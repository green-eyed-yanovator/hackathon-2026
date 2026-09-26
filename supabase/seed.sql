-- A small demo neighbourhood around Adelaide, loaded by `supabase db reset`.
-- Safe to run again (it does nothing the second time), and to run by hand on a
-- database that already has real users:
--
--   docker exec -i supabase_db_hackathon-2026 psql -U postgres < supabase/seed.sql
--
-- Every demo account signs in with its email and the password "neighbour".
-- To remove it all again (posts, replies and friendships go with the users):
--
--   delete from auth.users where email like '%@aroundhere.demo';

do $$
declare
  maya uuid := 'd0000000-0000-4000-8000-000000000001';
  tom uuid := 'd0000000-0000-4000-8000-000000000002';
  priya uuid := 'd0000000-0000-4000-8000-000000000003';
  lucas uuid := 'd0000000-0000-4000-8000-000000000004';
  hannah uuid := 'd0000000-0000-4000-8000-000000000005';
  ben uuid := 'd0000000-0000-4000-8000-000000000006';
  people jsonb := jsonb_build_array(
    jsonb_build_array(maya, 'maya', 'Maya Chen', 'Kent Town', 'Gardener and cat person. I run the Saturday seed swap, bring anything that grows.'),
    jsonb_build_array(tom, 'tom', 'Tom Okafor', 'North Adelaide', 'Cyclist. I fix bikes for free on Sunday mornings if you bring coffee.'),
    jsonb_build_array(priya, 'priya', 'Priya Sharma', 'Adelaide CBD', 'Chef at a little place on Gouger St. Will trade dumplings for gossip.'),
    jsonb_build_array(lucas, 'lucas', 'Lucas Rossi', 'Norwood', 'Bass player, always up for a jam. Also owns too many plants.'),
    jsonb_build_array(hannah, 'hannah', 'Hannah Walsh', 'Parkside', 'Mum of two, school-run veteran, organiser of the street clean-ups.'),
    jsonb_build_array(ben, 'ben', 'Ben Nguyen', 'Hackney', 'Pickup soccer on Tuesdays, all levels welcome. Ask me about the park.')
  );
  person jsonb;
  p record;
