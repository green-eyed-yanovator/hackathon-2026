-- City blocks, and what people make of them.
--
-- A block is the ground the streets close round. The app finds it from the map's
-- own streets when someone first does something with it, and it's kept from then
-- on: pins cover blocks, people write on them and vote the lines up and down, the
-- best-liked name becomes what the block is called, and four crews fight over
-- them by tagging them in person.
--
-- This replaces the drawn areas and the Lore pins: a place's lore is what
-- people say about it, not a kind of pin.

create table public.city_blocks (
  id uuid primary key default gen_random_uuid(),
  ring jsonb not null, -- its corners, [[lng, lat], ...], going round
  latitude double precision not null, -- a spot well inside it, where its name goes
  longitude double precision not null,
  shape polygon not null, -- the ring again, for finding the block a spot is in
  found_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index city_blocks_shape_idx on public.city_blocks using gist (shape);

alter table public.city_blocks enable row level security;
create policy "blocks are public" on public.city_blocks for select to anon, authenticated using (true);
revoke all on public.city_blocks from anon, authenticated;
grant select (id, ring, latitude, longitude, created_at) on public.city_blocks to anon, authenticated;

create function private.ring_polygon(ring jsonb) returns polygon
language sql immutable set search_path = ''
as $$
  select ('(' || string_agg(format('(%s,%s)', c ->> 0, c ->> 1), ',' order by n) || ')')::polygon
  from jsonb_array_elements(ring) with ordinality as e (c, n)
$$;

-- The block a ring of corners describes: the one already known there, or a new
-- one. The spot must be inside the ring, and every corner near it.
create function public.block_for(ring jsonb, latitude double precision, longitude double precision) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  found uuid;
  shape polygon;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if jsonb_typeof(ring) <> 'array' or jsonb_array_length(ring) not between 3 and 400 or exists (
    select 1 from jsonb_array_elements(ring) as c
    where jsonb_typeof(c) <> 'array' or jsonb_array_length(c) <> 2
       or jsonb_typeof(c -> 0) <> 'number' or jsonb_typeof(c -> 1) <> 'number'
       or abs((c ->> 0)::double precision - longitude) > 0.02
       or abs((c ->> 1)::double precision - latitude) > 0.015
  ) then
    raise exception 'That isn''t a block' using errcode = '22023';
  end if;
  shape := private.ring_polygon(ring);
  if not shape @> point(longitude, latitude) then
    raise exception 'That spot isn''t inside the block' using errcode = '22023';
  end if;

  -- One at a time, so two people finding the same block make it once.
  perform pg_advisory_xact_lock(4071);
  select b.id into found from public.city_blocks b
  where b.shape @> point(block_for.longitude, block_for.latitude)
  order by area(box(b.shape))
  limit 1;
  if found is null then
    if (select count(*) from public.city_blocks where found_by = auth.uid() and created_at > now() - interval '1 hour') >= 120 then
      raise exception 'That''s a lot of new blocks; try again in a while' using errcode = '54000';
    end if;
    insert into public.city_blocks (ring, latitude, longitude, shape)
    values (block_for.ring, block_for.latitude, block_for.longitude, shape)
    returning id into found;
  end if;
  return found;
end;
$$;
revoke execute on function public.block_for from public, anon;
grant execute on function public.block_for to authenticated;

-- Pins cover blocks now, instead of drawn areas; and lore isn't a kind of pin.
alter table public.posts drop constraint posts_area_valid;
alter table public.posts drop column area;
drop function private.valid_area;
alter table public.posts add column blocks uuid[] check (cardinality(blocks) <= 12);
grant insert (blocks), update (blocks) on public.posts to authenticated;

update public.posts set flair = 'general' where flair = 'lore';
alter table public.posts drop constraint posts_flair_check;
alter table public.posts add constraint posts_flair_check
  check (flair in ('general', 'food', 'music', 'sports', 'event', 'lost'));
alter table public.posts drop column year;

--
-- The word on the street: lines people write on a block, and names for it.
--

create table public.block_words (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null references public.city_blocks (id) on delete cascade,
  author_id uuid default auth.uid() references auth.users (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 200),
  is_name boolean not null default false, -- a name for the block, not something said about it
  created_at timestamptz not null default now(),
  check (not is_name or char_length(btrim(body)) <= 32)
);
create index block_words_block_idx on public.block_words (block_id);

alter table public.block_words enable row level security;
create policy "words are public" on public.block_words for select to anon, authenticated using (true);
create policy "people write as themselves" on public.block_words
  for insert to authenticated with check (author_id = (select auth.uid()));
create policy "people take back their own words" on public.block_words
  for delete to authenticated using (author_id = (select auth.uid()));
revoke all on public.block_words from anon, authenticated;
grant select on public.block_words to anon, authenticated;
grant insert (block_id, body, is_name), delete on public.block_words to authenticated;

create table public.word_votes (
  word_id uuid not null references public.block_words (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (word_id, user_id)
);

alter table public.word_votes enable row level security;
create policy "votes are public" on public.word_votes for select to anon, authenticated using (true);
create policy "people vote as themselves" on public.word_votes
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "people change their vote" on public.word_votes
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "people take back their vote" on public.word_votes
  for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.word_votes from anon, authenticated;
grant select, delete on public.word_votes to authenticated;
grant select on public.word_votes to anon;
grant insert (word_id, value), update (value) on public.word_votes to authenticated;

-- Writers back their own words, the way a new post starts on one point.
create function private.back_own_word() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.author_id is not null then
    insert into public.word_votes (word_id, user_id, value) values (new.id, new.author_id, 1) on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger back_own_word after insert on public.block_words
  for each row execute function private.back_own_word();

-- Not too much at once.
create function private.words_in_moderation() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select count(*) from public.block_words where author_id = new.author_id and created_at > now() - interval '10 minutes') >= 20 then
    raise exception 'Slow down a little' using errcode = '54000';
  end if;
  return new;
end;
$$;
create trigger words_in_moderation before insert on public.block_words
  for each row execute function private.words_in_moderation();

-- What a block is called: its best-liked name, if anyone likes it.
create function private.block_name(block uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select w.body from public.block_words w
  join public.word_votes v on v.word_id = w.id
  where w.block_id = block and w.is_name
  group by w.id
  having sum(v.value) >= 1
  order by sum(v.value) desc, w.created_at
  limit 1
$$;

--
-- Turf: four crews, and the blocks they hold.
--

alter table public.profiles
  add column crew text check (crew in ('magpies', 'galahs', 'possums', 'owls')),
  add column crew_since timestamptz;

-- Joining a crew is for a while: once a day at most, so nobody hops sides mid-fight.
create function public.join_crew(crew text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if crew not in ('magpies', 'galahs', 'possums', 'owls') then
    raise exception 'No such crew' using errcode = '22023';
  end if;
  if me.crew = crew then
    return;
  end if;
  if me.crew is not null and me.crew_since > now() - interval '1 day' then
    raise exception 'You changed crews today; try again tomorrow' using errcode = '54000';
  end if;
  update public.profiles set crew = join_crew.crew, crew_since = now() where id = auth.uid();
end;
$$;
revoke execute on function public.join_crew from public, anon;
grant execute on function public.join_crew to authenticated;

-- A tag: a crew's mark on a block, made by someone standing there. Worth 1 to 10,
-- from how the spraying went. Tags fade, half every three days, so ground that
-- isn't kept up goes back to whoever wants it.
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null references public.city_blocks (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  crew text not null check (crew in ('magpies', 'galahs', 'possums', 'owls')),
  points smallint not null check (points between 1 and 10),
  created_at timestamptz not null default now()
);
create index tags_block_idx on public.tags (block_id, created_at);
create index tags_user_idx on public.tags (user_id, created_at);

alter table public.tags enable row level security;
create policy "tags are public" on public.tags for select to anon, authenticated using (true);
revoke all on public.tags from anon, authenticated;
grant select on public.tags to anon, authenticated;

-- Who holds a block: the crew with the most (faded) tags on it; a tie goes to
-- the crew that got there first. The app works this out the same way.
create function private.holder(block uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select crew from public.tags
  where block_id = block and created_at > now() - interval '30 days'
  group by crew
  order by sum(points * power(0.5, extract(epoch from now() - created_at) / 259200.0)) desc, min(created_at)
  limit 1
$$;

create function public.tag_block(block uuid, latitude double precision, longitude double precision, points integer)
returns public.tags
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  my_crew text;
  held_by text;
  ground polygon;
  tag public.tags;
  last timestamptz;
begin
  select p.crew into my_crew from public.profiles p where p.id = me;
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if my_crew is null then
    raise exception 'Join a crew first' using errcode = '22023';
  end if;
  select shape into ground from public.city_blocks where id = block;
  if ground is null then
    raise exception 'No such block' using errcode = '22023';
  end if;
  -- In it, or across the street from it (degrees here; about 60 m).
  if not (ground @> point(longitude, latitude)) and (ground <-> point(longitude, latitude)) > 0.0007 then
    raise exception 'You have to be there to tag it' using errcode = '22023';
  end if;
  select max(created_at) into last from public.tags where user_id = me and block_id = block;
  if last > now() - interval '3 minutes' then
    raise exception 'You tagged it just now; give it a few minutes' using errcode = '54000';
  end if;
  if (select count(*) from public.tags where user_id = me and created_at > now() - interval '1 hour') >= 40 then
    raise exception 'That''s a lot of tagging; have a rest' using errcode = '54000';
  end if;

  held_by := private.holder(block);
  insert into public.tags (block_id, user_id, crew, points)
  values (block, me, my_crew, greatest(1, least(10, points)))
  returning * into tag;

  -- Hitting another crew's ground tells the people who put their tags there,
  -- once in a while, unless they've blocked the one doing it.
  if held_by is not null and held_by <> my_crew then
    insert into public.notifications (user_id, kind, actor_id, actor_name, block_id, post_title, preview)
    select defender, 'turf', me, (select display_name from public.profiles where id = me),
      block, private.block_name(block), my_crew
    from (
      select distinct t.user_id as defender from public.tags t
      where t.block_id = block and t.crew = held_by and t.created_at > now() - interval '14 days'
        and t.user_id is not null and t.user_id <> me
    ) d
    where not private.has_blocked(defender, me)
      and not exists (
        select 1 from public.notifications n
        where n.user_id = defender and n.kind = 'turf' and n.block_id = block and n.created_at > now() - interval '30 minutes'
      )
      and exists (select 1 from public.profiles p where p.id = defender and p.crew = held_by);
  end if;
  return tag;
end;
$$;
revoke execute on function public.tag_block from public, anon;
grant execute on function public.tag_block to authenticated;

alter table public.notifications add column block_id uuid references public.city_blocks (id) on delete cascade;
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('reply', 'saved_reply', 'thread_reply', 'save', 'interest', 'resolved',
    'friend_request', 'friend_accept', 'friend_post', 'mention', 'turf'));

alter publication supabase_realtime add table public.city_blocks, public.block_words, public.word_votes, public.tags;
