-- Posting requires an account; reading stays public.
-- The author is filled in by the database from the caller's JWT, never sent by the client.

alter table public.posts
  add column author_id uuid default auth.uid() references auth.users (id) on delete cascade,
  add column author_name text default (auth.jwt() -> 'user_metadata' ->> 'display_name');

alter table public.replies
  add column author_id uuid default auth.uid() references auth.users (id) on delete cascade,
  add column author_name text default (auth.jwt() -> 'user_metadata' ->> 'display_name');

-- Rows created before accounts existed keep a null author.

-- Clients may only write the content columns, so author_* always come from the defaults above.
revoke insert on public.posts, public.replies from anon, authenticated;
grant insert (title, description, latitude, longitude) on public.posts to authenticated;
grant insert (post_id, content) on public.replies to authenticated;

drop policy "anyone can create posts" on public.posts;
drop policy "anyone can create replies" on public.replies;

create policy "signed-in users create their own posts" on public.posts
  for insert to authenticated with check (author_id = (select auth.uid()));
create policy "signed-in users create their own replies" on public.replies
  for insert to authenticated with check (author_id = (select auth.uid()));
