# AroundHere

A community social map for neighbours. Anyone can make an account and drop a
pin on what's going on:

- Hosting a BBQ? Looking for people to hang out with?
- Someone dumping rubbish on your street? Lost cat? Local gossip?
- Want to see if the neighbours would back a bench in the park?

Pins are threads: people reply, say they're in, save them, and message each
other. Pins can have a time, so tonight's BBQ counts down in the feed, shows
under Soon, and ripples on the map while it's on. Add friends (People around
here suggests neighbours whose pins are close), share your location with
them, until you stop or just for an hour, and see each other on the map with
your photos. Tap a friend to talk; you'll see when they're typing. Your dot
only shows while you have the app open.

Looking after each other: block someone (they can't message or add you,
and their pins and replies disappear for you), or report a pin; reports
land in the `reports` table for whoever runs the neighbourhood.

Accounts: sign up with email and password, sign in with a password or an
emailed code, reset a forgotten password by code, change email or password,
pick a profile photo, delete your account. New accounts get a short
getting-started list.

## Running it

You need Node and the Supabase CLI (Docker underneath).

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
a friend request waiting and unread messages.

Emails (sign-in codes, password resets) land in Mailpit at http://127.0.0.1:54324.

Shared locations only count while they're fresh (a real phone refreshes its
own), so the demo neighbours fade off the map after half a day. To put them
back before a demo:

```sh
docker exec supabase_db_hackathon-2026 psql -U postgres -c "update locations set updated_at = now() where user_id::text like 'd0000000%'"
```

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
5. On a phone (or the browser's phone view): the tab bar, sheets you drag up
   and down, pinch to zoom, and the locate button that follows you around.

## Map styles

Press `T` to cycle, or pick one in Settings.

| Style      | Look |
|------------|------|
| Sun        | Day while the sun is up where you are, Night after (worked out from the sun's position, no service) |
| Day        | Clean and bright |
| Night      | Dark, easy on the eyes |
| Palm Coast | Sun-bleached 2004 console radar: square blips, fat outlined caps |
| Metro      | Modern pause-menu atlas: dark slate, round blips, condensed type |
| Frontier   | Hand-inked survey map on parchment: wobbly ink, hatched water, tree marks |
| Phosphor   | Green CRT tracking screen with glow, scanlines and a sweep |
| Neon Bay   | Eighties beachfront nights: hot pink roads glowing over purple, a low sunset |

Each style changes the map, the blips and people, the whole interface, and the
screen effect on top. The game styles cover the map in place blips from
further out, like a pause-menu map; the legend (the `i` button) says what
they mean. They also get a radar in the corner: the streets around you, your
arrow, north on the rim, friends and live pins waiting on the edge in their
direction. Tap it to go back to where you are.

Sounds are synthesized in the browser, no audio files: each style plays its
own short sting when you post, resolve or make a friend (a plucked-string
arpeggio for Frontier, an 8-bit climb for Palm Coast, a filtered synth run
for Neon Bay…) and a tick for messages. Settings turns them off.

## Keys

`/` or `Ctrl K` search pins, people, streets and commands (fuzzy: `rndl` finds
Rundle) · `N` new pin ·
`J` `K` next and previous pin · `L` where am I (follows you until you move the map) ·
`T` next map style · `F` friends · `I` inbox · arrows move the map · `+` `−`
zoom · `Esc` close

On phones: the tab bar at the bottom, sheets you can drag up to full height
or down to close, pinch and double-tap to zoom. It installs to the home
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
  zoom, double-tap, and animated flights.
- `src/data.ts` is the store. The public picture (pins, replies, people) loads
  once and stays live over Supabase realtime; the signed-in user's inbox,
  friends and saved pins load on sign-in. Every write is a plain function
  that updates Supabase and then the store.
- `src/App.tsx` is the whole interface: feed, threads, profiles, chat, inbox,
  friends and location sharing, settings, compose, accounts and the command
  palette. UI state lives in one object; anything that changes it redraws.
- `src/App.css` holds the six themes as CSS variables, the layouts for wide
  screens (floating panels) and phones (sheets and a tab bar), and the effects.

The database is in `supabase/migrations`. Row level security does the
privacy work: messages, inbox and saved pins are private, and a location is
only readable by accepted friends while its owner shares it.

Map data © OpenStreetMap contributors, tiles by OpenFreeMap.
