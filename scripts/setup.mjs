// From a fresh clone to a running backend of your own, in one command:
//
//   npm install && npm run setup && npm run dev
//
// With Docker running: local Supabase (the Supabase CLI comes through npx if it
// isn't installed). The first start builds the database from the migrations
// and loads the demo neighbourhood; later runs apply whatever migrations are new.
//
// Without Docker (or with `npm run setup -- --offline`): the offline backend,
// which needs neither Docker nor the internet. Postgres runs inside the dev
// server (server/offline.mjs), keeping everything in supabase/.local. This
// builds its database now, and, while there's internet, keeps the demo
// area's map so the map works offline too.
//
// Either way it never wipes anything, and .env.local ends up with what the app needs.

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const run = (command, quiet = false) => execSync(command, { stdio: quiet ? 'pipe' : 'inherit', encoding: 'utf8' })

function works(command) {
  try {
    run(command, true)
    return true
  } catch {
    return false
  }
}

// .env.local, rewritten with these settings (a null one taken out) and anything else kept.
function save(settings) {
  const kept = existsSync('.env.local')
    ? readFileSync('.env.local', 'utf8').split('\n').filter((line) => line.trim() && !Object.keys(settings).some((key) => line.startsWith(`${key}=`)))
    : ['# Local-only config (gitignored via *.local). Written by npm run setup.']
  const set = Object.entries(settings).filter(([, value]) => value !== null)
  writeFileSync('.env.local', [...kept, ...set.map(([key, value]) => `${key}=${value}`)].join('\n') + '\n')
}

// Docker that runs Linux containers, which is what Supabase needs (Docker on
// Windows can be switched to Windows containers, which won't do).
function dockerForSupabase() {
  try {
    return run('docker info --format "{{.OSType}}"', true).trim() === 'linux'
  } catch {
    return false
  }
}

const offline = process.argv.includes('--offline') || !dockerForSupabase()
let where

if (!offline) {
  const supabase = works('supabase --version') ? 'supabase' : 'npx --yes supabase'
  run(`${supabase} start`)
  run(`${supabase} migration up`)
  const status = JSON.parse(run(`${supabase} status -o json`, true))
  save({
    VITE_SUPABASE_URL: status.API_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY || status.ANON_KEY,
    AROUNDHERE_BACKEND: null,
    VITE_TILES_URL: null,
  })
  where = `local Supabase, in Docker. Emails (sign-in codes, resets) land in ${status.MAILPIT_URL || status.INBUCKET_URL}; the database is at ${status.STUDIO_URL}`
} else {
  if (!process.argv.includes('--offline')) console.log('No Docker running: using the offline backend (no Docker, no internet needed).\n')
  const { openBackend, keepTiles } = await import('../server/offline.mjs')
  const backend = await openBackend(process.cwd())
  const { anon } = backend.keys
  await backend.close()
  save({
    AROUNDHERE_BACKEND: 'offline',
    VITE_SUPABASE_URL: 'http://127.0.0.1:5173',
    VITE_SUPABASE_PUBLISHABLE_KEY: anon,
    VITE_TILES_URL: '/tiles/{z}/{x}/{y}.pbf',
  })

  // The middle of Adelaide, where the demo is, down to street level.
  process.stdout.write("Keeping the demo area's map for offline")
  const { total, kept } = await keepTiles(process.cwd(), [138.54, -34.96, 138.67, -34.88], 14, (done) => done % 10 === 0 && process.stdout.write('.'))
  console.log(kept === total ? ` all ${total} tiles.` : kept ? ` ${kept} of ${total} tiles (the rest when there's internet).` : ' no internet now: the map fills in (and is kept) as you use it online.')
  where = 'the offline backend, inside the dev server (everything in supabase/.local). Emails (sign-in codes, resets) land in http://127.0.0.1:5173/_mail'
}

console.log(`
Ready, on ${where}.
Now: npm run dev, and open http://127.0.0.1:5173

Demo accounts, password "neighbour": maya@aroundhere.demo (friends, messages
and a request waiting), tom@, priya@, lucas@, hannah@, ben@aroundhere.demo.`)
