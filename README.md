# AroundHere

A community social map for neighbours. Anyone can make an account and drop a
pin on what's going on:

- Hosting a BBQ? Looking for people to hang out with?
- Someone dumping rubbish on your street? Lost cat? Local gossip?
- Want to see if the neighbours would back a bench in the park?

![The map in each of its styles, with a walk to a street clean-up under way](docs/styles.jpg)

*Day, Night, Palm Coast, Metro; Frontier, Phosphor, Neon Bay, and Metro on a phone.*

What you can do:

- **Pins are threads.** Reply (mention people with `@`, heart a good reply), say you're in, save,
  or share. Answer a reply and it nests under it, Reddit-style: whoever you
  answered hears about it, and the line down a thread's side folds it away. A
  comment taken back after others answered it stays as "[deleted]", so the
  thread under it isn't lost. Give a pin a time and it counts down in the feed, shows under
  Soon, ripples on the map while it's on, and goes to your calendar in a tap;
  anything you're in on gets you a word an hour before.
- **City blocks, and what the neighbours make of them.** Tap the map between
  streets and that block opens: the app finds it from the map's own streets,
  and it's the same block for everyone from then on. People give it names and
  write on it (a rumour, a joke, what used to be here), and vote each line up
  or down, Reddit-style: the best-liked name becomes what the block is called,
  written across it on the map, and the best-liked lines float to the top.
  Every pin ever dropped there stays in its history. Nobody writes "lore";
  it builds up out of what people say and do.
- **Pins take over blocks.** Something that happens across a few blocks (a
  street party, a clean-up, a blackout) is pinned to them: tap the blocks when
  making the pin. They're marked out the way each style marks ground.
- **Turf.** Four crews (Magpies, Galahs, Possums, Owls) fight over the blocks,
  like the gang territories on a 2004 console map. Stand in a block and tag it:
  a twelve-second spraying game where you cover the other crews' tags on a
  wall, and how well you do is what the tag is worth. The crew with the most
  tags holds the block and colours it; tags fade by half every three days, so
  ground has to be kept. A block being hit flashes red, and the people who
  tagged it hear about it. The flag button shows the standings and the fights
  on right now.
- **Back in time.** The clock button (or `Y`) shows the map as it was at any
  moment: the pins up then, what the blocks were called and who held them. Pick
  how far back the timeline reaches (an hour, a day, a week, a month, a year)
  and it steps a minute at a time over the last hour, up to a day at a time over
  the year. Play runs it forward: pins drop in, names appear, turf spreads.
