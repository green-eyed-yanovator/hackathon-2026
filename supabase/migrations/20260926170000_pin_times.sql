-- When something happens: a BBQ tonight at 7, a clean-up on Saturday at 9. Optional.

alter table public.posts add column starts_at timestamptz;
grant insert (starts_at), update (starts_at) on public.posts to authenticated;
