-- Post history (edits, resolving, deleting) and notification settings.

-- Posts: authors can edit, resolve and delete their own pins.
alter table public.posts
  add column edited_at timestamptz,
  add column resolved_at timestamptz;

-- Supabase grants table-wide UPDATE by default: take it back, then allow only
-- these columns (revoking at table level also clears column grants, so revoke first).
revoke update on public.posts, public.replies from anon, authenticated;
grant update (title, description, resolved_at) on public.posts to authenticated;
grant delete on public.posts to authenticated;

create policy "authors edit their pins" on public.posts
  for update to authenticated using (author_id = (select auth.uid()));
create policy "authors delete their pins" on public.posts
  for delete to authenticated using (author_id = (select auth.uid()));

-- Every edit keeps the previous version, publicly, so edits are transparent.
create table public.post_revisions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  title text not null,
  description text not null,
  replaced_at timestamptz not null default now()
);

create index post_revisions_post_idx on public.post_revisions (post_id, replaced_at);

alter table public.post_revisions enable row level security;
create policy "revisions are public" on public.post_revisions
  for select to anon, authenticated using (true);
revoke all on public.post_revisions from anon, authenticated;
grant select on public.post_revisions to anon, authenticated;

create function public.keep_revision() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.title is distinct from old.title or new.description is distinct from old.description then
    insert into public.post_revisions (post_id, title, description)
    values (old.id, old.title, old.description);
    new.edited_at := now();
  end if;

  return new;
end;
$$;

create trigger keep_revision
  before update on public.posts
  for each row execute function public.keep_revision();

-- Edits, resolves and deletes reach other screens live.
alter table public.posts replica identity full;

-- Which kinds of notification each user has turned off.
create table public.notification_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  muted_kinds text[] not null default '{}'
);

alter table public.notification_settings enable row level security;
create policy "users read their settings" on public.notification_settings
  for select to authenticated using (user_id = (select auth.uid()));
create policy "users create their settings" on public.notification_settings
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "users change their settings" on public.notification_settings
  for update to authenticated using (user_id = (select auth.uid()));
revoke all on public.notification_settings from anon, authenticated;
grant select on public.notification_settings to authenticated;
grant insert (muted_kinds), update (muted_kinds) on public.notification_settings to authenticated;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('reply', 'saved_reply', 'thread_reply', 'save', 'interest', 'resolved'));

-- One place that decides whether someone hears about something: never about
-- their own actions, and never for a kind they've muted.
create function public.notify(recipient uuid, kind text, actor uuid, post public.posts, preview text default null)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.notifications (user_id, kind, actor_id, actor_name, post_id, post_title, preview)
  select recipient, kind, actor,
    (select display_name from public.profiles where id = actor),
    post.id, post.title, left(preview, 140)
  where recipient is not null
    and recipient is distinct from actor
    and not exists (
      select 1 from public.notification_settings settings
      where settings.user_id = recipient and kind = any (settings.muted_kinds)
    )
$$;

-- A reply reaches the author, everyone who saved the pin, and everyone else
-- already in the thread. Each person gets at most one notification.
create or replace function public.notify_reply() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  post public.posts;
begin
  select * into post from public.posts where id = new.post_id;

  perform public.notify(post.author_id, 'reply', new.author_id, post, new.content);

  perform public.notify(saved.user_id, 'saved_reply', new.author_id, post, new.content)
  from public.saved_posts saved
  where saved.post_id = post.id and saved.user_id is distinct from post.author_id;

  perform public.notify(thread.author_id, 'thread_reply', new.author_id, post, new.content)
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
  perform public.notify(post.author_id, 'save', new.user_id, post)
  from public.posts post where post.id = new.post_id;

  return new;
end;
$$;

create or replace function public.notify_interest() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.notify(post.author_id, 'interest', new.user_id, post)
  from public.posts post where post.id = new.post_id;

  return new;
end;
$$;

-- Resolving a pin tells everyone following it: savers, interested, repliers.
create function public.notify_resolved() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.notify(follower.user_id, 'resolved', new.author_id, new)
  from (
    select user_id from public.saved_posts where post_id = new.id
    union select user_id from public.post_interest where post_id = new.id
    union select author_id from public.replies where post_id = new.id
  ) follower;

  return new;
end;
$$;

create trigger notify_resolved
  after update of resolved_at on public.posts
  for each row when (old.resolved_at is null and new.resolved_at is not null)
  execute function public.notify_resolved();