- **Get there.** A walking route along the streets, drawn on the map (a GPS
  line in the game styles) with the minutes it takes and
  the street most of it is on. It shortens as you walk, finds a new way if
  you stray, and works for a friend too, following them as they move (one
  tap tells them you're on your way), or any street search finds. Your own
  maps app is one tap away.
- **Friends.** People around here suggests neighbours whose pins are close.
  Friends can share their location (until they stop, or just for an hour) and
  see each other on the map with their photos, only while the app is open;
  when one is a street away, you get a word about it.
- **Messages.** Tap a friend on the map to talk; you'll see when they're
  typing and when they've read it. Send a pin and it shows as a card.
- **Looking after each other.** Block someone (they can't message or add
  you, and their pins and replies disappear for you) or report a pin; reports
  land in the `reports` table for whoever runs the neighbourhood.
- **Accounts.** Sign up with email and password, sign in with a password or
  an emailed code, reset a forgotten password by code, change email or
  password, pick a profile photo, delete your account. New accounts get a
  short getting-started list. Settings turns off any kind of notification,
  one by one.

![Get there in Metro: the way along the streets as a GPS line, with the mission line and the walk bar](docs/walk.jpg)

## Running it

You need Node (20.19 or 22.12 and up, for Vite) and the Supabase CLI (Docker
underneath).

```sh
npm install
supabase start                      # local Postgres, auth, realtime, storage
supabase db reset                   # migrations + the demo neighbourhood (wipes local data)
cp .env.example .env.local          # then paste the publishable key from `supabase status`
npm run dev
```

Already have a local database you want to keep? Apply new migrations with
`supabase migration up`, and load the demo on top of it with:

```sh
docker exec -i supabase_db_hackathon-2026 psql -U postgres < supabase/seed.sql
```

Demo accounts (password `neighbour`): `maya@aroundhere.demo`,
`tom@aroundhere.demo`, `priya@aroundhere.demo`, `lucas@aroundhere.demo`,
`hannah@aroundhere.demo`, `ben@aroundhere.demo`. Maya has friends on the map,
a friend request waiting and unread messages. In development the sign-in
sheet has one-tap buttons for them (never in a production build).

Emails (sign-in codes, password resets) land in Mailpit at http://127.0.0.1:54324.

To try it on a phone over Tailscale, connect both devices to the same tailnet.
With the dev server on port 5173, run:

```sh
tailscale serve --bg --https=443 http://127.0.0.1:5173
```

On the first run, follow Tailscale's link to enable HTTPS. Open the HTTPS URL
printed by the command on your phone, with Tailscale connected. Keep the Mac
awake and the dev server running. The current Mac's URL is
`https://nicks-macbook-pro.tail1185f0.ts.net/`; another Mac needs its hostname
added to `server.allowedHosts` in `vite.config.ts`.

Keep `VITE_SUPABASE_URL` pointing to local Supabase. The dev server passes
auth, database, storage and realtime requests through the same HTTPS address,
so location features can work too. To stop sharing this app, run
`tailscale serve --https=443 off`.

Shared locations only count while they're fresh (a real phone refreshes its
own), so the demo neighbours fade after half an hour and leave the map after
half a day. Before a demo, put the whole neighbourhood back (friends on the
map, Maya's unread messages and waiting friend request, hearts on replies); it
touches only the demo accounts:

```sh
docker exec -i supabase_db_hackathon-2026 psql -U postgres < supabase/demo-reset.sql
```

## Putting it online

The frontend is a static build (`npm run build`, then serve `dist/`). For a
hosted Supabase project:

```sh
supabase link --project-ref <your project>
supabase db push                    # applies supabase/migrations
```

Then, in the dashboard: set the Site URL to where the frontend lives, and
copy the two email templates in `supabase/templates/` (sign-in code and
password reset) into Authentication → Email Templates, so emails carry a
6-digit code the app asks for. Don't run `seed.sql` there; it's demo data.

## Demo in two minutes

1. Open the app signed out: the map of Adelaide with pins, the feed beside it.
   Hover a pin, then press `T` a few times to go through the map styles.
2. Sign in as `maya@aroundhere.demo` / `neighbour`. Her friends Tom, Priya and
   Hannah are on the map; Tom has sent her a message (red badge on his dot).
   Click Tom to open the chat.
3. In a second browser (or a private window) sign in as `tom@aroundhere.demo`
   and open his chat with Maya: type, and Maya sees "typing…"; send, and it
   arrives live, with "seen" once she's looked.
4. As Tom, press `N`, pick Event, give it a time an hour from now and post: it
   pops up on Maya's map with a ripple, and she gets a notification.
5. As Maya, open Hannah's street clean-up and press Get there: the way along
   the streets, with the time it takes. Press `T` for Metro to see it as a
   purple GPS line. (It starts from where you really are;
   away from Adelaide, set a location near the city centre in the browser's
   dev tools, under Sensors.)
6. As Maya, switch to Palm Coast and zoom out a little: the crews' turf in
   their colours, Busker Row on Rundle Mall flashing because the Galahs are
   hitting it. Tap Dumpling Alley: its names and what people say about it,
   with votes, and its pins. Press Tag it (Touch up, since it's Maya's crew's)
   to play the spraying game; it needs you to be there, so set the location in
   dev tools to the block first.
7. On a phone (or the browser's phone view): the tab bar, sheets you drag up
   and down, pinch to zoom, and the locate button that follows you around.

## Map styles

Press `T` to cycle, or pick one in Settings.

| Style      | Look |
|------------|------|
| Sun        | Day while the sun is up where you are, Night after (worked out from the sun's position, no service) |
| Day        | Clean and bright |
| Night      | Dark, easy on the eyes |
| Palm Coast | Sun-bleached 2004 console map: square blips, fat outlined caps |
| Metro      | Modern pause-menu atlas: dark slate, round blips, condensed type |
| Frontier   | Hand-inked survey map on parchment: wobbly ink, hatched water, tree marks |
| Phosphor   | Green CRT tracking screen with glow, scanlines and a sweep |
| Neon Bay   | Eighties beachfront nights: hot pink roads glowing over purple, a low sunset |

Each style changes the map, the blips and people, the whole interface, and the
screen effect on top. The game styles cover the map in place blips from
further out, like a pause-menu map; the legend (the `i` button) says what
they mean. Setting off somewhere, they say so the way their games do, with
a mission line at the bottom ("Go to the street clean-up."), and messages go
up top left, each style in its own way: a help box, an inked band, a line of
terminal output, a neon-edged box.

Sounds are synthesized in the browser, no audio files: each style plays its
own short sting when you post, resolve or make a friend (a plucked-string
arpeggio for Frontier, an 8-bit climb for Palm Coast, a filtered synth run
for Neon Bay…) and a tick for messages. Settings turns them off.

## Keys

`/` or `Ctrl K` search pins, people, streets and commands (fuzzy: `rndl` finds
Rundle; `walk rundle mall` walks you there) · `N` new pin ·
`J` `K` next and previous pin · `L` where am I (follows you until you move the map) ·
`G` get there on foot (again to stop) · `Y` back in time ·
`T` next map style · `F` friends · `I` inbox · arrows move the map · `+` `−`
zoom · `Esc` close

On phones: the tab bar at the bottom, sheets you can drag up to full height
or down to close, pinch and double-tap to zoom, and press and hold the map to
pin something right there (right-click does the same with a mouse). It installs to the home
screen like an app.

## How it's built

Four source files, no UI or map libraries:

- `src/map.ts` draws the map. It fetches vector tiles from OpenFreeMap
  (OpenMapTiles schema), decodes the protobuf itself, paints each tile once
  per zoom level into a bitmap, and composites those every frame. Labels,
  blips, pins and people are placed per frame in screen space so they never
  overlap or get cut at tile edges. Tile painting is budgeted per frame, and
  missing tiles are stood in for by scaled-up parents, so zooming stays at
  60 fps. It also handles all the input: drag with fling, wheel and pinch
  zoom, double-tap, and animated flights. Walking routes come from the same
  tiles: the roads between the two ends are joined into a graph (crossings
  found by intersecting segments, since the tiles drop vertices on straight
  lines; bridges and tunnels meet only what joins their ends) and A* walks it.
  City blocks come from the same graph, of streets this time: dead ends
  pruned, a block is a face of it, traced by walking round from the nearest
  street turning as far left as the streets allow at every corner.
- `src/data.ts` is the store. The public picture (pins, replies, people) loads
  once and stays live over Supabase realtime; the signed-in user's inbox,
  friends and saved pins load on sign-in. Every write is a plain function
  that updates Supabase and then the store.
- `src/App.tsx` is the whole interface: feed, threads, profiles, chat, inbox,
  friends and location sharing, settings, compose, accounts and the command
  palette. UI state lives in one object; anything that changes it redraws.
- `src/App.css` holds the seven themes as CSS variables, the layouts for wide
  screens (floating panels) and phones (sheets and a tab bar), and the effects.

The database is in `supabase/migrations`. Row level security does the
privacy work: messages, inbox and saved pins are private, and a location is
only readable by accepted friends while its owner shares it.

### Privacy, and how not to break it

Where people are and when they're around is the sensitive part, so:

- **Locations and online status are friends-only.** Row security on
  `locations` and `presence` lets only accepted friends read them. Your dot is
  withdrawn when the app goes out of view, and positions older than 12 hours
  are ignored.
- **Those rows are never deleted, only updated.** Supabase realtime sends
  every DELETE to every client, whatever the row security, with the row's key,
  which for these tables is a person. Stopping sharing sets `shared = false`;
  leaving sets that device's `here = false` (the server stamps `seen_at`, so
  no one's clock decides who looks online).
- **Helper functions live in the `private` schema**, which the API doesn't
  expose. In `public`, `are_friends` or `has_blocked` would tell anyone who's
  friends with or blocked whom, and `notify` would let anyone send
  notifications as anyone.
- **"Typing…" uses a private realtime channel** that only the two people in
  the chat may join (policies on `realtime.messages`).
- Blocks are private to the blocker, and `notify` stops at them.
- **Photos only come from the project's own storage.** The columns can be
  written directly, and a picture on someone's own server would tell them who
  looked at it, so whatever host a stored address names, the app fetches the
  picture from its own storage by its path in the bucket (or not at all).

Map data © OpenStreetMap contributors, tiles by OpenFreeMap.
