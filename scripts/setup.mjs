// From a fresh clone to a running backend of your own, in one command:
//
//   npm ci && npm run setup && npm run dev
//
// By default: the offline backend,
// which needs neither Docker nor the internet. Postgres runs inside the dev
// server (server/offline.mjs), keeping everything in supabase/.local. This
// builds its database now. The demo area's map ships in public/tiles.
//
// `npm run setup -- --supabase` opts into local Supabase in Docker instead.
//
// Either way it never wipes anything, and .env.local ends up with what the app needs.

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'

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

const flags = process.argv.slice(2)
if (flags.some((flag) => !['--offline', '--supabase'].includes(flag)) || (flags.includes('--offline') && flags.includes('--supabase'))) {
  throw new Error('Use npm run setup, or npm run setup -- --supabase for Docker.')
}
const offline = !flags.includes('--supabase')
let where

if (!offline) {
  if (!dockerForSupabase()) throw new Error('Supabase needs Docker running with Linux containers. Use npm run setup for the offline backend.')
  const supabase = works('supabase --version') ? 'supabase' : 'npx --yes supabase'
  run(`${supabase} start`)
  run(`${supabase} migration up`)
  const status = JSON.parse(run(`${supabase} status -o json`, true))
  // The demo's photos, into storage where the seed's pins point (post-media/demo).
  const key = status.SERVICE_ROLE_KEY || status.SECRET_KEY
  for (const file of readdirSync('supabase/demo').filter((f) => f.endsWith('.jpg'))) {
    const response = await fetch(`${status.API_URL}/storage/v1/object/post-media/demo/${file}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, apikey: key, 'x-upsert': 'true', 'Content-Type': 'image/jpeg' },
      body: readFileSync(`supabase/demo/${file}`),
    })
    if (!response.ok) console.log(`Couldn't put ${file} in storage: ${response.status} ${await response.text()}`)
  }
  save({
    VITE_SUPABASE_URL: status.API_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY || status.ANON_KEY,
    AROUNDHERE_BACKEND: 'supabase',
    VITE_TILES_URL: null,
  })
  where = `local Supabase, in Docker. Emails (sign-in codes, resets) land in ${status.MAILPIT_URL || status.INBUCKET_URL}; the database is at ${status.STUDIO_URL}`
} else {
  console.log('Using the local offline backend (no Docker or internet needed).\n')
  if (!existsSync('public/tiles/manifest.json')) throw new Error('The bundled map is missing. Get public/tiles from the project, or run npm run cache:map while online.')
  const tiles = JSON.parse(readFileSync('public/tiles/manifest.json', 'utf8')).tiles
  if (!Object.keys(tiles).length || Object.keys(tiles).some((tile) => !existsSync(`public/tiles/${tile}`))) {
    throw new Error('The bundled map is incomplete. Get public/tiles from the project, or run npm run cache:map while online.')
  }
  const { keys, openBackend } = await import('../server/offline.mjs')
  const { anon } = keys(process.cwd())
  try {
    await (await openBackend(process.cwd())).close()
  } catch (error) {
    // A dev server already has it, and applies new migrations when it starts.
    if (error.code !== 'LOCKED') throw error
    console.log(`${error.message}\nIt's set up; restart that server after pulling to apply new migrations.\n`)
  }
  save({
    AROUNDHERE_BACKEND: 'offline',
    VITE_SUPABASE_URL: 'http://127.0.0.1:5173',
    VITE_SUPABASE_PUBLISHABLE_KEY: anon,
    VITE_TILES_URL: '/tiles/{z}/{x}/{y}.pbf',
  })

  console.log('The demo map is bundled in public/tiles; no download needed.')
  where = 'the offline backend, inside the dev server (everything in supabase/.local). Emails (sign-in codes, resets) land in http://127.0.0.1:5173/_mail'
}

console.log(`
Ready, on ${where}.
Now: npm run dev, and open http://127.0.0.1:5173

Demo accounts, password "neighbour": maya@aroundhere.demo (friends, messages
and a request waiting), tom@, priya@, lucas@, hannah@, ben@aroundhere.demo.`)
