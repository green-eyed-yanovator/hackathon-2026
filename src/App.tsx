// The whole interface. One store (data.ts), one map (map.ts), and the panels
// around it. UI state lives in the UI object below; anything that changes it
// calls changed(), and React redraws from scratch.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import {
  // The store and its helpers.
  S, useStore, changed, start, stats, takeError, time, distance, placeKey, flairs,
  supabase, supabaseUrl, supabaseKey,
  // People.
  nameOf, friendIds, friendshipWith, isOnline, locationOf, saveProfile, uploadAvatar,
  requestFriend, acceptFriend, removeFriend, block, unblock,
  // Pins.
  createPost, updatePost, deletePost, loadRevisions, reply, deleteReply, toggleLike, toggleInterest, toggleSave, report,
  // Messages and notifications.
  conversations, readable, unreadMessages, visibleNotifications, describeNotification, typingChannel,
  sendMessage, markConversationRead, markNotificationsRead, loadOlderNotifications, setMutedKinds, setIncomingHandler,
  // Where I am.
  watchHere, setSharing, enableCompass, checkOut,
  // Accounts.
  changeEmail, deleteAccount,
  type Flair, type Post, type Revision, type Notification,
} from './data'
import {
  createMap, destroyMap, setMarkers, setRadar, setTheme, flyTo, zoomBy, glideBy, requestFrame,
  project, center, lngToX, latToY, nearestStreet, findPlaces,
  icons, mapThemes, LEGEND, poiColor, RADAR_WIDE,
  MARK_MINE, MARK_SAVED, MARK_NEW, MARK_RESOLVED, MARK_SELECTED, MARK_STALE, MARK_ONLINE, MARK_LIVE,
  type IconName, type MapState, type Marker,
} from './map'
import './App.css'

//
// UI state.
//

type AuthMode = 'signin' | 'signup' | 'code' | 'reset' | 'new-password'
type Tab = 'around' | 'latest' | 'soon' | 'friends' | 'mine' | 'past'

const THEMES = [
  { id: 'auto', name: 'Sun', note: 'Day while the sun is up here, Night after' },
  { id: 'day', name: 'Day', note: 'Clean and bright' },
  { id: 'night', name: 'Night', note: 'Easy on the eyes' },
  { id: 'coast', name: 'Palm Coast', note: '2004 radar, chunky square blips' },
  { id: 'metro', name: 'Metro', note: 'Pause-menu atlas of a modern sprawl' },
  { id: 'frontier', name: 'Frontier', note: 'Hand-inked survey map on parchment' },
  { id: 'radar', name: 'Phosphor', note: 'Green CRT tracking screen' },
  { id: 'neon', name: 'Neon Bay', note: 'Eighties beachfront nights, pink and cyan' },
]

function readRoute() {
  const [kind = '', id = ''] = window.location.hash.replace(/^#\/?/, '').split('/')
  return { kind, id: decodeURIComponent(id) }
}

function stored(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private mode: it just won't be remembered.
  }
}

const narrow = () => window.matchMedia('(max-width: 760px)').matches

function initialTheme() {
  const saved = stored('aroundhere.theme')
  if (saved && (mapThemes[saved] || saved === 'auto')) return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'day'
}

function initialView() {
  try {
    const view = JSON.parse(stored('aroundhere.view') ?? '')
    if (typeof view.lat === 'number') return view as { lat: number; lng: number; zoom: number }
  } catch {
    // First visit.
  }
  return { lat: -34.9235, lng: 138.6007, zoom: 15.2 }
}

const UI = {
  route: readRoute(),
  theme: initialTheme(),
  toast: '',
  auth: null as AuthMode | null,
  palette: false,
  hover: null as string | null, // marker id under the mouse or under a hovered list row
  tab: 'around' as Tab,
  flair: null as Flair | null,
  feed: !narrow(),
  view: initialView(),
  draft: null as { latitude: number; longitude: number } | null,
  alerts: stored('aroundhere.alerts') === 'on',
  sounds: stored('aroundhere.sounds') !== 'off',
  started: stored('aroundhere.started') === 'hidden', // the getting-started list was dismissed
  banner: null as { title: string; sub: string } | null,
  follow: false, // the camera keeps you in the middle until you move the map
  sheetFull: false, // phones: the open sheet is pulled up to full height
  legend: false,
}

// When this device last had the app open, for "new since your last visit".
// Read once at start; saved as the page goes away.
const lastVisit = Number(stored('aroundhere.lastVisit') ?? 0)
window.addEventListener('pagehide', () => store('aroundhere.lastVisit', String(Date.now())))
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') store('aroundhere.lastVisit', String(Date.now()))
})

let map: MapState | null = null
let toastTimer = 0

// The one way components change UI state.
function ui(patch: Partial<typeof UI>) {
  Object.assign(UI, patch)
  changed()
}

// The phone's status bar takes the map's colour.
function paintChrome(id: string) {
  document.documentElement.dataset.theme = id
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mapThemes[id].land)
}

// How high the sun is over a place, in degrees, from the usual low-precision
// solar formulas (good to a fraction of a degree, plenty for dusk).
function sunAltitude(time: number, lat: number, lng: number) {
  const r = Math.PI / 180
  const d = time / 86400000 - 10957.5 // days since noon, 1 January 2000
  const g = (357.529 + 0.98560028 * d) * r // the sun's mean anomaly
  const q = 280.459 + 0.98564736 * d // its mean longitude, degrees
  const l = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * r // ecliptic longitude
  const e = (23.439 - 0.00000036 * d) * r // tilt of the earth
  const ra = Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l))
  const dec = Math.asin(Math.sin(e) * Math.sin(l))
  const sidereal = ((18.697374558 + 24.06570982441908 * d) % 24) * 15 * r
  const hourAngle = sidereal + lng * r - ra
  return Math.asin(Math.sin(lat * r) * Math.sin(dec) + Math.cos(lat * r) * Math.cos(dec) * Math.cos(hourAngle)) / r
}

// The style actually on screen: the choice, unless it's "Sun", which is Day
// until the sun is a few degrees under the horizon wherever you are (or are looking).
function shown() {
  if (UI.theme !== 'auto') return UI.theme
  const lat = S.here?.latitude ?? UI.view.lat
  const lng = S.here?.longitude ?? UI.view.lng
  return sunAltitude(Date.now(), lat, lng) > -4 ? 'day' : 'night'
}

paintChrome(shown())

window.addEventListener('popstate', () => {
  UI.route = readRoute()
  changed()
})

function go(path: string) {
  const hash = path ? `#${path}` : ''
  if (window.location.hash !== hash) window.history.pushState(null, '', hash || window.location.pathname + window.location.search)
  UI.route = readRoute()
  UI.hover = null
  UI.sheetFull = false
  if (UI.route.kind !== 'new') UI.draft = null
  else if (!UI.draft) UI.draft = viewCenter()
  changed()
}

function viewCenter() {
  const c = map ? center(map) : UI.view
  return { latitude: c.lat, longitude: c.lng }
}

function toast(message: string) {
  UI.toast = message
  changed()
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    UI.toast = ''
    changed()
  }, 2800)
}

//
// Sounds, synthesized on the spot: every style has its own short sting for big
// moments, and a tick for messages. No audio files.
//

let audio: AudioContext | null = null

function note(at: number, freq: number, length: number, type: OscillatorType, volume: number, out: AudioNode) {
  const a = audio!
  const osc = a.createOscillator()
  const gain = a.createGain()
  osc.type = type
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0, at)
  gain.gain.linearRampToValueAtTime(volume, at + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length)
  osc.connect(gain).connect(out)
  osc.start(at)
  osc.stop(at + length + 0.05)
}

// A plucked string (Karplus-Strong): a burst of noise fed round a short delay
// that averages itself, so it rings at the delay's pitch and dies away.
function pluck(at: number, freq: number, volume: number, out: AudioNode) {
  const a = audio!
  const length = Math.floor(a.sampleRate * 1.2)
  const buffer = a.createBuffer(1, length, a.sampleRate)
  const data = buffer.getChannelData(0)
  const period = Math.round(a.sampleRate / freq)
  for (let i = 0; i < period; i++) data[i] = Math.random() * 2 - 1
  for (let i = period; i < length; i++) data[i] = 0.498 * (data[i - period] + data[i - period + 1])
  const source = a.createBufferSource()
  const gain = a.createGain()
  source.buffer = buffer
  gain.gain.value = volume
  source.connect(gain).connect(out)
  source.start(at)
}

const hz = (semitonesFromA4: number) => 440 * 2 ** (semitonesFromA4 / 12)

function play(kind: 'sting' | 'tick') {
  if (!UI.sounds) return
  try {
    audio ??= new AudioContext()
    if (audio.state === 'suspended') audio.resume()
  } catch {
    return
  }
  const a = audio
  const t0 = a.currentTime + 0.02
  const out = a.createGain()
  out.gain.value = 0.5
  out.connect(a.destination)
  setTimeout(() => out.disconnect(), 3000) // every sound is over by then
  const style = shown()

  if (kind === 'tick') {
    const type: OscillatorType = style === 'coast' ? 'square' : style === 'neon' ? 'sawtooth' : 'sine'
    if (style === 'frontier') pluck(t0, hz(7), 0.5, out)
    else note(t0, style === 'radar' ? 1320 : hz(12), 0.12, type, style === 'coast' || style === 'neon' ? 0.08 : 0.2, out)
    return
  }

  switch (style) {
    case 'coast': // a quick 8-bit climb
      ;[0, 4, 7, 12, 16].forEach((n, i) => note(t0 + i * 0.07, hz(n + 3), 0.18, 'square', 0.09, out))
      break
    case 'metro': { // a slow, soft chord over a low thump
      note(t0, hz(-33), 0.5, 'sine', 0.5, out)
      ;[-9, -2, 3, 7].forEach((n, i) => note(t0 + 0.05 + i * 0.03, hz(n), 1.4, 'sine', 0.12, out))
      break
    }
    case 'frontier': // a plucked arpeggio, like a guitar on a porch
      ;[-14, -10, -7, -2, 2].forEach((n, i) => pluck(t0 + i * 0.11, hz(n), 0.45, out))
      break
    case 'radar': // two clean beeps
      note(t0, 1200, 0.09, 'sine', 0.25, out)
      note(t0 + 0.13, 1600, 0.14, 'sine', 0.25, out)
      break
    case 'neon': { // a sawtooth run through a closing filter
      const filter = a.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.setValueAtTime(4000, t0)
      filter.frequency.exponentialRampToValueAtTime(600, t0 + 0.8)
      filter.connect(out)
      ;[0, 7, 12, 15, 19].forEach((n, i) => note(t0 + i * 0.09, hz(n - 5), 0.3, 'sawtooth', 0.07, filter))
      break
    }
    default: // Day and Night: a gentle two-note chime
      note(t0, hz(7), 0.5, 'sine', 0.2, out)
      note(t0 + 0.12, hz(12), 0.7, 'sine', 0.2, out)
  }
}

// Big moments get a full-screen banner in the game styles, a toast elsewhere.
let bannerTimer = 0
function celebrate(title: string, sub: string) {
  play('sting')
  if (shown() === 'day' || shown() === 'night') {
    toast(sub)
    return
  }
  UI.banner = { title, sub }
  changed()
  window.clearTimeout(bannerTimer)
  bannerTimer = window.setTimeout(() => {
    UI.banner = null
    changed()
  }, 2600)
}

function failed(fallback: string) {
  toast(takeError() || fallback)
}

function applyTheme(id: string) {
  UI.theme = id
  paintChrome(shown())
  store('aroundhere.theme', id)
  if (map) setTheme(map, shown())
  changed()
}

function needAccount(mode: AuthMode = 'signup') {
  if (S.userId) return false
  UI.auth = mode
  changed()
  return true
}

//
// Actions for buttons: do the thing, then say how it went.
//

async function interest(postId: string) {
  if (needAccount()) return
  if (!(await toggleInterest(postId))) failed("Couldn't update")
}

async function saveToggle(postId: string, wasSaved: boolean) {
  if (await toggleSave(postId)) toast(wasSaved ? 'Removed from saved' : 'Saved')
  else failed("Couldn't save")
}

async function resolve(postId: string) {
  if (await updatePost(postId, { resolved_at: new Date().toISOString() })) celebrate('Resolved', 'Moved to Past, thanks for closing the loop')
  else failed("Couldn't resolve")
}

async function befriend(id: string) {
  if (await requestFriend(id)) toast('Friend request sent')
  else failed("Couldn't send")
}

async function accept(id: string) {
  if (await acceptFriend(id)) celebrate('New friend', `You and ${nameOf(id)} are friends`)
  else failed("Couldn't accept")
}

async function shareForAnHour() {
  if (await setSharing(true, 3600000)) toast('Friends can see you for the next hour')
  else failed("Couldn't share your location")
}

async function toggleSharing() {
  if (await setSharing(!S.sharing)) toast(S.sharing ? 'Friends can see you now' : 'Stopped sharing')
  else failed("Couldn't change sharing")
}

//
// Formatting.
//

