-- Saved pins, direct messages and notifications. All private to their users.

create table public.saved_posts (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (sender_id <> recipient_id)
);

create index messages_recipient_idx on public.messages (recipient_id, created_at);
create index messages_sender_idx on public.messages (sender_id, created_at);

-- Written only by the triggers below. Names and titles are copied in so a
-- realtime payload is enough to render the notification.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('reply', 'saved_reply', 'save')),
  actor_id uuid references auth.users (id) on delete cascade,
  actor_name text,
  post_id uuid references public.posts (id) on delete cascade,
  post_title text,
  preview text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index notifications_user_idx on public.notifications (user_id, created_at);

alter table public.saved_posts enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;

create policy "users see their saved pins" on public.saved_posts
  for select to authenticated using (user_id = (select auth.uid()));
create policy "users save pins" on public.saved_posts
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "users unsave pins" on public.saved_posts
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "participants read messages" on public.messages
  for select to authenticated
  using ((select auth.uid()) in (sender_id, recipient_id));
create policy "users send as themselves" on public.messages
  for insert to authenticated with check (sender_id = (select auth.uid()));
create policy "recipients mark messages read" on public.messages
  for update to authenticated using (recipient_id = (select auth.uid()));

create policy "users read their notifications" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy "users mark their notifications read" on public.notifications
  for update to authenticated using (user_id = (select auth.uid()));

-- Clients get only what the UI needs; everything else comes from defaults and triggers.
revoke all on public.saved_posts, public.messages, public.notifications from anon, authenticated;
grant select, delete on public.saved_posts to authenticated;
grant insert (post_id) on public.saved_posts to authenticated;
grant select on public.messages, public.notifications to authenticated;
grant insert (recipient_id, body) on public.messages to authenticated;
grant update (read_at) on public.messages, public.notifications to authenticated;

alter publication supabase_realtime add table public.messages, public.notifications;

-- A reply notifies the pin's author and everyone who saved the pin.
create function public.notify_reply() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  post public.posts;
begin
  select * into post from public.posts where id = new.post_id;

  if post.author_id <> new.author_id then
    insert into public.notifications (user_id, kind, actor_id, actor_name, post_id, post_title, preview)
    values (post.author_id, 'reply', new.author_id, new.author_name, post.id, post.title, left(new.content, 140));
  end if;

  insert into public.notifications (user_id, kind, actor_id, actor_name, post_id, post_title, preview)
  select saved.user_id, 'saved_reply', new.author_id, new.author_name, post.id, post.title, left(new.content, 140)
  from public.saved_posts saved
  where saved.post_id = post.id
    and saved.user_id <> new.author_id
    and saved.user_id is distinct from post.author_id;

  return new;
end;
$$;

create trigger notify_reply
  after insert on public.replies
  for each row execute function public.notify_reply();

-- Saving someone's pin tells them.
create function public.notify_save() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.notifications (user_id, kind, actor_id, actor_name, post_id, post_title)
  select post.author_id, 'save', new.user_id,
    (select display_name from public.profiles where id = new.user_id),
    post.id, post.title
  from public.posts post
  where post.id = new.post_id and post.author_id <> new.user_id;

  return new;
end;
$$;

create trigger notify_save
  after insert on public.saved_posts
  for each row execute function public.notify_save();
