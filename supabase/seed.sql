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

-- The next time it's this weekday and hour in Adelaide (0 is Sunday), for event times.
create function pg_temp.next_local(dow int, hour float8) returns timestamptz
language sql as $$
  select case when t < now() then t + interval '7 days' else t end
  from (
    select (date_trunc('day', now() at time zone 'Australia/Adelaide')
      + ((dow - extract(dow from now() at time zone 'Australia/Adelaide')::int + 7) % 7) * interval '1 day'
      + hour * interval '1 hour') at time zone 'Australia/Adelaide' as t
  ) next
$$;

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
  create temporary table demo_posts (author uuid, title text, body text, flair text, lat float8, lng float8, age interval, resolved boolean, starts timestamptz) on commit drop;
  insert into demo_posts values
    (priya, 'Dumpling night, three spare seats', 'Making way too many pork and chive dumplings tonight at 7. Bring a drink, I''ll bring the chilli oil.', 'food', -34.92905, 138.59745, '3 hours', false, pg_temp.next_local(extract(dow from now() at time zone 'Australia/Adelaide')::int, 19)),
    (maya, 'Lost: grey tabby called Miso', 'Hasn''t come home since Tuesday night. Very friendly, blue collar with a bell. Please check sheds and garages!', 'lost', -34.92231, 138.61912, '20 hours', false, null),
    (hannah, 'Street clean-up, Saturday 9am', 'Meeting at the Hutt St end of the park. Gloves, bags and grabbers provided, coffee after.', 'event', -34.93615, 138.61226, '1 day', false, pg_temp.next_local(6, 9)),
    (ben, 'Pickup soccer, Tuesday 6pm', 'Rymill Park, near the lake. We usually have 10 to 14 people, all levels. Bring a light and a dark shirt.', 'sports', -34.92352, 138.61351, '2 days', false, pg_temp.next_local(2, 18)),
    (lucas, 'Looking for a drummer', 'Trio playing soul and funk covers, rehearsing Thursdays in Norwood. No gear needed, we have a kit.', 'music', -34.92108, 138.63118, '5 hours', false, pg_temp.next_local(4, 19)),
    (tom, 'Did anyone else hear the fireworks?', 'Around 11pm last night, sounded like it came from the parklands. Anyone know what the occasion was?', 'general', -34.90712, 138.59522, '14 hours', false, null),
    (maya, 'A bench for the corner of Rundle St?', 'Thinking of asking council for a bench under the plane tree. Tap interested if you''d use it, I''ll take the numbers along.', 'general', -34.92248, 138.60772, '2 days', false, null),
    (hannah, 'Farmers market this Sunday', 'The Wayville market is on from 8. Best sourdough in town at the stall by the gate, get there early.', 'food', -34.94335, 138.58583, '9 hours', false, pg_temp.next_local(0, 8)),
    (tom, 'Outdoor cinema in the park, Friday', 'Bring a blanket. It''s an 80s classic this week, starts when it gets dark.', 'event', -34.92478, 138.61702, '6 hours', false, pg_temp.next_local(5, 19.5)),
    (ben, 'Found: keys on a red lanyard', 'Picked them up outside the Mall''s Balls. Message me with what''s on the keyring.', 'lost', -34.92265, 138.60101, '4 hours', false, null),
    (tom, 'Morning run club, 6:30', 'Meet at the university footbridge, 5k along the river at an easy pace. No one gets left behind.', 'sports', -34.91719, 138.60368, '3 days', false, pg_temp.next_local(6, 6.5)),
    (priya, 'The busker on Rundle Mall is incredible', 'Cellist near the Beehive Corner playing Radiohead. Go now if you can.', 'music', -34.92226, 138.60449, '40 minutes', false, null),
    (hannah, 'Power out on Hutt St?', 'Whole block just went dark, anyone else?', 'general', -34.93123, 138.61022, '1 day', true, null),
    (maya, 'Too many zucchinis, come grab some', 'Box on the front fence. Free, take as many as you want, seriously.', 'food', -34.91955, 138.62245, '7 hours', false, null),
    (lucas, 'Garage sale, everything must go', 'Moving house! Records, a couch, plants, a slightly haunted lamp. Saturday 8 to 2.', 'event', -34.91842, 138.63512, '1 day', false, pg_temp.next_local(6, 8)),
    (priya, 'New cafe opening on King William', 'Soft opening tomorrow, free coffee for the first 50. The pastries looked unreal.', 'food', -34.92765, 138.59992, '2 hours', false, null),
    (ben, 'Anyone up for tennis this weekend?', 'Booked a court at the North Adelaide courts for Sunday 10am, need a doubles partner.', 'sports', -34.90998, 138.59263, '11 hours', false, pg_temp.next_local(0, 10)),
    (lucas, 'Open mic at the pub, Wednesday', 'First one in ages. Sign-up sheet at the bar from 7, bring your songs.', 'music', -34.92311, 138.62642, '1 day', false, pg_temp.next_local(3, 19));

  for p in select * from demo_posts loop
    with place as (
      insert into public.places (latitude, longitude, created_at) values (p.lat, p.lng, now() - p.age) returning id
    )
    insert into public.posts (place_id, title, description, latitude, longitude, flair, author_id, author_name, created_at, resolved_at, starts_at)
    select place.id, p.title, p.body, p.lat, p.lng, p.flair, p.author,
      (select display_name from public.profiles where id = p.author), now() - p.age,
      case when p.resolved then now() - p.age + interval '2 hours' end, p.starts
    from place;
  end loop;

  -- A second thread at the clean-up spot, so one marker holds two.
  insert into public.posts (place_id, title, description, latitude, longitude, flair, author_id, author_name, created_at)
  select post.place_id, 'Anyone want the leftover bin bags?', 'Twenty or so, heavy duty. Next to the gate after the clean-up.', post.latitude, post.longitude,
    'general', tom, (select display_name from public.profiles where id = tom), now() - interval '20 hours'
  from public.posts post where post.title = 'Street clean-up, Saturday 9am' and post.author_id = hannah;

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

  -- A few hearts on replies.
  insert into public.reply_likes (user_id, reply_id)
  select who, r.id
  from (values
    (priya, 'Yes please! I can bring a salad.'), (lucas, 'Yes please! I can bring a salad.'),
    (maya, 'Count me in. I''ll bring the trailer for the big stuff.'), (hannah, 'Count me in. I''ll bring the trailer for the big stuff.'), (ben, 'Count me in. I''ll bring the trailer for the big stuff.'),
    (tom, 'Flickers during minor chords. Otherwise fine.'), (maya, 'Flickers during minor chords. Otherwise fine.'), (priya, 'Flickers during minor chords. Otherwise fine.'),
    (hannah, 'I think I saw a grey cat near the tennis courts this morning?')
  ) as l (who, body)
  join public.replies r on r.content = l.body and r.author_id in (maya, tom, priya, lucas, hannah, ben);

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

