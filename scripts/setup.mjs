// From a fresh clone to a running backend in one command:
//
//   npm install && npm run setup && npm run dev
//
// With Docker running: starts local Supabase (the Supabase CLI comes through npx
// if it isn't installed). The first start builds the database from the
// migrations and loads the demo neighbourhood; later runs, after a pull, apply
// whatever migrations are new. Safe to run again: it never wipes anything.
//
// Without Docker, or with `npm run setup -- --shared`: uses the team's shared
// Supabase instead (supabase/shared.env), the one on Nick's Mac, reached over
// Tailscale. Everyone's data is in it together, and it's up while that Mac is.
//
// Either way, .env.local gets the address and key the app needs.

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

// VITE_... lines from a file of them.
const settingsIn = (file) =>
  Object.fromEntries(
    readFileSync(file, 'utf8')
      .split('\n')
      .map((line) => /^(VITE_[A-Z_]+)=(.*)$/.exec(line.trim()))
      .filter((match) => match && match[2])
      .map((match) => [match[1], match[2]]),
  )

let settings
let where
if (process.argv.includes('--shared') || !has('docker info')) {
  if (!process.argv.includes('--shared')) console.log('No Docker running: using the team’s shared Supabase instead.')
  settings = settingsIn('supabase/shared.env')
  where = `the shared Supabase at ${settings.VITE_SUPABASE_URL}. It's reached over Tailscale: this computer needs to be on the team's tailnet, and that Mac awake`
} else {
  const supabase = has('supabase --version') ? 'supabase' : 'npx --yes supabase'
  run(`${supabase} start`)
  run(`${supabase} migration up`)
  const status = JSON.parse(run(`${supabase} status -o json`, true))
  settings = { VITE_SUPABASE_URL: status.API_URL, VITE_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY || status.ANON_KEY }
  where = `local Supabase. Emails (sign-in codes, resets) land in ${status.MAILPIT_URL || status.INBUCKET_URL}; the database is at ${status.STUDIO_URL}`
}

// Anything else already in .env.local stays.
const kept = existsSync('.env.local')
  ? readFileSync('.env.local', 'utf8').split('\n').filter((line) => line.trim() && !Object.keys(settings).some((key) => line.startsWith(`${key}=`)))
  : ['# Local-only config (gitignored via *.local). Written by npm run setup.']
writeFileSync('.env.local', [...kept, ...Object.entries(settings).map(([key, value]) => `${key}=${value}`)].join('\n') + '\n')

console.log(`
Ready, on ${where}.
Now: npm run dev, and open http://127.0.0.1:5173

Demo accounts, password "neighbour": maya@aroundhere.demo (friends, messages
and a request waiting), tom@, priya@, lucas@, hannah@, ben@aroundhere.demo.`)
