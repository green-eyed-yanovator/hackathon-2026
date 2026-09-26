-- Profile photos. The app crops and shrinks them before upload, so they're small.

alter table public.profiles add column avatar_url text check (char_length(avatar_url) <= 500);
grant update (avatar_url) on public.profiles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Anyone can look; each person writes only inside their own folder.
create policy "avatars are public" on storage.objects
  for select to anon, authenticated using (bucket_id = 'avatars');
create policy "people upload their own avatar" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "people remove their old avatars" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
