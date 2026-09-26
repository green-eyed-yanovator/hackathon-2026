-- Blocking someone: they can't message you or send you friend requests, and
-- you stop seeing their pins, replies and messages. Private to the blocker.

create table public.blocks (
  blocker uuid not null default auth.uid() references auth.users (id) on delete cascade,
  blocked uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);

alter table public.blocks enable row level security;
create policy "people see who they blocked" on public.blocks
  for select to authenticated using (blocker = (select auth.uid()));
create policy "people block" on public.blocks
  for insert to authenticated with check (blocker = (select auth.uid()));
create policy "people unblock" on public.blocks
  for delete to authenticated using (blocker = (select auth.uid()));
revoke all on public.blocks from anon, authenticated;
grant select, delete on public.blocks to authenticated;
grant insert (blocked) on public.blocks to authenticated;

create function public.has_blocked(who uuid, whom uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.blocks where blocker = who and blocked = whom)
$$;

-- Messages and friend requests don't reach someone who blocked you.
drop policy "users send as themselves" on public.messages;
create policy "users send as themselves" on public.messages
  for insert to authenticated
  with check (sender_id = (select auth.uid()) and not public.has_blocked(recipient_id, sender_id));

drop policy "people send requests as themselves" on public.friendships;
create policy "people send requests as themselves" on public.friendships
  for insert to authenticated
  with check (requester = (select auth.uid()) and accepted_at is null and not public.has_blocked(addressee, requester));
