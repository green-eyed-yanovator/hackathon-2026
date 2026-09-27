-- Puts the demo neighbourhood back the way "Demo in two minutes" in the README
-- expects it, after people have clicked around: friends back on the map (fresh,
-- so not faded), Maya's friends, unread messages and waiting request, the
-- hearts on replies, the lore and the stickers. Only the demo accounts are
-- touched.
--
--   npm run demo:reset

do $$
declare
  maya uuid := 'd0000000-0000-4000-8000-000000000001';
  tom uuid := 'd0000000-0000-4000-8000-000000000002';
  priya uuid := 'd0000000-0000-4000-8000-000000000003';
  lucas uuid := 'd0000000-0000-4000-8000-000000000004';
  hannah uuid := 'd0000000-0000-4000-8000-000000000005';
  ben uuid := 'd0000000-0000-4000-8000-000000000006';
  demo uuid[] := array[maya, tom, priya, lucas, hannah, ben];
begin
  if (select count(*) from auth.users where id = any (demo)) < 6 then
    raise exception 'Some demo accounts are gone. Take the rest out with: delete from auth.users where email like ''%%@aroundhere.demo''; then load supabase/seed.sql again.';
  end if;

  -- Friends where the seed put them, as of now. Maya herself isn't sharing:
  -- whoever demos her shares their own place.
  insert into public.locations (user_id, latitude, longitude, accuracy, heading) values
    (tom, -34.91640, 138.60021, 15, 90),
    (priya, -34.92841, 138.59912, 25, null),
    (hannah, -34.93388, 138.61307, 20, 200),
    (ben, -34.91305, 138.61782, 30, null)
  on conflict (user_id) do update set latitude = excluded.latitude, longitude = excluded.longitude,
    accuracy = excluded.accuracy, heading = excluded.heading, shared = true, updated_at = now();
  update public.locations set shared = false, latitude = 0, longitude = 0, accuracy = null, heading = null
  where user_id = maya;
  update public.presence set here = false where user_id = any (demo);

  -- Nobody blocked.
  delete from public.blocks where blocker = any (demo) and blocked = any (demo);

  -- The seeded friends. A pair that was unfriended and asked again is waiting,
  -- so it goes; put back as friends straight away, it sends no notification.
  delete from public.friendships f
  using (values (maya, tom), (priya, maya), (maya, hannah), (tom, ben), (hannah, priya)) as p (a, b)
  where least(f.requester, f.addressee) = least(p.a, p.b) and greatest(f.requester, f.addressee) = greatest(p.a, p.b)
    and f.accepted_at is null;
  insert into public.friendships (requester, addressee, accepted_at) values
    (maya, tom, now()), (priya, maya, now()), (maya, hannah, now()), (tom, ben, now()), (hannah, priya, now())
  on conflict do nothing;

  -- Lucas's request to Maya, waiting and unread. Anything else between them
  -- (friends, or Maya asking him) goes with its notifications, and the request
  -- is made again, which tells her once.
  if exists (select 1 from public.friendships where requester = lucas and addressee = maya and accepted_at is null) then
    update public.notifications set read_at = null where user_id = maya and kind = 'friend_request' and actor_id = lucas;
  else
    delete from public.friendships
    where least(requester, addressee) = least(lucas, maya) and greatest(requester, addressee) = greatest(lucas, maya);
    delete from public.notifications where user_id = maya and kind = 'friend_request' and actor_id = lucas;
    insert into public.friendships (requester, addressee) values (lucas, maya);
  end if;
  -- Any other asking between the demo accounts is settled now.
  delete from public.notifications
  where kind = 'friend_request' and user_id = any (demo) and actor_id = any (demo) and not (user_id = maya and actor_id = lucas);

  -- The two messages Maya hasn't read yet.
  update public.messages set read_at = null
  where recipient_id = maya and sender_id in (tom, priya)
    and body in ('I''ll ride past on the way home and have a look.', 'Dumplings at 7, don''t be late!');

  -- Hearts on replies.
  insert into public.reply_likes (user_id, reply_id)
  select l.who, r.id
  from (values
    (priya, 'Yes please! I can bring a salad.'), (lucas, 'Yes please! I can bring a salad.'),
    (maya, 'Count me in. I''ll bring the trailer for the big stuff.'), (hannah, 'Count me in. I''ll bring the trailer for the big stuff.'),
    (ben, 'Count me in. I''ll bring the trailer for the big stuff.'),
    (tom, 'Flickers during minor chords. Otherwise fine.'), (maya, 'Flickers during minor chords. Otherwise fine.'),
    (priya, 'Flickers during minor chords. Otherwise fine.'),
    (hannah, 'I think I saw a grey cat near the tennis courts this morning?')
  ) as l (who, body)
  join public.replies r on r.content = l.body and r.author_id = any (demo)
  on conflict do nothing;

  -- The word on the street and the lore as the seed left them: whatever the demo
  -- accounts wrote or voted in the last two hours goes, and the stickers go
  -- back up for another day.
  delete from public.block_words where author_id = any (demo) and created_at > now() - interval '2 hours';
  delete from public.word_votes where user_id = any (demo) and created_at > now() - interval '2 hours';
  delete from public.post_votes where user_id = any (demo) and created_at > now() - interval '2 hours';
  update public.stickers set expires_at = now() + interval '22 hours' where user_id = any (demo);
  -- Snaps are up for a day: the demo's go back to having most of it left, and
  -- the picnic is on again.
  update public.posts set created_at = now() - v.age, expires_at = now() - v.age + interval '24 hours'
  from (values ('Sunset from the hills', interval '90 minutes'), ('Laneway after the rain', interval '200 minutes'),
    ('Best flat white on Gouger, fight me', interval '35 minutes')) as v (title, age)
  where posts.title = v.title and posts.author_id = any (demo);
  update public.posts set created_at = now() - interval '1 hour', starts_at = now() - interval '30 minutes'
  where title = 'Sunset picnic in Rymill Park, on now' and author_id = any (demo);
  -- Today's two link-ups on the map, as recent as the seed made them; any made
  -- while showing it off go.
  delete from public.link_ups where (a = any (demo) and b = any (demo)) and created_at > now() - interval '2 hours'
    and not (a = tom and b = ben and move = 'fist_bump');
  update public.link_ups set created_at = now() - interval '50 minutes' where a = tom and b = ben and move = 'fist_bump';
  update public.link_ups set created_at = now() - interval '3 hours' where a = hannah and b = priya and move = 'high_five';
  delete from private.dabs where who = any (demo) or whom = any (demo);
  -- Maya's streak waits for her to open the app today.
  update public.profiles set streak_day = (now() at time zone 'Australia/Adelaide')::date - 1 where id = any (demo);
end $$;
