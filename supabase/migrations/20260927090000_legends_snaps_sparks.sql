-- The neighbourhood's lore, made by the neighbours: sightings (a bear on the
-- bike path, something big in the parklands at 3am) and stories, voted up and
-- down like Reddit; enough votes and a pin becomes a Legend and stays on the
-- map for good. Snaps are the opposite: a photo that's gone in a day, unless it
-- too gets voted into the lore. Anyone at a meetup can add their photos to it.
-- And for coming back: a daily streak, sparks, and silly things to spend them on.
--
-- The crews and their turf go: they weren't what this is about.

drop function public.tag_block(uuid, double precision, double precision, integer);
drop function public.join_crew(text);
drop function private.holder(uuid);
alter publication supabase_realtime drop table public.tags;
drop table public.tags;
alter table public.profiles drop column crew, drop column crew_since;
delete from public.notifications where kind = 'turf';

--
-- Kinds of pin: sightings, stories, snaps.
--

alter table public.posts drop constraint posts_flair_check;
alter table public.posts add constraint posts_flair_check
  check (flair in ('general', 'food', 'music', 'sports', 'event', 'lost', 'sighting', 'story', 'snap'));

alter table public.posts
  add column expires_at timestamptz, -- snaps: gone after a day
  add column legend_at timestamptz, -- voted into the lore: stays for good
  add column boosted_until timestamptz; -- someone spent sparks to make it stand out

-- A snap lasts a day; nothing else runs out. A pin can't become a snap or stop
-- being one later.
create function private.snap_lifetime() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (old.flair = 'snap') <> (new.flair = 'snap') then
    raise exception 'A snap stays a snap' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    new.expires_at := case when new.flair = 'snap' then now() + interval '24 hours' end;
  end if;
  return new;
end;
$$;
create trigger snap_lifetime before insert or update of flair on public.posts
  for each row execute function private.snap_lifetime();

-- A snap that's run out is gone for everyone but its author, unless it became a legend.
drop policy "posts are readable" on public.posts;
create policy "posts are readable" on public.posts
  for select to anon, authenticated
  using (expires_at is null or expires_at > now() or legend_at is not null or author_id = (select auth.uid()));

--
-- Votes on pins, and legends.
--

create table public.post_votes (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.post_votes enable row level security;
create policy "votes on pins are public" on public.post_votes for select to anon, authenticated using (true);
create policy "people vote on pins as themselves" on public.post_votes
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "people change their vote on pins" on public.post_votes
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "people take back their vote on pins" on public.post_votes
  for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.post_votes from anon, authenticated;
grant select on public.post_votes to anon, authenticated;
grant insert (post_id, value), update (value), delete on public.post_votes to authenticated;

-- Three more up than down makes a legend, for good.
create function private.maybe_legend() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  post public.posts;
  score integer;
begin
  select * into post from public.posts where id = coalesce(new.post_id, old.post_id);
  if post.id is null or post.legend_at is not null then
    return null;
  end if;
  select coalesce(sum(value), 0) into score from public.post_votes where post_id = post.id;
  if score >= 3 then
    update public.posts set legend_at = now() where id = post.id;
    perform private.notify(post.author_id, 'legend', null, post, null);
    perform private.give_sparks(post.author_id, 10);
  end if;
  return null;
end;
$$;
create trigger maybe_legend after insert or update or delete on public.post_votes
  for each row execute function private.maybe_legend();

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('reply', 'saved_reply', 'thread_reply', 'save', 'interest', 'resolved',
    'friend_request', 'friend_accept', 'friend_post', 'mention', 'comment_reply', 'word_reply', 'legend'));

--
-- Meetup albums: anyone can add their photos and videos to a pin, in its thread.
--

alter table public.post_media
  add column author_id uuid default auth.uid() references auth.users (id) on delete cascade,
  add column reply_id uuid references public.replies (id) on delete cascade;
update public.post_media m set author_id = p.author_id from public.posts p where p.id = m.post_id and m.author_id is null;

drop policy "authors attach media to their pins" on public.post_media;
create policy "people add their photos to pins" on public.post_media
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and exists (select 1 from public.posts where id = post_id)
    and (reply_id is null or exists (select 1 from public.replies r where r.id = reply_id and r.post_id = post_media.post_id and r.author_id = (select auth.uid())))
  );
create policy "people take back their photos" on public.post_media
  for delete to authenticated using (author_id = (select auth.uid()));
grant insert (reply_id), delete on public.post_media to authenticated;

-- Uploads: the pin's author into its folder, as before; anyone else into a
-- folder of their own inside it.
create policy "people upload their own photos to a pin" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'post-media'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and exists (select 1 from public.posts where id::text = (storage.foldername(name))[1])
  );

--
-- Sparks: a daily streak, and what they buy.
--

