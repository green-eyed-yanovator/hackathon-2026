-- Friends, and live locations shared only with them.

-- One row per pair. The requester sends it; it's a friendship once the addressee accepts.
create table public.friendships (
  requester uuid not null default auth.uid() references auth.users (id) on delete cascade,
  addressee uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (requester, addressee),
  check (requester <> addressee)
);

-- A asking B and B asking A is still one friendship.
create unique index friendships_pair_idx
  on public.friendships (least(requester, addressee), greatest(requester, addressee));
create index friendships_addressee_idx on public.friendships (addressee);

alter table public.friendships enable row level security;

create policy "people see their own friendships" on public.friendships
  for select to authenticated using ((select auth.uid()) in (requester, addressee));
create policy "people send requests as themselves" on public.friendships
  for insert to authenticated with check (requester = (select auth.uid()) and accepted_at is null);
create policy "addressees accept requests" on public.friendships
  for update to authenticated using (addressee = (select auth.uid()));
create policy "either side can end it" on public.friendships
  for delete to authenticated using ((select auth.uid()) in (requester, addressee));

revoke all on public.friendships from anon, authenticated;
grant select, delete on public.friendships to authenticated;
grant insert (addressee) on public.friendships to authenticated;
grant update (accepted_at) on public.friendships to authenticated;

create function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.friendships
    where accepted_at is not null
      and ((requester = a and addressee = b) or (requester = b and addressee = a))
  )
$$;

-- Where someone is right now. A row exists only while they're sharing.
create table public.locations (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  accuracy real,
  heading real,
  updated_at timestamptz not null default now()
);

alter table public.locations enable row level security;

create policy "friends see each other" on public.locations
  for select to authenticated
  using (user_id = (select auth.uid()) or public.are_friends(user_id, (select auth.uid())));
create policy "people share their own location" on public.locations
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "people move their own location" on public.locations
  for update to authenticated using (user_id = (select auth.uid()));
create policy "people stop sharing" on public.locations
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.locations from anon, authenticated;
grant select, delete on public.locations to authenticated;
grant insert (latitude, longitude, accuracy, heading),
  update (latitude, longitude, accuracy, heading) on public.locations to authenticated;

create function public.touch_location() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger touch_location
  before update on public.locations
  for each row execute function public.touch_location();

alter publication supabase_realtime add table public.friendships, public.locations;

-- Friend requests and acceptances show up as notifications.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('reply', 'saved_reply', 'thread_reply', 'save', 'interest', 'resolved', 'friend_request', 'friend_accept'));

create function public.notify_friendship() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.accepted_at is null then
      perform public.notify(new.addressee, 'friend_request', new.requester, null::public.posts);
    end if;
  elsif old.accepted_at is null and new.accepted_at is not null then
    perform public.notify(new.requester, 'friend_accept', new.addressee, null::public.posts);
  end if;

  return new;
end;
$$;

create trigger notify_friendship
  after insert or update of accepted_at on public.friendships
  for each row execute function public.notify_friendship();

-- Names in the app come from profiles, loaded once and kept live.
alter publication supabase_realtime add table public.profiles;
