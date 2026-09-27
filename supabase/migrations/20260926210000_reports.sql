-- Flagging a pin for whoever looks after the neighbourhood. Reporters see only
-- their own reports; reading them all is for the service role (the dashboard).

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid not null default auth.uid() references auth.users (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  reason text not null check (reason in ('spam', 'unkind', 'unsafe', 'other')),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (reporter, post_id)
);

alter table public.reports enable row level security;
create policy "reporters see their reports" on public.reports
  for select to authenticated using (reporter = (select auth.uid()));
create policy "signed-in people report" on public.reports
  for insert to authenticated with check (reporter = (select auth.uid()));
revoke all on public.reports from anon, authenticated;
grant select on public.reports to authenticated;
grant insert (post_id, reason, note) on public.reports to authenticated;