function ago(when: string | number) {
  const seconds = (Date.now() - (typeof when === 'number' ? when : time(when))) / 1000
  if (seconds < 60) return 'now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`
  return new Date(when).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

// "right now", "5m ago", "3h ago", or "on 12 Sep".
function since(iso: string) {
  const text = ago(iso)
  if (text === 'now') return 'right now'
  return /\d[mhd]$/.test(text) ? `${text} ago` : `on ${text}`
}

function meters(m: number) {
  if (m < 50) return 'here'
  if (m < 1000) return `${Math.round(m / 10) * 10} m`
  if (m < 10000) return `${(m / 1000).toFixed(1)} km`
  return `${Math.round(m / 1000).toLocaleString()} km`
}

// "Today, 7:00 pm", "Tomorrow, 9:00 am", "Saturday, 9:00 am", or a date further out.
function whenText(iso: string) {
  const d = new Date(iso)
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000)
  const day =
    days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days === -1 ? 'Yesterday'
    : days > 1 && days < 7 ? d.toLocaleDateString(undefined, { weekday: 'long' })
    : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  return `${day}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
}

// The short version for lists: "now", "in 40m", "in 3h", then the day. Null once it's long over.
function soonText(iso: string) {
  const minutes = (time(iso) - Date.now()) / 60000
  if (minutes < -180) return null
  if (minutes < 0) return 'now'
  if (minutes < 60) return `in ${Math.max(1, Math.round(minutes))}m`
  if (minutes < 12 * 60) return `in ${Math.round(minutes / 60)}h`
  const d = new Date(iso)
  if (minutes < 6 * 24 * 60) return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${d.toLocaleTimeString(undefined, { hour: 'numeric' })}`
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

// datetime-local inputs speak local time without a zone; these convert both ways.
const toLocalInput = (iso: string) => {
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : null)

const minutesLeft = (until: number) => Math.max(1, Math.ceil((until - Date.now()) / 60000))

// How far something is from me, in metres; null if I don't know where I am.
function fromMe(at: { latitude: number; longitude: number } | null | undefined) {
  return at && S.here ? distance(S.here.latitude, S.here.longitude, at.latitude, at.longitude) : null
}

const awayText = (m: number) => (m < 50 ? 'right here' : `${meters(m)} away`)

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function hue(id: string) {
  let h = 0
  for (const ch of id) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0
  return h % 360
}

const firstName = (id: string) => nameOf(id).split(' ')[0]

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?'
}

function dayLabel(iso: string) {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(new Date()) - startOfDay(new Date(iso))) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return 'This week'
  return 'Earlier'
}

//
// Derived data.
//

// The feed and the map always show the same pins.
function visiblePosts() {
  const friends = new Set(friendIds())
  const { joined, active } = stats()
  // Pins nobody has touched in a month quietly leave the map; Past still has them.
  // An event still to come counts as recent however long ago it was pinned.
  const recent = (p: Post) => Math.max(active.get(p.id) ?? 0, p.starts_at ? time(p.starts_at) : 0) > Date.now() - 30 * 86400000

  return S.posts.filter((p) => {
    if (p.author_id && S.blocked.has(p.author_id)) return false
    if (UI.flair && p.flair !== UI.flair) return false
    switch (UI.tab) {
      case 'around':
      case 'latest':
        return !p.resolved_at && recent(p)
      case 'soon':
        // Happening now (started within 3 hours) or in the coming week.
        return !p.resolved_at && !!p.starts_at && time(p.starts_at) > Date.now() - 3 * 3600000 && time(p.starts_at) < Date.now() + 7 * 86400000
      case 'friends':
        return !!p.author_id && friends.has(p.author_id)
      case 'mine':
        return joined.has(p.id)
      case 'past':
        return !!p.resolved_at || !recent(p)
    }
  })
}

function sortedFeed(posts: Post[]) {
  const active = stats().active
  const withMeta = posts.map((post) => ({
    post,
    active: active.get(post.id) ?? 0,
    away: distance(UI.view.lat, UI.view.lng, post.latitude, post.longitude),
  }))
  if (UI.tab === 'around') withMeta.sort((a, b) => a.away - b.away)
  else if (UI.tab === 'soon') withMeta.sort((a, b) => time(a.post.starts_at!) - time(b.post.starts_at!))
  else withMeta.sort((a, b) => b.active - a.active)
  return withMeta
}

function buildMarkers(posts: Post[]): Marker[] {
  const markers: Marker[] = []
  const unread = stats().unread
  const saved = new Set(S.saved.map((s) => s.post_id))
  const route = UI.route

  // The open pin stays on the map even when the filter would hide it.
  const onMap = [...posts]
  if (route.kind === 'pin') {
    const open = S.posts.find((p) => p.id === route.id)
    if (open && !onMap.includes(open)) onMap.push(open)
  }

  const places = new Map<string, Post[]>()
  for (const post of onMap) {
    const key = placeKey(post)
    const list = places.get(key)
    if (list) list.push(post)
    else places.set(key, [post])
  }

  for (const [key, list] of places) {
    const newest = list[0] // posts are newest first
    const f = flairs[newest.flair] ?? flairs.general
    let flags = 0
    if (list.some((p) => p.author_id && p.author_id === S.userId)) flags |= MARK_MINE
    if (list.some((p) => saved.has(p.id))) flags |= MARK_SAVED
    if (list.some((p) => unread.has(p.id))) flags |= MARK_NEW
    if (list.every((p) => p.resolved_at)) flags |= MARK_RESOLVED
    if (list.some((p) => p.starts_at && !p.resolved_at && Math.abs(time(p.starts_at) - Date.now()) < 3 * 3600000)) flags |= MARK_LIVE
    if ((route.kind === 'pin' && list.some((p) => p.id === route.id)) || (route.kind === 'place' && route.id === key)) flags |= MARK_SELECTED
    markers.push({
      id: key, kind: 'pin', x: lngToX(newest.longitude), y: latToY(newest.latitude), icon: f.icon, color: f.color,
      count: list.length, flags, text: '', name: newest.title, accuracy: 0, heading: null, image: null,
    })
  }

  for (const userId of S.locations.keys()) {
    const loc = locationOf(userId)
    if (userId === S.userId || !loc) continue
    const name = nameOf(userId)
    const unreadFrom = S.messages.filter((m) => m.sender_id === userId && m.recipient_id === S.userId && !m.read_at).length
    markers.push({
      id: `person:${userId}`, kind: 'person', x: lngToX(loc.longitude), y: latToY(loc.latitude), icon: 'user',
      color: `hsl(${hue(userId)} 55% 45%)`, count: unreadFrom,
      flags: (Date.now() - time(loc.updated_at) > 30 * 60000 ? MARK_STALE : 0) | (isOnline(userId) ? MARK_ONLINE : 0),
      text: initials(name), name: name.split(' ')[0],
      accuracy: loc.accuracy ?? 0, heading: loc.heading, image: S.profiles.get(userId)?.avatar_url ?? null,
    })
  }

  if (S.here) {
    markers.push({
      id: 'me', kind: 'me', x: lngToX(S.here.longitude), y: latToY(S.here.latitude), icon: 'user', color: '', count: 0,
      flags: 0, text: '', name: 'You', accuracy: S.here.accuracy, heading: S.here.heading, image: null,
    })
  }

  if (UI.route.kind === 'new' && UI.draft) {
    markers.push({
      id: 'draft', kind: 'draft', x: lngToX(UI.draft.longitude), y: latToY(UI.draft.latitude), icon: 'pin', color: '',
      count: 0, flags: 0, text: '', name: '', accuracy: 0, heading: null, image: null,
    })
  }

  return markers
}

//
// Camera helpers: panels cover parts of the map, so "centre" means the middle of what's visible.
//

function openArea() {
  const w = window.innerWidth
  const h = window.innerHeight
  if (narrow()) {
    // Sheet heights match the phone layout in App.css.
    const kind = UI.route.kind
    const sheet = kind === 'pin' || kind === 'place' || kind === 'new' ? h * 0.58 : kind ? h * 0.86 : UI.feed ? h * 0.56 : 0
    return { left: 0, top: 64, right: w, bottom: h - 60 - sheet }
  }
  // Below 1180 px the feed steps aside while something is open (see App.css).
  const left = UI.feed && !(UI.route.kind && w < 1180) ? 392 : 0
  const right = UI.route.kind ? w - 436 : w
  return { left, top: 72, right, bottom: h }
}

// The game styles get a radar in the bottom-left corner of what's visible of the map.
function radarPlace() {
  if (shown() === 'day' || shown() === 'night' || !map) return null
  const h = map.height
  if (narrow()) {
    if (UI.route.kind || UI.feed) return null
    return { x: 12 + (shown() === 'metro' ? 58 * RADAR_WIDE : 58), y: h - 60 - 26 - 60, r: 58 }
  }
  const left = UI.feed && !(UI.route.kind && window.innerWidth < 1180) ? 392 : 0
  const half = shown() === 'metro' ? 76 * RADAR_WIDE : 76 // Metro's radar is a wide rectangle
  return { x: left + 16 + half, y: h - 26 - 80, r: 76 }
}

function reveal(lat: number, lng: number, zoom?: number, force = false) {
  if (!map) return
  const area = openArea()
  const p = project(map, lngToX(lng), latToY(lat))
  const inside = p.x > area.left + 40 && p.x < area.right - 40 && p.y > area.top + 60 && p.y < area.bottom - 30
  const z = zoom ?? map.zoom
  if (inside && !force && z === map.zoom) return
  flyTo(map, lng, lat, z, (area.left + area.right) / 2 - map.width / 2, (area.top + area.bottom) / 2 - map.height / 2)
}

function openPin(post: Post) {
  go(`pin/${post.id}`)
  reveal(post.latitude, post.longitude, Math.max(map?.zoom ?? 16, 16))
}

async function locate() {
  enableCompass()
  const here = S.here ?? (await watchHere())
  if (!here) {
    toast("Can't find you: location is blocked or unavailable")
    return
  }
  reveal(here.latitude, here.longitude, Math.max(map?.zoom ?? 16, 16.5), true)
  followed = here
  ui({ follow: true })
}

// Opened from a link: once the pins have loaded, bring that one into view.
let linkRevealed = false

function revealLinked() {
  if (linkRevealed || !S.ready || !map) return
  linkRevealed = true
  const route = UI.route
  const post = S.posts.find((p) => (route.kind === 'pin' && p.id === route.id) || (route.kind === 'place' && placeKey(p) === route.id))
  if (post) reveal(post.latitude, post.longitude, Math.max(map.zoom, 16), true)
}

// Following: when my position moves, the camera goes with it.
let followed: { latitude: number; longitude: number } | null = null

function keepFollowing() {
  const here = S.here
  if (!UI.follow || !here || !map || map.fly) return
  if (followed && distance(followed.latitude, followed.longitude, here.latitude, here.longitude) < 3) return
  followed = here
  reveal(here.latitude, here.longitude, map.zoom, true)
}

function startCompose() {
  if (needAccount()) return
  UI.draft = S.here ? { latitude: S.here.latitude, longitude: S.here.longitude } : viewCenter()
  go('new')
  // Get a real fix in the background; move the draft there if it arrives before the user moves it.
  const first = UI.draft
  watchHere().then((here) => {
    if (here && UI.draft === first && UI.route.kind === 'new') {
      UI.draft = { latitude: here.latitude, longitude: here.longitude }
      changed()
      reveal(here.latitude, here.longitude, Math.max(map?.zoom ?? 16, 16.5))
    }
  })
  reveal(UI.draft.latitude, UI.draft.longitude)
}

//
// Little building blocks.
//

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const d = icons[name]
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d={d[0] === '!' ? d.slice(1) : d} fillRule={d[0] === '!' ? 'evenodd' : 'nonzero'} />
    </svg>
  )
}

function Avatar({ id, size = 32, dot = false }: { id: string | null; size?: number; dot?: boolean }) {
  const name = nameOf(id)
  const photo = id ? S.profiles.get(id)?.avatar_url : null
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4, background: id ? `hsl(${hue(id)} 52% 44%)` : '#8a8f98' }}>
      {photo ? <img src={photo} alt="" /> : id ? initials(name) : '?'}
      {dot && id && isOnline(id) && <i className="online" />}
    </span>
  )
}

function Blip({ flair, size = 30 }: { flair: Flair; size?: number }) {
  const f = flairs[flair] ?? flairs.general
  return (
    <span className="blip" style={{ width: size, height: size, background: f.color }}>
      <Icon name={f.icon} size={size * 0.56} />
    </span>
  )
}

// Lists get one highlight that glides to the row under the mouse, instead of
// every row lighting up on its own. It's moved straight in the DOM; no renders.
function glide(e: React.MouseEvent<HTMLElement>) {
  const body = e.currentTarget
  const bar = body.querySelector<HTMLElement>(':scope > .glide')
  if (!bar) return
  const row = (e.target as HTMLElement).closest<HTMLElement>('button.row')
  if (!row || e.type === 'mouseleave') {
    bar.style.opacity = '0'
    return
  }
  bar.style.opacity = '1'
  bar.style.width = `${row.offsetWidth}px`
  bar.style.height = `${row.offsetHeight}px`
  bar.style.transform = `translate(${row.offsetLeft}px, ${row.offsetTop}px)`
}

// The handle on top of a phone sheet: drag it down to dismiss, up (or tap it) to
// pull the sheet to full height and back. It moves its parent, the sheet itself.
function Grip({ onDismiss }: { onDismiss: () => void }) {
  const drag = useRef<{ y: number; dy: number } | null>(null)

  const settle = (sheet: HTMLElement) => {
    sheet.style.transition = ''
    sheet.style.transform = ''
    drag.current = null
  }

  return (
    <div
      className="grip"
      onPointerDown={(e) => {
        drag.current = { y: e.clientY, dy: 0 }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const sheet = e.currentTarget.parentElement
        if (!drag.current || !sheet) return
        drag.current.dy = e.clientY - drag.current.y
        sheet.style.transform = `translateY(${Math.max(0, drag.current.dy)}px)`
        sheet.style.transition = 'none'
      }}
      onPointerUp={(e) => {
        const sheet = e.currentTarget.parentElement
        if (!drag.current || !sheet) return
        const dy = drag.current.dy
        settle(sheet)
        if (dy > 110) onDismiss()
        else if (dy < -40) ui({ sheetFull: true })
        else if (Math.abs(dy) < 6) ui({ sheetFull: !UI.sheetFull })
      }}
      onPointerCancel={(e) => e.currentTarget.parentElement && settle(e.currentTarget.parentElement)}
    >
      <i />
    </div>
  )
}

type PanelProps = {
  title: ReactNode
  icon?: ReactNode
  onBack?: () => void
  children: ReactNode
  foot?: ReactNode // stays put under the scrolling body, e.g. a reply box
  className?: string
}

