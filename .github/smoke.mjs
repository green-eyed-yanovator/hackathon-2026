// Does the app run on a clean machine, after npm ci, npm run setup and npm run
// dev? A person's first ten minutes, in a real browser: the demo loads, the
// map draws from its own copy, signing in, a pin with a photo going up and
// arriving live in another browser, a sign-in code from the mailbox. Chrome,
// driven over its debugging protocol with nothing but Node; run by
// .github/workflows/anywhere.yml on Windows, Linux and macOS.

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const APP = process.env.APP ?? 'http://127.0.0.1:5173/'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}

// The dev server, once it answers.
for (let t = 0; ; t++) {
  const up = await fetch(APP).then((r) => r.ok, () => false)
  if (up) break
  if (t > 240) {
    console.log('FAIL the dev server never answered')
    process.exit(1)
  }
  await sleep(500)
}

const chrome = [
  process.env.CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => p && existsSync(p))
const port = 9333
const browser = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'smoke-'))}`, '--no-first-run', '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' })
for (let t = 0; t < 60 && !(await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.ok, () => false)); t++) await sleep(250)

// A page to drive: navigate, run code in it, see what it threw.
async function page() {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  let id = 0
  const waiting = new Map()
  const errors = []
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && waiting.has(msg.id)) {
      waiting.get(msg.id)(msg)
      waiting.delete(msg.id)
    }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text)
  })
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  await send('Runtime.enable')
  await send('Page.enable')
  return {
    errors,
    async go(url, wait) {
      await send('Page.navigate', { url })
      await sleep(wait)
    },
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text)
      return r.result?.result?.value
    },
    async shot(file) {
      const r = await send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(file, Buffer.from(r.result.data, 'base64'))
    },
  }
}

const inApp = (p, code) => p.eval(`(async () => { const mod = await import('/src/data.ts'); ${code} })()`)
const feed = (p) => p.eval(`document.querySelector('.feed')?.textContent.match(/(\\d+) pins?/)?.[1] ?? '0'`)

try {
  const a = await page()
  await a.go(APP, 8000)
  const pins = Number(await feed(a))
  check('the demo neighbourhood loads', pins > 10, `${pins} pins`)
  check('with no errors on the page', a.errors.length === 0, a.errors.slice(0, 2).join(' / '))

  const tile = await a.eval(`fetch('/tiles/14/14502/9835.pbf').then((r) => r.status + ' ' + r.headers.get('content-type'))`)
  check("the map's tiles come from its own copy", tile.startsWith('200 application/x-protobuf'), tile)

  const signedIn = await inApp(a, `const r = await mod.supabase.auth.signInWithPassword({ email: 'maya@aroundhere.demo', password: 'neighbour' }); return r.error?.message ?? 'ok'`)
  await a.go(APP, 6000)
  check('signing in as Maya', signedIn === 'ok' && (await a.eval(`!!document.querySelector('.me-btn')`)), signedIn)
  const unread = await a.eval(`document.querySelector('.icon-btn.bar .badge')?.textContent ?? ''`)
  check('her own things load (unread in the inbox)', Number(unread) > 0, unread)

  const b = await page()
  await b.go(APP, 3000)
  await inApp(b, `await mod.supabase.auth.signInWithPassword({ email: 'tom@aroundhere.demo', password: 'neighbour' })`)
  await b.go(APP, 5000)
  const made = await inApp(b, `
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64
    const g = canvas.getContext('2d'); g.fillStyle = '#f5b50a'; g.fillRect(0, 0, 64, 64)
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg'))
    const p = await mod.createPost({ title: 'Smoke test pin', description: 'From a clean machine', flair: 'general', startsAt: null, latitude: -34.925, longitude: 138.60, blocks: [], files: [new File([blob], 'photo.jpg', { type: 'image/jpeg' })] })
    return p ? p.id : mod.takeError()`)
  check('Tom posts a pin with a photo', /^[0-9a-f-]{36}$/.test(made), made)
  let live = false
  for (let t = 0; t < 40 && !live; t++) {
    live = await a.eval(`document.querySelector('.feed')?.textContent.includes('Smoke test pin') ?? false`)
    await sleep(250)
  }
  check('it turns up on Maya\'s map and feed, live', live)
  const photo = await inApp(b, `const m = mod.S.media.find((x) => x.post_id === '${made}'); if (!m) return 'none'; const r = await fetch(m.url); return r.status + ' ' + r.headers.get('content-type')`)
  check('its photo is served', photo.startsWith('200 image/jpeg'), photo)

  await inApp(a, `await mod.supabase.auth.signOut()`)
  const sent = await inApp(a, `const r = await mod.supabase.auth.signInWithOtp({ email: 'hannah@aroundhere.demo', options: { shouldCreateUser: false } }); return r.error?.message ?? 'sent'`)
  const mail = await (await fetch(`${APP}_mail.json`)).json()
  const code = /\d{6}/.exec(mail[0]?.body ?? '')?.[0]
  const coded = code ? await inApp(a, `const r = await mod.supabase.auth.verifyOtp({ email: 'hannah@aroundhere.demo', token: '${code}', type: 'email' }); return r.data.user?.email ?? r.error?.message`) : 'no code'
  check('a sign-in code from the mailbox page works', sent === 'sent' && coded === 'hannah@aroundhere.demo', coded)

  await a.go(APP, 5000)
  await a.shot('smoke.png')
  check('no errors anywhere along the way', a.errors.length + b.errors.length === 0, [...a.errors, ...b.errors].slice(0, 3).join(' / '))
} catch (error) {
  check('the run finished', false, error.message)
} finally {
  browser.kill()
}
console.log(failures ? `${failures} failed` : 'all passed')
process.exit(failures ? 1 : 0)