-- City blocks: what the neighbours call them and what they say about them. The
-- outlines are the app's own, traced from the map's streets. Blocks someone
-- already made here are used as they are.
do $$
declare
  maya uuid := 'd0000000-0000-4000-8000-000000000001';
  tom uuid := 'd0000000-0000-4000-8000-000000000002';
  priya uuid := 'd0000000-0000-4000-8000-000000000003';
  lucas uuid := 'd0000000-0000-4000-8000-000000000004';
  hannah uuid := 'd0000000-0000-4000-8000-000000000005';
  ben uuid := 'd0000000-0000-4000-8000-000000000006';
  b record;
  w record;
  word uuid;
  kept uuid;
begin
  if not exists (select 1 from auth.users where id = maya) then
    raise notice 'Load the demo neighbourhood first.';
    return;
  end if;
  if exists (select 1 from public.block_words where author_id = maya) then
    raise notice 'Demo blocks are already here.';
    return;
  end if;

  create temporary table demo_blocks (key text, ring jsonb, lat float8, lng float8, id uuid) on commit drop;
  insert into demo_blocks (key, ring, lat, lng) values
    ('deli', '[[138.599224,-34.92863],[138.599208,-34.928335],[138.59924,-34.928058],[138.599401,-34.927746],[138.599685,-34.927262],[138.599718,-34.92717],[138.599573,-34.927209],[138.597117,-34.927331],[138.597159,-34.9279],[138.597186,-34.92797],[138.597239,-34.928727]]', -34.927481, 138.598342),
    ('dumplings', '[[138.599267,-34.929145],[138.599235,-34.928709],[138.595845,-34.92889],[138.595963,-34.930323],[138.596542,-34.930293],[138.596579,-34.930257],[138.59681,-34.93024],[138.597685,-34.930205],[138.59902,-34.93013],[138.599251,-34.930103],[138.599208,-34.929329],[138.599224,-34.929299],[138.599288,-34.92925]]', -34.929193, 138.597573),
    ('cafe', '[[138.600377,-34.927706],[138.600211,-34.927517],[138.600018,-34.927253],[138.599964,-34.927157],[138.599718,-34.92717],[138.599685,-34.927262],[138.599401,-34.927746],[138.59924,-34.928058],[138.599208,-34.928335],[138.599224,-34.92863],[138.60049,-34.928573],[138.600748,-34.92852],[138.600721,-34.928278],[138.600656,-34.928111],[138.600533,-34.927913]]', -34.928335, 138.599968),
    ('bakery', '[[138.597631,-34.924443],[138.59754,-34.923088],[138.595426,-34.923189],[138.595496,-34.92399],[138.596542,-34.923933],[138.596579,-34.924494]]', -34.923369, 138.5965),
    ('g31', '[[138.599718,-34.92717],[138.599739,-34.927042],[138.599637,-34.92577],[138.597658,-34.925877],[138.597769,-34.927212],[138.599578,-34.927121]]', -34.926058, 138.598667),
    ('g30', '[[138.597769,-34.927212],[138.597658,-34.925877],[138.596,-34.925974],[138.596106,-34.927294]]', -34.927011, 138.596917),
    ('g51', '[[138.600082,-34.931515],[138.599997,-34.930271],[138.599959,-34.930156],[138.598783,-34.930204],[138.598886,-34.931577]]', -34.93044, 138.599405),
    ('g50', '[[138.596767,-34.931684],[138.596665,-34.930504],[138.596676,-34.930446],[138.596671,-34.930323],[138.596579,-34.930328],[138.596542,-34.930293],[138.595963,-34.930323],[138.596059,-34.931717]]', -34.931432, 138.596392),
    ('keys', '[[138.601866,-34.922871],[138.601831,-34.922283],[138.601879,-34.922222],[138.601831,-34.921593],[138.601837,-34.921527],[138.599519,-34.921619],[138.599621,-34.922983]]', -34.922109, 138.600713),
    ('probe', '[[138.601955,-34.924157],[138.601866,-34.922871],[138.600651,-34.922934],[138.600742,-34.924214],[138.600737,-34.924289],[138.60196,-34.924227]]', -34.923154, 138.601276),
    ('busker', '[[138.605581,-34.922684],[138.605517,-34.921817],[138.604277,-34.921883],[138.604245,-34.921388],[138.603467,-34.921426],[138.603569,-34.922785]]', -34.921947, 138.604516),
    ('g11', '[[138.599438,-34.922992],[138.599383,-34.922253],[138.598902,-34.922266],[138.598956,-34.923018]]', -34.922865, 138.599187),
    ('g12', '[[138.603569,-34.922785],[138.603467,-34.921426],[138.602974,-34.921456],[138.602641,-34.921492],[138.601837,-34.921527],[138.601831,-34.921593],[138.601879,-34.922222],[138.601831,-34.922283],[138.601866,-34.922871]]', -34.922582, 138.602701),
    ('g22', '[[138.60203,-34.925177],[138.601965,-34.924324],[138.599739,-34.924439],[138.599852,-34.925758],[138.602058,-34.925647]]', -34.924611, 138.60087),
    ('g10', '[[138.596842,-34.923123],[138.596751,-34.921747],[138.596022,-34.921782],[138.596107,-34.923159]]', -34.922876, 138.596458),
    ('band', '[[138.625547,-34.92388],[138.625499,-34.923189],[138.624882,-34.923225],[138.624995,-34.924768],[138.625504,-34.924729],[138.62552,-34.92468],[138.625601,-34.924645],[138.625596,-34.924329]]', -34.924295, 138.625276),
    ('park', '[[138.616959,-34.923572],[138.616047,-34.922939],[138.615677,-34.92256],[138.615521,-34.922248],[138.615468,-34.921971],[138.615248,-34.922072],[138.61506,-34.922134],[138.61455,-34.922226],[138.612088,-34.922349],[138.611128,-34.922442],[138.610945,-34.922433],[138.611042,-34.923752],[138.611096,-34.924131],[138.611155,-34.924263],[138.61123,-34.924346],[138.6116,-34.924632],[138.611718,-34.924742],[138.611836,-34.924931],[138.611868,-34.925024],[138.611889,-34.925147],[138.613129,-34.925081],[138.61381,-34.925098],[138.617731,-34.925098],[138.618155,-34.925111],[138.618504,-34.925002],[138.6186,-34.924953],[138.618649,-34.924896],[138.618654,-34.924782],[138.618397,-34.924588],[138.617356,-34.923862]]', -34.924512, 138.614865),
    ('g36', '[[138.613762,-34.927473],[138.613692,-34.926572],[138.61367,-34.926532],[138.613611,-34.926484],[138.613536,-34.926471],[138.612957,-34.926501],[138.612855,-34.925098],[138.611889,-34.925147],[138.611959,-34.926559],[138.612043,-34.927561]]', -34.926576, 138.612826),
    ('g46', '[[138.614652,-34.929387],[138.614566,-34.927918],[138.613778,-34.927931],[138.61285,-34.927975],[138.612292,-34.928089],[138.612088,-34.928102],[138.612147,-34.92885],[138.612178,-34.929484],[138.612308,-34.929448],[138.612716,-34.929483]]', -34.928231, 138.613341),
    ('g25', '[[138.611686,-34.924909],[138.611643,-34.924834],[138.611541,-34.924729],[138.611149,-34.924421],[138.611015,-34.92428],[138.610972,-34.924139],[138.61094,-34.923849],[138.610056,-34.923902],[138.610092,-34.924381],[138.609765,-34.924398],[138.609835,-34.925248],[138.61175,-34.925151],[138.611729,-34.925015]]', -34.924968, 138.610761),
    ('bench', '[[138.607866,-34.922486],[138.607807,-34.92176],[138.607786,-34.92132],[138.607759,-34.921206],[138.606831,-34.921258],[138.606466,-34.921294],[138.60548,-34.921342],[138.605581,-34.922684],[138.607909,-34.922569]]', -34.921501, 138.606643),
    ('g15', '[[138.61086,-34.922855],[138.610827,-34.922411],[138.608574,-34.922534],[138.608681,-34.923893],[138.610929,-34.923761],[138.610886,-34.923387]]', -34.922707, 138.609718),
    ('power', '[[138.612215,-34.931583],[138.612168,-34.930908],[138.60697,-34.931172],[138.607078,-34.932487],[138.607711,-34.932518],[138.608585,-34.932478],[138.608536,-34.93177]]', -34.93123, 138.609583),
    ('cleanup', '[[138.61271,-34.937377],[138.612581,-34.935939],[138.612517,-34.935781],[138.612463,-34.93506],[138.610082,-34.935183],[138.607764,-34.935284],[138.607582,-34.93535],[138.60748,-34.935407],[138.607437,-34.935447],[138.609996,-34.937012],[138.612807,-34.938705]]', -34.935789, 138.610258),
    ('g44', '[[138.607367,-34.929756],[138.607234,-34.928346],[138.606525,-34.928384],[138.606627,-34.929796]]', -34.929506, 138.606975),
    ('g45', '[[138.610503,-34.929593],[138.610401,-34.928181],[138.608349,-34.928287],[138.608462,-34.92969]]', -34.928483, 138.609394),
    ('g35', '[[138.610333,-34.927346],[138.610275,-34.926642],[138.608225,-34.926739],[138.60834,-34.928168],[138.610393,-34.928063]]', -34.927863, 138.609346),
    ('g56', '[[138.612946,-34.932263],[138.612877,-34.931348],[138.612887,-34.931295],[138.612855,-34.930869],[138.612528,-34.930886],[138.612362,-34.930952],[138.612299,-34.931034],[138.612394,-34.932245]]', -34.931147, 138.612592),
    ('g53', '[[138.605479,-34.931634],[138.605452,-34.931247],[138.604449,-34.9313],[138.60447,-34.931669]]', -34.931585, 138.604971),
    ('bike', '[[138.599117,-34.917195],[138.599026,-34.916627],[138.598881,-34.91547],[138.598768,-34.915549],[138.598865,-34.916451],[138.598983,-34.917207]]', -34.916512, 138.598943),
    ('g33', '[[138.605946,-34.927579],[138.605887,-34.926853],[138.605726,-34.926902],[138.604296,-34.926973],[138.604406,-34.928361],[138.605999,-34.928287]]', -34.927607, 138.605147),
    ('g34', '[[138.608279,-34.927465],[138.608225,-34.926739],[138.605887,-34.926853],[138.605946,-34.927579]]', -34.926907, 138.607064),
    ('g23', '[[138.605071,-34.925494],[138.604991,-34.924293],[138.604902,-34.924182],[138.604412,-34.924206],[138.604497,-34.925521]]', -34.925253, 138.604767),
    ('g24', '[[138.608125,-34.925337],[138.608032,-34.924016],[138.606364,-34.924104],[138.606461,-34.925424]]', -34.924298, 138.607215),
    ('g32', '[[138.602293,-34.928459],[138.602162,-34.92708],[138.600635,-34.927157],[138.600748,-34.92852]]', -34.928232, 138.601497),
    ('g52', '[[138.602244,-34.932404],[138.602148,-34.931414],[138.600254,-34.931511],[138.600367,-34.932852],[138.602271,-34.932755]]', -34.932421, 138.601288),
    ('g42', '[[138.606106,-34.929824],[138.60601,-34.928406],[138.602303,-34.928582],[138.600753,-34.92863],[138.60086,-34.930046],[138.603489,-34.929914],[138.605602,-34.929853]]', -34.928734, 138.603397),
    ('g14', '[[138.60753,-34.923049],[138.607496,-34.922591],[138.605581,-34.922684],[138.605613,-34.923141]]', -34.923031, 138.606567);

  for b in select * from demo_blocks loop
    select c.id into kept from public.city_blocks c where c.shape @> point(b.lng, b.lat) order by area(box(c.shape)) limit 1;
    if kept is null then
      insert into public.city_blocks (ring, latitude, longitude, shape, found_by, created_at)
      values (b.ring, b.lat, b.lng, private.ring_polygon(b.ring), maya, now() - interval '7 days')
      returning id into kept;
    end if;
    update demo_blocks set id = kept where key = b.key;
  end loop;

  -- What people call the blocks, and what they say about them, with the votes:
  -- (block, who, words, a name?, hours ago, up, down). Old memories of a place
  -- sit next to this week's rumours; the votes decide what floats up.
  create temporary table demo_words (key text, who uuid, body text, is_name boolean, hours int, up uuid[], down uuid[]) on commit drop;
  insert into demo_words values
    ('deli', priya, 'Nan''s Corner', true, 90, array[maya, hannah, tom], array[]::uuid[]),
    ('deli', ben, 'Lolly Corner', true, 60, array[lucas], array[]::uuid[]),
    ('deli', priya, 'My nan ran a deli on this corner in the sixties. Kids came in after school for a bag of mixed lollies and she knew every one of them by name, and who their mum was.', false, 96, array[maya, hannah, tom, lucas, ben], array[]::uuid[]),
    ('dumplings', maya, 'Dumpling Alley', true, 70, array[priya, lucas, tom, ben], array[]::uuid[]),
    ('dumplings', lucas, 'Dumpling night is a cult now. Priya is the cult leader.', false, 30, array[maya, ben, tom], array[priya]),
    ('dumplings', maya, 'Chilli oil is BYO but you won''t need to.', false, 20, array[lucas], array[]::uuid[]),
    ('cafe', priya, 'Pastry Row', true, 26, array[maya], array[]::uuid[]),
    ('cafe', priya, 'The pastries at the new place are unreal. Get there before nine.', false, 25, array[ben, hannah], array[]::uuid[]),
    ('bakery', ben, 'Pie Floater Corner', true, 110, array[tom, maya], array[]::uuid[]),
    ('bakery', ben, 'The bakery here did pies at 2am. After the clubs everyone ended up on the bench with a pie floater, the sky going pink over the rooftops.', false, 120, array[tom, maya, lucas, priya], array[]::uuid[]),
    ('keys', ben, 'The Balls', true, 40, array[tom, priya], array[]::uuid[]),
    ('keys', hannah, 'Luck Corner', true, 38, array[]::uuid[], array[tom]),
    ('keys', ben, 'Rub the Mall''s Balls for luck. Everyone does. Nobody knows why.', false, 44, array[tom, maya, hannah], array[]::uuid[]),
    ('probe', tom, 'Pigeon Court', true, 14, array[ben], array[]::uuid[]),
    ('probe', tom, 'The pigeons here run a protection racket. Pay in chips.', false, 13, array[ben, priya, lucas], array[]::uuid[]),
    ('busker', priya, 'Busker Row', true, 50, array[maya, lucas], array[]::uuid[]),
    ('busker', priya, 'The cellist takes requests if you ask nicely. Asked for Radiohead, got Radiohead.', false, 3, array[maya, tom], array[]::uuid[]),
    ('band', lucas, 'The Mums'' Gig', true, 48, array[hannah], array[]::uuid[]),
    ('band', lucas, 'Our band''s first gig was upstairs at the pub here, 1994. Twelve people came and eight of them were our mums. We played the same four songs twice and nobody minded.', false, 50, array[hannah, priya, maya], array[]::uuid[]),
    ('park', ben, 'The Lake Pitch', true, 70, array[tom], array[]::uuid[]),
    ('park', tom, 'Watched the Grand Prix from the fence here in ''86. You felt the cars in your chest before you saw them, and the whole park smelled of hot tyres.', false, 72, array[ben, lucas, hannah, maya], array[]::uuid[]),
    ('bench', maya, 'Council said yes to the bench! Well, they said they''d look into it.', false, 18, array[lucas, priya], array[]::uuid[]),
    ('power', hannah, 'Blackout Block', true, 30, array[tom, ben, priya], array[]::uuid[]),
    ('power', hannah, 'Third blackout this month. Someone''s running a mining rig in a basement, I''m sure of it.', false, 24, array[tom, ben], array[lucas]),
    ('cleanup', tom, 'Bin Bag Park', true, 36, array[hannah], array[]::uuid[]),
    ('cleanup', hannah, 'We pulled fourteen bags out of here last spring. One shopping trolley, two traffic cones and a very surprised possum.', false, 40, array[tom, maya, lucas], array[]::uuid[]),
    ('bike', hannah, 'Let-Go Bridge', true, 140, array[maya, tom], array[]::uuid[]),
    ('bike', hannah, 'Learned to ride a bike on this path in ''79. Dad let go of the seat near the bridge and didn''t tell me until the far end. I cried, then made him do it again.', false, 144, array[maya, tom, priya], array[]::uuid[]),
    ('bike', maya, 'The winter of 2016 the river came right up over the benches. The ducks swam over them like they owned the place.', false, 30, array[hannah, ben], array[]::uuid[]);

  for w in select v.*, d.id as block from demo_words v join demo_blocks d on d.key = v.key loop
    insert into public.block_words (block_id, author_id, body, is_name, created_at)
    values (w.block, w.who, w.body, w.is_name, now() - make_interval(hours => w.hours))
    returning id into word;
    insert into public.word_votes (word_id, user_id, value, created_at)
    select word, u, 1, now() - make_interval(hours => w.hours) + interval '20 minutes' from unnest(w.up) u
    union all
    select word, u, -1, now() - make_interval(hours => w.hours) + interval '30 minutes' from unnest(w.down) u
    on conflict do nothing;
  end loop;
  update public.word_votes v set created_at = bw.created_at from public.block_words bw where v.word_id = bw.id and v.user_id = bw.author_id;

  -- Pins that take over a few blocks.
  update public.posts set blocks = v.blocks
  from (
    select 'Street clean-up, Saturday 9am' as title, array_agg(id) as blocks from demo_blocks where key in ('cleanup', 'g56')
    union all select 'Pickup soccer, Tuesday 6pm', array_agg(id) from demo_blocks where key = 'park'
    union all select 'Outdoor cinema in the park, Friday', array_agg(id) from demo_blocks where key = 'park'
    union all select 'Power out on Hutt St?', array_agg(id) from demo_blocks where key in ('power', 'g45', 'g35')
    union all select 'The busker on Rundle Mall is incredible', array_agg(id) from demo_blocks where key = 'busker'
  ) as v
  where posts.title = v.title and posts.author_id in (maya, tom, priya, lucas, hannah, ben);