function Panel({ title, icon, onBack, children, foot, className = '' }: PanelProps) {
  return (
    <aside className={`panel detail ${className}`}>
      <Grip onDismiss={() => go('')} />
      <header className="panel-head">
        {onBack && (
          <button className="icon-btn" onClick={onBack} aria-label="Back">
            <Icon name="back" />
          </button>
        )}
        {icon}
        <h2>{title}</h2>
        <button className="icon-btn" onClick={() => go('')} aria-label="Close" title="Close (Esc)">
          <Icon name="close" />
        </button>
      </header>
      <div className="panel-body" onMouseOver={glide} onMouseLeave={glide}>
        <i className="glide" />
        {children}
      </div>
      {foot && <footer className="panel-foot">{foot}</footer>}
    </aside>
  )
}

// Text with its web addresses turned into links.
// Text with its web addresses turned into links. A link to one of our own pins
// becomes a little card for it that opens here, rather than a bare address.
function Linked({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]*[^\s.,!?;:)\]'"])/g)
  return parts.map((part, i) => {
    if (i % 2 === 0) return part
    const pinId = pinInLink(part)
    const post = pinId ? S.posts.find((p) => p.id === pinId) : null
    if (post) {
      return (
        <button key={i} className="pin-card" onClick={() => openPin(post)}>
          <Blip flair={post.flair} size={26} />
          <span className="row-main">
            <strong className="clip">{post.title}</strong>
            <span className="small clip">{post.starts_at ? whenText(post.starts_at) : nameOf(post.author_id, post.author_name)}</span>
          </span>
        </button>
      )
    }
    return (
      <a key={i} href={part} target="_blank" rel="noreferrer noopener">
        {part.replace(/^https?:\/\/(www\.)?/, '')}
      </a>
    )
  })
}

// Directions are the phone's job: Apple devices open Apple Maps, everything else
// OpenStreetMap's route planner.
function directions(post: Post) {
  const at = `${post.latitude.toFixed(6)},${post.longitude.toFixed(6)}`
  if (/iPhone|iPad|Macintosh/.test(navigator.userAgent)) return `https://maps.apple.com/?daddr=${at}`
  return `https://www.openstreetmap.org/directions?to=${at}`
}

// A reply's text with "@Name" of people we know as links to them.
function Mentions({ text }: { text: string }) {
  const names = [...S.profiles.values()].filter((p) => text.includes('@' + p.display_name))
  if (!names.length) return <Linked text={text} />
  const pattern = new RegExp(`(${names.map((p) => '@' + p.display_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g')
  return text.split(pattern).map((part, i) => {
    const person = i % 2 ? names.find((p) => '@' + p.display_name === part) : null
    return person ? (
      <button key={i} className="mention" onClick={() => go(`user/${person.id}`)}>
        {part}
      </button>
    ) : (
      <Linked key={i} text={part} />
    )
  })
}

// The pin a link points at, if it's one of ours.
function pinInLink(url: string) {
  if (!url.startsWith(window.location.origin)) return null
  return /#pin\/([0-9a-f-]{36})/.exec(url)?.[1] ?? null
}

const pinLink = (post: Post) => `${window.location.origin}/#pin/${post.id}`

// A person in a list: their face and name (tap to open their profile), a line
// under the name, and whatever you can do with them on the right.
function PersonRow({ id, sub, children }: { id: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="row">
      <button className="plain person" onClick={() => go(`user/${id}`)}>
        <Avatar id={id} size={34} dot />
        <div>
          <strong>{nameOf(id)}</strong>
          {sub && <div className="muted small">{sub}</div>}
        </div>
      </button>
      {children}
    </div>
  )
}

function Empty({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} />
      <div>{children}</div>
    </div>
  )
}

// A textarea that grows with its text, sends on Enter, and keeps Shift+Enter for new lines.
type ComposerProps = {
  placeholder: string
  onSend: (text: string) => Promise<boolean> // true once it's sent, which clears the box
  onType?: () => void
  autoFocus?: boolean
  people?: string[] // who "@" suggests, first ones first
}

function Composer({ placeholder, onSend, onType, autoFocus = false, people }: ComposerProps) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [caret, setCaret] = useState(0)
  const ref = useRef<HTMLTextAreaElement>(null)

  // "@ma" just before the caret: suggest people whose name starts that way.
  const typed = people ? /(^|\s)@([^\s@]{0,20})$/.exec(text.slice(0, caret)) : null
  const suggestions = typed
    ? people!.filter((id) => nameOf(id).toLowerCase().startsWith(typed[2].toLowerCase())).slice(0, 5)
    : []

  function mention(id: string) {
    const start = caret - typed![2].length - 1
    const next = `${text.slice(0, start)}@${nameOf(id)} ${text.slice(caret)}`
    setText(next)
    const at = start + nameOf(id).length + 2
    setCaret(at)
    requestAnimationFrame(() => {
      ref.current?.focus()
      ref.current?.setSelectionRange(at, at)
    })
  }

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [text])

  async function send() {
    const body = text.trim()
    if (!body || busy) return
    setBusy(true)
    const ok = await onSend(body)
    setBusy(false)
    if (ok) setText('')
    else failed("Couldn't send")
    ref.current?.focus()
  }

  return (
    <div className="composer">
      {suggestions.length > 0 && (
        <div className="mentions" role="listbox" aria-label="Mention someone">
          {suggestions.map((id) => (
            <button key={id} role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => mention(id)}>
              <Avatar id={id} size={22} />
              {nameOf(id)}
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={ref}
        rows={1}
        value={text}
        placeholder={placeholder}
        autoFocus={autoFocus}
        maxLength={2000}
        onChange={(e) => {
          setText(e.target.value)
          setCaret(e.target.selectionStart)
          onType?.()
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (suggestions.length) mention(suggestions[0])
            else send()
          }
        }}
      />
      <button className="icon-btn send" onClick={send} disabled={!text.trim() || busy} aria-label="Send">
        <Icon name="send" />
      </button>
    </div>
  )
}

//
// The feed: the list twin of the map.
//

const TABS: [Tab, string][] = [
  ['around', 'Around'],
  ['latest', 'Latest'],
  ['soon', 'Soon'],
  ['friends', 'Friends'],
  ['mine', 'Mine'],
  ['past', 'Past'],
]

function PostRow({ post, away, active }: { post: Post; away: number; active: number }) {
  const st = stats()
  const replies = st.replies.get(post.id) ?? 0
  const interested = st.interested.get(post.id) ?? 0
  const unread = st.unread.has(post.id)
  const soon = post.starts_at && !post.resolved_at ? soonText(post.starts_at) : null
  const photo = st.photo.get(post.id)
  const key = placeKey(post)

  return (
    <button
      className={`row post-row${UI.route.id === post.id ? ' selected' : ''}`}
      onClick={() => openPin(post)}
      onMouseEnter={() => {
        if (map) {
          map.highlight = key
          requestFrame(map)
        }
      }}
      onMouseLeave={() => {
        if (map && map.highlight === key) {
          map.highlight = null
          requestFrame(map)
        }
      }}
    >
      <Blip flair={post.flair} />
      <div className="row-main">
        <div className="row-top">
          <strong className="clip">{post.title}</strong>
          <span className="muted small nowrap">{ago(active)}</span>
        </div>
        {post.description && <div className="clip muted">{post.description}</div>}
        <div className="row-meta">
          <span className="clip">{post.author_id ? nameOf(post.author_id, post.author_name) : 'Anonymous'}</span>
          {replies > 0 && (
            <span>
              <Icon name="chat" size={12} /> {replies}
            </span>
          )}
          {interested > 0 && (
            <span>
              <Icon name="thumb" size={12} /> {interested}
            </span>
          )}
          <span className="nowrap">{meters(away)}</span>
          {soon && (
            <span className={soon === 'now' ? 'when now' : 'when'}>
              <Icon name="calendar" size={12} /> {soon}
            </span>
          )}
          {unread && <i className="dot" title="New activity" />}
        </div>
      </div>
      {photo && <img className="row-thumb" src={photo.url} alt="" loading="lazy" />}
    </button>
  )
}

// A new account's first steps into the neighbourhood; each one opens the place to do it.
function GettingStarted() {
  const me = S.userId ? S.profiles.get(S.userId) : null
  if (!me || UI.started) return null
  const steps: [boolean, string, () => void][] = [
    [!!(me.neighbourhood || me.bio), 'Tell neighbours who you are', () => go(`user/${me.id}`)],
    [S.friendships.length > 0, 'Add a friend', () => go('friends')],
    [S.sharing, 'Share your location with friends', () => go('friends')],
    [S.posts.some((p) => p.author_id === me.id), 'Pin something', startCompose],
  ]
  if (steps.every(([done]) => done)) return null

  return (
    <div className="welcome started">
      <div className="row-top">
        <strong>Get started</strong>
        <button
          className="link small"
          onClick={() => {
            store('aroundhere.started', 'hidden')
            ui({ started: true })
          }}
        >
          Hide
        </button>
      </div>
      {steps.map(([done, label, run]) => (
        <button key={label} className={done ? 'step done' : 'step'} onClick={run}>
          <i>{done && <Icon name="check" size={12} />}</i>
          {label}
        </button>
      ))}
    </div>
  )
}

function Feed() {
  const rows = sortedFeed(visiblePosts())
  const signedOut = !S.userId

  return (
    <aside className="panel feed">
      <Grip onDismiss={() => ui({ feed: false, sheetFull: false })} />
      <header className="feed-head">
        <div className="tabs" role="tablist">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={UI.tab === id}
              className={UI.tab === id ? 'tab on' : 'tab'}
              onClick={() => {
                if ((id === 'friends' || id === 'mine') && needAccount('signin')) return
                ui({ tab: id })
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flair-bar">
          {(Object.keys(flairs) as Flair[]).map((f) => (
            <button
              key={f}
              className={UI.flair === f ? 'flair-chip on' : 'flair-chip'}
              style={{ '--c': flairs[f].color } as React.CSSProperties}
              title={flairs[f].label}
              onClick={() => ui({ flair: UI.flair === f ? null : f })}
            >
              <Icon name={flairs[f].icon} size={14} />
              <span>{flairs[f].label}</span>
            </button>
          ))}
        </div>
      </header>

      <div className="panel-body" onMouseOver={glide} onMouseLeave={glide}>
        <i className="glide" />
        {signedOut && (
          <div className="welcome">
            <strong>What's happening around here?</strong>
            <p>Pins from people nearby: events, lost pets, free lemons, street gossip. Join to post, reply and find friends on the map.</p>
            <div className="btn-row">
              <button className="btn primary" onClick={() => ui({ auth: 'signup' })}>
                Create account
              </button>
              <button className="btn" onClick={() => ui({ auth: 'signin' })}>
                Sign in
              </button>
            </div>
            <button className="link small near-me" onClick={locate}>
              <Icon name="locate" size={14} /> Show what's around me
            </button>
          </div>
        )}

        <GettingStarted />

        {/* Somewhere with nothing yet: say so, and point at where things are. */}
        {S.ready && UI.tab === 'around' && rows.length > 0 && rows[0].away > 5000 && (
          <div className="welcome quiet">
            <strong>Nothing pinned within {meters(rows[0].away)} of here yet</strong>
            <p>Be the first on your street, or have a look at where people are already busy.</p>
            <div className="btn-row">
              <button className="btn primary" onClick={startCompose}>
                Pin something here
              </button>
              <button className="btn" onClick={() => reveal(rows[0].post.latitude, rows[0].post.longitude, 15, true)}>
                Go to the nearest
              </button>
            </div>
          </div>
        )}

        {S.offline ? (
          <Empty icon="map">Can't reach AroundHere right now. Trying again…</Empty>
        ) : !S.ready ? (
          <div className="skeleton">{[0, 1, 2, 3].map((i) => <div key={i} />)}</div>
        ) : rows.length === 0 ? (
          <Empty icon="pin">
            {UI.tab === 'friends'
              ? 'Nothing from friends yet. Add people from their profiles.'
              : UI.tab === 'mine'
                ? 'Pins you post, save, reply to or join show up here.'
                : UI.tab === 'past'
                  ? 'Nothing here yet: resolved pins, and ones quiet for a month, end up in Past.'
                  : UI.tab === 'soon'
                    ? 'Nothing planned this week. Give a pin a time and it shows up here.'
                    : 'No pins here yet. Be the first: press N or tap +.'}
          </Empty>
        ) : (
          rows.map(({ post, away, active }, i) => {
            // In Latest, a line where the new stuff since your last visit ends.
            const divide = UI.tab === 'latest' && lastVisit > 0 && active > lastVisit && (rows[i + 1]?.active ?? 0) <= lastVisit && i < rows.length - 1
            return (
              <div key={post.id}>
                <PostRow post={post} away={away} active={active} />
                {divide && <div className="section since">Since your last visit ↑</div>}
              </div>
            )
          })
        )}
      </div>
      <footer className="feed-foot muted small">
        {plural(rows.length, 'pin')}
        {UI.tab === 'around' ? ' · nearest first' : UI.tab === 'soon' ? ' · soonest first' : ' · latest activity first'}
      </footer>
    </aside>
  )
}

function FlairPick({ value, onPick }: { value: Flair; onPick: (flair: Flair) => void }) {
  return (
    <div className="flair-pick" role="radiogroup" aria-label="Kind of pin">
      {(Object.keys(flairs) as Flair[]).map((f) => (
        <button key={f} role="radio" aria-checked={value === f} className={value === f ? 'on' : ''} style={{ '--c': flairs[f].color } as React.CSSProperties} onClick={() => onPick(f)}>
          <Blip flair={f} size={26} />
          <span>{flairs[f].label}</span>
        </button>
      ))}
    </div>
  )
}

//
// A pin and its thread.
//

function PostView({ post }: { post: Post }) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(post.title)
  const [body, setBody] = useState(post.description)
  const [starts, setStarts] = useState(post.starts_at ? toLocalInput(post.starts_at) : '')
  const [flair, setFlair] = useState<Flair>(post.flair)
  const [doomedReply, setDoomedReply] = useState<string | null>(null) // a reply of mine waiting for "really?"
  const [reporting, setReporting] = useState(false)
  const [sending, setSending] = useState(false) // choosing a friend to send the pin to
  const [history, setHistory] = useState<Revision[] | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const me = S.userId
  const mine = !!me && post.author_id === me
  const replies = S.replies.filter((r) => r.post_id === post.id && !(r.author_id && S.blocked.has(r.author_id)))
  const { likes, liked } = stats()
  const media = S.media.filter((m) => m.post_id === post.id)
  const interested = S.interests.filter((i) => i.post_id === post.id).map((i) => i.user_id)
  const iAmIn = !!me && interested.includes(me)
  const saved = S.saved.some((s) => s.post_id === post.id)
  const siblings = S.posts.filter((p) => placeKey(p) === placeKey(post))
  const f = flairs[post.flair] ?? flairs.general
  const street = map ? nearestStreet(map, post.longitude, post.latitude) : ''
  const away = fromMe(post)
  const soon = post.starts_at ? soonText(post.starts_at) : null

  // Opening a pin reads its notifications.
  const unread = S.notifications.filter((n) => n.post_id === post.id && !n.read_at).map((n) => n.id).join(',')
  useEffect(() => {
    if (unread) markNotificationsRead(unread.split(','))
  }, [unread])

  async function save() {
    if (!title.trim()) return
    if (await updatePost(post.id, { title: title.trim(), description: body.trim(), starts_at: fromLocalInput(starts), flair })) {
      setEditing(false)
      setHistory(null)
    } else failed("Couldn't save")
  }

  async function remove() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      setTimeout(() => setConfirmDelete(false), 4000)
      return
    }
    if (await deletePost(post.id)) {
      go('')
      toast('Pin deleted')
    } else failed("Couldn't delete")
  }

  async function copyLink() {
    // Phones get their own share sheet; everything else copies the link.
    if (narrow() && navigator.share) {
      navigator.share({ title: post.title, text: post.description.slice(0, 140), url: window.location.href }).catch(() => {})
      return
    }
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast('Link copied')
    } catch {
      toast(window.location.href)
    }
  }

  const interestedNames = interested.map((id) => (id === me ? 'You' : nameOf(id)))

  return (
    <Panel
      title={f.label}
      icon={<Blip flair={post.flair} size={24} />}
      onBack={siblings.length > 1 ? () => go(`place/${placeKey(post)}`) : undefined}
      foot={
        me ? (
          <Composer
            people={[...new Set([post.author_id, ...replies.map((r) => r.author_id), ...friendIds(), ...S.profiles.keys()])].filter(
              (id): id is string => !!id && id !== me && !S.blocked.has(id),
            )}
            placeholder={`Reply to ${post.author_id ? firstName(post.author_id) : 'this pin'}…`}
            onSend={async (text) => {
              const ok = await reply(post.id, text)
              if (ok) setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
              return ok
            }}
          />
        ) : (
          <button className="btn wide" onClick={() => needAccount('signup')}>
            Join to reply
          </button>
        )
      }
    >
      <div className="author">
        <button className="person" onClick={() => post.author_id && go(`user/${post.author_id}`)} disabled={!post.author_id}>
          <Avatar id={post.author_id} size={38} dot />
          <div>
            <strong>{post.author_id ? nameOf(post.author_id, post.author_name) : 'Anonymous'}</strong>
            <div className="muted small">
              {ago(post.created_at)}
              {street && ` · ${street}`}
              {away !== null && ` · ${awayText(away)}`}
            </div>
          </div>
        </button>
      </div>

      {post.resolved_at && (
        <div className="banner ok">
          <Icon name="check" size={16} /> Resolved {ago(post.resolved_at)}
          {mine && (
            <button className="link" onClick={() => updatePost(post.id, { resolved_at: null })}>
              Reopen
            </button>
          )}
        </div>
      )}

      {editing ? (
        <div className="stack">
          <FlairPick value={flair} onPick={setFlair} />
          <input className="input title-input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} autoFocus />
          <textarea className="input" rows={5} value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} />
          <label className="field when-field">
            <span>When</span>
            <input className="input" type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} />
          </label>
          <div className="btn-row">
            <button className="btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button className="btn primary" onClick={save} disabled={!title.trim()}>
              Save
            </button>
          </div>
        </div>
      ) : (
        <>
          <h1 className="post-title">{post.title}</h1>
          {post.starts_at && (
            <div className={soon === 'now' ? 'when-line now' : 'when-line'}>
              <Icon name="calendar" size={16} />
              <strong>{whenText(post.starts_at)}</strong>
              {soon === null && <span className="muted">· over</span>}
              {soon === 'now' && <span>· happening now</span>}
              {soon?.startsWith('in ') && <span className="muted">· {soon}</span>}
            </div>
          )}
          {post.description && (
            <p className="post-body">
              <Linked text={post.description} />
            </p>
          )}
        </>
      )}

      {post.edited_at && !editing && (
        <div className="muted small">
          Edited {ago(post.edited_at)} ·{' '}
          <button className="link" onClick={async () => setHistory(history ? null : await loadRevisions(post.id))}>
            {history ? 'hide history' : 'history'}
          </button>
        </div>
      )}
      {history && (
        <div className="history">
          {history.map((rev) => (
            <div key={rev.id}>
              <div className="muted small">Before {ago(rev.replaced_at)}</div>
              <strong>{rev.title}</strong>
              <p>{rev.description}</p>
            </div>
          ))}
        </div>
      )}

      {media.length > 0 && (
        <div className="gallery">
          {media.map((m) =>
            m.media_type === 'video' ? (
              <video key={m.id} src={m.url} controls preload="metadata" />
            ) : (
              <button key={m.id} onClick={() => setLightbox(m.url)}>
                <img src={m.url} alt="" loading="lazy" />
              </button>
            ),
          )}
        </div>
      )}
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
        </div>
      )}

      <div className="actions">
        <button className={iAmIn ? 'btn on' : 'btn'} aria-pressed={iAmIn} onClick={() => interest(post.id)}>
          <Icon name="thumb" size={16} /> {iAmIn ? "I'm in" : 'Interested'}
          {interested.length > 0 && <b>{interested.length}</b>}
        </button>
        {me && (
          <button className={saved ? 'btn on gold' : 'btn'} aria-pressed={saved} onClick={() => saveToggle(post.id, saved)}>
            <Icon name="star" size={16} /> {saved ? 'Saved' : 'Save'}
          </button>
        )}
        {me && post.author_id && !mine && (
          <button className="btn" onClick={() => go(`chat/${post.author_id}`)}>
            <Icon name="chat" size={16} /> Message
          </button>
        )}
        {me && friendIds().length > 0 && (
          <button className={sending ? 'btn on' : 'btn'} onClick={() => setSending(!sending)} title="Send to a friend">
            <Icon name="send" size={16} />
          </button>
        )}
        <button className="btn" onClick={copyLink} title="Copy link">
          <Icon name="link" size={16} />
        </button>
        <a className="btn" href={directions(post)} target="_blank" rel="noreferrer noopener" title="Directions in your maps app">
          <Icon name="arrow" size={16} /> Get there
        </a>
      </div>

      {sending && (
        <div className="send-to">
          <span className="muted small">Send to</span>
          {friendIds().map((id) => (
            <button
              key={id}
              className="chip-person"
              onClick={async () => {
                setSending(false)
                if (await sendMessage(id, `${post.title} ${pinLink(post)}`)) toast(`Sent to ${firstName(id)}`)
                else failed("Couldn't send")
              }}
            >
              <Avatar id={id} size={22} />
              {firstName(id)}
            </button>
          ))}
        </div>
      )}

      {mine && !editing && (
        <div className="actions">
          <button className="btn" onClick={() => setEditing(true)}>
            <Icon name="pencil" size={16} /> Edit
          </button>
          {!post.resolved_at && (
            <button className="btn" onClick={() => resolve(post.id)} title="Done, found, sorted: moves it to Past">
              <Icon name="check" size={16} /> Resolve
            </button>
          )}
          <button className={confirmDelete ? 'btn danger' : 'btn'} onClick={remove}>
            <Icon name="trash" size={16} /> {confirmDelete ? 'Really delete?' : 'Delete'}
          </button>
        </div>
      )}

      {me && !mine && post.author_id && (
        <div className="report">
          {reporting ? (
            <>
              <span className="muted small">What's wrong with it?</span>
              {(
                [
                  ['spam', 'Spam or ad'],
                  ['unkind', 'Unkind or hateful'],
                  ['unsafe', 'Unsafe or illegal'],
                  ['other', 'Something else'],
                ] as const
              ).map(([reason, label]) => (
                <button
                  key={reason}
                  className="btn small"
                  onClick={async () => {
                    setReporting(false)
                    if (await report(post.id, reason)) toast('Thanks, someone will take a look')
                    else failed("Couldn't send the report")
                  }}
                >
                  {label}
                </button>
              ))}
              <button className="link small" onClick={() => setReporting(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button className="link small quiet-danger" onClick={() => setReporting(true)}>
              Report this pin
            </button>
          )}
        </div>
      )}

      {interested.length > 0 && (
        <div className="facepile">
          <span>
            {interested.slice(0, 5).map((id) => (
              <Avatar key={id} id={id} size={24} />
            ))}
          </span>
          <span className="muted small">
            {interestedNames.length <= 2
              ? `${interestedNames.join(' and ')} ${interestedNames.length === 1 && interestedNames[0] !== 'You' ? 'is' : 'are'} in`
              : `${interestedNames.slice(0, 2).join(', ')} and ${plural(interestedNames.length - 2, 'other')} are in`}
          </span>
        </div>
      )}

      <div className="section">{replies.length ? plural(replies.length, 'reply', 'replies') : 'Replies'}</div>
      {replies.length === 0 && <p className="muted">No replies yet. Start the conversation.</p>}
      {replies.map((r) => (
        <div key={r.id} className="reply">
          <button className="plain" onClick={() => r.author_id && go(`user/${r.author_id}`)}>
            <Avatar id={r.author_id} size={30} />
          </button>
          <div>
            <div className="small">
              <button className="plain name" onClick={() => r.author_id && go(`user/${r.author_id}`)}>
                {r.author_id ? nameOf(r.author_id, r.author_name) : 'Anonymous'}
              </button>
              {r.author_id === post.author_id && post.author_id && <span className="tag">author</span>}
              <span className="muted"> · {ago(r.created_at)}</span>
              {me && r.author_id === me && (
                <button
                  className={doomedReply === r.id ? 'link danger-link' : 'link quiet'}
                  onClick={async () => {
                    if (doomedReply !== r.id) return setDoomedReply(r.id)
                    if (!(await deleteReply(r.id))) failed("Couldn't delete")
                  }}
                  onBlur={() => setDoomedReply(null)}
                >
                  {doomedReply === r.id ? 'really delete?' : 'delete'}
                </button>
              )}
            </div>
            <div className="reply-text">
              <Mentions text={r.content} />
            </div>
            <button
              className={liked.has(r.id) ? 'like on' : 'like'}
              aria-pressed={liked.has(r.id)}
              aria-label={liked.has(r.id) ? 'Unlike' : 'Like'}
              onClick={() => !needAccount() && toggleLike(r.id).then((ok) => ok || failed("Couldn't update"))}
            >
              <Icon name="heart" size={13} />
              {(likes.get(r.id) ?? 0) > 0 && <span>{likes.get(r.id)}</span>}
            </button>
          </div>
        </div>
      ))}
      <div ref={endRef} />
    </Panel>
  )
}

