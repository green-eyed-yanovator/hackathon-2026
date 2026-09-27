// A clean teammate setup: no Docker, no external network, real migrations,
// Supabase client, HTTP, storage and realtime. Never touches the working DB.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { openBackend } from '../server/offline.mjs'

const source = fileURLToPath(new URL('../', import.meta.url))
const realFetch = globalThis.fetch
let externalRequests = 0
globalThis.fetch = (input, init) => {
  const host = new URL(input instanceof Request ? input.url : input).hostname
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) {
    externalRequests++
    throw new Error(`External request forbidden: ${host}`)
  }
  return realFetch(input, init)
}

function ok(result) {
  assert.equal(result.error, null, result.error?.message)
  return result.data
}

function deadline(promise) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Realtime did not arrive within 5 seconds')), 5000)
    promise.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

test('clean offline setup, accounts, data, files, realtime and restart', { timeout: 45000 }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'aroundhere-offline-test-'))
  let backend, server
  const clients = []
  try {
    for (const file of ['server', 'supabase/migrations', 'supabase/seed.sql', 'public/tiles', 'scripts/setup.mjs']) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
      cpSync(path.join(source, file), path.join(root, file), { recursive: true })
    }
    if (existsSync(path.join(source, 'supabase/demo'))) cpSync(path.join(source, 'supabase/demo'), path.join(root, 'supabase/demo'), { recursive: true })
    symlinkSync(path.join(source, 'node_modules'), path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
    // Fail if default setup even probes Docker, runs npx, or tries downloading.
    const guard = path.join(root, 'no-network.mjs')
    writeFileSync(guard, `
      import childProcess from 'node:child_process'
      import { syncBuiltinESMExports } from 'node:module'
      childProcess.execSync = () => { process.stderr.write('External commands forbidden in offline setup\\n'); process.exit(99) }
      syncBuiltinESMExports()
      globalThis.fetch = () => { process.stderr.write('Network forbidden in offline setup\\n'); process.exit(99) }
    `)
    writeFileSync(path.join(root, '.env.local'), '# Keep custom settings\nCUSTOM_SETTING=preserved\n')
    const setup = () => execFileSync(process.execPath, ['--import', guard, path.join(root, 'scripts/setup.mjs')], { cwd: root, encoding: 'utf8' })
    assert.match(setup(), /Ready/)
    const env = readFileSync(path.join(root, '.env.local'), 'utf8')
    assert.match(env, /AROUNDHERE_BACKEND=offline/)
    assert.match(env, /CUSTOM_SETTING=preserved/)
    assert.match(setup(), /Ready/)
    assert.equal(readFileSync(path.join(root, '.env.local'), 'utf8'), env)

    backend = await openBackend(root, () => {})
    assert.equal((await backend.sql('select count(*)::int as n from supabase_migrations.schema_migrations')).rows[0].n, 26)
    server = createServer((req, res) => void backend.handle(req, res))
    server.on('upgrade', (req, socket) => backend.upgrade(req, socket))
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    const client = () => {
      const c = createClient(origin, backend.keys.anon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
      clients.push(c)
      return c
    }
    const anon = client(), maya = client(), tom = client()
    assert.ok(ok(await anon.from('posts').select('*')).length >= 25)
    assert.equal(ok(await anon.from('profiles').select('*')).length, 6)
    assert.equal(ok(await maya.auth.signInWithPassword({ email: 'maya@aroundhere.demo', password: 'neighbour' })).user.id, 'd0000000-0000-4000-8000-000000000001')
    ok(await tom.auth.signInWithPassword({ email: 'tom@aroundhere.demo', password: 'neighbour' }))
    assert.ok(ok(await maya.from('messages').select('*')).length)
    const privateMessages = await anon.from('messages').select('*')
    assert.ok(privateMessages.error || privateMessages.data.length === 0)
    for (const media of ok(await anon.from('post_media').select('url')).filter((m) => m.url.includes('/post-media/demo/'))) {
      const pathname = new URL(media.url).pathname
      const response = await fetch(origin + pathname)
      assert.equal(response.status, 200, pathname)
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), readFileSync(path.join(root, 'supabase/demo', path.basename(pathname))))
    }

    // Every tile in the shared bundle must be intact and served without fetches.
    const manifest = JSON.parse(readFileSync(path.join(root, 'public/tiles/manifest.json'), 'utf8'))
    assert.ok(Object.keys(manifest.tiles).length >= 79)
    for (const [tile, hash] of Object.entries(manifest.tiles)) {
      const response = await fetch(`${origin}/tiles/${tile}`)
      assert.equal(response.status, 200, tile)
      assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'), hash, tile)
    }
    assert.equal((await fetch(`${origin}/tiles/14/0/0.pbf`)).status, 404)

    const joined = Promise.withResolvers(), changed = Promise.withResolvers()
    tom.channel('offline-test').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => changed.resolve(payload)).subscribe((status) => {
      if (status === 'SUBSCRIBED') joined.resolve()
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') joined.reject(new Error(status))
    })
    await deadline(joined.promise)
    const message = ok(await maya.from('messages').insert({ recipient_id: 'd0000000-0000-4000-8000-000000000002', body: 'Offline hello' }).select().single())
    assert.equal((await deadline(changed.promise)).new.id, message.id)

    const signup = client()
    const registered = ok(await signup.auth.signUp({ email: 'offline-test@example.test', password: 'localpassword', options: { data: { display_name: 'Offline Tester' } } }))
    const place = ok(await signup.from('places').insert({ latitude: -34.922, longitude: 138.602 }).select().single())
    const post = ok(await signup.from('posts').insert({ place_id: place.id, title: 'Offline pin', description: 'Saved on this computer', latitude: place.latitude, longitude: place.longitude, flair: 'general' }).select().single())
    assert.equal(post.author_id, registered.user.id)
    assert.equal(post.author_name, 'Offline Tester')
    const reply = ok(await signup.from('replies').insert({ post_id: post.id, content: 'Offline reply' }).select().single())
    assert.equal(reply.content, 'Offline reply')
    ok(await signup.from('posts').update({ title: 'Updated offline pin' }).eq('id', post.id))
    ok(await signup.rpc('check_in_day', { today: new Date().toISOString().slice(0, 10) }))
    const photoPath = `${post.id}/offline.png`
    const photo = readFileSync(path.join(source, 'public/icon-192.png'))
    ok(await signup.storage.from('post-media').upload(photoPath, photo, { contentType: 'image/png' }))
    const stored = await fetch(signup.storage.from('post-media').getPublicUrl(photoPath).data.publicUrl)
    assert.equal(stored.status, 200)
    assert.deepEqual(Buffer.from(await stored.arrayBuffer()), photo)

    ok(await signup.auth.signOut())
    ok(await signup.auth.signInWithPassword({ email: 'offline-test@example.test', password: 'localpassword' }))
    ok(await signup.auth.refreshSession())
    ok(await signup.auth.resetPasswordForEmail('offline-test@example.test'))
    const mail = await (await fetch(`${origin}/_mail.json`)).json()
    const token = /\b\d{6}\b/.exec(mail[0].body)[0]
    ok(await signup.auth.verifyOtp({ email: 'offline-test@example.test', token, type: 'recovery' }))
    ok(await signup.auth.updateUser({ password: 'changedpassword' }))
    assert.ok((await client().auth.signInWithPassword({ email: 'offline-test@example.test', password: 'localpassword' })).error)
    ok(await client().auth.signInWithPassword({ email: 'offline-test@example.test', password: 'changedpassword' }))

    await Promise.all(clients.map((c) => c.removeAllChannels()))
    await backend.close()
    backend = await openBackend(root, () => {})
    assert.equal((await backend.sql('select title from public.posts where id = $1', [post.id])).rows[0].title, 'Updated offline pin')
    assert.equal((await backend.sql('select count(*)::int as n from auth.users')).rows[0].n, 7)
    assert.equal(externalRequests, 0)
  } catch (error) {
    console.error(error.stack)
    throw error
  } finally {
    await Promise.all(clients.map((c) => c.removeAllChannels()))
    if (server) {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
    if (backend) await backend.close()
    rmSync(root, { recursive: true, force: true })
  }
})
