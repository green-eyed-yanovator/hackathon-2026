-- "Interested" on a pin: one tap to say you're in (a BBQ, a bench proposal, a lost pet).
-- Public, so everyone sees how much interest a pin has and who.

create table public.post_interest (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

alter table public.post_interest enable row level security;

create policy "interest is public" on public.post_interest
  for select to anon, authenticated using (true);
create policy "users mark interest" on public.post_interest
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "users unmark interest" on public.post_interest
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.post_interest from anon, authenticated;
grant select on public.post_interest to anon, authenticated;
grant insert (post_id) on public.post_interest to authenticated;
grant delete on public.post_interest to authenticated;

-- Realtime DELETE payloads carry the primary key, which here is both columns.
alter publication supabase_realtime add table public.post_interest;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('reply', 'saved_reply', 'save', 'interest'));

create function public.notify_interest() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.notifications (user_id, kind, actor_id, actor_name, post_id, post_title)
  select post.author_id, 'interest', new.user_id,
    (select display_name from public.profiles where id = new.user_id),
    post.id, post.title
  from public.posts post
  where post.id = new.post_id and post.author_id <> new.user_id;

  return new;
end;
$$;

create trigger notify_interest
  after insert on public.post_interest
  for each row execute function public.notify_interest();