function PlaceView({ id }: { id: string }) {
  const posts = S.posts.filter((p) => placeKey(p) === id)
  if (!posts.length) return <Missing what="place" />
  const street = map ? nearestStreet(map, posts[0].longitude, posts[0].latitude) : ''
  return (
    <Panel title={street || plural(posts.length, 'thread') + ' here'} icon={<Icon name="pin" />}>
      <p className="muted small">{plural(posts.length, 'thread')} at this spot</p>
      {sortedFeed(posts).map(({ post, away, active }) => (
        <PostRow key={post.id} post={post} away={away} active={active} />
      ))}
    </Panel>
  )
}

// Private pages when signed out: say why, and offer the way in.
function SignInFirst({ title, icon, why }: { title: string; icon: IconName; why: string }) {
  if (!S.authKnown) return <Panel title={title}>{null}</Panel>
  return (
    <Panel title={title} icon={<Icon name={icon} />}>
      <Empty icon={icon}>{why}</Empty>
      <div className="btn-row center">
        <button className="btn primary" onClick={() => ui({ auth: 'signup' })}>
          Create account
        </button>
        <button className="btn" onClick={() => ui({ auth: 'signin' })}>
          Sign in
        </button>
      </div>
    </Panel>
  )
}

function Missing({ what }: { what: string }) {
  return (
    <Panel title="Not found">
      <Empty icon="map">{S.ready ? `This ${what} is gone, or never existed.` : 'Loading…'}</Empty>
    </Panel>
  )
}

//
// People.
//

function FriendButton({ id }: { id: string }) {
  const f = friendshipWith(id)
  if (!S.userId || id === S.userId) return null

  if (!f) {
    return (
      <button className="btn" onClick={() => befriend(id)}>
        <Icon name="userplus" size={16} /> Add friend
      </button>
    )
  }
  if (f.accepted_at) {
    return (
      <button className="btn on" onClick={() => confirm(`Remove ${nameOf(id)} from friends?`) && removeFriend(id)} title="Remove friend">
        <Icon name="check" size={16} /> Friends
      </button>
    )
  }
  if (f.addressee === S.userId) {
    return (
      <>
        <button className="btn primary" onClick={() => accept(id)}>
          <Icon name="check" size={16} /> Accept
        </button>
        <button className="btn" onClick={() => removeFriend(id)}>
          Decline
        </button>
      </>
    )
  }
  return (
    <button className="btn" onClick={() => removeFriend(id)} title="Cancel request">
      Requested
    </button>
  )
}