end;
$$;

-- Threads: some replies answer other replies, and some lines on blocks have
-- answers of their own.
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
  if not exists (select 1 from public.block_words where author_id = maya) then
    raise notice 'Load the demo blocks first.';
    return;
  end if;
  if exists (select 1 from public.replies where parent_id is not null and author_id = any (demo)) then
    raise notice 'Demo threads are already here.';
    return;
  end if;

  -- (reply, the reply it answers)
  update public.replies r set parent_id = p.id
  from (values
    ('Thanks Ben, heading there now!', 'I think I saw a grey cat near the tennis courts this morning?'),
    ('Always. See you there.', 'Is there a spot for a slightly unfit cyclist?'),
    ('Flickers during minor chords. Otherwise fine.', 'How haunted is the lamp exactly?'),
    ('Back on now!', 'Same on Gilles St. SA Power says an hour.'),
    ('Two seats left!', 'Save me a seat, I''ll bring beer.')
  ) as v (answer, answered)
  join public.replies p on p.content = v.answered and p.author_id = any (demo)
  where r.content = v.answer and r.author_id = any (demo) and r.post_id = p.post_id;

  -- A reply further down the lamp thread.
  insert into public.replies (post_id, parent_id, content, author_id, author_name, created_at)
  select p.post_id, p.id, 'I will pay extra for the haunting.', tom, (select display_name from public.profiles where id = tom), p.created_at + interval '20 minutes'
  from public.replies p where p.content = 'Flickers during minor chords. Otherwise fine.' and p.author_id = lucas;

  -- (block line, who, answer, hours after it)
  insert into public.block_words (block_id, parent_id, author_id, body, created_at)
  select w.block_id, w.id, v.who, v.body, w.created_at + make_interval(hours => v.after)
  from (values
    ('Dumpling night is a cult now. Priya is the cult leader.', priya, 'I prefer "community". Bring chilli oil.', 2),
    ('Dumpling night is a cult now. Priya is the cult leader.', ben, 'Joined last week. No regrets.', 5),
    ('Third blackout this month. Someone''s running a mining rig in a basement, I''m sure of it.', lucas, 'It''s the tram substation. Every time.', 3),
    ('Rub the Mall''s Balls for luck. Everyone does. Nobody knows why.', priya, 'Rubbed them before my exam. Passed. Science.', 4),
    ('My nan ran a deli on this corner in the sixties. Kids came in after school for a bag of mixed lollies and she knew every one of them by name, and who their mum was.', hannah, 'My mum was one of those kids! She still talks about the milk bottles.', 6)
  ) as v (line, who, body, after)
  join public.block_words w on w.body = v.line and w.author_id = any (demo);
  update public.word_votes v set created_at = w.created_at from public.block_words w where v.word_id = w.id and v.user_id = w.author_id and w.parent_id is not null;
