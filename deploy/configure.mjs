// Run on the Droplet after copying the app and the pinned Supabase stack.
// Secrets stay on the server; the frontend receives only its publishable key.
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, chmodSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const [stack, app, domain] = process.argv.slice(2)
if (!stack || !app || !domain || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(domain)) {
  throw new Error('Usage: node deploy/configure.mjs <stack directory> <app directory> <domain>')
}
const url = `https://${domain}`
const envFile = path.join(stack, '.env')
let env = readFileSync(envFile, 'utf8')
const get = (key) => new RegExp(`^${key}=(.*)$`, 'm').exec(env)?.[1]?.trim().replace(/^"|"$/g, '')
function set(key, value) {
  const line = `${key}=${value}`
  const pattern = new RegExp(`^${key}=.*$`, 'm')
  env = pattern.test(env) ? env.replace(pattern, () => line) : `${env}\n${line}\n`
}
const smtp = !!get('SMTP_HOST') && get('SMTP_HOST') !== 'supabase-mail'
for (const [key, value] of Object.entries({
  COMPOSE_FILE: 'docker-compose.yml:aroundhere.override.yml',
  SUPABASE_PUBLIC_URL: url,
  API_EXTERNAL_URL: `${url}/auth/v1`,
  SITE_URL: url,
  ADDITIONAL_REDIRECT_URLS: url,
  POOLER_TENANT_ID: 'aroundhere',
  STUDIO_DEFAULT_ORGANIZATION: 'AroundHere',
  STUDIO_DEFAULT_PROJECT: 'Demo',
  OPENAI_API_KEY: '',
  PGRST_DB_SCHEMAS: 'public',
  ENABLE_PHONE_SIGNUP: 'false',
  ENABLE_PHONE_AUTOCONFIRM: 'false',
  ENABLE_ANONYMOUS_USERS: 'false',
  FUNCTIONS_VERIFY_JWT: 'true',
  // For this short demo, account creation works without a mail service.
  ENABLE_EMAIL_AUTOCONFIRM: smtp ? 'false' : 'true',
})) set(key, value)
if (get('DASHBOARD_PASSWORD')?.includes('insecure')) set('DASHBOARD_PASSWORD', randomBytes(24).toString('hex'))
writeFileSync(envFile, env, { mode: 0o600 })
chmodSync(envFile, 0o600)
copyFileSync(path.join(app, 'deploy/compose.override.yml'), path.join(stack, 'aroundhere.override.yml'))

const emailBlock = smtp ? '' : `
  @email path /auth/v1/otp /auth/v1/recover /auth/v1/resend
  handle @email {
    header Content-Type application/json
    respond \`{"code":"email_disabled","msg":"Email delivery is not enabled for this demo. Please sign in with your password."}\` 503
  }
`
writeFileSync('/etc/caddy/Caddyfile', `${domain} {
  encode zstd gzip
  header {
    X-Content-Type-Options nosniff
    Referrer-Policy strict-origin-when-cross-origin
    -Server
  }
  @private path /_mail* /_demo* /pg* /api/* /.env* /.git* /server/* /deploy/* /supabase/*
  handle @private {
    respond "Not found" 404
  }
${emailBlock}
  @backend path /auth/v1/* /rest/v1/* /storage/v1/* /realtime/v1/*
  handle @backend {
    reverse_proxy 127.0.0.1:8000
  }
  @templates path /email-templates/*
  handle @templates {
    root * /var/www/aroundhere
    file_server
  }
  @assets path /assets/* /tiles/*
  handle @assets {
    root * /var/www/aroundhere
    file_server
  }
  handle {
    root * /var/www/aroundhere
    header Cache-Control no-cache
    try_files {path} /index.html
    file_server
  }
}
`)
chmodSync('/etc/caddy/Caddyfile', 0o644)

const compose = (args, input) => execFileSync('docker', ['compose', ...args], {
  cwd: stack, input, encoding: 'utf8', stdio: input === undefined ? ['ignore', 'pipe', 'inherit'] : ['pipe', 'pipe', 'inherit'],
})
const sql = (input) => compose(['exec', '-T', 'db', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], input)
// The full official stack has populated auth and storage before application SQL.
compose(['config', '--quiet'])
execFileSync('docker', ['compose', 'up', '-d', '--wait', '--wait-timeout', '300'], { cwd: stack, stdio: 'inherit' })
sql(`create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key);
grant usage on schema public to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;`)
const applied = new Set(sql('select version from supabase_migrations.schema_migrations;').trim().split('\n'))
for (const file of readdirSync(path.join(app, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()) {
  const version = file.split('_')[0]
  if (!/^\d+$/.test(version)) throw new Error(`Invalid migration filename: ${file}`)
  if (applied.has(version)) continue
  sql(`begin;\n${readFileSync(path.join(app, 'supabase/migrations', file), 'utf8')}\ninsert into supabase_migrations.schema_migrations (version) values ('${version}');\ncommit;`)
  console.log(`Applied ${file}`)
}
sql(readFileSync(path.join(app, 'supabase/seed.sql'), 'utf8'))
sql(readFileSync(path.join(app, 'supabase/demo-reset.sql'), 'utf8'))
sql("notify pgrst, 'reload schema';")

// Upload through Storage's API so the files and database metadata agree.
const service = get('SERVICE_ROLE_KEY')
for (const file of readdirSync(path.join(app, 'supabase/demo')).filter((f) => f.endsWith('.jpg'))) {
  const response = await fetch(`http://127.0.0.1:8000/storage/v1/object/post-media/demo/${file}`, {
    method: 'POST', headers: { Authorization: `Bearer ${service}`, apikey: service, 'x-upsert': 'true', 'Content-Type': 'image/jpeg' },
    body: readFileSync(path.join(app, 'supabase/demo', file)), signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`Demo photo upload failed: ${file}, HTTP ${response.status}`)
}
// Explicit build settings override any developer configuration. No server keys
// are written into the source tree or shipped in the browser bundle.
execFileSync('npm', ['ci'], { cwd: app, stdio: 'inherit' })
execFileSync('npm', ['run', 'build'], { cwd: app, stdio: 'inherit', env: {
  ...process.env, AROUNDHERE_BACKEND: 'supabase', VITE_SUPABASE_URL: url,
  VITE_SUPABASE_PUBLISHABLE_KEY: get('SUPABASE_PUBLISHABLE_KEY') || get('ANON_KEY'),
  VITE_TILES_URL: '/tiles/{z}/{x}/{y}.pbf',
} })
execFileSync('rsync', ['-a', '--delete', `${app}/dist/`, '/var/www/aroundhere/'])
mkdirSync('/var/www/aroundhere/email-templates', { recursive: true })
for (const file of ['login_code.html', 'reset_code.html']) copyFileSync(path.join(app, 'supabase/templates', file), `/var/www/aroundhere/email-templates/${file}`)
execFileSync('chmod', ['-R', 'a+rX', '/var/www/aroundhere'])
execFileSync('caddy', ['validate', '--config', '/etc/caddy/Caddyfile'], { stdio: 'inherit' })
execFileSync('systemctl', ['enable', '--now', 'caddy'], { stdio: 'inherit' })
execFileSync('systemctl', ['reload', 'caddy'], { stdio: 'inherit' })
console.log(`AroundHere: ${url}\nEmail codes: ${smtp ? 'SMTP configured; verify delivery' : 'disabled until SMTP is configured'}`)