begin
  if exists (select 1 from auth.users where email = 'maya@aroundhere.demo') then
    raise notice 'Demo neighbourhood is already here.';
    return;
  end if;

  -- Accounts. The profile trigger creates each profile from display_name.
  for person in select * from jsonb_array_elements(people) loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', (person ->> 0)::uuid, 'authenticated', 'authenticated',
      (person ->> 1) || '@aroundhere.demo', extensions.crypt('neighbour', extensions.gen_salt('bf')), now(),
      '{"provider": "email", "providers": ["email"]}', jsonb_build_object('display_name', person ->> 2),
      now() - interval '30 days', now(), '', '', '', ''
    );
    insert into auth.identities (user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (
      (person ->> 0)::uuid, person ->> 0, 'email',
      jsonb_build_object('sub', person ->> 0, 'email', (person ->> 1) || '@aroundhere.demo', 'email_verified', true),
      now(), now(), now()
    );
    update public.profiles
    set neighbourhood = person ->> 3, bio = person ->> 4, created_at = now() - interval '30 days'
    where id = (person ->> 0)::uuid;
  end loop;

  -- Pins. Each gets its own place, like the app does for a new spot.
  create temporary table demo_posts (author uuid, title text, body text, flair text, lat float8, lng float8, age interval, resolved boolean) on commit drop;
  insert into demo_posts values
    (priya, 'Dumpling night, three spare seats', 'Making way too many pork and chive dumplings tonight at 7. Bring a drink, I''ll bring the chilli oil.', 'food', -34.92905, 138.59745, '3 hours', false),
    (maya, 'Lost: grey tabby called Miso', 'Hasn''t come home since Tuesday night. Very friendly, blue collar with a bell. Please check sheds and garages!', 'lost', -34.92231, 138.61912, '20 hours', false),
    (hannah, 'Street clean-up, Saturday 9am', 'Meeting at the Hutt St end of the park. Gloves, bags and grabbers provided, coffee after.', 'event', -34.93615, 138.61226, '1 day', false),
    (ben, 'Pickup soccer, Tuesday 6pm', 'Rymill Park, near the lake. We usually have 10 to 14 people, all levels. Bring a light and a dark shirt.', 'sports', -34.92352, 138.61351, '2 days', false),
    (lucas, 'Looking for a drummer', 'Trio playing soul and funk covers, rehearsing Thursdays in Norwood. No gear needed, we have a kit.', 'music', -34.92108, 138.63118, '5 hours', false),
    (tom, 'Did anyone else hear the fireworks?', 'Around 11pm last night, sounded like it came from the parklands. Anyone know what the occasion was?', 'general', -34.90712, 138.59522, '14 hours', false),
    (maya, 'A bench for the corner of Rundle St?', 'Thinking of asking council for a bench under the plane tree. Tap interested if you''d use it, I''ll take the numbers along.', 'general', -34.92248, 138.60772, '2 days', false),
    (hannah, 'Farmers market this Sunday', 'The Wayville market is on from 8. Best sourdough in town at the stall by the gate, get there early.', 'food', -34.94335, 138.58583, '9 hours', false),
    (tom, 'Outdoor cinema in the park, Friday', 'Bring a blanket. It''s an 80s classic this week, starts when it gets dark.', 'event', -34.92478, 138.61702, '6 hours', false),
    (ben, 'Found: keys on a red lanyard', 'Picked them up outside the Mall''s Balls. Message me with what''s on the keyring.', 'lost', -34.92265, 138.60101, '4 hours', false),
    (tom, 'Morning run club, 6:30', 'Meet at the university footbridge, 5k along the river at an easy pace. No one gets left behind.', 'sports', -34.91719, 138.60368, '3 days', false),
    (priya, 'The busker on Rundle Mall is incredible', 'Cellist near the Beehive Corner playing Radiohead. Go now if you can.', 'music', -34.92226, 138.60449, '40 minutes', false),
    (hannah, 'Power out on Hutt St?', 'Whole block just went dark, anyone else?', 'general', -34.93123, 138.61022, '1 day', true),
    (maya, 'Too many zucchinis, come grab some', 'Box on the front fence. Free, take as many as you want, seriously.', 'food', -34.91955, 138.62245, '7 hours', false),
    (lucas, 'Garage sale, everything must go', 'Moving house! Records, a couch, plants, a slightly haunted lamp. Saturday 8 to 2.', 'event', -34.91842, 138.63512, '1 day', false),
    (priya, 'New cafe opening on King William', 'Soft opening tomorrow, free coffee for the first 50. The pastries looked unreal.', 'food', -34.92765, 138.59992, '2 hours', false),
    (ben, 'Anyone up for tennis this weekend?', 'Booked a court at the North Adelaide courts for Sunday 10am, need a doubles partner.', 'sports', -34.90998, 138.59263, '11 hours', false),
    (lucas, 'Open mic at the pub, Wednesday', 'First one in ages. Sign-up sheet at the bar from 7, bring your songs.', 'music', -34.92311, 138.62642, '1 day', false);

  for p in select * from demo_posts loop
    with place as (
      insert into public.places (latitude, longitude, created_at) values (p.lat, p.lng, now() - p.age) returning id
    )
    insert into public.posts (place_id, title, description, latitude, longitude, flair, author_id, author_name, created_at, resolved_at)
    select place.id, p.title, p.body, p.lat, p.lng, p.flair, p.author,
      (select display_name from public.profiles where id = p.author), now() - p.age,
      case when p.resolved then now() - p.age + interval '2 hours' end
    from place;
  end loop;

  -- Replies, as (post title, author, text, minutes after the post).
  create temporary table demo_replies (post text, author uuid, body text, after int) on commit drop;
  insert into demo_replies values
    ('Dumpling night, three spare seats', maya, 'Yes please! I can bring a salad.', 10),
    ('Dumpling night, three spare seats', lucas, 'Save me a seat, I''ll bring beer.', 25),
    ('Dumpling night, three spare seats', priya, 'Two seats left!', 40),
    ('Lost: grey tabby called Miso', hannah, 'Shared it with the school parents group. Fingers crossed.', 30),
    ('Lost: grey tabby called Miso', ben, 'I think I saw a grey cat near the tennis courts this morning?', 300),
    ('Lost: grey tabby called Miso', maya, 'Thanks Ben, heading there now!', 320),
    ('Street clean-up, Saturday 9am', tom, 'Count me in. I''ll bring the trailer for the big stuff.', 60),
    ('Street clean-up, Saturday 9am', priya, 'I''ll do the coffee run after.', 90),
    ('Pickup soccer, Tuesday 6pm', tom, 'Is there a spot for a slightly unfit cyclist?', 120),
    ('Pickup soccer, Tuesday 6pm', ben, 'Always. See you there.', 130),
    ('Looking for a drummer', tom, 'My flatmate drums! Sending him your way.', 45),
    ('Did anyone else hear the fireworks?', hannah, 'It was a wedding at the golf course, apparently.', 50),
    ('Did anyone else hear the fireworks?', ben, 'Woke the dog up, she was not impressed.', 70),
    ('A bench for the corner of Rundle St?', lucas, 'Great idea. Shade would be nice too.', 200),
    ('A bench for the corner of Rundle St?', priya, 'Absolutely, I''d eat lunch there every day.', 400),
    ('Outdoor cinema in the park, Friday', maya, 'Which film?! Don''t leave us hanging.', 20),
    ('Found: keys on a red lanyard', priya, 'Not mine but that''s so kind of you.', 15),
    ('Power out on Hutt St?', tom, 'Same on Gilles St. SA Power says an hour.', 5),
    ('Power out on Hutt St?', hannah, 'Back on now!', 110),
    ('Too many zucchinis, come grab some', priya, 'Taking two for a fritter experiment, thank you!', 30),
    ('Garage sale, everything must go', maya, 'How haunted is the lamp exactly?', 60),
    ('Garage sale, everything must go', lucas, 'Flickers during minor chords. Otherwise fine.', 75);

  insert into public.replies (post_id, content, author_id, author_name, created_at)
  select post.id, r.body, r.author, (select display_name from public.profiles where id = r.author), post.created_at + make_interval(mins => r.after)
  from demo_replies r
  join public.posts post on post.title = r.post and post.author_id in (maya, tom, priya, lucas, hannah, ben);

  -- Interest and saves.
  insert into public.post_interest (user_id, post_id)
  select who, post.id
  from (values
    (maya, 'Street clean-up, Saturday 9am'), (tom, 'Street clean-up, Saturday 9am'), (priya, 'Street clean-up, Saturday 9am'), (ben, 'Street clean-up, Saturday 9am'),
    (tom, 'A bench for the corner of Rundle St?'), (lucas, 'A bench for the corner of Rundle St?'), (priya, 'A bench for the corner of Rundle St?'), (hannah, 'A bench for the corner of Rundle St?'), (ben, 'A bench for the corner of Rundle St?'),
    (maya, 'Outdoor cinema in the park, Friday'), (hannah, 'Outdoor cinema in the park, Friday'), (lucas, 'Outdoor cinema in the park, Friday'),
    (tom, 'Pickup soccer, Tuesday 6pm'), (lucas, 'Pickup soccer, Tuesday 6pm'),
    (maya, 'Dumpling night, three spare seats'), (lucas, 'Dumpling night, three spare seats')
  ) as i (who, title)
  join public.posts post on post.title = i.title and post.author_id in (maya, tom, priya, lucas, hannah, ben);

  insert into public.saved_posts (user_id, post_id)
  select who, post.id
  from (values (maya, 'Farmers market this Sunday'), (tom, 'Looking for a drummer'), (hannah, 'Lost: grey tabby called Miso')) as s (who, title)
  join public.posts post on post.title = s.title and post.author_id in (maya, tom, priya, lucas, hannah, ben);

  -- Friends, one request still waiting for Maya, and a few shared locations.
  insert into public.friendships (requester, addressee, created_at, accepted_at) values
    (maya, tom, now() - interval '20 days', now() - interval '19 days'),
    (priya, maya, now() - interval '12 days', now() - interval '12 days'),
    (maya, hannah, now() - interval '8 days', now() - interval '7 days'),
    (tom, ben, now() - interval '6 days', now() - interval '6 days'),
    (hannah, priya, now() - interval '3 days', now() - interval '3 days'),
    (lucas, maya, now() - interval '1 hour', null);

  insert into public.locations (user_id, latitude, longitude, accuracy, heading) values
    (tom, -34.91640, 138.60021, 15, 90),
    (priya, -34.92841, 138.59912, 25, null),
    (hannah, -34.93388, 138.61307, 20, 200),
    (ben, -34.91305, 138.61782, 30, null);

  insert into public.messages (sender_id, recipient_id, body, created_at, read_at) values
    (tom, maya, 'Any sign of Miso?', now() - interval '3 hours', now() - interval '2 hours'),
    (maya, tom, 'Not yet, Ben thinks he saw him by the courts.', now() - interval '2 hours', now() - interval '2 hours'),
    (tom, maya, 'I''ll ride past on the way home and have a look.', now() - interval '110 minutes', null),
    (priya, maya, 'Dumplings at 7, don''t be late!', now() - interval '50 minutes', null);
end;
$$;