end;
$$;

-- Lore: sightings and stories, some already voted into Legends; a few stickers
-- where things were seen; and everyone's streaks.
do $$
declare
  maya uuid := 'd0000000-0000-4000-8000-000000000001';
  tom uuid := 'd0000000-0000-4000-8000-000000000002';
  priya uuid := 'd0000000-0000-4000-8000-000000000003';
  lucas uuid := 'd0000000-0000-4000-8000-000000000004';
  hannah uuid := 'd0000000-0000-4000-8000-000000000005';
  ben uuid := 'd0000000-0000-4000-8000-000000000006';
  demo uuid[] := array[maya, tom, priya, lucas, hannah, ben];
  p record;
  post uuid;
begin
  if not exists (select 1 from auth.users where id = maya) then
    raise notice 'Load the demo neighbourhood first.';
    return;
  end if;
  if exists (select 1 from public.posts where flair in ('sighting', 'story') and author_id = any (demo)) then
    raise notice 'Demo lore is already here.';
    return;
  end if;

  -- (who, kind, title, text, lat, lng, hours ago, up-voters, down-voters)
  create temporary table demo_lore (who uuid, flair text, title text, body text, lat float8, lng float8, hours int, up uuid[], down uuid[]) on commit drop;
  insert into demo_lore values
    (tom, 'sighting', 'Something big on the Torrens path at 5am', 'Riding in before sunrise and something the size of a man, but wider, crossed the path near the footbridge and went down into the reeds. No torch, no dog, no sound. I stopped and it didn''t come back up. Footprints in the mud this morning, I''m not kidding.', -34.91700, 138.59880, 30, array[maya, ben, lucas, hannah], array[]::uuid[]),
    (hannah, 'sighting', 'Lights over the parklands, 3am', 'Three orange lights in a line, no noise, drifting east over Victoria Park, then they just weren''t there. My neighbour saw them too from her balcony.', -34.92980, 138.61700, 20, array[priya, maya], array[tom]),
    (ben, 'sighting', 'A koala. On Rundle Mall. At lunch.', 'Just sitting on a bench outside the arcade like it owned the place. Security had no idea what to do. Anyone know where it went?', -34.92255, 138.60220, 5, array[tom, priya, lucas, maya], array[]::uuid[]),
    (lucas, 'story', 'The night shift at the old gaol', E'I did a winter of night security at the old gaol on Gaol Road, back when they ran the ghost tours.\n\nEvery night at 2:10 the motion light in the east yard came on. Every night. No wind, no possums on the camera, nothing. The guy before me said it was a guard who''d done his last round at ten past two in 1890-something and just kept doing it.\n\nOne night I stood in the yard at 2:09 to prove him wrong. The light came on over my head, and from somewhere down the row a door I''d locked myself went clunk, like someone checking it.\n\nI finished the winter. I didn''t go back into the yard at ten past two.', -34.91760, 138.58640, 60, array[maya, tom, priya, hannah, ben], array[]::uuid[]),
    (priya, 'story', 'Why the Gouger St dumpling place has a second door', E'Ask the old man who owns it and he''ll tell you: in the 80s the council made him brick up the back door, so every night one of the regulars would come in the front, eat, and leave through the kitchen anyway.\n\nWhen they rebuilt, he put in a second front door. It opens onto the same street, three metres along. It''s for "the ones who don''t like to leave the way they came in". Nobody has ever explained this to me further.', -34.92905, 138.59745, 44, array[lucas, ben], array[]::uuid[]),
    (maya, 'story', 'The possum who rings the doorbell', 'Every night around 11 the doorbell goes. Nobody there. We put a camera up: it''s a brushtail, standing on the letterbox, leaning on the button with its whole face. We have named him Gerald. Gerald wants apple.', -34.92231, 138.61912, 12, array[hannah, priya, tom], array[]::uuid[]);

  for p in select * from demo_lore loop
    with place as (
      insert into public.places (latitude, longitude, created_at) values (p.lat, p.lng, now() - make_interval(hours => p.hours)) returning id
    )
    insert into public.posts (place_id, title, description, latitude, longitude, flair, author_id, author_name, created_at)
    select place.id, p.title, p.body, p.lat, p.lng, p.flair, p.who, (select display_name from public.profiles where id = p.who), now() - make_interval(hours => p.hours)
    from place
    returning id into post;
    insert into public.post_votes (post_id, user_id, value, created_at)
    select post, u, 1, now() - make_interval(hours => p.hours) + interval '1 hour' from unnest(p.up) u
    union all
    select post, u, -1, now() - make_interval(hours => p.hours) + interval '2 hours' from unnest(p.down) u;
  end loop;
  -- Voted in when the votes came in, not just now.
  update public.posts set legend_at = created_at + interval '1 hour' where legend_at is not null and author_id = any (demo);
  update public.notifications set created_at = now() - interval '20 hours' where kind = 'legend' and user_id = any (demo);

  -- A few votes on the other pins too.
  insert into public.post_votes (post_id, user_id, value)
  select id, v.who, 1 from public.posts, (values (maya), (tom), (priya), (lucas)) as v (who)
  where title in ('Street clean-up, Saturday 9am', 'Too many zucchinis, come grab some') and author_id = any (demo) and author_id <> v.who
  on conflict do nothing;

  -- Stickers where the things were seen: footprints on the path, a ghost on the gaol.
  insert into public.stickers (user_id, emoji, latitude, longitude, created_at, expires_at) values
    (tom, '👣', -34.91712, 138.59840, now() - interval '2 hours', now() + interval '22 hours'),
    (ben, '👣', -34.91690, 138.59810, now() - interval '1 hour', now() + interval '23 hours'),
    (lucas, '👻', -34.91740, 138.58680, now() - interval '3 hours', now() + interval '21 hours'),
    (hannah, '🛸', -34.92940, 138.61760, now() - interval '5 hours', now() + interval '19 hours'),
    (priya, '🎉', -34.92890, 138.59770, now() - interval '30 minutes', now() + interval '23 hours');

  -- Streaks and sparks.
  update public.profiles set streak = v.streak, streak_day = (now() at time zone 'Australia/Adelaide')::date - 1, sparks = v.sparks, sparks_earned = v.earned
  from (values (maya, 12, 23, 61), (tom, 30, 40, 160), (priya, 6, 11, 34), (lucas, 3, 8, 20), (hannah, 45, 52, 190), (ben, 2, 5, 12)) as v (who, streak, sparks, earned)
  where id = v.who;
