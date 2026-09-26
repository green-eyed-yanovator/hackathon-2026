-- Schema inferred from the Post/Reply types in src/App.tsx (MVP, commit d665886).

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  latitude double precision not null,
  longitude double precision not null,
  created_at timestamptz not null default now()
);

create table public.replies (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create index replies_post_id_idx on public.replies (post_id);

-- No auth in the app yet: anyone may read and create, nobody may edit or delete.
alter table public.posts enable row level security;
alter table public.replies enable row level security;

create policy "posts are readable" on public.posts
  for select to anon, authenticated using (true);
create policy "anyone can create posts" on public.posts
  for insert to anon, authenticated with check (true);

create policy "replies are readable" on public.replies
  for select to anon, authenticated using (true);
create policy "anyone can create replies" on public.replies
  for insert to anon, authenticated with check (true);

-- The MVP subscribes to INSERTs on both tables.
alter publication supabase_realtime add table public.posts, public.replies;