alter table public.profiles
  add column streak integer not null default 0, -- days in a row the app was opened
  add column streak_day date, -- the last of those days, where the person is
  add column sparks integer not null default 0, -- to spend
  add column sparks_earned integer not null default 0; -- ever, for the badge

create function private.give_sparks(who uuid, amount integer) returns void
language sql security definer set search_path = ''
as $$
  update public.profiles set sparks = sparks + amount, sparks_earned = sparks_earned + greatest(amount, 0) where id = who
$$;
revoke all on function private.give_sparks(uuid, integer) from public;

-- Once a day: the streak goes on (or starts again), and a spark for coming back,
-- five more every seventh day. `today` is the date where the person is; it may
-- be a day either side of the server's. Says what it gave, and the profile now.
create function public.check_in_day(today date) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles;
  prize integer;
begin
  if abs(today - (now() at time zone 'utc')::date) > 1 then
    raise exception 'That isn''t today' using errcode = '22023';
  end if;
  select * into me from public.profiles where id = auth.uid() for update;
  if me.id is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if me.streak_day is not null and me.streak_day >= today then
    return jsonb_build_object('prize', 0, 'profile', to_jsonb(me));
  end if;
  me.streak := case when me.streak_day = today - 1 then me.streak + 1 else 1 end;
  prize := case when me.streak % 7 = 0 then 6 else 1 end;
  update public.profiles
  set streak = me.streak, streak_day = today, sparks = sparks + prize, sparks_earned = sparks_earned + prize
  where id = me.id
  returning * into me;
  return jsonb_build_object('prize', prize, 'profile', to_jsonb(me));
end;
$$;
revoke execute on function public.check_in_day(date) from public, anon;
grant execute on function public.check_in_day(date) to authenticated;

-- An up-vote from someone else is a spark for the pin's author, once per voter.
create table private.vote_rewards (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  primary key (post_id, user_id)
);
create function private.reward_vote() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  author uuid;
begin
  select author_id into author from public.posts where id = new.post_id;
  if new.value = 1 and author is not null and author <> new.user_id then
    insert into private.vote_rewards (post_id, user_id) values (new.post_id, new.user_id) on conflict do nothing;
    if found then
      perform private.give_sparks(author, 1);
    end if;
  end if;
  return null;
end;
$$;
create trigger reward_vote after insert or update of value on public.post_votes
  for each row execute function private.reward_vote();

-- Stickers: an emoji dropped on the map for a day. Footprints where the thing
-- was seen, a ghost over the old gaol, confetti on a party.
create table public.stickers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  emoji text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);
alter table public.stickers enable row level security;
create policy "stickers are up for a day" on public.stickers for select to anon, authenticated using (expires_at > now());
create policy "people peel off their own stickers" on public.stickers for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.stickers from anon, authenticated;
grant select on public.stickers to anon, authenticated;
grant delete on public.stickers to authenticated;

create function public.drop_sticker(emoji text, latitude double precision, longitude double precision) returns public.stickers
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles;
  sticker public.stickers;
begin
  select * into me from public.profiles where id = auth.uid() for update;
  if me.id is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not (emoji = any (array['👣', '👻', '🛸', '🐻', '🦝', '👀', '💀', '🔥', '🎉', '🍕', '🎸', '🌈'])) then
    raise exception 'Not one of the stickers' using errcode = '22023';
  end if;
  if me.sparks < 3 then
    raise exception 'A sticker is 3 sparks' using errcode = '54000';
  end if;
  update public.profiles set sparks = sparks - 3 where id = me.id;
  insert into public.stickers (emoji, latitude, longitude) values (drop_sticker.emoji, drop_sticker.latitude, drop_sticker.longitude)
  returning * into sticker;
  return sticker;
end;
$$;
revoke execute on function public.drop_sticker(text, double precision, double precision) from public, anon;
grant execute on function public.drop_sticker(text, double precision, double precision) to authenticated;

-- Boosting a pin: it stands out on the map and tops the feed for twelve hours.
create function public.boost_post(post uuid) returns public.posts
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles;
  boosted public.posts;
begin
  select * into me from public.profiles where id = auth.uid() for update;
  if me.id is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if me.sparks < 10 then
    raise exception 'A boost is 10 sparks' using errcode = '54000';
  end if;
  update public.posts set boosted_until = greatest(coalesce(boosted_until, now()), now()) + interval '12 hours'
  where id = post and (expires_at is null or expires_at > now() or legend_at is not null)
  returning * into boosted;
  if boosted.id is null then
    raise exception 'No such pin' using errcode = '22023';
  end if;
  update public.profiles set sparks = sparks - 10 where id = me.id;
  return boosted;
end;
$$;
revoke execute on function public.boost_post(uuid) from public, anon;
grant execute on function public.boost_post(uuid) to authenticated;

alter publication supabase_realtime add table public.post_votes, public.stickers;
