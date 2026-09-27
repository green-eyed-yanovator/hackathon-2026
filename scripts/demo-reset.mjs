// Puts the demo neighbourhood back before showing it (supabase/demo-reset.sql):
// friends on the map, Maya's unread messages and waiting request, the snaps
// with most of their day left, the picnic on now. Only the demo accounts are
// touched, on whichever backend npm run setup chose.
//
//   npm run demo:reset

import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const env = existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : ''
const setting = (key) => new RegExp(`^${key}=(.*)$`, 'm').exec(env)?.[1]?.trim()
const backend = setting('AROUNDHERE_BACKEND') ?? (setting('VITE_SUPABASE_URL')?.includes(':54321') ? 'supabase' : 'offline')
const reset = readFileSync('supabase/demo-reset.sql')

if (backend === 'supabase') {
  const project = /^project_id = "(.*)"/m.exec(readFileSync('supabase/config.toml', 'utf8'))[1]
  execSync(`docker exec -i supabase_db_${project} psql -U postgres -v ON_ERROR_STOP=1 -q`, { input: reset, stdio: ['pipe', 'inherit', 'inherit'] })
} else {
  const { holder, keys, openBackend } = await import('../server/offline.mjs')
  // A server with the database open does it (only one process may have it).
  // Otherwise, straight in.
  const held = holder(process.cwd())
  if (held) {
    if (!held.url) throw new Error(`The offline database is open in another process (pid ${held.pid}). Try again once it's serving, or stop it.`)
    const running = await fetch(`${held.url}/_demo/reset`, { method: 'POST', headers: { Authorization: `Bearer ${keys(process.cwd()).service}` } })
    const answer = await running.json().catch(() => null)
    if (!answer?.ok) throw new Error(`The server at ${held.url} said ${running.status}: ${answer?.message ?? '?'}`)
  } else {
    const db = await openBackend(process.cwd(), () => {})
    try {
      await db.sql(reset.toString())
    } finally {
      await db.close()
    }
  }
}
console.log('The demo neighbourhood is back: friends on the map, Maya\'s unread things, fresh snaps and the picnic on now.')
