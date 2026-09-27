-- A public profile for every account. Emails stay private in auth.users.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 50),
  neighbourhood text check (char_length(neighbourhood) <= 80),
  bio text check (char_length(bio) <= 500),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles are readable" on public.profiles
  for select to anon, authenticated using (true);
create policy "users update their own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Rows are only created by the trigger below; clients may edit just these columns.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (display_name, neighbourhood, bio) on public.profiles to authenticated;

-- Create the profile in the same transaction as the account, so every user has one.
create function public.create_profile_for_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), -- Google / GitHub
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      'Neighbour'
    ), 50)
  );
  return new;
end;
$$;

create trigger create_profile_after_signup
  after insert on auth.users
  for each row execute function public.create_profile_for_new_user();

-- Accounts created before this migration.
insert into public.profiles (id, display_name)
select id, left(coalesce(nullif(trim(raw_user_meta_data ->> 'display_name'), ''), 'Neighbour'), 50)
from auth.users
on conflict (id) do nothing;

-- Author names on new posts and replies now come from the profile...
create function public.current_display_name() returns text
language sql stable set search_path = ''
as $$
  select display_name from public.profiles where id = auth.uid()
$$;

alter table public.posts alter column author_name set default public.current_display_name();
alter table public.replies alter column author_name set default public.current_display_name();

-- ...and follow renames, so older posts show the current name too.
create function public.sync_author_name() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.posts set author_name = new.display_name where author_id = new.id;
  update public.replies set author_name = new.display_name where author_id = new.id;
  return new;
end;
$$;

create trigger sync_author_name_after_rename
  after update of display_name on public.profiles
  for each row when (old.display_name is distinct from new.display_name)
  execute function public.sync_author_name();
