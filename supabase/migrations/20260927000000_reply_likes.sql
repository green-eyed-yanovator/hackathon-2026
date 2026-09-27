-- A heart on a reply: the smallest way to say "yes, this".

create table public.reply_likes (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reply_id uuid not null references public.replies (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, reply_id)
);

alter table public.reply_likes enable row level security;
create policy "likes are public" on public.reply_likes
  for select to anon, authenticated using (true);
create policy "people like as themselves" on public.reply_likes
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "people take back their likes" on public.reply_likes
  for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.reply_likes from anon, authenticated;
grant select on public.reply_likes to anon, authenticated;
grant insert (reply_id), delete on public.reply_likes to authenticated;

alter publication supabase_realtime add table public.reply_likes;