function ProfileView({ id }: { id: string }) {
  const profile = S.profiles.get(id)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [area, setArea] = useState('')
  const [bio, setBio] = useState('')

  if (!profile) return <Missing what="person" />

  const own = id === S.userId
  const posts = S.posts.filter((p) => p.author_id === id)
  const replyCount = S.replies.filter((r) => r.author_id === id).length
  const joinedCount = S.interests.filter((i) => i.user_id === id).length
  const loc = locationOf(id)

  async function save() {
    const ok = await saveProfile({ display_name: name.trim(), neighbourhood: area.trim() || null, bio: bio.trim() || null })
    if (ok) {
      setEditing(false)
      toast('Profile saved')
    } else failed("Couldn't save")
  }

  return (
    <Panel title={own ? 'You' : 'Profile'} icon={<Icon name="user" />} className="tall">
      <div className="profile-card">
        {own ? (
          <label className="photo-pick" title="Change your photo">
            <Avatar id={id} size={64} />
            <span>
              <Icon name="image" size={14} />
            </span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) uploadAvatar(file).then((ok) => (ok ? toast('Photo updated') : failed("Couldn't update your photo")))
              }}
            />
          </label>
        ) : (
          <Avatar id={id} size={64} dot />
        )}
        <div>
          <h1>{profile.display_name}</h1>
          <div className="muted small">
            {profile.neighbourhood && <>{profile.neighbourhood} · </>}
            Joined {new Date(profile.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
            {isOnline(id) && <span className="online-text"> · online</span>}
          </div>
        </div>
      </div>

      {editing ? (
        <div className="stack">
          <label className="field">
            <span>Name</span>
            <input className="input" value={name} maxLength={50} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Neighbourhood</span>
            <input className="input" value={area} maxLength={80} placeholder="e.g. Kent Town" onChange={(e) => setArea(e.target.value)} />
          </label>
          <label className="field">
            <span>About you</span>
            <textarea className="input" rows={4} value={bio} maxLength={500} placeholder="What you're into, what you can help with…" onChange={(e) => setBio(e.target.value)} />
          </label>
          <div className="btn-row">
            <button className="btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button className="btn primary" onClick={save} disabled={!name.trim()}>
              Save
            </button>
          </div>
        </div>
      ) : (
        profile.bio && (
          <p className="post-body">
            <Linked text={profile.bio} />
          </p>
        )
      )}

      {/* On your own profile the numbers are a way into the feed's Mine tab. */}
      <div className="stats">
        {(
          [
            [posts.length, 'pins'],
            [replyCount, 'replies'],
            [joinedCount, 'joined'],
          ] as const
        ).map(([count, label]) => (
          <button key={label} disabled={!own} onClick={() => { ui({ tab: 'mine', feed: true }); go('') }} title={own ? 'Show them in the feed' : undefined}>
            <b>{count}</b>
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className="actions">
        {own ? (
          !editing && (
            <>
              <button
                className="btn"
                onClick={() => {
                  // Fill the form from the profile as it is now, not as it was on first render.
                  setName(profile.display_name)
                  setArea(profile.neighbourhood ?? '')
                  setBio(profile.bio ?? '')
                  setEditing(true)
                }}
              >
                <Icon name="pencil" size={16} /> Edit profile
              </button>
              <button className="btn" onClick={() => go('friends')}>
                <Icon name="users" size={16} /> Friends
              </button>
              <button className="btn" onClick={() => go('settings')}>
                <Icon name="sliders" size={16} /> Settings
              </button>
            </>
          )
        ) : (
          <>
            {S.userId && (
              <button className="btn primary" onClick={() => go(`chat/${id}`)}>
                <Icon name="chat" size={16} /> Message
              </button>
            )}
            <FriendButton id={id} />
            {loc && (
              <button className="btn" onClick={() => reveal(loc.latitude, loc.longitude, 17, true)}>
                <Icon name="locate" size={16} /> Find
              </button>
            )}
          </>
        )}
      </div>

      {!own && S.userId && (
        <div className="actions">
          {S.blocked.has(id) ? (
            <button className="link small" onClick={() => unblock(id).then((ok) => (ok ? toast(`Unblocked ${nameOf(id)}`) : failed("Couldn't unblock")))}>
              Unblock {firstName(id)}
            </button>
          ) : (
            <button
              className="link small quiet-danger"
              onClick={() => confirm(`Block ${nameOf(id)}? They won't be able to message you or add you, and you won't see their pins.`) && block(id).then((ok) => (ok ? toast(`Blocked ${nameOf(id)}`) : failed("Couldn't block")))}
            >
              Block {firstName(id)}
            </button>
          )}
        </div>
      )}

      <div className="section">{own ? 'Your pins' : 'Pins'}</div>
      {posts.length === 0 ? (
        <p className="muted">{own ? "You haven't pinned anything yet." : 'No pins yet.'}</p>
      ) : (
        sortedFeed(posts).map(({ post, away, active }) => <PostRow key={post.id} post={post} away={away} active={active} />)
      )}

      <Activity id={id} />

      {own && (
        <div className="foot-links">
          <span className="muted small clip">{S.session?.user.email}</span>
          <button className="link" onClick={signOut}>
            Sign out
          </button>
        </div>
      )}
    </Panel>
  )
}

// What someone has been up to on the map, newest first, from what's already loaded.
function Activity({ id }: { id: string }) {
  const [limit, setLimit] = useState(6)
  const byId = new Map(S.posts.filter((p) => !(p.author_id && S.blocked.has(p.author_id))).map((p) => [p.id, p]))
  const items: { key: string; time: number; icon: IconName; verb: string; post: Post; quote?: string }[] = []

  for (const post of byId.values()) {
    if (post.author_id !== id) continue
    items.push({ key: `p${post.id}`, time: time(post.created_at), icon: 'pin', verb: 'Pinned', post })
    if (post.resolved_at) items.push({ key: `r${post.id}`, time: time(post.resolved_at), icon: 'check', verb: 'Resolved', post })
  }
  for (const r of S.replies) {
    const post = byId.get(r.post_id)
    if (r.author_id === id && post) items.push({ key: `c${r.id}`, time: time(r.created_at), icon: 'chat', verb: 'Replied to', post, quote: r.content })
  }
  for (const i of S.interests) {
    const post = byId.get(i.post_id)
    if (i.user_id === id && post) items.push({ key: `i${post.id}`, time: time(i.created_at), icon: 'thumb', verb: "Is in on", post })
  }
  items.sort((a, b) => b.time - a.time)
  if (!items.length) return null

  return (
    <>
      <div className="section">Activity</div>
      {items.slice(0, limit).map((item) => (
        <button key={item.key} className="row activity" onClick={() => openPin(item.post)}>
          <span className="activity-icon">
            <Icon name={item.icon} size={14} />
          </span>
          <div className="row-main">
            <div className="clip">
              {item.verb} <strong>{item.post.title}</strong>
            </div>
            {item.quote && <div className="muted clip">“{item.quote}”</div>}
          </div>
          <span className="muted small nowrap">{ago(item.time)}</span>
        </button>
      ))}
      {items.length > limit && (
        <button className="link small" onClick={() => setLimit(limit + 10)}>
          More
        </button>
      )}
    </>
  )
}

async function signOut() {
  if (S.sharing) await setSharing(false)
  await checkOut()
  await supabase.auth.signOut()
  UI.tab = 'around'
  go('')
  toast('Signed out')
}

function ChatView({ id }: { id: string }) {
  const endRef = useRef<HTMLDivElement>(null)
  const typing = useRef<ReturnType<typeof typingChannel> | null>(null)
  const [typingAt, setTypingAt] = useState(0)
  const me = S.userId

  useEffect(() => {
    if (!me || id === me) return
    const channel = typingChannel(id, () => setTypingAt(Date.now()))
    typing.current = channel
    return () => channel.close()
  }, [id, me])

  // "typing…" goes away after a few quiet seconds.
  useEffect(() => {
    if (!typingAt) return
    const timer = setTimeout(() => setTypingAt(0), 3000)
    return () => clearTimeout(timer)
  }, [typingAt])

  const thread = S.messages.filter((m) => (m.sender_id === id && m.recipient_id === S.userId) || (m.recipient_id === id && m.sender_id === S.userId))
  const unread = thread.some((m) => m.sender_id === id && !m.read_at)
  const loc = locationOf(id)
  const away = fromMe(loc)

  useEffect(() => {
    if (unread) markConversationRead(id)
  }, [unread, id])

  useLayoutEffect(() => {
    endRef.current?.scrollIntoView()
  }, [thread.length])

  if (!S.userId) return <SignInFirst title="Messages" icon="chat" why="Sign in to message your neighbours." />
  if (id === S.userId) return <Missing what="conversation" />

  return (
    <Panel
      title={
        <button className="plain person-title" onClick={() => go(`user/${id}`)}>
          <Avatar id={id} size={28} dot />
          <span>
            {nameOf(id)}
            <small className="muted">
              {typingAt ? <em className="typing">typing…</em> : isOnline(id) ? 'online' : 'offline'}
              {loc && ` · ${away !== null ? awayText(away) : 'on the map'} ${since(loc.updated_at)}`}
            </small>
          </span>
        </button>
      }
      onBack={() => go('inbox')}
      className="chat"
      foot={<Composer placeholder={`Message ${firstName(id)}…`} autoFocus={!narrow()} onSend={(text) => sendMessage(id, text)} onType={() => typing.current?.ping()} />}
    >
      {loc && (
        <button className="btn wide" onClick={() => reveal(loc.latitude, loc.longitude, 17, true)}>
          <Icon name="locate" size={16} /> Show {firstName(id)} on the map
        </button>
      )}
      {thread.length === 0 && (
        <Empty icon="chat">
          Say hi to {firstName(id)}. Messages are private between you two.
        </Empty>
      )}
      <div className="bubbles">
        {thread.map((m, i) => {
          const day = dayLabel(m.created_at)
          const showDay = i === 0 || day !== dayLabel(thread[i - 1].created_at)
          const mineMsg = m.sender_id === S.userId
          const next = thread[i + 1]
          const tail = !next || next.sender_id !== m.sender_id || time(next.created_at) - time(m.created_at) > 300000
          return (
            <div key={m.id} className="bubble-wrap">
              {showDay && <div className="day">{day}</div>}
              <div className={`bubble ${mineMsg ? 'out' : 'in'}${tail ? ' tail' : ''}`}>
                <Linked text={m.body} />
                {tail && (
                  <span className="stamp">
                    {new Date(m.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                    {mineMsg && m.id === thread.filter((x) => x.sender_id === S.userId).at(-1)?.id && (m.read_at ? ' · seen' : ' · sent')}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div ref={endRef} />
    </Panel>
  )
}

//
// Inbox: notifications and conversations.
//

function InboxView() {
  const [tab, setTab] = useState<'activity' | 'messages'>(unreadMessages().length > 0 ? 'messages' : 'activity')
  if (!S.userId) return <SignInFirst title="Inbox" icon="bell" why="Replies to your pins, friend requests and messages land here." />

  const notifications = visibleNotifications().reverse()
  const unreadCount = notifications.filter((n) => !n.read_at).length
  const convos = conversations()

  // The same thing happening on the same pin on the same day is one row:
  // "Tom, Priya and 1 other replied to your pin".
  const groups: Notification[][] = []
  for (const n of notifications) {
    const last = groups.at(-1)?.[0]
    const alike = last && n.post_id && last.post_id === n.post_id && last.kind === n.kind && dayLabel(last.created_at) === dayLabel(n.created_at)
    if (alike) groups.at(-1)!.push(n)
    else groups.push([n])
  }

  function open(group: Notification[]) {
    const n = group[0]
    markNotificationsRead(group.map((g) => g.id))
    if (n.post_id) {
      const post = S.posts.find((p) => p.id === n.post_id)
      if (post) openPin(post)
      else toast('That pin is gone')
    } else if (n.actor_id) go(`user/${n.actor_id}`)
  }

  return (
    <Panel title="Inbox" icon={<Icon name="bell" />} className="tall">
      <div className="tabs">
        <button className={tab === 'activity' ? 'tab on' : 'tab'} onClick={() => setTab('activity')}>
          Activity {unreadCount > 0 && <b className="count">{unreadCount}</b>}
        </button>
        <button className={tab === 'messages' ? 'tab on' : 'tab'} onClick={() => setTab('messages')}>
          Messages {convos.some((c) => c.unread) && <b className="count">{convos.reduce((n, c) => n + c.unread, 0)}</b>}
        </button>
      </div>

      {tab === 'activity' ? (
        <>
          {unreadCount > 0 && (
            <button className="link right" onClick={() => markNotificationsRead(notifications.map((n) => n.id))}>
              Mark all read
            </button>
          )}
          {notifications.length === 0 && <Empty icon="bell">Replies, saves and friend requests land here.</Empty>}
          {groups.map((group, i) => {
            const n = group[0]
            const day = dayLabel(n.created_at)
            const showDay = i === 0 || day !== dayLabel(groups[i - 1][0].created_at)
            const pending = n.kind === 'friend_request' && n.actor_id && friendshipWith(n.actor_id) && !friendshipWith(n.actor_id)!.accepted_at
            const actors = [...new Set(group.map((g) => g.actor_id))]
            const names = actors.map((id) => (id ? nameOf(id, group.find((g) => g.actor_id === id)?.actor_name ?? null) : 'Someone'))
            const who = names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${plural(names.length - 2, 'other')}`
            return (
              <div key={n.id}>
                {showDay && <div className="section">{day}</div>}
                <div className={group.every((g) => g.read_at) ? 'row note' : 'row note unread'}>
                  <button className="plain facestack" onClick={() => n.actor_id && go(`user/${n.actor_id}`)}>
                    {actors.slice(0, 2).map((id, j) => (
                      <Avatar key={id ?? j} id={id} size={actors.length > 1 ? 26 : 34} />
                    ))}
                  </button>
                  <button className="row-main" onClick={() => open(group)}>
                    <div>
                      <strong>{who}</strong> {describeNotification(n)}
                    </div>
                    {n.preview && <div className="muted clip">“{n.preview}”</div>}
                    <div className="muted small">
                      {ago(n.created_at)}
                      {group.length > 1 && ` · ${group.length} times`}
                    </div>
                  </button>
                  {pending && (
                    <div className="stack tight">
                      <FriendButton id={n.actor_id!} />
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          {S.hasOlderNotifications && (
            <button className="btn wide" onClick={loadOlderNotifications}>
              Older
            </button>
          )}
        </>
      ) : convos.length === 0 ? (
        <Empty icon="chat">No messages yet. Open someone's profile, or tap a friend on the map, to start one.</Empty>
      ) : (
        convos.map((c) => (
          <button key={c.other} className={c.unread ? 'row unread' : 'row'} onClick={() => go(`chat/${c.other}`)}>
            <Avatar id={c.other} size={40} dot />
            <div className="row-main">
              <div className="row-top">
                <strong className="clip">{nameOf(c.other)}</strong>
                <span className="muted small">{ago(c.last.created_at)}</span>
              </div>
              <div className="clip muted">
                {c.last.sender_id === S.userId && 'You: '}
                {readable(c.last.body)}
              </div>
            </div>
            {c.unread > 0 && <b className="count">{c.unread}</b>}
          </button>
        ))
      )}
    </Panel>
  )
}

//
// Friends and location sharing.
//

function FriendsView() {
  const [query, setQuery] = useState('')
  if (!S.userId) return <SignInFirst title="Friends" icon="users" why="Add friends to see them on the map and chat." />

  const friends = friendIds().sort((a, b) => Number(isOnline(b)) - Number(isOnline(a)) || nameOf(a).localeCompare(nameOf(b)))
  const incoming = S.friendships.filter((f) => !f.accepted_at && f.addressee === S.userId).map((f) => f.requester)
  const outgoing = S.friendships.filter((f) => !f.accepted_at && f.requester === S.userId).map((f) => f.addressee)
  const q = query.trim().toLowerCase()
  // Neighbours first: people whose pins are closest to you (or to the map, if we don't know where you are).
  const from = S.here ? { lat: S.here.latitude, lng: S.here.longitude } : UI.view
  const nearest = new Map<string, number>()
  for (const post of S.posts) {
    if (!post.author_id) continue
    const d = distance(from.lat, from.lng, post.latitude, post.longitude)
    if (d < (nearest.get(post.author_id) ?? Infinity)) nearest.set(post.author_id, d)
  }
  const others = [...S.profiles.values()]
    .filter((p) => p.id !== S.userId && !friendshipWith(p.id))
    .filter((p) => !q || p.display_name.toLowerCase().includes(q) || (p.neighbourhood ?? '').toLowerCase().includes(q))
    .sort((a, b) => (nearest.get(a.id) ?? Infinity) - (nearest.get(b.id) ?? Infinity))
    .slice(0, 30)

  return (
    <Panel title="Friends" icon={<Icon name="users" />} className="tall">
      <div className={S.sharing ? 'share-card on' : 'share-card'}>
        <div>
          <strong>
            {!S.sharing ? 'Location sharing is off' : S.sharingUntil ? `Sharing for ${minutesLeft(S.sharingUntil)} more min` : 'Sharing your location'}
          </strong>
          <p className="muted small">
            {S.sharing ? 'Friends see where you are while the app is open. Only friends, never anyone else.' : 'Turn it on to show up on your friends’ maps, and see theirs.'}
          </p>
          {!S.sharing && (
            <button className="link small" onClick={() => shareForAnHour()}>
              Or just for the next hour
            </button>
          )}
        </div>
        <button
          className={S.sharing ? 'switch on' : 'switch'}
          role="switch"
          aria-checked={S.sharing}
          onClick={toggleSharing}
        >
          <i />
        </button>
      </div>

      {incoming.length > 0 && (
        <>
          <div className="section">Requests</div>
          {incoming.map((id) => (
            <PersonRow key={id} id={id}>
              <FriendButton id={id} />
            </PersonRow>
          ))}
        </>
      )}

      <div className="section">{friends.length ? plural(friends.length, 'friend') : 'Friends'}</div>
      {friends.length === 0 && <p className="muted">No friends yet. Find people below, or from anyone's profile.</p>}
      {friends.map((id) => {
        const loc = locationOf(id)
        const away = fromMe(loc)
        return (
          <PersonRow key={id} id={id} sub={`${isOnline(id) ? 'online' : 'offline'}${loc ? ` · ${away !== null ? awayText(away) : 'on the map'}` : ''}`}>
            <div className="btn-row tight">
              {loc && (
                <button className="icon-btn" title="Show on map" onClick={() => reveal(loc.latitude, loc.longitude, 17, true)}>
                  <Icon name="locate" />
                </button>
              )}
              <button className="icon-btn" title="Message" onClick={() => go(`chat/${id}`)}>
                <Icon name="chat" />
              </button>
            </div>
          </PersonRow>
        )
      })}

      {outgoing.length > 0 && (
        <>
          <div className="section">Sent</div>
          {outgoing.map((id) => (
            <PersonRow key={id} id={id}>
              <FriendButton id={id} />
            </PersonRow>
          ))}
        </>
      )}

      <div className="section">People around here</div>
      <input className="input" placeholder="Search by name or neighbourhood" value={query} onChange={(e) => setQuery(e.target.value)} />
      {others.map((p) => (
        <PersonRow key={p.id} id={p.id} sub={[p.neighbourhood, nearest.has(p.id) && `pins ${awayText(nearest.get(p.id)!)}`].filter(Boolean).join(' · ')}>
          <FriendButton id={p.id} />
        </PersonRow>
      ))}
    </Panel>
  )
}

//
// Settings.
//

const MUTABLE: [string, string][] = [
  ['reply', 'Replies to your pins'],
  ['saved_reply', 'Replies on pins you saved'],
  ['thread_reply', 'Replies in threads you joined'],
  ['interest', 'People interested in your pins'],
  ['save', 'People saving your pins'],
  ['resolved', 'Pins you follow getting resolved'],
  ['friend_request', 'Friend requests'],
  ['friend_accept', 'Friend requests accepted'],
  ['friend_post', 'Friends pinning something new'],
  ['mention', 'Someone mentioning you'],
]

function ThemeSwatch({ id }: { id: string }) {
  if (id === 'auto') {
    // Half Day, half Night.
    return (
      <span className="swatch sun">
        <ThemeSwatch id="day" />
        <ThemeSwatch id="night" />
      </span>
    )
  }
  const t = mapThemes[id]
  return (
    <span className="swatch" style={{ background: t.land }}>
      <i style={{ background: t.water }} />
      <i style={{ background: t.park }} />
      <i style={{ background: t.road.primary, boxShadow: t.casing ? `0 0 0 1px ${t.casing}` : undefined }} />
    </span>
  )
}

function ThemeGrid() {
  return (
    <div className="theme-grid">
      {THEMES.map((t) => (
        <button key={t.id} className={UI.theme === t.id ? 'theme-card on' : 'theme-card'} onClick={() => applyTheme(t.id)}>
          <ThemeSwatch id={t.id} />
          <strong>{t.name}</strong>
          <span className="muted small">{t.note}</span>
        </button>
      ))}
    </div>
  )
}

function SettingsView() {
  const [newEmail, setNewEmail] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function saveEmail() {
    if (!newEmail?.includes('@')) return
    if (await changeEmail(newEmail.trim())) {
      setNewEmail(null)
      toast('Check both inboxes to confirm the change')
    } else failed("Couldn't change your email")
  }

  async function removeAccount() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    if (await deleteAccount()) {
      go('')
      toast('Your account and everything in it is gone')
    } else failed("Couldn't delete your account")
  }

  async function toggleAlerts() {
    let on = !UI.alerts
    if (on && typeof Notification !== 'undefined' && Notification.permission !== 'granted') on = (await Notification.requestPermission()) === 'granted'
    store('aroundhere.alerts', on ? 'on' : 'off')
    ui({ alerts: on })
  }

  return (
    <Panel title="Settings" icon={<Icon name="sliders" />} className="tall">
      <div className="section">Map style</div>
      <ThemeGrid />
      <label className="check">
        <input
          type="checkbox"
          checked={UI.sounds}
          onChange={(e) => {
            store('aroundhere.sounds', e.target.checked ? 'on' : 'off')
            ui({ sounds: e.target.checked })
            if (e.target.checked) play('sting')
          }}
        />
        <span>Sounds (each style has its own)</span>
      </label>

      {S.userId && (
        <>
          <div className="section">Notifications</div>
          <label className="check">
            <input type="checkbox" checked={UI.alerts} onChange={toggleAlerts} disabled={typeof Notification === 'undefined'} />
            <span>Desktop alerts when the tab is in the background</span>
          </label>
          {MUTABLE.map(([kind, label]) => (
            <label key={kind} className="check">
              <input
                type="checkbox"
                checked={!S.mutedKinds.includes(kind)}
                onChange={(e) => setMutedKinds(e.target.checked ? S.mutedKinds.filter((k) => k !== kind) : [...S.mutedKinds, kind])}
              />
              <span>{label}</span>
            </label>
          ))}

          <div className="section">Account</div>
          {newEmail === null ? (
            <div className="muted small">{S.session?.user.email}</div>
          ) : (
            <div className="composer">
              <input className="input" type="email" placeholder="New email" value={newEmail} autoFocus onChange={(e) => setNewEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveEmail()} />
              <button className="btn primary" onClick={saveEmail} disabled={!newEmail.includes('@')}>
                Save
              </button>
            </div>
          )}
          <div className="actions">
            {newEmail === null && (
              <button className="btn" onClick={() => setNewEmail('')}>
                Change email
              </button>
            )}
            <button className="btn" onClick={() => ui({ auth: 'new-password' })}>
              Change password
            </button>
            <button className="btn" onClick={signOut}>
              <Icon name="logout" size={16} /> Sign out
            </button>
          </div>
          {S.blocked.size > 0 && (
            <>
              <div className="section">Blocked</div>
              {[...S.blocked].map((id) => (
                <PersonRow key={id} id={id}>
                  <button className="btn small" onClick={() => unblock(id)}>
                    Unblock
                  </button>
                </PersonRow>
              ))}
            </>
          )}

          <div className="danger-zone">
            <button className={confirmDelete ? 'btn danger' : 'btn'} onClick={removeAccount} onBlur={() => setConfirmDelete(false)}>
              <Icon name="trash" size={16} /> {confirmDelete ? 'Delete everything, for good?' : 'Delete account'}
            </button>
            {confirmDelete && <p className="muted small">Your pins, replies, messages and friends go too. This can't be undone.</p>}
          </div>
        </>
      )}

      <div className="section">Keys</div>
      <div className="keys">
        {[
          ['/', 'Search and commands'],
          ['?', 'These keys'],
          ['N', 'New pin'],
          ['J K', 'Next, previous pin'],
          ['L', 'Where am I'],
          ['T', 'Next map style'],
          ['F', 'Friends'],
          ['I', 'Inbox'],
          ['+ −', 'Zoom'],
          ['← → ↑ ↓', 'Move the map'],
          ['Esc', 'Close'],
        ].map(([key, what]) => (
          <div key={key}>
            <kbd>{key}</kbd>
            <span>{what}</span>
          </div>
        ))}
      </div>
    </Panel>
  )
}

//
// A new pin.
//

function ComposeView() {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [flair, setFlair] = useState<Flair>('general')
  const [starts, setStarts] = useState('')
  const [attached, setAttached] = useState<{ file: File; url: string }[]>([])
  const [busy, setBusy] = useState(false)

  // Preview URLs live as long as the attachment; the last ones go with the form.
  const latest = useRef(attached)
  useEffect(() => {
    latest.current = attached
  }, [attached])
  useEffect(() => () => latest.current.forEach((a) => URL.revokeObjectURL(a.url)), [])

  function attach(list: FileList | null) {
    const added = Array.from(list ?? []).map((file) => ({ file, url: URL.createObjectURL(file) }))
    setAttached([...attached, ...added].slice(0, 6))
  }

  function detach(index: number) {
    URL.revokeObjectURL(attached[index].url)
    setAttached(attached.filter((_, i) => i !== index))
  }

  if (!S.userId) return <SignInFirst title="New pin" icon="plus" why="Join to pin what's happening around you." />
  const draft = UI.draft ?? viewCenter()
  const street = map ? nearestStreet(map, draft.longitude, draft.latitude) : ''

  async function submit() {
    if (!title.trim() || busy) return
    setBusy(true)
    const post = await createPost({
      title: title.trim(),
      description: body.trim(),
      flair,
      startsAt: fromLocalInput(starts),
      latitude: draft.latitude,
      longitude: draft.longitude,
      files: attached.map((a) => a.file),
    })
    setBusy(false)
    if (!post) {
      failed("Couldn't post")
      return
    }
    go(`pin/${post.id}`)
    celebrate('Pin posted', 'Neighbours can see it now')
  }

  return (
    <Panel
      title="New pin"
      icon={<Icon name="plus" />}
      className="compose"
      foot={
        <div className="btn-row">
          <button className="btn" onClick={() => go('')}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={!title.trim() || busy}>
            {busy ? 'Posting…' : 'Post pin'}
          </button>
        </div>
      }
    >
      <div className="where">
        <Icon name="pin" size={16} />
        <div>
          <strong>{street ? `Near ${street}` : 'At the red marker'}</strong>
          <div className="muted small">{narrow() ? 'Tap' : 'Click'} the map to move it</div>
        </div>
        <button className="btn small" onClick={async () => {
          const here = await watchHere()
          if (!here) return toast("Can't find you")
          ui({ draft: { latitude: here.latitude, longitude: here.longitude } })
          reveal(here.latitude, here.longitude, Math.max(map?.zoom ?? 16, 16.5))
        }}>
          <Icon name="locate" size={14} /> Me
        </button>
      </div>

      <FlairPick value={flair} onPick={setFlair} />

      <input className="input title-input" placeholder="What's happening?" value={title} maxLength={120} autoFocus={!narrow()} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="input" rows={5} placeholder="Details: where exactly, who should come, what to bring…" value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} />
      <label className="field when-field">
        <span>
          When <em className="muted">· optional, for things that happen at a time</em>
        </span>
        <input className="input" type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} />
      </label>

      <label className="drop">
        <input type="file" accept="image/*,video/*" multiple onChange={(e) => attach(e.target.files)} />
        <Icon name="image" size={18} /> {attached.length ? `${plural(attached.length, 'file')} attached` : 'Add photos or video'}
      </label>
      {attached.length > 0 && (
        <div className="thumbs">
          {attached.map((a, i) => (
            <button key={a.url} title="Remove" onClick={() => detach(i)}>
              {a.file.type.startsWith('video/') ? <video src={a.url} muted /> : <img src={a.url} alt="" />}
              <Icon name="close" size={14} />
            </button>
          ))}
        </div>
      )}
    </Panel>
  )
}

//
// Accounts.
//

const AUTH_TITLES: Record<AuthMode, string> = {
  signin: 'Welcome back',
  signup: 'Join your neighbourhood',
  code: 'Sign in with a code',
  reset: 'Reset your password',
  'new-password': 'Choose a new password',
}

function AuthView() {
  const [mode, setMode] = useState<AuthMode>(UI.auth ?? 'signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [providers, setProviders] = useState<Record<string, boolean>>({})

  useEffect(() => {
    // Only offer the social logins the auth server actually has set up.
    fetch(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: supabaseKey } })
      .then((r) => r.json())
      .then((settings) => setProviders(settings.external ?? {}))
      .catch(() => {})
  }, [])

  const close = () => ui({ auth: null })

  function switchTo(next: AuthMode) {
    setMode(next)
    setPassword('')
    setCode('')
    setCodeSent(false)
    setMessage('')
  }

  const trimmed = email.trim()
  const usesCode = mode === 'code' || mode === 'reset'
  const valid =
    mode === 'signup' ? !!name.trim() && trimmed.includes('@') && password.length >= 6
    : mode === 'signin' ? trimmed.includes('@') && !!password
    : mode === 'new-password' ? password.length >= 6
    : codeSent ? code.trim().length === 6 : trimmed.includes('@')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setMessage('')
    const done = (ok: string | null) => {
      setBusy(false)
      if (ok !== null) setMessage(ok)
    }

    if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({ email: trimmed, password, options: { data: { display_name: name.trim() } } })
      if (error) return done(error.message)
      if (!data.session) return done('Check your email to confirm your account, then sign in.')
      done(null)
      close()
      toast(`Welcome, ${name.trim().split(' ')[0]}!`)
      return
    }

    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email: trimmed, password })
      if (error) return done(error.message === 'Invalid login credentials' ? 'That email and password don’t match.' : error.message)
      done(null)
      close()
      toast('Signed in')
      return
    }

    if (mode === 'new-password') {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) return done(error.message)
      done(null)
      close()
      toast('Password updated')
      return
    }

    // Codes: email a 6-digit code, then verify it.
    if (!codeSent) {
      const { error } = mode === 'reset'
        ? await supabase.auth.resetPasswordForEmail(trimmed)
        : await supabase.auth.signInWithOtp({ email: trimmed, options: { shouldCreateUser: false } })
      if (error) return done(error.code === 'otp_disabled' ? 'No account with that email yet.' : error.message)
      setCodeSent(true)
      return done(`We emailed a 6-digit code to ${trimmed}.`)
    }

    const { error } = await supabase.auth.verifyOtp({ email: trimmed, token: code.trim(), type: mode === 'reset' ? 'recovery' : 'email' })
    if (error) return done(error.message)
    done(null)
    if (mode === 'reset') {
      switchTo('new-password')
      return
    }
    close()
    toast('Signed in')
  }

  const social = (['google', 'github'] as const).filter((p) => providers[p])
  let submitLabel = 'Email me a code'
  if (mode === 'signup') submitLabel = 'Create account'
  else if (mode === 'signin') submitLabel = 'Sign in'
  else if (mode === 'new-password') submitLabel = 'Save password'
  else if (codeSent) submitLabel = mode === 'reset' ? 'Verify code' : 'Sign in'

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <form className="panel modal auth" onSubmit={submit}>
        <button type="button" className="icon-btn corner" onClick={close} aria-label="Close">
          <Icon name="close" />
        </button>
        <div className="brand-mark big">
          <Icon name="pin" size={26} />
        </div>
        <h1>{AUTH_TITLES[mode]}</h1>

        {(mode === 'signin' || mode === 'signup') && (
          <div className="tabs">
            <button type="button" className={mode === 'signin' ? 'tab on' : 'tab'} onClick={() => switchTo('signin')}>
              Sign in
            </button>
            <button type="button" className={mode === 'signup' ? 'tab on' : 'tab'} onClick={() => switchTo('signup')}>
              Create account
            </button>
          </div>
        )}

        {mode === 'signup' && (
          <label className="field">
            <span>Your name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="How neighbours will see you" autoComplete="nickname" maxLength={50} autoFocus />
          </label>
        )}
        {mode !== 'new-password' && (
          <label className="field">
            <span>Email</span>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={codeSent} autoComplete="email" autoFocus={mode !== 'signup'} />
          </label>
        )}
        {(mode === 'signin' || mode === 'signup' || mode === 'new-password') && (
          <label className="field">
            <span>
              {mode === 'new-password' ? 'New password' : 'Password'}
              {mode !== 'signin' && <em className="muted"> · at least 6 characters</em>}
            </span>
            <div className="input-wrap">
              <input
                className="input"
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                autoFocus={mode === 'new-password'}
              />
              <button type="button" className="link reveal" onClick={() => setShow(!show)}>
                {show ? 'hide' : 'show'}
              </button>
            </div>
          </label>
        )}
        {usesCode && codeSent && (
          <label className="field">
            <span>Code</span>
            <input className="input code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="••••••" autoFocus />
          </label>
        )}

        {message && <p className="banner" role="alert">{message}</p>}

        <button type="submit" className="btn primary wide" disabled={!valid || busy}>
          {busy ? 'One moment…' : submitLabel}
        </button>

        <div className="auth-links">
          {mode === 'signin' && (
            <>
              <button type="button" className="link" onClick={() => switchTo('reset')}>
                Forgot password?
              </button>
              <button type="button" className="link" onClick={() => switchTo('code')}>
                Email me a sign-in code
              </button>
            </>
          )}
          {usesCode && (
            <button type="button" className="link" onClick={() => switchTo('signin')}>
              Back to sign in
            </button>
          )}
        </div>

        {social.length > 0 && (mode === 'signin' || mode === 'signup') && (
          <div className="stack">
            <div className="or">or</div>
            {social.map((p) => (
              <button key={p} type="button" className="btn wide" onClick={() => supabase.auth.signInWithOAuth({ provider: p, options: { redirectTo: window.location.origin } })}>
                Continue with {p === 'google' ? 'Google' : 'GitHub'}
              </button>
            ))}
          </div>
        )}
      </form>
    </div>
  )
}

//
// Search and commands.
//

type Command = { key: string; icon: ReactNode; label: string; hint?: string; run: () => void }

// How well a query matches a short text: its letters in order, scoring runs of
// letters and word starts, so "rndl" finds "Rundle". Every place the first letter
// appears is tried as a start, and the best one counts. 0 is no match.
function fuzzy(query: string, text: string | null | undefined) {
  if (!query) return 1
  if (!text) return 0
  const t = text.toLowerCase()
  if (t.includes(query)) return 100 + query.length
  const q = query.replace(/ /g, '')
  let best = 0

  for (let start = t.indexOf(q[0]); start >= 0; start = t.indexOf(q[0], start + 1)) {
    let score = 0
    let at = start
    let run = 0
    for (let i = 0; i < q.length; i++) {
      const found = t.indexOf(q[i], at)
      if (found < 0) {
        score = 0
        break
      }
      run = i > 0 && found === at ? run + 1 : 1
      score += 1 + run * 2 + (found === 0 || t[found - 1] === ' ' ? 5 : 0)
      at = found + 1
    }
    best = Math.max(best, score)
  }
  // Letters scattered all over the text aren't a match anyone meant.
  return best >= q.length * 5 ? best : 0
}

// A query's words, each matched on its own against any of an item's short texts
// (fuzzy) or long texts (plainly), in any order: "coffee ann" finds Ann's coffee pin.
function score(words: string[], short: (string | null | undefined)[], long: (string | null | undefined)[] = []) {
  let total = 0
  for (const word of words) {
    let best = 0
    for (const text of short) best = Math.max(best, fuzzy(word, text))
    for (const text of long) if (text?.toLowerCase().includes(word)) best = Math.max(best, 10)
    if (best === 0) return 0
    total += best
  }
  return total
}

function paletteItems(query: string): { group: string; items: Command[] }[] {
  const q = query.trim().toLowerCase()
  const words = q.split(/\s+/).filter(Boolean)
  const ranked = <T,>(items: T[], score: (item: T) => number) =>
    items.map((item) => ({ item, score: score(item) })).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).map((r) => r.item)

  const commands: Command[] = [
    { key: 'new', icon: <Icon name="plus" />, label: 'New pin', hint: 'N', run: startCompose },
    { key: 'locate', icon: <Icon name="locate" />, label: 'Where am I', hint: 'L', run: locate },
    { key: 'friends', icon: <Icon name="users" />, label: 'Friends', hint: 'F', run: () => !needAccount('signin') && go('friends') },
    { key: 'inbox', icon: <Icon name="bell" />, label: 'Inbox', hint: 'I', run: () => !needAccount('signin') && go('inbox') },
    { key: 'settings', icon: <Icon name="sliders" />, label: 'Settings', run: () => go('settings') },
    ...(S.userId
      ? [
          { key: 'me', icon: <Icon name="user" />, label: 'My profile', run: () => go(`user/${S.userId}`) },
          { key: 'share', icon: <Icon name="pin" />, label: S.sharing ? 'Stop sharing my location' : 'Share my location with friends', run: toggleSharing },
          { key: 'out', icon: <Icon name="logout" />, label: 'Sign out', run: signOut },
        ]
      : [
          { key: 'in', icon: <Icon name="user" />, label: 'Sign in', run: () => ui({ auth: 'signin' }) },
          { key: 'up', icon: <Icon name="userplus" />, label: 'Create account', run: () => ui({ auth: 'signup' }) },
        ]),
    ...THEMES.map((t) => ({
      key: `theme-${t.id}`, icon: <ThemeSwatch id={t.id} />, label: `Map style: ${t.name}`,
      hint: UI.theme === t.id ? 'current' : undefined, run: () => applyTheme(t.id),
    })),
  ]
  const shownCommands = q ? ranked(commands, (c) => score(words, [c.label])) : commands

  const posts = S.posts.filter((p) => !(p.author_id && S.blocked.has(p.author_id)))
  const pins = (q ? ranked(posts, (p) => score(words, [p.title, p.author_name, flairs[p.flair]?.label], [p.description])) : posts)
    .slice(0, q ? 8 : 5)
    .map((p) => ({ key: p.id, icon: <Blip flair={p.flair} size={22} />, label: p.title, hint: p.resolved_at ? 'resolved' : ago(p.created_at), run: () => openPin(p) }))

  const people = q
    ? ranked([...S.profiles.values()], (p) => score(words, [p.display_name], [p.neighbourhood]))
        .slice(0, 6)
        .map((p) => ({ key: p.id, icon: <Avatar id={p.id} size={22} />, label: p.display_name, hint: p.neighbourhood ?? undefined, run: () => go(`user/${p.id}`) }))
    : []

  const places = q && map
    ? findPlaces(map, q).map((p) => ({
        key: `place:${p.kind}:${p.name}`, icon: <Icon name={p.kind === 'Street' ? 'map' : 'pin'} />, label: p.name, hint: p.kind,
        run: () => reveal(p.lat, p.lng, p.kind === 'Area' ? 15 : 17, true),
      }))
    : []

  return [
    { group: q ? 'Pins' : 'Recent pins', items: pins },
    { group: 'People', items: people },
    { group: 'On the map', items: places },
    { group: 'Commands', items: shownCommands },
  ].filter((g) => g.items.length)
}

function Palette() {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const groups = paletteItems(query)
  const flat = groups.flatMap((g) => g.items)
  const at = Math.min(index, flat.length - 1)

  const close = () => ui({ palette: false })
  const run = (c: Command | undefined) => {
    if (!c) return
    close()
    c.run()
  }

  useEffect(() => {
    listRef.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' })
  }, [at])

  let n = -1
  return (
    <div className="modal-back top" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="panel palette">
        <div className="palette-input">
          <Icon name="search" />
          <input
            autoFocus
            value={query}
            placeholder="Search pins, people, or type a command…"
            onChange={(e) => {
              setQuery(e.target.value)
              setIndex(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIndex((at + 1) % Math.max(flat.length, 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIndex((at - 1 + flat.length) % Math.max(flat.length, 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                run(flat[at])
              } else if (e.key === 'Escape') {
                e.preventDefault()
                close()
              }
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="palette-list" ref={listRef} role="listbox" aria-label="Results">
          {flat.length === 0 && <div className="muted pad">Nothing matches “{query}”.</div>}
          {groups.map((g) => (
            <div key={g.group}>
              <div className="section">{g.group}</div>
              {g.items.map((c) => {
                n++
                const mine = n
                return (
                  <button
                    key={c.key}
                    role="option"
                    aria-selected={mine === at}
                    className={mine === at ? 'palette-item on' : 'palette-item'}
                    onMouseMove={() => mine !== at && setIndex(mine)}
                    onClick={() => run(c)}
                  >
                    {c.icon}
                    <span className="clip">{c.label}</span>
                    {c.hint && <kbd>{c.hint}</kbd>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

//
// The legend.
//

// What everything on the map means, in the current style.
function Legend() {
  return (
    <div className="panel legend">
      <div className="section">Pins</div>
      <div className="legend-grid">
        {(Object.keys(flairs) as Flair[]).map((f) => (
          <div key={f}>
            <Blip flair={f} size={22} />
            <span>{flairs[f].label}</span>
          </div>
        ))}
        <div>
          <span className="avatar" style={{ width: 22, height: 22, fontSize: 9, background: '#2f9e6b' }}>
            FR
          </span>
          <span>A friend</span>
        </div>
      </div>
      <div className="section">Places</div>
      <div className="legend-grid">
        {LEGEND.map(([icon, label]) => (
          <div key={icon}>
            <span className="blip" style={{ width: 18, height: 18, background: poiColor(icon) }}>
              <Icon name={icon} size={11} />
            </span>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

//
// The hover card that follows a pin on the map.
//

function HoverCard({ cardRef }: { cardRef: React.RefObject<HTMLDivElement | null> }) {
  const id = UI.hover
  if (narrow() || !id) return null

  if (id.startsWith('person:')) {
    const userId = id.slice('person:'.length)
    const loc = locationOf(userId)
    const away = fromMe(loc)
    return (
      <div className="hover-card person-card" ref={cardRef}>
        <Avatar id={userId} size={32} dot />
        <div>
          <strong>{nameOf(userId)}</strong>
          <div className="muted small">
            {loc && `here ${since(loc.updated_at)}`}
            {away !== null && ` · ${awayText(away)}`}
          </div>
          <div className="muted small">Click to message</div>
        </div>
      </div>
    )
  }

  const posts = S.posts.filter((p) => placeKey(p) === id)
  if (!posts.length || (UI.route.kind === 'pin' && posts.some((p) => p.id === UI.route.id))) return null
  const post = posts[0]
  const replies = stats().replies.get(post.id) ?? 0
  const photo = stats().photo.get(post.id)

  return (
    <div className="hover-card" ref={cardRef}>
      <div className="row-top">
        <strong className="clip">{post.title}</strong>
      </div>
      <div className="muted small">
        {nameOf(post.author_id, post.author_name)} · {ago(post.created_at)}
        {replies > 0 && ` · ${plural(replies, 'reply', 'replies')}`}
      </div>
      {photo && <img className="hover-photo" src={photo.url} alt="" />}
      {post.description && <div className="hover-body">{post.description}</div>}
      {posts.length > 1 && <div className="muted small">+ {plural(posts.length - 1, 'more thread')} here</div>}
    </div>
  )
}

//
// The app.
//

export default function App() {
  useStore()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  // A clock: "5m ago", "in 3h" and the map's live and stale cues move on by
  // themselves, even when nothing else happens.
  useEffect(() => {
    const tick = window.setInterval(changed, 30000)
    return () => window.clearInterval(tick)
  }, [])

  useEffect(() => {
    start()
    // If location was allowed before, show where you are without asking again.
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((p) => {
        if (p.state === 'granted') watchHere()
      })
      .catch(() => {})
    setIncomingHandler((title, body, route) => {
      if (document.visibilityState === 'visible') {
        play('tick')
        toast(body ? `${title}: ${body}` : title)
        return
      }
      if (!UI.alerts || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
      const alert = new Notification(title, { body, tag: route })
      alert.onclick = () => {
        window.focus()
        go(route)
        alert.close()
      }
    })
  }, [])

  useEffect(() => {
    const m = createMap(canvasRef.current!, UI.view.lng, UI.view.lat, UI.view.zoom, shown())
    map = m
    let saveTimer = 0
    let lastCenter = center(m)

    m.onClick = (marker, lng, lat) => {
      if (UI.route.kind === 'new') {
        ui({ draft: { latitude: lat, longitude: lng } })
        return
      }
      if (!marker) {
        // Tapping empty map on a phone puts the map first.
        if (narrow() && (UI.route.kind || UI.feed)) {
          ui({ feed: false })
          go('')
        }
        return
      }
      if (marker.kind === 'pin') {
        const posts = S.posts.filter((p) => placeKey(p) === marker.id)
        go(posts.length === 1 ? `pin/${posts[0].id}` : `place/${marker.id}`)
        reveal(posts[0].latitude, posts[0].longitude)
      } else if (marker.kind === 'person') {
        go(`chat/${marker.id.slice('person:'.length)}`)
      } else if (marker.kind === 'me' && S.userId) {
        go(`user/${S.userId}`)
      }
    }
    // Panels that name the nearest street redraw once the tiles around them arrive.
    let tileTimer = 0
    m.onTile = () => {
      window.clearTimeout(tileTimer)
      tileTimer = window.setTimeout(() => {
        if (['pin', 'place', 'new'].includes(UI.route.kind)) changed()
      }, 300)
    }
    m.onUserMove = () => {
      if (UI.follow) ui({ follow: false })
    }
    m.onHover = (marker) => ui({ hover: marker && marker.kind !== 'me' ? marker.id : null })
    m.onFrame = () => {
      // Keep the hover card glued to its pin, without a React render per frame.
      const card = cardRef.current
      const marker = m.markers.find((x) => x.id === UI.hover)
      if (card && marker) {
        const p = project(m, marker.x, marker.y)
        const lift = marker.kind === 'pin' && m.theme.blip === 'pin' ? 52 : 26
        card.style.transform = `translate(${Math.round(p.x - card.offsetWidth / 2)}px, ${Math.round(p.y - lift - card.offsetHeight)}px)`
      }

      // Remember the view, and re-sort "Around", once the camera has stopped moving.
      // Frames keep coming while things pulse, so compare with the last frame.
      const c = center(m)
      if (c.lat !== lastCenter.lat || c.lng !== lastCenter.lng || c.zoom !== lastCenter.zoom) {
        lastCenter = c
        window.clearTimeout(saveTimer)
        saveTimer = window.setTimeout(() => {
          store('aroundhere.view', JSON.stringify({ lat: c.lat, lng: c.lng, zoom: c.zoom }))
          ui({ view: { lat: c.lat, lng: c.lng, zoom: c.zoom } })
        }, 250)
      }
    }

    return () => {
      destroyMap(m)
      if (map === m) map = null
    }
  }, [])

  // Everything on the map is rebuilt from the store after each render; it's cheap.
  const posts = visiblePosts()
  useEffect(() => {
    if (!map) return
    map.draftMode = UI.route.kind === 'new'
    // "Sun" turns to Night at dusk by itself (the clock redraws every minute).
    if (map.themeName !== shown()) {
      setTheme(map, shown())
      paintChrome(shown())
    }
    setMarkers(map, buildMarkers(posts))
    setRadar(map, radarPlace())
    map.canvas.style.cursor = map.draftMode ? 'crosshair' : 'grab'
    keepFollowing()
    revealLinked()
  })

  // Keys: the map is the main surface, so single letters drive it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        ui({ palette: !UI.palette })
        return
      }
      if (e.key === 'Escape') {
        if (UI.palette) ui({ palette: false })
        else if (UI.auth) ui({ auth: null })
        else if (UI.legend) ui({ legend: false })
        else if (UI.route.kind) go('')
        return
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey || UI.palette || UI.auth) return

      const k = e.key.toLowerCase()
      if (k === '/') {
        e.preventDefault()
        ui({ palette: true })
      } else if (k === '?') go('settings')
      else if (k === 'n') startCompose()
      else if (k === 'l') locate()
      else if (k === 't') applyTheme(THEMES[(THEMES.findIndex((t) => t.id === UI.theme) + 1) % THEMES.length].id)
      else if (k === 'f') {
        if (!needAccount('signin')) go('friends')
      } else if (k === 'i') {
        if (!needAccount('signin')) go('inbox')
      }
      else if (k === 'j' || k === 'k') {
        // Step through the feed, newest or nearest first, like a list of messages.
        const rows = sortedFeed(visiblePosts())
        const at = rows.findIndex((r) => r.post.id === UI.route.id)
        const next = rows[at === -1 ? 0 : Math.max(0, Math.min(rows.length - 1, at + (k === 'j' ? 1 : -1)))]
        if (next) openPin(next.post)
      } else if (k.startsWith('arrow') && map && (document.activeElement === document.body || document.activeElement === map.canvas)) {
        // Only when nothing else has the focus: arrows still scroll a panel you're in.
        const step = e.shiftKey ? 300 : 100
        glideBy(map, k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0, k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0)
      } else if ((k === '=' || k === '+') && map) zoomBy(map, 1)
      else if (k === '-' && map) zoomBy(map, -1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const unread = visibleNotifications().filter((n) => !n.read_at).length + unreadMessages().length
  const incomingRequests = S.friendships.filter((f) => !f.accepted_at && f.addressee === S.userId).length

  useEffect(() => {
    document.title = unread ? `(${unread}) AroundHere` : 'AroundHere'
  }, [unread])

  const route = UI.route
  let detail: ReactNode = null
  if (route.kind === 'pin') {
    const post = S.posts.find((p) => p.id === route.id)
    detail = post ? <PostView key={post.id} post={post} /> : <Missing what="pin" />
  } else if (route.kind === 'place') detail = <PlaceView key={route.id} id={route.id} />
  else if (route.kind === 'user') detail = <ProfileView key={route.id} id={route.id} />
  else if (route.kind === 'chat') detail = <ChatView key={route.id} id={route.id} />
  else if (route.kind === 'inbox') detail = <InboxView />
  else if (route.kind === 'friends') detail = <FriendsView />
  else if (route.kind === 'settings') detail = <SettingsView />
  else if (route.kind === 'new') detail = <ComposeView />

  const me = S.userId
  const sheetUp = !!detail || UI.feed

  return (
    <div className={`app${detail ? ' has-detail' : ''}${UI.feed ? ' has-feed' : ''}${sheetUp ? ' sheet-up' : ''}${UI.sheetFull ? ' sheet-full' : ''}`}>
      <canvas ref={canvasRef} className="map" role="application" aria-label="Map of pins and friends nearby. Drag to move, scroll or pinch to zoom." />
      <div className="fx" aria-hidden />

      <header className="topbar">
        <button className="brand" onClick={() => ui({ feed: !UI.feed })} title="Toggle the list">
          <span className="brand-mark">
            <Icon name="pin" size={18} />
          </span>
          <span className="brand-name">AroundHere</span>
        </button>
        <button className="search" onClick={() => ui({ palette: true })}>
          <Icon name="search" size={16} />
          <span>Search pins, people, commands</span>
          <kbd>/</kbd>
        </button>
        <div className="spacer" />
        <button className="icon-btn bar" onClick={() => go(route.kind === 'settings' ? '' : 'settings')} title="Map style and settings" aria-label="Settings">
          <Icon name="palette" />
        </button>
        {me ? (
          <>
            <button className="icon-btn bar" onClick={() => go(route.kind === 'friends' ? '' : 'friends')} title="Friends (F)" aria-label="Friends">
              <Icon name="users" />
              {incomingRequests > 0 && <b className="badge">{incomingRequests}</b>}
            </button>
            <button className="icon-btn bar hide-narrow" onClick={() => go(route.kind === 'inbox' ? '' : 'inbox')} title="Inbox (I)" aria-label="Inbox">
              <Icon name="bell" />
              {unread > 0 && <b className="badge">{unread > 99 ? '99+' : unread}</b>}
            </button>
            <button className="me-btn hide-narrow" onClick={() => go(`user/${me}`)} title="Your profile">
              <Avatar id={me} size={30} />
            </button>
          </>
        ) : (
          <button className="btn primary" onClick={() => ui({ auth: 'signin' })}>
            Sign in
          </button>
        )}
      </header>

      {UI.feed && <Feed />}
      {detail}

      <div className="map-tools">
        <button className="icon-btn tool" onClick={() => map && zoomBy(map, 1)} aria-label="Zoom in" title="Zoom in (+)">
          <Icon name="plus" />
        </button>
        <button className="icon-btn tool" onClick={() => map && zoomBy(map, -1)} aria-label="Zoom out" title="Zoom out (−)">
          <Icon name="minus" />
        </button>
        <button className={UI.follow ? 'icon-btn tool follow' : S.here ? 'icon-btn tool on' : 'icon-btn tool'} onClick={locate} aria-label="Where am I" title="Where am I (L)">
          <Icon name="locate" />
        </button>
        <button className={UI.legend ? 'icon-btn tool on' : 'icon-btn tool'} onClick={() => ui({ legend: !UI.legend })} aria-label="Legend" title="What the blips mean">
          <Icon name="info" />
        </button>
      </div>
      {UI.legend && <Legend />}

      {route.kind !== 'new' && (
        <button className="fab hide-narrow" onClick={startCompose} title="New pin (N)">
          <Icon name="plus" size={20} /> Pin something
        </button>
      )}
      {route.kind === 'new' && <div className="hint-bar">{narrow() ? 'Tap' : 'Click'} the map to place your pin</div>}

      <nav className="tabbar">
        <button className={!detail && !UI.feed ? 'on' : ''} onClick={() => { ui({ feed: false }); go('') }}>
          <Icon name="map" />
          <span>Map</span>
        </button>
        <button className={!detail && UI.feed ? 'on' : ''} onClick={() => { ui({ feed: true }); go('') }}>
          <Icon name="list" />
          <span>Feed</span>
        </button>
        <button className="post" onClick={startCompose} aria-label="New pin">
          <Icon name="plus" size={26} />
        </button>
        <button className={route.kind === 'inbox' || route.kind === 'chat' ? 'on' : ''} onClick={() => !needAccount('signin') && go('inbox')}>
          <Icon name="bell" />
          <span>Inbox</span>
          {unread > 0 && <b className="badge">{unread}</b>}
        </button>
        <button className={route.kind === 'user' && route.id === me ? 'on' : route.kind === 'friends' ? 'on' : ''} onClick={() => (me ? go(`user/${me}`) : needAccount('signin'))}>
          <Icon name="user" />
          <span>{me ? 'Me' : 'Sign in'}</span>
          {incomingRequests > 0 && <b className="badge">{incomingRequests}</b>}
        </button>
      </nav>

      <div className="credit">
        © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> · OpenFreeMap
      </div>
      <HoverCard cardRef={cardRef} />
      {UI.banner && (
        <div className="banner-big" role="status" key={UI.banner.title + UI.banner.sub}>
          <strong>{UI.banner.title}</strong>
          <span>{UI.banner.sub}</span>
        </div>
      )}
      {UI.toast && (
        <div className="toast" role="status">
          {UI.toast}
        </div>
      )}
      {UI.palette && <Palette />}
      {UI.auth && <AuthView key={UI.auth} />}
    </div>
  )
}
