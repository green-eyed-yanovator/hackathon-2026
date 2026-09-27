-- Presence, take two: one row per device (locking your phone doesn't sign your
-- laptop out), times stamped by the server (a wrong clock can't make anyone
-- look online or offline), and no deletes at all: realtime would announce them
-- to everyone. Leaving is here = false.

drop table public.presence;

create table public.presence (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device text not null check (char_length(device) between 8 and 64),
  here boolean not null default true,
  seen_at timestamptz not null default now(),
  primary key (user_id, device)
);

alter table public.presence enable row level security;
create policy "friends see who's around" on public.presence
  for select to authenticated
  using (user_id = (select auth.uid()) or private.are_friends(user_id, (select auth.uid())));
create policy "people say they're here" on public.presence
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "people come and go" on public.presence
  for update to authenticated using (user_id = (select auth.uid()));
revoke all on public.presence from anon, authenticated;
grant select on public.presence to authenticated;
-- (An upsert updates every column it sends, so device needs update too.)
grant insert (device, here), update (device, here) on public.presence to authenticated;

create function private.stamp_presence() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.seen_at := now();
  return new;
end;
$$;

create trigger stamp_presence
  before insert or update on public.presence
  for each row execute function private.stamp_presence();

alter publication supabase_realtime add table public.presence;

-- The same rule for locations, enforced here rather than trusted to clients:
-- stopping sharing is an update (shared = false). Accounts that are deleted
-- still take their rows with them.
drop policy "people stop sharing" on public.locations;
revoke delete on public.locations from authenticated;
