// From a fresh clone to a running backend in one command:
//
//   npm install && npm run setup && npm run dev
//
// Starts local Supabase (Docker underneath; the Supabase CLI comes through npx
// if it isn't installed). The first start builds the database from the
// migrations and loads the demo neighbourhood. Later runs, after a pull, apply
// whatever migrations are new. Then .env.local gets the local address and key.
// Safe to run again: it never wipes anything.

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const run = (command, quiet = false) => execSync(command, { stdio: quiet ? 'pipe' : 'inherit', encoding: 'utf8' })

function has(command) {
  try {
    run(command, true)
    return true
  } catch {
    return false
  }
}

if (!has('docker info')) {
  console.error('Docker isn’t running. Start Docker Desktop, OrbStack or Colima, then run this again.')
  console.error('(With a Colima profile of its own, point DOCKER_HOST at its socket first.)')
  process.exit(1)
}

const supabase = has('supabase --version') ? 'supabase' : 'npx --yes supabase'
run(`${supabase} start`)
run(`${supabase} migration up`)

const status = JSON.parse(run(`${supabase} status -o json`, true))
const settings = {
  VITE_SUPABASE_URL: status.API_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY || status.ANON_KEY,
}

// Anything else already in .env.local stays.
const kept = existsSync('.env.local')
  ? readFileSync('.env.local', 'utf8').split('\n').filter((line) => line.trim() && !Object.keys(settings).some((key) => line.startsWith(`${key}=`)))
  : ['# Local-only config (gitignored via *.local). Written by npm run setup.']
writeFileSync('.env.local', [...kept, ...Object.entries(settings).map(([key, value]) => `${key}=${value}`)].join('\n') + '\n')

console.log(`
Ready. Now: npm run dev, and open http://127.0.0.1:5173

Demo accounts, password "neighbour": maya@aroundhere.demo (friends, messages
and a request waiting), tom@, priya@, lucas@, hannah@, ben@aroundhere.demo.
Emails (sign-in codes, resets) land in ${status.MAILPIT_URL || status.INBUCKET_URL}.
The database, to look around: ${status.STUDIO_URL}.`)
