-- Meeting a friend in person: you both dab (or high-five, fist-bump, hug) within
-- ten minutes of each other, standing close. It's a link-up: on the map for a
-- day, where you met, for the two of you and your friends to see, and sparks
-- for both of you (the first time each day). Nobody has to share their location:
-- each tap brings its own fix, and the server compares them.

create table public.link_ups (
  id uuid primary key default gen_random_uuid(),
  a uuid not null references auth.users (id) on delete cascade, -- who dabbed first
  b uuid not null references auth.users (id) on delete cascade, -- who dabbed back
  move text not null check (move in ('dab', 'high_five', 'fist_bump', 'hug')),
  latitude double precision not null,
  longitude double precision not null,
  created_at timestamptz not null default now(),
  check (a <> b)
);
create index link_ups_a_idx on public.link_ups (a, created_at);
create index link_ups_b_idx on public.link_ups (b, created_at);
alter table public.link_ups enable row level security;
create policy "the two of them, and their friends, see it" on public.link_ups
  for select to authenticated
  using ((select auth.uid()) in (a, b) or private.are_friends(a, (select auth.uid())) or private.are_friends(b, (select auth.uid())));
revoke all on public.link_ups from anon, authenticated;
grant select on public.link_ups to authenticated;
alter publication supabase_realtime add table public.link_ups;

-- A dab waiting to be answered: never readable through the API (it holds where
-- someone was); the friend hears about it as a notification.
create table private.dabs (
  who uuid not null references auth.users (id) on delete cascade,
  whom uuid not null references auth.users (id) on delete cascade,
  move text not null,
  latitude double precision not null,
  longitude double precision not null,
  fix real not null,
  at timestamptz not null default now(),
  primary key (who, whom)
);
revoke all on private.dabs from public, anon, authenticated;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('reply', 'saved_reply', 'thread_reply', 'save', 'interest', 'resolved',
    'friend_request', 'friend_accept', 'friend_post', 'mention', 'comment_reply', 'word_reply', 'legend',
    'dab', 'link_up'));

-- Dab at a friend, from where you are (fix: how good the position is, in metres).
-- Their dab at you in the last ten minutes, close enough, makes it a link-up;
-- otherwise yours waits for theirs. Says which: {status: 'linked', link_up},
-- {status: 'waiting'} or {status: 'far', apart: metres}.
create function public.dab(friend uuid, how text, lat double precision, lng double precision, fix real) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  theirs private.dabs;
  apart double precision;
  made public.link_ups;
  waiting boolean;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if how not in ('dab', 'high_five', 'fist_bump', 'hug') then raise exception 'Not a move: %', how; end if;
  if not private.are_friends(me, friend) or private.has_blocked(friend, me) or private.has_blocked(me, friend) then
    raise exception 'Only friends can link up';
  end if;
  if fix > 250 then
    raise exception 'Your location is too rough to tell (± % m). Try again outside, in a moment.', round(fix);
  end if;

  select * into theirs from private.dabs where who = friend and whom = me and at > now() - interval '10 minutes' for update;
  if found then
    apart := 6371000 * 2 * asin(sqrt(
      power(sin(radians(theirs.latitude - lat) / 2), 2) +
      cos(radians(lat)) * cos(radians(theirs.latitude)) * power(sin(radians(theirs.longitude - lng) / 2), 2)));
    -- Close: 50 m, and however rough the two fixes are, up to 250 m more.
    if apart > 50 + least(theirs.fix + fix, 250) then
      return jsonb_build_object('status', 'far', 'apart', round(apart));
    end if;
    delete from private.dabs where (who = friend and whom = me) or (who = me and whom = friend);
    insert into public.link_ups (a, b, move, latitude, longitude)
    values (friend, me, theirs.move, (theirs.latitude + lat) / 2, (theirs.longitude + lng) / 2)
    returning * into made;
    -- Sparks for the first link-up of the day between these two.
    if not exists (
      select 1 from public.link_ups l
      where l.id <> made.id and least(l.a, l.b) = least(me, friend) and greatest(l.a, l.b) = greatest(me, friend)
        and (l.created_at at time zone 'Australia/Adelaide')::date = (now() at time zone 'Australia/Adelaide')::date
    ) then
      perform private.give_sparks(me, 5);
      perform private.give_sparks(friend, 5);
    end if;
    perform private.notify(friend, 'link_up', me, null::public.posts, theirs.move);
    return jsonb_build_object('status', 'linked', 'link_up', to_jsonb(made));
  end if;

  -- Waiting for theirs. They hear about it once, not on every tap.
  waiting := exists (select 1 from private.dabs where who = me and whom = friend and at > now() - interval '10 minutes');
  insert into private.dabs (who, whom, move, latitude, longitude, fix) values (me, friend, how, lat, lng, fix)
  on conflict (who, whom) do update
    set move = excluded.move, latitude = excluded.latitude, longitude = excluded.longitude, fix = excluded.fix, at = now();
  if not waiting then perform private.notify(friend, 'dab', me, null::public.posts, how); end if;
  return jsonb_build_object('status', 'waiting');
end;
$$;
revoke execute on function public.dab(uuid, text, double precision, double precision, real) from public, anon;
grant execute on function public.dab(uuid, text, double precision, double precision, real) to authenticated;
