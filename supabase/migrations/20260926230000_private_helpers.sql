-- Helper functions out of the API's reach.
--
-- Everything in the public schema can be called by any client over the API.
-- These helpers are for row security and triggers only: are_friends and
-- has_blocked would tell anyone who's friends with or blocked whom, and notify
-- would let anyone send notifications as anyone. The private schema isn't
-- exposed, so they live there now. notify also stops at blocks.

create schema if not exists private;
grant usage on schema private to authenticated; -- row security calls them as the signed-in user

create function private.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.friendships
    where accepted_at is not null
      and ((requester = a and addressee = b) or (requester = b and addressee = a))
  )
$$;

create function private.has_blocked(who uuid, whom uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.blocks where blocker = who and blocked = whom)
$$;

revoke all on function private.are_friends(uuid, uuid), private.has_blocked(uuid, uuid) from public;
grant execute on function private.are_friends(uuid, uuid), private.has_blocked(uuid, uuid) to authenticated;

-- Only ever called from the triggers below, which run as their owner.
create function private.notify(recipient uuid, kind text, actor uuid, post public.posts, preview text default null)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.notifications (user_id, kind, actor_id, actor_name, post_id, post_title, preview)
  select recipient, kind, actor,
    (select display_name from public.profiles where id = actor),
    post.id, post.title, left(preview, 140)
  where recipient is not null
    and recipient is distinct from actor
    and not private.has_blocked(recipient, actor)
    and not exists (
      select 1 from public.notification_settings settings
      where settings.user_id = recipient and kind = any (settings.muted_kinds)
    )
$$;

revoke all on function private.notify(uuid, text, uuid, public.posts, text) from public;

drop policy "friends see each other" on public.locations;
create policy "friends see each other" on public.locations
  for select to authenticated
  using (user_id = (select auth.uid()) or private.are_friends(user_id, (select auth.uid())));

drop policy "users send as themselves" on public.messages;
create policy "users send as themselves" on public.messages
  for insert to authenticated
  with check (sender_id = (select auth.uid()) and not private.has_blocked(recipient_id, sender_id));

drop policy "people send requests as themselves" on public.friendships;
create policy "people send requests as themselves" on public.friendships
  for insert to authenticated
  with check (requester = (select auth.uid()) and accepted_at is null and not private.has_blocked(addressee, requester));

-- The triggers, as before, notifying through private.notify.

create or replace function public.notify_reply() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  post public.posts;
begin
  select * into post from public.posts where id = new.post_id;

  perform private.notify(post.author_id, 'reply', new.author_id, post, new.content);

  perform private.notify(saved.user_id, 'saved_reply', new.author_id, post, new.content)
  from public.saved_posts saved
  where saved.post_id = post.id and saved.user_id is distinct from post.author_id;

  perform private.notify(thread.author_id, 'thread_reply', new.author_id, post, new.content)
  from (select distinct author_id from public.replies where post_id = post.id and id <> new.id) thread
  where thread.author_id is distinct from post.author_id
    and not exists (
      select 1 from public.saved_posts saved
      where saved.post_id = post.id and saved.user_id = thread.author_id
    );

  return new;
end;
$$;

create or replace function public.notify_save() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.notify(post.author_id, 'save', new.user_id, post)
  from public.posts post where post.id = new.post_id;

  return new;
end;
$$;

create or replace function public.notify_interest() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.notify(post.author_id, 'interest', new.user_id, post)
  from public.posts post where post.id = new.post_id;

  return new;
end;
$$;

create or replace function public.notify_resolved() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.notify(follower.user_id, 'resolved', new.author_id, new)
  from (
    select user_id from public.saved_posts where post_id = new.id
    union select user_id from public.post_interest where post_id = new.id
    union select author_id from public.replies where post_id = new.id
  ) follower;

  return new;
end;
$$;

create or replace function public.notify_friendship() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.accepted_at is null then
      perform private.notify(new.addressee, 'friend_request', new.requester, null::public.posts);
    end if;
  elsif old.accepted_at is null and new.accepted_at is not null then
    perform private.notify(new.requester, 'friend_accept', new.addressee, null::public.posts);
  end if;

  return new;
end;
$$;

create or replace function public.notify_friend_post() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.notify(friend.id, 'friend_post', new.author_id, new, new.description)
  from (
    select case when requester = new.author_id then addressee else requester end as id
    from public.friendships
    where accepted_at is not null and new.author_id in (requester, addressee)
  ) friend;

  return new;
end;
$$;

create or replace function public.notify_mentions() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  post public.posts;
begin
  select * into post from public.posts where id = new.post_id;

  perform private.notify(person.id, 'mention', new.author_id, post, new.content)
  from public.profiles person
  -- "@Name" followed by anything but a letter or digit, so @Ben isn't @Benjamin.
  where lower(new.content) ~ ('@' || regexp_replace(lower(person.display_name), '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '([^[:alnum:]]|$)')
    and person.display_name <> 'Neighbour' -- everyone's name before they choose one
    and person.id is distinct from post.author_id -- the author already hears about every reply
    and not exists (select 1 from public.replies r where r.post_id = post.id and r.author_id = person.id and r.id <> new.id)
    and not exists (select 1 from public.saved_posts s where s.post_id = post.id and s.user_id = person.id);

  return new;
end;
$$;

drop function public.notify(uuid, text, uuid, public.posts, text);
drop function public.are_friends(uuid, uuid);
drop function public.has_blocked(uuid, uuid);
