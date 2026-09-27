-- From map-fix-tomorrow: posts belong to a place (posts within ~30 m share one
-- marker), carry a flair, and can have photos or videos attached.

create table public.places (
  id uuid primary key default gen_random_uuid(),
  latitude double precision not null,
  longitude double precision not null,
  created_at timestamptz not null default now()
);

alter table public.places enable row level security;
create policy "places are public" on public.places
  for select to anon, authenticated using (true);
create policy "signed-in users add places" on public.places
  for insert to authenticated with check (true);
revoke all on public.places from anon, authenticated;
grant select on public.places to anon, authenticated;
grant insert (latitude, longitude) on public.places to authenticated;

-- Older posts have no place; the app treats each of them as its own place.
alter table public.posts
  add column place_id uuid references public.places (id),
  add column flair text not null default 'general'
    check (flair in ('general', 'food', 'music', 'sports', 'event', 'lost'));

grant insert (place_id, flair) on public.posts to authenticated;

create table public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  media_type text not null check (media_type in ('image', 'video')),
  url text not null,
  created_at timestamptz not null default now()
);

create index post_media_post_idx on public.post_media (post_id, created_at);

alter table public.post_media enable row level security;
create policy "media is public" on public.post_media
  for select to anon, authenticated using (true);
create policy "authors attach media to their pins" on public.post_media
  for insert to authenticated
  with check (exists (select 1 from public.posts where id = post_id and author_id = (select auth.uid())));
revoke all on public.post_media from anon, authenticated;
grant select on public.post_media to anon, authenticated;
grant insert (post_id, media_type, url) on public.post_media to authenticated;

alter publication supabase_realtime add table public.post_media;

-- Uploads live in a public bucket, one folder per post; only the post's
-- author can upload into it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-media', 'post-media', true, 52428800, array['image/*', 'video/*'])
on conflict (id) do nothing;

create policy "post media is public" on storage.objects
  for select to anon, authenticated using (bucket_id = 'post-media');
create policy "authors upload media for their pins" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'post-media'
    and exists (
      select 1 from public.posts
      where id::text = (storage.foldername(name))[1] and author_id = (select auth.uid())
    )
  );

-- A place with no posts left has nothing to show; remove it with its last post.
create function public.forget_empty_place() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.places
  where id = old.place_id
    and not exists (select 1 from public.posts where place_id = old.place_id);

  return old;
end;
$$;

create trigger forget_empty_place
  after delete on public.posts
  for each row when (old.place_id is not null)
  execute function public.forget_empty_place();
