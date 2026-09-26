# AroundHere

A community social map for neighbours. Anyone can make an account and drop a
pin on what's going on:

- Hosting a BBQ? Looking for people to hang out with?
- Someone dumping rubbish on your street? Lost cat? Local gossip?
- Want to see if the neighbours would back a bench in the park?

Pins are threads: people reply, say they're in, save them, and message each
other. Add friends, share your location with them, and see each other on the
map. Tap a friend to talk.

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

## Map styles

Press `T` to cycle, or pick one in Settings.

| Style      | Look |
|------------|------|
| Day        | Clean and bright |
| Night      | Dark, easy on the eyes |
| Palm Coast | Sun-bleached 2004 console radar: square blips, fat outlined caps |
| Metro      | Modern pause-menu atlas: dark slate, round blips, condensed type |
| Frontier   | Hand-inked survey map on parchment: wobbly ink, hatched water, tree marks |
| Phosphor   | Green CRT tracking screen with glow, scanlines and a sweep |

Each style changes the map, the blips and people, the whole interface, and the
screen effect on top.

## Keys

`/` or `Ctrl K` search and commands · `N` new pin · `L` where am I ·
`T` next map style · `F` friends · `I` inbox · `+` `−` zoom · `Esc` close

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
