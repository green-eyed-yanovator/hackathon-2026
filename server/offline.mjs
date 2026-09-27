// The backend with no Docker and no internet: what the app asks of Supabase,
// answered from here. The database is real Postgres, compiled to WebAssembly
// (PGlite), so supabase/migrations and supabase/seed.sql run as they are, with
// every rule, trigger and row policy in them. Around it, just the parts of
// Supabase's services the app uses, speaking the same protocols:
//
//   /rest/v1      tables and functions, as PostgREST does (filters, order, limit,
//                 one row or many, insert, upsert, update, delete, rpc)
//   /auth/v1      accounts and sessions, as GoTrue does (password, codes, tokens)
//   /storage/v1   uploads and public files, kept in a folder
//   /realtime/v1  live changes and broadcasts over a WebSocket, as Realtime does
//   /tiles        the map's tiles, from a folder filled while online
//   /_mail        the "emails" (sign-in codes, resets), since there's no post office
//
// Everything is kept in supabase/.local. It runs inside the dev server (see
// vite.config.ts), on the app's own address, when .env.local says
// AROUNDHERE_BACKEND=offline; npm run setup writes that when there's no Docker.

import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, createReadStream, statSync } from 'node:fs'
import path from 'node:path'

const TILEJSON = 'https://tiles.openfreemap.org/planet'

//
// Keys: tokens are signed with a secret kept next to the data, as Supabase's are
// with its JWT secret. The app's publishable key is the anonymous token.
//

const b64url = (data) => Buffer.from(data).toString('base64url')

