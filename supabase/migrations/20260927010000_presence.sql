-- Who has the app open, for friends' eyes only. (A shared realtime presence
-- channel would tell every client who's online.) A row is refreshed every
-- minute while the app is in view and removed when it isn't.

create table public.presence (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  seen_at timestamptz not null default now()
);

alter table public.presence enable row level security;
create policy "friends see who's around" on public.presence
  for select to authenticated
  using (user_id = (select auth.uid()) or private.are_friends(user_id, (select auth.uid())));
create policy "people say they're here" on public.presence
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "people stay here" on public.presence
  for update to authenticated using (user_id = (select auth.uid()));
create policy "people leave" on public.presence
  for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.presence from anon, authenticated;
grant select, delete on public.presence to authenticated;
grant insert (seen_at), update (seen_at) on public.presence to authenticated;

alter publication supabase_realtime add table public.presence;