end;
$$;

-- Photos on the pins (the files are in supabase/demo; npm run setup puts them in
-- storage under post-media/demo), a few snaps, a picnic that's on right now,
-- and a reply that brings its own photo.
do $$
declare
  maya uuid := 'd0000000-0000-4000-8000-000000000001';
  tom uuid := 'd0000000-0000-4000-8000-000000000002';
  priya uuid := 'd0000000-0000-4000-8000-000000000003';
  lucas uuid := 'd0000000-0000-4000-8000-000000000004';
  hannah uuid := 'd0000000-0000-4000-8000-000000000005';
  ben uuid := 'd0000000-0000-4000-8000-000000000006';
  demo uuid[] := array[maya, tom, priya, lucas, hannah, ben];
  photos text := 'http://127.0.0.1:54321/storage/v1/object/public/post-media/demo/';
  p record;
  answer uuid;
begin
  if not exists (select 1 from public.posts where flair = 'sighting' and author_id = any (demo)) then
    raise notice 'Load the demo lore first.';
    return;
  end if;
  if exists (select 1 from public.post_media where url like '%/post-media/demo/%') then
    raise notice 'Demo photos are already here.';
    return;
  end if;

  -- The koala was up a tree, as its photo shows.
  update public.posts set description = 'Up the plane tree outside the arcade like it owned the place. Security had no idea what to do. Anyone know where it went?'
  where title = 'A koala. On Rundle Mall. At lunch.' and author_id = ben;

  -- (who, kind, title, text, lat, lng, minutes ago, starts: minutes from now)
  create temporary table demo_new (who uuid, flair text, title text, body text, lat float8, lng float8, minutes int, starts int) on commit drop;
  insert into demo_new values
    (hannah, 'snap', 'Sunset from the hills', '', -34.93850, 138.61950, 90, null),
    (lucas, 'snap', 'Laneway after the rain', '', -34.92400, 138.60560, 200, null),
    (priya, 'snap', 'Best flat white on Gouger, fight me', '', -34.92870, 138.59900, 35, null),
    (ben, 'event', 'Sunset picnic in Rymill Park, on now', 'Blankets by the lake. Bring something to share, there''s plenty of room.', -34.92330, 138.61400, 60, -30);
  for p in select * from demo_new loop
    with place as (
      insert into public.places (latitude, longitude, created_at) values (p.lat, p.lng, now() - make_interval(mins => p.minutes)) returning id
    )
    insert into public.posts (place_id, title, description, latitude, longitude, flair, author_id, author_name, created_at, starts_at)
    select place.id, p.title, p.body, p.lat, p.lng, p.flair, p.who, (select display_name from public.profiles where id = p.who),
      now() - make_interval(mins => p.minutes), case when p.starts is not null then now() + make_interval(mins => p.starts) end
    from place;
  end loop;
  -- A snap's day runs from when it was taken.
  update public.posts set expires_at = created_at + interval '24 hours' where flair = 'snap' and author_id = any (demo);

  -- (pin, photo)
  insert into public.post_media (post_id, author_id, media_type, url, created_at)
  select post.id, post.author_id, 'image', photos || v.file || '.jpg', post.created_at + interval '2 minutes'
  from (values
    ('Something big on the Torrens path at 5am', 'sighting-torrens-path'),
    ('Lights over the parklands, 3am', 'sighting-parklands-lights'),
    ('A koala. On Rundle Mall. At lunch.', 'sighting-koala'),
    ('The night shift at the old gaol', 'story-old-gaol'),
    ('Why the Gouger St dumpling place has a second door', 'story-dumpling-door'),
    ('The possum who rings the doorbell', 'story-doorbell-possum'),
    ('Lost: grey tabby called Miso', 'lost-miso'),
    ('Street clean-up, Saturday 9am', 'cleanup-crew'),
    ('Garage sale, everything must go', 'garage-sale-lamp'),
    ('Farmers market this Sunday', 'farmers-market'),
    ('New cafe opening on King William', 'new-cafe'),
    ('Dumpling night, three spare seats', 'dumpling-night'),
    ('Sunset from the hills', 'snap-sunset'),
    ('Laneway after the rain', 'snap-laneway'),
    ('Best flat white on Gouger, fight me', 'snap-coffee'),
    ('Sunset picnic in Rymill Park, on now', 'event-sunset-picnic')
  ) as v (title, file)
  join public.posts post on post.title = v.title and post.author_id = any (demo);

  -- Tom answers the clean-up with last year's haul.
  insert into public.replies (post_id, content, author_id, author_name, created_at)
  select id, 'Last year''s haul, for motivation. The trailer''s booked again.', tom, (select display_name from public.profiles where id = tom), created_at + interval '3 hours'
  from public.posts where title = 'Street clean-up, Saturday 9am' and author_id = hannah
  returning id into answer;
  insert into public.post_media (post_id, reply_id, author_id, media_type, url, created_at)
  select post_id, id, tom, 'image', photos || 'cleanup-skip.jpg', created_at from public.replies where id = answer;
end;
$$;