function sign(claims, secret) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(claims))
  return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`
}

function verify(token, secret) {
  const [head, body, mac] = String(token).split('.')
  if (!head || !body || !mac) return null
  const want = createHmac('sha256', secret).update(`${head}.${body}`).digest()
  const got = Buffer.from(mac, 'base64url')
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString())
  if (claims.exp && claims.exp * 1000 < Date.now()) return 'expired'
  return claims
}

// The secret, and the two keys made from it. Made on first use.
export function keys(root) {
  const dir = path.join(root, 'supabase/.local')
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'secret')
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString('hex'))
  const secret = readFileSync(file, 'utf8').trim()
  const forever = { iss: 'aroundhere-offline', iat: 1700000000, exp: 4100000000 }
  return {
    secret,
    anon: sign({ ...forever, role: 'anon' }, secret),
    service: sign({ ...forever, role: 'service_role' }, secret),
  }
}

//
// The database.
//

export async function openBackend(root, log = console.log) {
  const local = path.join(root, 'supabase/.local')
  const { secret } = keys(root)
  const db = new PGlite({ dataDir: path.join(local, 'db'), extensions: { pgcrypto } })
  await db.waitReady

  // Built once from supabase/migrations and the seed; new migrations after a pull.
  const fresh = !(await db.query(`select to_regnamespace('supabase_migrations') is not null as ok`)).rows[0].ok
  if (fresh) {
    log('Building the database (the first time only)…')
    await db.exec(readFileSync(path.join(root, 'server/supabase.sql'), 'utf8'))
  }
  const applied = new Set((await db.query('select version from supabase_migrations.schema_migrations')).rows.map((r) => r.version))
  const migrations = readdirSync(path.join(root, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()
  for (const file of migrations) {
    const version = file.split('_')[0]
    if (applied.has(version)) continue
    await db.transaction(async (tx) => {
      await tx.exec(readFileSync(path.join(root, 'supabase/migrations', file), 'utf8'))
      await tx.query('insert into supabase_migrations.schema_migrations (version) values ($1)', [version])
    })
    if (!fresh) log(`Applied ${file}`)
  }
  if (fresh) {
    await db.exec(readFileSync(path.join(root, 'supabase/seed.sql'), 'utf8'))
    log(`Database ready: ${migrations.length} migrations and the demo neighbourhood.`)
  }

  // Every table the app listens to gets a trigger that notes its changes.
  const published = (await db.query(`select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime'`)).rows
  for (const { schemaname, tablename } of published) {
    await db.exec(`create or replace trigger realtime_capture after insert or update or delete on "${schemaname}"."${tablename}" for each row execute function realtime.capture()`)
  }
  // Each table's primary key: what a deletion says about the row that went.
  const keyColumns = new Map()
  for (const row of (await db.query(`
    select c.relname as table, array_agg(a.attname order by a.attnum) as cols
    from pg_index i join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum = any (i.indkey)
    where i.indisprimary and n.nspname = 'public' group by c.relname`)).rows) keyColumns.set(row.table, row.cols)

  // One request at a time, as whoever sent it: their role and their claims,
  // which is what auth.uid() and the row policies read.
  let queue = Promise.resolve()
  function as(claims, work) {
    const next = queue.then(() =>
      db.transaction(async (tx) => {
        const role = claims?.role === 'authenticated' || claims?.role === 'service_role' ? claims.role : 'anon'
        await tx.exec(`set local role ${role}`)
        await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims ?? { role: 'anon' })])
        return work(tx)
      }),
    )
    queue = next.then(sendChanges, sendChanges)
    return next
  }

  //
  // Live changes: after every request, whatever the triggers noted goes out
  // to the sockets listening for it, if the row is theirs to see.
  //

  const sockets = new Set()

  async function sendChanges() {
    const { rows } = await db.query('delete from realtime.changes returning * ')
    if (!rows.length) return
    rows.sort((a, b) => Number(a.id) - Number(b.id))
    for (const change of rows) {
      for (const socket of sockets) {
        for (const channel of socket.channels.values()) {
          const ids = channel.changes.filter((c) => matches(c, change)).map((c) => c.id)
          if (!ids.length) continue
          if (change.type !== 'DELETE' && !(await canSee(socket.claims, change))) continue
          const keys = keyColumns.get(change.table) ?? ['id']
          const old = change.old_record ? Object.fromEntries(keys.map((k) => [k, change.old_record[k]])) : {}
          socket.send([null, null, channel.topic, 'postgres_changes', {
            ids,
            data: {
              schema: change.schema, table: change.table, commit_timestamp: new Date(change.at).toISOString(), type: change.type,
              columns: [], record: change.record ?? {}, old_record: change.type === 'INSERT' ? {} : old, errors: null,
            },
          }])
        }
      }
    }
  }

  function matches(wanted, change) {
    if (wanted.schema !== change.schema || (wanted.table && wanted.table !== '*' && wanted.table !== change.table)) return false
    if (wanted.event !== '*' && wanted.event !== change.type) return false
    if (!wanted.filter) return true
    const [, column, op, value] = /^([a-z_]+)=([a-z]+)\.(.*)$/.exec(wanted.filter) ?? []
    const row = change.record ?? change.old_record ?? {}
    const cell = row[column] === null || row[column] === undefined ? null : String(row[column])
    if (op === 'eq') return cell === value
    if (op === 'neq') return cell !== value
    if (op === 'in') return value.replace(/^\(|\)$/g, '').split(',').includes(cell)
    return false
  }

  async function canSee(claims, change) {
    const keys = keyColumns.get(change.table) ?? ['id']
    const where = keys.map((k, i) => `"${k}"::text = $${i + 1}`).join(' and ')
    const values = keys.map((k) => String(change.record[k]))
    const role = claims?.role === 'authenticated' || claims?.role === 'service_role' ? claims.role : 'anon'
    try {
      return await db.transaction(async (tx) => {
        await tx.exec(`set local role ${role}`)
        await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims ?? { role: 'anon' })])
        const { rows } = await tx.query(`select 1 from "${change.schema}"."${change.table}" where ${where}`, values)
        return rows.length > 0
      })
    } catch {
      return false
    }
  }

  // Private channels: allowed the way Supabase does it, by the row policies on
  // realtime.messages, tried on a row that's put in and taken straight out.
  async function allowed(claims, topic, write) {
    try {
      let ok = false
      await db.transaction(async (tx) => {
        const { rows } = await tx.query(`insert into realtime.messages (topic, extension, event, private) values ($1, 'broadcast', 'check', true) returning id`, [topic])
        await tx.exec(`set local role ${claims?.role === 'authenticated' ? 'authenticated' : 'anon'}`)
        await tx.query(`select set_config('request.jwt.claims', $1, true), set_config('realtime.topic', $2, true)`, [JSON.stringify(claims ?? {}), topic])
        if (write) {
          await tx.query(`insert into realtime.messages (topic, extension, event, private) values ($1, 'broadcast', 'check', true)`, [topic])
          ok = true
        } else ok = (await tx.query('select 1 from realtime.messages where id = $1', [rows[0].id])).rows.length > 0
        await tx.rollback()
      })
      return ok
    } catch {
      return false
    }
  }

  //
  // Who's asking: the bearer token (a user's session, or the anonymous key).
  //

  function claimsOf(req) {
    const header = req.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : req.headers.apikey
    if (!token) return { role: 'anon' }
    return verify(token, secret)
  }

  //
  // HTTP.
  //

  async function handle(req, res, next) {
    const url = new URL(req.url, 'http://local')
    const route = url.pathname
    const known = ['/rest/v1', '/auth/v1', '/storage/v1', '/tiles/', '/_mail'].some((p) => route.startsWith(p))
    if (!known) return next ? next() : notFound(res)
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS')
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range')
    if (req.method === 'OPTIONS') return send(res, 204)
    try {
      if (route.startsWith('/tiles/')) return await tile(route, res)
      if (route.startsWith('/_mail')) return await mailbox(route, res)
      const claims = claimsOf(req)
      if (!claims) return send(res, 401, { code: 'PGRST301', message: 'JWT invalid', details: null, hint: null })
      if (claims === 'expired') return send(res, 401, { code: 'PGRST303', message: 'JWT expired', details: null, hint: null })
      const body = await readBody(req)
      if (route.startsWith('/rest/v1/')) return await rest(req, res, url, claims, body)
      if (route.startsWith('/auth/v1/')) return await auth(req, res, url, claims, body)
      if (route.startsWith('/storage/v1/')) return await storage(req, res, url, claims, body)
    } catch (error) {
      log(`offline backend: ${req.method} ${route}: ${error.stack ?? error}`)
      if (!res.headersSent) send(res, 500, { message: error.message })
    }
  }

  //
  // PostgREST's part: /rest/v1/<table> and /rest/v1/rpc/<function>.
  //

  const ident = (name) => {
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw Object.assign(new Error(`Not a name: ${name}`), { status: 400 })
    return `"${name}"`
  }

  function filters(url, params) {
    const where = []
    for (const [key, raw] of url.searchParams) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(key)) continue
      let value = raw
      let not = false
      if (value.startsWith('not.')) {
        not = true
        value = value.slice(4)
      }
      const dot = value.indexOf('.')
      const op = value.slice(0, dot)
      const arg = value.slice(dot + 1)
      const col = ident(key)
      let sql
      if (op === 'is') sql = `${col} is ${{ null: 'null', true: 'true', false: 'false' }[arg] ?? 'null'}`
      else if (op === 'in') {
        params.push(arg.replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/^"|"$/g, '')))
        sql = `${col}::text = any($${params.length}::text[])`
      } else {
        const sqlOp = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'like', ilike: 'ilike' }[op]
        if (!sqlOp) throw Object.assign(new Error(`Unknown filter ${op}`), { status: 400 })
        params.push(op.endsWith('like') ? arg.replaceAll('*', '%') : arg)
        sql = `${col} ${sqlOp} $${params.length}`
      }
      where.push(not ? `not (${sql})` : sql)
    }
    return where.length ? `where ${where.join(' and ')}` : ''
  }

  function columnsOf(url) {
    const select = url.searchParams.get('select') ?? '*'
    return select === '*' ? '*' : select.split(',').map((c) => ident(c.trim())).join(', ')
  }

  function ordering(url) {
    const order = url.searchParams.get('order')
    if (!order) return ''
    return 'order by ' + order.split(',').map((part) => {
      const [col, dir, nulls] = part.split('.')
      return `${ident(col)} ${dir === 'desc' ? 'desc' : 'asc'}${nulls === 'nullsfirst' ? ' nulls first' : nulls === 'nullslast' ? ' nulls last' : ''}`
    }).join(', ')
  }

  async function rest(req, res, url, claims, body) {
    const one = (req.headers.accept ?? '').includes('vnd.pgrst.object')
    const prefer = req.headers.prefer ?? ''
    const wantRows = prefer.includes('return=representation')
    const [, , , name, fn] = url.pathname.split('/') // '', rest, v1, <table> | rpc, <function>

    const reply = (rows, status = 200) => {
      if (one) {
        if (rows.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows`, hint: null })
        return send(res, status, rows[0])
      }
      return send(res, status, rows)
    }

    try {
      if (name === 'rpc') {
        const { rows: args } = await db.query(`
          select p.proretset as many, t.typtype as kind, t.typname as returns,
            coalesce((select array_agg(format('%s => $%s::%s', n, i, format_type(ty, null)) order by i)
              from unnest(p.proargnames, p.proargtypes::oid[]) with ordinality as a (n, ty, i)), '{}') as args,
            coalesce(p.proargnames, '{}') as names
          from pg_proc p join pg_namespace s on s.oid = p.pronamespace join pg_type t on t.oid = p.prorettype
          where s.nspname = 'public' and p.proname = $1`, [fn])
        if (!args.length) return send(res, 404, { code: 'PGRST202', message: `Could not find the function public.${fn}`, details: null, hint: null })
        const info = args[0]
        const input = body ? JSON.parse(body) : {}
        const values = info.names.map((n) => (input[n] !== null && typeof input[n] === 'object' ? JSON.stringify(input[n]) : input[n] ?? null))
        const call = `public.${ident(fn)}(${info.args.join(', ')})`
        if (info.returns === 'void') {
          await as(claims, (tx) => tx.query(`select ${call}`, values))
          return send(res, 204)
        }
        const sql = info.many ? `select coalesce(json_agg(r), '[]'::json) as r from ${call} r` : `select to_json(${call}) as r`
        const result = await as(claims, (tx) => tx.query(sql, values))
        const value = result.rows[0].r
        return send(res, 200, one && Array.isArray(value) ? value[0] ?? null : value)
      }

      const table = `public.${ident(name)}`
      const params = []
      if (req.method === 'GET' || req.method === 'HEAD') {
        const limit = url.searchParams.has('limit') ? `limit ${Number(url.searchParams.get('limit'))}` : ''
        const offset = url.searchParams.has('offset') ? `offset ${Number(url.searchParams.get('offset'))}` : ''
        const sql = `select coalesce(json_agg(t), '[]'::json) as rows from (select ${columnsOf(url)} from ${table} ${filters(url, params)} ${ordering(url)} ${limit} ${offset}) t`
        return reply((await as(claims, (tx) => tx.query(sql, params))).rows[0].rows)
      }

      const returning = wantRows || one ? `returning ${columnsOf(url)}` : ''
      // With rows wanted back, the statement's RETURNING is gathered into JSON; without, it just runs.
      const wrap = (statement) => (returning ? `with r as (${statement} ${returning}) select coalesce(json_agg(r), '[]'::json) as rows from r` : statement)
      if (req.method === 'POST') {
        const input = JSON.parse(body || '[]')
        const rows = Array.isArray(input) ? input : [input]
        const cols = url.searchParams.get('columns')?.split(',') ?? [...new Set(rows.flatMap((r) => Object.keys(r)))]
        const list = cols.map(ident).join(', ')
        params.push(JSON.stringify(rows))
        let conflict = ''
        if (prefer.includes('resolution=')) {
          const target = url.searchParams.get('on_conflict')?.split(',').map(ident).join(', ')
          const keys = target ?? (keyColumns.get(name) ?? ['id']).map(ident).join(', ')
          conflict = prefer.includes('ignore-duplicates')
            ? `on conflict (${keys}) do nothing`
            : `on conflict (${keys}) do update set ${cols.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(', ')}`
        }
        const sql = wrap(`insert into ${table} (${list}) select ${list} from json_populate_recordset(null::${table}, $1::json) ${conflict}`)
        const result = await as(claims, (tx) => tx.query(sql, params))
        return returning ? reply(result.rows[0].rows, 201) : send(res, 201)
      }
      if (req.method === 'PATCH') {
        const input = JSON.parse(body || '{}')
        const cols = Object.keys(input)
        params.push(JSON.stringify(input))
        // Each new value read from the patch, typed as the table's column is.
        const set = cols.map((c) => `${ident(c)} = (select ${ident(c)} from json_populate_record(null::${table}, $1::json))`).join(', ')
        const sql = wrap(`update ${table} set ${set} ${filters(url, params)}`)
        const result = await as(claims, (tx) => tx.query(sql, params))
        return returning ? reply(result.rows[0].rows) : send(res, 204)
      }
      if (req.method === 'DELETE') {
        const sql = wrap(`delete from ${table} ${filters(url, params)}`)
        const result = await as(claims, (tx) => tx.query(sql, params))
        return returning ? reply(result.rows[0].rows) : send(res, 204)
      }
      return send(res, 405, { message: 'Method not allowed' })
    } catch (error) {
      return send(res, error.status ?? statusOf(error.code), { code: error.code ?? 'PGRST000', message: error.message, details: error.detail ?? null, hint: error.hint ?? null })
    }
  }

  function statusOf(code) {
    if (!code) return 400
    if (code === '42501') return 403
    if (code === '23505') return 409
    if (code === '42P01' || code === '42883') return 404
    return 400
  }

  //
  // GoTrue's part: accounts and sessions.
  //

  const userJson = (u) => ({
    id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, phone: '',
    email_confirmed_at: u.email_confirmed_at, confirmed_at: u.email_confirmed_at, last_sign_in_at: u.last_sign_in_at,
    app_metadata: u.raw_app_meta_data ?? {}, user_metadata: u.raw_user_meta_data ?? {}, identities: [],
    created_at: u.created_at, updated_at: u.updated_at, is_anonymous: false,
  })

  async function session(user, method = 'password') {
    const now = Math.floor(Date.now() / 1000)
    const claims = {
      aud: 'authenticated', exp: now + 3600, iat: now, iss: 'aroundhere-offline', sub: user.id, email: user.email, phone: '',
      app_metadata: user.raw_app_meta_data ?? {}, user_metadata: user.raw_user_meta_data ?? {},
      role: 'authenticated', aal: 'aal1', amr: [{ method, timestamp: now }], session_id: randomUUID(), is_anonymous: false,
    }
    const refresh = randomBytes(24).toString('base64url')
    await db.query('insert into auth.refresh_tokens (token, user_id) values ($1, $2)', [refresh, user.id])
    await db.query('update auth.users set last_sign_in_at = now() where id = $1', [user.id])
    return { access_token: sign(claims, secret), token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: refresh, user: userJson(user) }
  }

  const authError = (res, status, code, msg) => send(res, status, { code: status, error_code: code, msg })
  const userBy = async (column, value) => (await db.query(`select * from auth.users where ${column} = $1`, [value])).rows[0]

  // Offline, "email" is a page: the mailbox at /_mail.
  async function mail(to, subject, body) {
    await db.query('insert into auth.mail (to_email, subject, body) values ($1, $2, $3)', [to, subject, body])
    log(`Mail to ${to}: ${subject} (see /_mail)`)
  }

  async function code(email, kind) {
    const value = String(Math.floor(100000 + Math.random() * 900000))
    await db.query('delete from auth.codes where email = $1 and kind = $2', [email, kind])
    await db.query('insert into auth.codes (email, code, kind) values ($1, $2, $3)', [email, value, kind])
    return value
  }

  async function newUser(email, password, data) {
    const hashed = password ? (await db.query(`select extensions.crypt($1, extensions.gen_salt('bf')) as h`, [password])).rows[0].h : null
    const user = (await db.query(
      `insert into auth.users (instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
       values ('00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $1, $2, now(), '{"provider": "email", "providers": ["email"]}', $3) returning *`,
      [email, hashed, JSON.stringify(data ?? {})],
    )).rows[0]
    await db.query(`insert into auth.identities (user_id, provider_id, provider, identity_data) values ($1::uuid, $1::text, 'email', $2)`, [user.id, JSON.stringify({ sub: user.id, email })])
    await sendChanges() // the new profile
    return user
  }

  async function auth(req, res, url, claims, body) {
    const route = url.pathname.slice('/auth/v1'.length)
    const input = body ? JSON.parse(body) : {}
    const email = input.email?.trim().toLowerCase()

    if (route === '/signup' && req.method === 'POST') {
      if (!email || !input.password) return authError(res, 400, 'validation_failed', 'Email and password are needed')
      if (input.password.length < 6) return authError(res, 422, 'weak_password', 'Password should be at least 6 characters.')
      if (await userBy('email', email)) return authError(res, 422, 'user_already_exists', 'User already registered')
      return send(res, 200, await session(await newUser(email, input.password, input.data)))
    }

    if (route === '/token' && req.method === 'POST') {
      const grant = url.searchParams.get('grant_type')
      if (grant === 'password') {
        const { rows } = await db.query(`select * from auth.users where email = $1 and encrypted_password = extensions.crypt($2, encrypted_password)`, [email, input.password ?? ''])
        if (!rows.length) return authError(res, 400, 'invalid_credentials', 'Invalid login credentials')
        return send(res, 200, await session(rows[0]))
      }
      if (grant === 'refresh_token') {
        const { rows } = await db.query('delete from auth.refresh_tokens where token = $1 returning user_id', [input.refresh_token ?? ''])
        const user = rows.length ? await userBy('id', rows[0].user_id) : null
        if (!user) return authError(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found')
        return send(res, 200, await session(user, 'token'))
      }
      return authError(res, 400, 'unsupported_grant_type', 'Unsupported grant type')
    }

    if (route === '/otp' && req.method === 'POST') {
      if (!email) return authError(res, 400, 'validation_failed', 'An email is needed')
      if (!(await userBy('email', email))) {
        if (input.create_user === false) return authError(res, 422, 'otp_disabled', 'Signups not allowed for otp')
        await newUser(email, null, input.data)
      }
      await mail(email, 'Your sign-in code', `Your code for AroundHere is ${await code(email, 'email')}.`)
      return send(res, 200, {})
    }

    if (route === '/recover' && req.method === 'POST') {
      if (email && (await userBy('email', email))) await mail(email, 'Reset your password', `Your code to set a new password is ${await code(email, 'recovery')}.`)
      return send(res, 200, {})
    }

    if (route === '/verify' && req.method === 'POST') {
      const kinds = input.type === 'recovery' ? ['recovery'] : ['email', 'recovery']
      const { rows } = await db.query(`delete from auth.codes where email = $1 and code = $2 and kind = any($3) and created_at > now() - interval '1 hour' returning kind`, [email, String(input.token ?? '').trim(), kinds])
      const user = rows.length ? await userBy('email', email) : null
      if (!user) return authError(res, 403, 'otp_expired', 'Token has expired or is invalid')
      return send(res, 200, await session(user, 'otp'))
    }

    if (route === '/user') {
      if (claims?.role !== 'authenticated') return authError(res, 401, 'no_authorization', 'This endpoint requires a valid Bearer token')
      if (req.method === 'PUT') {
        if (input.password) {
          if (input.password.length < 6) return authError(res, 422, 'weak_password', 'Password should be at least 6 characters.')
          await db.query(`update auth.users set encrypted_password = extensions.crypt($1, extensions.gen_salt('bf')), updated_at = now() where id = $2`, [input.password, claims.sub])
        }
        if (email) {
          if (await userBy('email', email)) return authError(res, 422, 'email_exists', 'A user with this email address has already been registered')
          await db.query('update auth.users set email = $1, updated_at = now() where id = $2', [email, claims.sub])
          await mail(email, 'Your email changed', 'This is now the email for your AroundHere account.')
        }
        if (input.data) await db.query(`update auth.users set raw_user_meta_data = raw_user_meta_data || $1::jsonb, updated_at = now() where id = $2`, [JSON.stringify(input.data), claims.sub])
        await sendChanges()
      }
      const user = await userBy('id', claims.sub)
      if (!user) return authError(res, 404, 'user_not_found', 'User not found')
      return send(res, 200, userJson(user))
    }

    if (route === '/logout') {
      if (claims?.sub) await db.query('delete from auth.refresh_tokens where user_id = $1', [claims.sub])
      return send(res, 204)
    }

    if (route === '/settings') return send(res, 200, { external: { email: true }, disable_signup: false, mailer_autoconfirm: true })

    if (route === '/authorize') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      return send(res, 200, `<p style="font: 16px system-ui; margin: 20vh auto; max-width: 30em">Signing in with ${url.searchParams.get('provider') ?? 'another account'} needs the internet; offline, use an email and password. <a href="/">Back</a></p>`)
    }

    return authError(res, 404, 'not_found', 'Not found')
  }

  //
  // Storage's part: files in supabase/.local/storage/<bucket>/<path>, their rows
  // in storage.objects, where the row policies decide who may put what where.
  //

  const files = path.join(local, 'storage')

  async function storage(req, res, url, claims, body) {
    const parts = url.pathname.slice('/storage/v1/object/'.length).split('/').map(decodeURIComponent)
    const safe = (p) => {
      if (p.split('/').some((s) => s === '..' || s === '')) throw Object.assign(new Error('Bad path'), { status: 400 })
      return p
    }

    if (req.method === 'GET' && parts[0] === 'public') {
      const [, bucket, ...rest] = parts
      const name = safe(rest.join('/'))
      const { rows } = await db.query(`select o.metadata from storage.objects o join storage.buckets b on b.id = o.bucket_id where b.public and o.bucket_id = $1 and o.name = $2`, [bucket, name])
      const file = path.join(files, bucket, name)
      if (!rows.length || !existsSync(file)) return send(res, 404, { statusCode: '404', error: 'not_found', message: 'Object not found' })
      return serveFile(req, res, file, rows[0].metadata?.mimetype ?? 'application/octet-stream')
    }

    if (req.method === 'POST' && parts[0] === 'list') {
      const bucket = parts[1]
      const input = JSON.parse(body || '{}')
      const prefix = (input.prefix ?? '').replace(/\/$/, '')
      const { rows } = await as(claims, (tx) => tx.query(
        `select name, id, created_at, updated_at, metadata from storage.objects where bucket_id = $1 and name like $2 order by name limit $3 offset $4`,
        [bucket, prefix ? `${prefix}/%` : '%', input.limit ?? 100, input.offset ?? 0],
      ))
      return send(res, 200, rows.filter((r) => !r.name.slice(prefix ? prefix.length + 1 : 0).includes('/')).map((r) => ({ ...r, name: r.name.slice(prefix ? prefix.length + 1 : 0) })))
    }

    if (req.method === 'DELETE') {
      const bucket = parts[0]
      const names = JSON.parse(body || '{}').prefixes ?? []
      const { rows } = await as(claims, (tx) => tx.query('delete from storage.objects where bucket_id = $1 and name = any($2) returning name, bucket_id', [bucket, names]))
      for (const row of rows) rmSync(path.join(files, bucket, safe(row.name)), { force: true })
      return send(res, 200, rows)
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      const [bucket, ...rest] = parts
      const name = safe(rest.join('/'))
      const upload = parseUpload(req, body)
      const { rows: buckets } = await db.query('select * from storage.buckets where id = $1', [bucket])
      const b = buckets[0]
      if (!b) return send(res, 404, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' })
      if (b.file_size_limit && upload.data.length > Number(b.file_size_limit)) return send(res, 413, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' })
      if (b.allowed_mime_types?.length && !b.allowed_mime_types.some((m) => m === upload.type || (m.endsWith('/*') && upload.type.startsWith(m.slice(0, -1))))) {
        return send(res, 415, { statusCode: '415', error: 'invalid_mime_type', message: `mime type ${upload.type} is not supported` })
      }
      const upsert = req.headers['x-upsert'] === 'true'
      try {
        const { rows } = await as(claims, (tx) => tx.query(
          `insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, auth.uid(), $3)
           ${upsert ? 'on conflict (bucket_id, name) do update set metadata = excluded.metadata, updated_at = now()' : ''} returning id`,
          [bucket, name, JSON.stringify({ mimetype: upload.type, size: upload.data.length })],
        ))
        mkdirSync(path.dirname(path.join(files, bucket, name)), { recursive: true })
        writeFileSync(path.join(files, bucket, name), upload.data)
        return send(res, 200, { Key: `${bucket}/${name}`, Id: rows[0].id })
      } catch (error) {
        if (error.code === '23505') return send(res, 409, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' })
        return send(res, 403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' })
      }
    }
    return send(res, 404, { message: 'Not found' })
  }

  // An upload: the file itself, or the form storage-js sends a Blob in.
  function parseUpload(req, body) {
    const type = req.headers['content-type'] ?? 'application/octet-stream'
    const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(type)
    if (!type.startsWith('multipart/form-data') || !boundary) return { type, data: body }
    const mark = Buffer.from(`--${boundary[1] ?? boundary[2]}`)
    let at = body.indexOf(mark)
    while (at >= 0) {
      const next = body.indexOf(mark, at + mark.length)
      if (next < 0) break
      const part = body.subarray(at + mark.length + 2, next - 2) // past the CRLF, before the next boundary's CRLF
      const split = part.indexOf('\r\n\r\n')
      const head = part.subarray(0, split).toString()
      if (/filename=|name=""/.test(head) || /content-type:/i.test(head)) {
        const partType = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1] ?? 'application/octet-stream'
        return { type: partType, data: part.subarray(split + 4) }
      }
      at = next
    }
    return { type, data: body }
  }

  //
  // The map's tiles: from supabase/.local/tiles, fetched and kept while online.
  //

  async function tile(route, res) {
    const [, , z, x, file] = route.split('/')
    const y = file?.replace(/\.pbf$/, '')
    if (![z, x, y].every((n) => /^\d+$/.test(n ?? ''))) return notFound(res)
    const data = await cachedTile(root, +z, +x, +y)
    if (!data) {
      res.setHeader('Cache-Control', 'no-store')
      return notFound(res)
    }
    res.setHeader('Content-Type', 'application/x-protobuf')
    res.setHeader('Cache-Control', 'public, max-age=86400')
    res.writeHead(200)
    res.end(data)
  }

  //
  // The mailbox: every "email" the backend would have sent, newest first.
  //

  async function mailbox(route, res) {
    const { rows } = await db.query('select * from auth.mail order by id desc limit 50')
    if (route === '/_mail.json') return send(res, 200, rows)
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    send(res, 200, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Mailbox</title>
<meta http-equiv="refresh" content="5">
<body style="font: 15px/1.5 system-ui; max-width: 40em; margin: 2em auto; padding: 0 1em; color: #222">
<h1>Mailbox</h1><p style="color: #777">What AroundHere would have emailed, offline. It checks for more every few seconds.</p>
${rows.map((m) => `<div style="border-top: 1px solid #ddd; padding: 12px 0"><b>${esc(m.subject)}</b> <span style="color: #777">to ${esc(m.to_email)}, ${new Date(m.sent_at).toLocaleTimeString()}</span><div style="font-size: 20px">${esc(m.body)}</div></div>`).join('') || '<p>Nothing yet.</p>'}`)
  }

  //
  // Realtime's part: a WebSocket per page, channels on it (Phoenix's protocol,
  // version 2: JSON arrays, and a small binary form for broadcasts sent).
  //

  function upgrade(req, socket) {
    const url = new URL(req.url, 'http://local')
    if (url.pathname !== '/realtime/v1/websocket') return false
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    const key = verify(url.searchParams.get('apikey') ?? '', secret)
    const client = {
      claims: key && key !== 'expired' ? key : { role: 'anon' },
      channels: new Map(), // topic → { topic, changes, self, private }
      send: (message) => !socket.destroyed && socket.write(frame(Buffer.from(JSON.stringify(message)), 1)),
    }
    sockets.add(client)
    let buffer = Buffer.alloc(0)
    let pieces = []
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      for (;;) {
        const got = unframe(buffer)
        if (!got) break
        buffer = buffer.subarray(got.length)
        if (got.opcode === 8) return socket.end(frame(Buffer.alloc(0), 8))
        if (got.opcode === 9) {
          socket.write(frame(got.data, 10))
          continue
        }
        if (got.opcode === 10) continue
        pieces.push(got)
        if (!got.fin) continue
        const opcode = pieces[0].opcode
        const data = Buffer.concat(pieces.map((p) => p.data))
        pieces = []
        received(client, opcode, data).catch((error) => log('offline realtime:', error.message))
      }
    })
    const gone = () => sockets.delete(client)
    socket.on('close', gone)
    socket.on('error', gone)
    return true
  }

  async function received(client, opcode, data) {
    let joinRef, ref, topic, event, payload
    if (opcode === 2) {
      // A broadcast sent in binary: kind 3, then the lengths, then the parts.
      const kind = data[0]
      if (kind !== 3) return
      const [joinLen, refLen, topicLen, eventLen, metaLen, encoding] = [data[1], data[2], data[3], data[4], data[5], data[6]]
      let at = 7
      const take = (n) => data.subarray(at, (at += n)).toString()
      joinRef = take(joinLen)
      ref = take(refLen)
      topic = take(topicLen)
      const userEvent = take(eventLen)
      take(metaLen)
      const rest = data.subarray(at)
      event = 'broadcast'
      payload = { type: 'broadcast', event: userEvent, payload: encoding === 1 ? JSON.parse(rest.toString() || '{}') : {} }
    } else {
      ;[joinRef, ref, topic, event, payload] = JSON.parse(data.toString())
    }
    const reply = (status, response = {}) => client.send([joinRef, ref, topic, 'phx_reply', { status, response }])

    if (topic === 'phoenix' && event === 'heartbeat') return reply('ok')
    if (event === 'access_token') {
      const claims = verify(payload.access_token, secret)
      if (claims && claims !== 'expired') client.claims = claims
      return
    }
    if (event === 'phx_join') {
      if (payload.access_token) {
        const claims = verify(payload.access_token, secret)
        if (claims && claims !== 'expired') client.claims = claims
      }
      const config = payload.config ?? {}
      const name = topic.replace(/^realtime:/, '')
      if (config.private && !(await allowed(client.claims, name, false))) return reply('error', { reason: 'Unauthorized: You do not have permissions to read from this Channel topic' })
      const changes = (config.postgres_changes ?? []).map((c, i) => ({ id: i + 1, event: c.event, schema: c.schema, table: c.table, filter: c.filter }))
      client.channels.set(topic, { topic, name, changes, self: !!config.broadcast?.self, private: !!config.private })
      reply('ok', { postgres_changes: changes.map((c) => ({ id: c.id, event: c.event, schema: c.schema, table: c.table, filter: c.filter })) })
      if (changes.length) client.send([null, null, topic, 'system', { message: 'Subscribed to PostgreSQL', status: 'ok', extension: 'postgres_changes', channel: name }])
      return
    }
    if (event === 'phx_leave') {
      client.channels.delete(topic)
      return reply('ok')
    }
    if (event === 'broadcast') {
      const channel = client.channels.get(topic)
      if (!channel) return
      if (channel.private && !(await allowed(client.claims, channel.name, true))) return
      for (const other of sockets) {
        if (other === client && !channel.self) continue
        if (other.channels.has(topic)) other.send([null, null, topic, 'broadcast', { type: 'broadcast', event: payload.event, payload: payload.payload }])
      }
      if (ref) reply('ok')
    }
  }

  return {
    handle,
    upgrade,
    keys: keys(root),
    async sql(query, params) {
      // For scripts and tests: straight to the database, as its owner.
      const result = await (queue = queue.then(() => db.query(query, params)))
      await sendChanges()
      return result
    },
    async close() {
      for (const client of sockets) client.channels.clear()
      await queue
      await db.close()
    },
  }
}

//
// Little pieces.
//

function send(res, status, body) {
  if (res.headersSent) return
  if (body === undefined) {
    res.writeHead(status)
    return res.end()
  }
  if (typeof body === 'string') {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.writeHead(status)
    return res.end(body)
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.writeHead(status)
  res.end(JSON.stringify(body))
}

const notFound = (res) => send(res, 404, { message: 'Not found' })

function readBody(req) {
  return new Promise((done, fail) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const data = Buffer.concat(chunks)
      const type = req.headers['content-type'] ?? ''
      done(type.includes('json') || type.startsWith('text/') ? data.toString() : data.length ? data : '')
    })
    req.on('error', fail)
  })
}

// Files with ranges, so a video can be scrubbed through.
function serveFile(req, res, file, type) {
  const size = statSync(file).size
  res.setHeader('Content-Type', type)
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Cache-Control', 'public, max-age=3600')
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '')
  if (range) {
    const start = range[1] ? +range[1] : 0
    const end = range[2] ? Math.min(+range[2], size - 1) : size - 1
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
    res.setHeader('Content-Length', end - start + 1)
    res.writeHead(206)
    return createReadStream(file, { start, end }).pipe(res)
  }
  res.setHeader('Content-Length', size)
  res.writeHead(200)
  createReadStream(file).pipe(res)
}

// WebSocket frames: the server's go out whole and unmasked; the page's come in masked.
function frame(data, opcode) {
  const head = data.length < 126 ? Buffer.from([0x80 | opcode, data.length]) : data.length < 65536 ? Buffer.alloc(4) : Buffer.alloc(10)
  if (data.length >= 126) {
    head[0] = 0x80 | opcode
    if (data.length < 65536) {
      head[1] = 126
      head.writeUInt16BE(data.length, 2)
    } else {
      head[1] = 127
      head.writeBigUInt64BE(BigInt(data.length), 2)
    }
  }
  return Buffer.concat([head, data])
}

function unframe(buffer) {
  if (buffer.length < 2) return null
  const fin = (buffer[0] & 0x80) !== 0
  const opcode = buffer[0] & 0x0f
  const masked = (buffer[1] & 0x80) !== 0
  let length = buffer[1] & 0x7f
  let at = 2
  if (length === 126) {
    if (buffer.length < 4) return null
    length = buffer.readUInt16BE(2)
    at = 4
  } else if (length === 127) {
    if (buffer.length < 10) return null
    length = Number(buffer.readBigUInt64BE(2))
    at = 10
  }
  const mask = masked ? buffer.subarray(at, at + 4) : null
  if (masked) at += 4
  if (buffer.length < at + length) return null
  const data = Buffer.from(buffer.subarray(at, at + length))
  if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3]
  return { fin, opcode, data, length: at + length }
}

//
// Tiles, cached: the map's own source (OpenFreeMap), kept on disk as it's used,
// so the neighbourhood's map is there without the internet.
//

let tileTemplate = null

async function upstream() {
  if (tileTemplate) return tileTemplate
  const json = await (await fetch(TILEJSON, { signal: AbortSignal.timeout(8000) })).json()
  return (tileTemplate = json.tiles[0])
}

export async function cachedTile(root, z, x, y) {
  const file = path.join(root, 'supabase/.local/tiles', String(z), String(x), `${y}.pbf`)
  if (existsSync(file)) return readFileSync(file)
  try {
    const url = (await upstream()).replace('{z}', z).replace('{x}', x).replace('{y}', y)
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) return null
    const data = Buffer.from(await response.arrayBuffer())
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, data)
    return data
  } catch {
    return null // offline, and not kept: that bit of the map stays blank
  }
}

// Fetch and keep every tile over an area, for being offline later: the source
// zooms the map draws from (up to 14) over a box of [west, south, east, north].
export async function keepTiles(root, [west, south, east, north], maxZoom = 14, progress = () => {}) {
  const lonToX = (lon, n) => Math.floor(((lon + 180) / 360) * n)
  const latToY = (lat, n) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n)
  const jobs = []
  for (let z = 0; z <= maxZoom; z++) {
    const n = 2 ** z
    for (let x = lonToX(west, n); x <= lonToX(east, n); x++) for (let y = latToY(north, n); y <= latToY(south, n); y++) jobs.push([z, x, y])
  }
  let done = 0
  let kept = 0
  const worker = async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      if (await cachedTile(root, ...job)) kept++
      progress(++done)
    }
  }
  const total = jobs.length
  await Promise.all(Array.from({ length: 6 }, worker))
  return { total, kept }
}
