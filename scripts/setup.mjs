// From a fresh clone to a running backend of your own, in one command:
//
//   npm install && npm run setup && npm run dev
//
// With Docker running: local Supabase (the Supabase CLI comes through npx if it
// isn't installed). The first start builds the database from the migrations
// and loads the demo neighbourhood; later runs apply whatever migrations are new.
//
// Without Docker (or with `npm run setup -- --cloud`): a free Supabase project
// of your own, in your Supabase account. The first run logs you in (a browser
// window), makes the project, builds its database with the demo, and turns off
// email confirmation so sign-up just works. Later runs apply new migrations.
// Which project, and its database password, are kept in .env.local.
//
// Either way it never wipes anything, and .env.local ends up with what the app needs.

import { execSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { userInfo } from 'node:os'

const run = (command, quiet = false) => execSync(command, { stdio: quiet ? 'pipe' : 'inherit', encoding: 'utf8' })
const json = (command) => JSON.parse(run(command, true))

function works(command) {
  try {
    run(command, true)
    return true
  } catch {
    return false
  }
}

// What's in .env.local now, and a way to write it keeping everything else.
const env = existsSync('.env.local')
  ? Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').map((line) => /^([A-Z_]+)=(.*)$/.exec(line.trim())).filter(Boolean).map((m) => [m[1], m[2]]))
  : {}

function save(settings) {
  const kept = existsSync('.env.local')
    ? readFileSync('.env.local', 'utf8').split('\n').filter((line) => line.trim() && !Object.keys(settings).some((key) => line.startsWith(`${key}=`)))
    : ['# Local-only config (gitignored via *.local). Written by npm run setup.']
  writeFileSync('.env.local', [...kept, ...Object.entries(settings).map(([key, value]) => `${key}=${value}`)].join('\n') + '\n')
}

const supabase = works('supabase --version') ? 'supabase' : 'npx --yes supabase'
const cloud = process.argv.includes('--cloud') || !works('docker info')
let where

if (!cloud) {
  run(`${supabase} start`)
  run(`${supabase} migration up`)
  const status = JSON.parse(run(`${supabase} status -o json`, true))
  save({ VITE_SUPABASE_URL: status.API_URL, VITE_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY || status.ANON_KEY })
  where = `local Supabase. Emails (sign-in codes, resets) land in ${status.MAILPIT_URL || status.INBUCKET_URL}; the database is at ${status.STUDIO_URL}`
} else {
  if (!process.argv.includes('--cloud')) console.log('No Docker running: setting up a free Supabase project of your own instead.\n')
  if (!works(`${supabase} projects list -o json`)) {
    console.log('First, log in to Supabase (a browser window opens; make a free account if you need one).')
    try {
      run(`${supabase} login`)
    } catch {
      console.error(`\nCouldn't log in from here. Run \`${supabase} login\` in a terminal yourself, then npm run setup again.`)
      process.exit(1)
    }
  }

  // The project: the one set up last time, or a new one.
  let ref = env.SUPABASE_PROJECT_REF
  let password = env.SUPABASE_DB_PASSWORD
  if (!ref || !password) {
    const org = process.env.SUPABASE_ORG_ID || json(`${supabase} orgs list -o json`)[0]?.id
    if (!org) {
      console.error('Your Supabase account has no organisation yet: make one at https://supabase.com/dashboard, then run this again.')
      process.exit(1)
    }
    const name = `aroundhere-${userInfo().username}`.toLowerCase().replace(/[^a-z0-9-]/g, '-')
    const region = process.env.SUPABASE_REGION || 'ap-southeast-2' // Sydney, nearest Adelaide
    password = randomBytes(18).toString('base64url')
    console.log(`Making ${name} in ${region}…`)
    try {
      ref = json(`${supabase} projects create ${name} --org-id ${org} --db-password ${password} --region ${region} -o json`).id
    } catch (e) {
      console.error(`\nCouldn't make the project: ${String(e.stderr || e.message).trim()}`)
      console.error('A free account has room for two active projects. Pause one in the dashboard, or use a project you already have:')
      console.error('put SUPABASE_PROJECT_REF=<its ref> and SUPABASE_DB_PASSWORD=<its database password> in .env.local and run this again.')
      process.exit(1)
    }
    save({ SUPABASE_PROJECT_REF: ref, SUPABASE_DB_PASSWORD: password })
  }

  // A new project takes a minute or two to come up.
  process.stdout.write('Waiting for it to be ready')
  for (let tries = 0; ; tries++) {
    const project = json(`${supabase} projects list -o json`).find((p) => p.id === ref || p.ref === ref)
    if (project?.status === 'ACTIVE_HEALTHY') break
    if (tries > 60) {
      console.error(`\nIt's still ${project?.status ?? 'missing'} after five minutes; run this again in a bit.`)
      process.exit(1)
    }
    process.stdout.write('.')
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000) // five seconds, on any system
  }
  console.log(' ready.')

  run(`${supabase} link --project-ref ${ref} -p ${password}`)
  run(`${supabase} db push --linked --include-seed -p ${password} --yes`)
  // Sign-in settings from supabase/config.toml: no email confirmation, the code emails.
  if (!works(`${supabase} config push --project-ref ${ref} --yes`)) {
    console.log('(Couldn’t apply the sign-in settings; new sign-ups may need to confirm their email. The demo accounts work either way.)')
  }
  const keys = json(`${supabase} projects api-keys --project-ref ${ref} -o json`)
  const key = keys.find((k) => k.type === 'publishable')?.api_key || keys.find((k) => k.name === 'anon')?.api_key
  save({ VITE_SUPABASE_URL: `https://${ref}.supabase.co`, VITE_SUPABASE_PUBLISHABLE_KEY: key })
  where = `your own Supabase project, ${ref} (https://supabase.com/dashboard/project/${ref}). Its database password is in .env.local`
}

console.log(`
Ready, on ${where}.
Now: npm run dev, and open http://127.0.0.1:5173

Demo accounts, password "neighbour": maya@aroundhere.demo (friends, messages
and a request waiting), tom@, priya@, lucas@, hannah@, ben@aroundhere.demo.`)
