// Everything the app knows, in one place.
//
// A neighbourhood is small, so the whole public picture (pins, replies,
// people) is loaded once and kept live over realtime. The signed-in user's
// private rows (inbox, friends, saved pins, blocks) load on sign-in. Actions
// below write to Supabase and then to the store; changed() re-renders the UI.
// At the bottom: where I am, sharing it with friends, and telling them I'm around.
//
// Privacy rule for realtime: every client hears every DELETE with the row's
// key, whatever the row security says, so rows keyed by a person (locations,
// presence) are only ever updated, never deleted.

import { createClient, type Session } from '@supabase/supabase-js'
import { useSyncExternalStore } from 'react'

export const supabaseUrl: string = import.meta.env.VITE_SUPABASE_URL
export const supabaseKey: string = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
export const supabase = createClient(supabaseUrl, supabaseKey)

export type Flair = 'general' | 'food' | 'music' | 'sports' | 'event' | 'lost'

export type Post = {
  id: string
  title: string
  description: string
  latitude: number
  longitude: number
  created_at: string
  author_id: string | null
  author_name: string | null
  edited_at: string | null
  resolved_at: string | null
  place_id: string | null // posts within ~30 m share a place and one marker
  flair: Flair
  starts_at: string | null // when it happens, for events and meetups
}

export type Reply = {
  id: string
  post_id: string
  content: string
  created_at: string
  author_id: string | null
  author_name: string | null
}

export type Profile = {
  id: string
  display_name: string
  neighbourhood: string | null
  bio: string | null
  avatar_url: string | null
  created_at: string
}

export type Media = { id: string; post_id: string; media_type: 'image' | 'video'; url: string; created_at: string }
export type Interest = { user_id: string; post_id: string; created_at: string }
export type Like = { user_id: string; reply_id: string; created_at: string }
export type Saved = { post_id: string; created_at: string }
export type Revision = { id: string; title: string; description: string; replaced_at: string }

export type NotificationKind = 'reply' | 'saved_reply' | 'thread_reply' | 'save' | 'interest' | 'resolved' | 'friend_request' | 'friend_accept' | 'friend_post' | 'mention'

export type Notification = {
  id: string
  kind: NotificationKind
  actor_id: string | null
  actor_name: string | null
  post_id: string | null
  post_title: string | null
  preview: string | null
  created_at: string
  read_at: string | null
}

export type Message = { id: string; sender_id: string; recipient_id: string; body: string; created_at: string; read_at: string | null }
export type Friendship = { id: string; requester: string; addressee: string; created_at: string; accepted_at: string | null }
export type Location = { user_id: string; latitude: number; longitude: number; accuracy: number | null; heading: number | null; updated_at: string; shared: boolean }
export type Here = { latitude: number; longitude: number; accuracy: number; heading: number | null }
export type Presence = { user_id: string; device: string; here: boolean; seen_at: string }

export const flairs: Record<Flair, { label: string; icon: 'chat' | 'burger' | 'note' | 'ball' | 'star' | 'alert'; color: string }> = {
  general: { label: 'General', icon: 'chat', color: '#4f7cff' },
  food: { label: 'Food', icon: 'burger', color: '#f07b2d' },
  music: { label: 'Music', icon: 'note', color: '#a259ff' },
  sports: { label: 'Sports', icon: 'ball', color: '#16a974' },
  event: { label: 'Event', icon: 'star', color: '#e0a100' },
  lost: { label: 'Lost & found', icon: 'alert', color: '#ef4444' },
}

export const S = {
  ready: false,
  offline: false, // the server couldn't be reached; loading retries on its own
  authKnown: false, // true once the stored session has been read
  session: null as Session | null,
  userId: null as string | null,

  posts: [] as Post[], // newest first
  replies: [] as Reply[], // oldest first
  media: [] as Media[],
  interests: [] as Interest[],
  likes: [] as Like[],
  profiles: new Map<string, Profile>(),

  saved: [] as Saved[],
  notifications: [] as Notification[], // oldest first
  hasOlderNotifications: false,
  messages: [] as Message[], // oldest first
  mutedKinds: [] as string[],
  friendships: [] as Friendship[],
  blocked: new Set<string>(), // people I've blocked: their pins, replies and messages stay out of sight
  locations: new Map<string, Location>(),
  seen: new Map<string, Map<string, Presence>>(), // friends' devices and when each was last here

  here: null as Here | null,
  sharing: false,
  sharingUntil: null as number | null, // sharing for a while stops itself at this time
}

let version = 0
const listeners = new Set<() => void>()

export function changed() {
  version++
  for (const listener of listeners) listener()
}

export function useStore() {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => version,
  )
  return S
}

// Counts every view needs, worked out once per change instead of once per row.
type Stats = {
  replies: Map<string, number>
  interested: Map<string, number>
  active: Map<string, number> // last reply, or when it was posted
  unread: Set<string> // pins with unread notifications
  joined: Set<string> // pins I posted, saved, replied to or said I'm in
  photo: Map<string, Media> // each pin's first photo
  likes: Map<string, number> // hearts per reply
  liked: Set<string> // replies I've hearted
}

let statsVersion = -1
let statsCache: Stats

export function stats() {
  if (statsVersion === version) return statsCache
  const st: Stats = { replies: new Map(), interested: new Map(), active: new Map(), unread: new Set(), joined: new Set(), photo: new Map(), likes: new Map(), liked: new Set() }
  for (const like of S.likes) {
    if (S.blocked.has(like.user_id)) continue
    st.likes.set(like.reply_id, (st.likes.get(like.reply_id) ?? 0) + 1)
    if (like.user_id === S.userId) st.liked.add(like.reply_id)
  }
  for (const m of S.media) if (m.media_type === 'image' && !st.photo.has(m.post_id)) st.photo.set(m.post_id, m)
  for (const p of S.posts) {
    st.active.set(p.id, time(p.created_at))
    if (p.author_id && p.author_id === S.userId) st.joined.add(p.id)
  }
  for (const r of S.replies) {
    st.replies.set(r.post_id, (st.replies.get(r.post_id) ?? 0) + 1)
    st.active.set(r.post_id, Math.max(st.active.get(r.post_id) ?? 0, time(r.created_at)))
    if (r.author_id && r.author_id === S.userId) st.joined.add(r.post_id)
  }
  for (const i of S.interests) {
    st.interested.set(i.post_id, (st.interested.get(i.post_id) ?? 0) + 1)
    if (i.user_id === S.userId) st.joined.add(i.post_id)
  }
  for (const saved of S.saved) st.joined.add(saved.post_id)
  for (const n of S.notifications) if (!n.read_at && n.post_id) st.unread.add(n.post_id)
  statsCache = st
  statsVersion = version
  return st
}

// Where something went wrong, in words for a toast. Set by actions, taken (and
// cleared) by the UI, so an old failure is never reported for a new one.
let lastError = ''
function fail(what: string, error: { message: string } | null) {
  console.error(what, error)
  lastError = error?.message ?? what
  return false
}

export function takeError() {
  const error = lastError
  lastError = ''
  return error
}

//
// Small helpers the UI uses everywhere.
//

export const time = (iso: string) => new Date(iso).getTime()

export function nameOf(id: string | null, fallback: string | null = null) {
  if (!id) return fallback ?? 'Someone'
  return S.profiles.get(id)?.display_name ?? fallback ?? 'Neighbour'
}

export function friendshipWith(id: string) {
  return S.friendships.find((f) => (f.requester === id && f.addressee === S.userId) || (f.addressee === id && f.requester === S.userId)) ?? null
}

export function friendIds() {
  const ids: string[] = []
  for (const f of S.friendships) {
    if (!f.accepted_at) continue
    ids.push(f.requester === S.userId ? f.addressee : f.requester)
  }
  return ids
}

// What's waiting for me, not counting anyone I've blocked (their old messages
// and notifications stay out of sight, and out of the badges).
export function unreadMessages() {
  return S.messages.filter((m) => m.recipient_id === S.userId && !m.read_at && !S.blocked.has(m.sender_id))
}

export function visibleNotifications() {
  return S.notifications.filter((n) => !(n.actor_id && S.blocked.has(n.actor_id)))
}

// How far the server's clock is ahead of ours, learnt from our own check-ins.
let clockSkew = 0

function rememberPresence(p: Presence) {
  let devices = S.seen.get(p.user_id)
  if (!devices) S.seen.set(p.user_id, (devices = new Map()))
  devices.set(p.device, p)
}

// Online dots come from the presence table, which only friends can read.
export function isOnline(id: string) {
  if (id === S.userId) return document.visibilityState === 'visible'
  if (!friendIds().includes(id)) return false
  // Devices check in every minute; times are the server's, so compare on its clock.
  const now = Date.now() + clockSkew
  for (const p of S.seen.get(id)?.values() ?? []) if (p.here && now - time(p.seen_at) < 150000) return true
  return false
}

// A friend's shared position, unless it's too old to mean anything.
export function locationOf(id: string) {
  const loc = S.locations.get(id)
  return loc && Date.now() - time(loc.updated_at) < 12 * 3600000 ? loc : null
}

// Posts without a place (older ones) each count as their own place.
export const placeKey = (post: Post) => post.place_id ?? post.id

//
// Loading.
//

function upsert<T>(list: T[], row: T, same: (a: T, b: T) => boolean, atStart = false) {
  const index = list.findIndex((existing) => same(existing, row))
  if (index >= 0) list[index] = row
  else if (atStart) list.unshift(row)
  else list.push(row)
}

const byId = (a: { id: string }, b: { id: string }) => a.id === b.id
const sameInterest = (a: Interest, b: Interest) => a.user_id === b.user_id && a.post_id === b.post_id
const sameLike = (a: Like, b: Like) => a.user_id === b.user_id && a.reply_id === b.reply_id

let retrying = false // a reload is already waiting

async function loadPublic() {
  const [posts, replies, media, interests, profiles, likes] = await Promise.all([
    supabase.from('posts').select('*').order('created_at', { ascending: false }),
    supabase.from('replies').select('*').order('created_at', { ascending: true }),
    supabase.from('post_media').select('*').order('created_at', { ascending: true }),
    supabase.from('post_interest').select('user_id, post_id, created_at'),
    supabase.from('profiles').select('*'),
    supabase.from('reply_likes').select('user_id, reply_id, created_at'),
  ])

  if (posts.error) {
    fail('Loading pins', posts.error)
    S.offline = true
    changed()
    if (!retrying) {
      retrying = true
      setTimeout(() => {
        retrying = false
        loadPublic()
      }, 5000)
    }
    return
  }
  S.offline = false
  S.posts = posts.data ?? []
  S.replies = replies.data ?? []
  S.media = media.data ?? []
  S.interests = interests.data ?? []
  S.likes = likes.data ?? []
  S.profiles = new Map((profiles.data ?? []).map((p: Profile) => [p.id, p]))
  S.ready = true
  changed()
}

function subscribePublic() {
  supabase
    .channel('public-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, ({ new: row }) => {
      const post = row as Post
      const fresh = !S.posts.some((p) => p.id === post.id)
      upsert(S.posts, post, byId, true)
      changed()
      // Someone else pinned something close to me: worth a word. Worked out here,
      // so my position never leaves this device. (Friends hear via notifications.)
      const mine = post.author_id === S.userId
      const known = post.author_id && (S.blocked.has(post.author_id) || friendIds().includes(post.author_id))
      if (fresh && !mine && !known && S.here && distance(S.here.latitude, S.here.longitude, post.latitude, post.longitude) < 1500) {
        onIncoming('New nearby', post.title, `pin/${post.id}`)
      }
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'posts' }, ({ new: row }) => {
      upsert(S.posts, row as Post, byId, true)
      changed()
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'posts' }, ({ old }) => {
      forgetPost((old as Post).id)
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'replies' }, ({ new: row }) => {
      upsert(S.replies, row as Reply, byId)
      changed()
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'replies' }, ({ old }) => {
      S.replies = S.replies.filter((r) => r.id !== (old as Reply).id)
      changed()
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'post_media' }, ({ new: row }) => {
      upsert(S.media, row as Media, byId)
      changed()
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'post_interest' }, ({ new: row }) => {
      upsert(S.interests, row as Interest, sameInterest)
      changed()
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'post_interest' }, ({ old }) => {
      S.interests = S.interests.filter((i) => !sameInterest(i, old as Interest))
      changed()
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reply_likes' }, ({ new: row }) => {
      upsert(S.likes, row as Like, sameLike)
      changed()
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'reply_likes' }, ({ old }) => {
      S.likes = S.likes.filter((l) => !sameLike(l, old as Like))
      changed()
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, (payload) => {
      if (payload.eventType === 'DELETE') S.profiles.delete((payload.old as Profile).id)
      else S.profiles.set((payload.new as Profile).id, payload.new as Profile)
      changed()
    })
    .subscribe()
}

type Channel = ReturnType<typeof supabase.channel>
let privateChannel: Channel | null = null

// Something arrived for the signed-in user; the UI may raise a desktop alert.
let onIncoming: (title: string, body: string, route: string) => void = () => {}
export function setIncomingHandler(handler: typeof onIncoming) {
  onIncoming = handler
}

async function loadPrivate(userId: string, attempt = 0) {
  const results = await Promise.all([
    supabase.from('saved_posts').select('post_id, created_at'),
    supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(60),
    supabase.from('messages').select('*').order('created_at', { ascending: false }).limit(1000),
    supabase.from('notification_settings').select('muted_kinds').maybeSingle(),
    supabase.from('friendships').select('*'),
    supabase.from('locations').select('*'),
    supabase.from('blocks').select('blocked'),
    supabase.from('presence').select('user_id, device, here, seen_at'),
  ] as const)
  if (S.userId !== userId) return
  // A network blip keeps what we had, rather than emptying the inbox and the
  // friends off the map, and tries again in a bit.
  if (results.some((r) => r.error)) {
    if (attempt < 3) setTimeout(() => S.userId === userId && loadPrivate(userId, attempt + 1), 5000)
    return
  }
  const [saved, notifications, messages, settings, friendships, locations, blocks, presence] = results

  S.saved = saved.data ?? []
  // A reload keeps any older notifications already paged in.
  const fresh: Notification[] = (notifications.data ?? []).reverse()
  const oldestFresh = fresh[0] ? time(fresh[0].created_at) : Infinity
  const keptOlder = S.notifications.filter((n) => time(n.created_at) < oldestFresh)
  S.notifications = [...keptOlder, ...fresh]
  if (!keptOlder.length) S.hasOlderNotifications = (notifications.data?.length ?? 0) === 60
  S.messages = (messages.data ?? []).reverse()
  S.mutedKinds = settings.data?.muted_kinds ?? []
  S.friendships = friendships.data ?? []
  S.blocked = new Set((blocks.data ?? []).map((b: { blocked: string }) => b.blocked))
  S.seen = new Map()
  for (const p of (presence.data ?? []) as Presence[]) rememberPresence(p)
  checkIn()
  S.locations = new Map((locations.data ?? []).filter((l: Location) => l.shared).map((l: Location) => [l.user_id, l]))
  const remembered = remembersSharing()
  S.sharing = remembered.on
  S.sharingUntil = remembered.until
  changed()
  // Sharing from last time on this device picks up again. A row without it may
  // be another device of yours sharing right now, so it's left alone, unless
  // it's this device's own hour that ran out while the app was closed.
  if (S.sharing) watchHere().then(() => pushLocation(true))
  else if (remembered.expired) {
    rememberSharing(false)
    // Only if the row is still the one this device left: another device may be sharing now.
    const row = S.locations.get(userId)
    if (row && remembered.until && time(row.updated_at) <= remembered.until + 60000) withdrawLocation()
  }
}

function subscribePrivate(userId: string) {
  privateChannel = supabase
    .channel(`private-${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, ({ new: row }) => {
      const n = row as Notification
      upsert(S.notifications, n, byId)
      changed()
      if (n.actor_id && S.blocked.has(n.actor_id)) return // (the server stops these too, since the block)
      const text = describeNotification(n)
      onIncoming(`${n.actor_name ?? 'Someone'} ${text}`, n.preview ?? '', n.post_id ? `pin/${n.post_id}` : n.actor_id ? `user/${n.actor_id}` : 'inbox')
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, ({ new: row }) => {
      // Read on another device.
      upsert(S.notifications, row as Notification, byId)
      changed()
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: row }) => {
      const message = row as Message
      upsert(S.messages, message, byId)
      changed()
      if (message.sender_id !== userId && !S.blocked.has(message.sender_id)) onIncoming(nameOf(message.sender_id), readable(message.body), `chat/${message.sender_id}`)
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, ({ new: row }) => {
      upsert(S.messages, row as Message, byId)
      changed()
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, (payload) => {
      if (payload.eventType === 'DELETE') {
        // Deletes reach everyone and carry only the id, so act only on our own.
        const gone = S.friendships.find((f) => f.id === (payload.old as Friendship).id)
        if (!gone) return
        S.friendships = S.friendships.filter((f) => f !== gone)
        // Their dot and their online light go with the friendship.
        const other = gone.requester === userId ? gone.addressee : gone.requester
        S.locations.delete(other)
        S.seen.delete(other)
      } else {
        upsert(S.friendships, payload.new as Friendship, byId)
        // A new friend may already be sharing, and around.
        if ((payload.new as Friendship).accepted_at) refreshFriendsNow()
      }
      changed()
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'presence' }, (payload) => {
      // Rows are only ever deleted with their account; otherwise it's an arrival or a departure.
      if (payload.eventType === 'DELETE') S.seen.delete((payload.old as Presence).user_id)
      else rememberPresence(payload.new as Presence)
      changed()
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'locations' }, (payload) => {
      // A row that stops being shared (or, for a deleted account, goes) leaves the map.
      const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Location
      if (payload.eventType === 'DELETE' || !row.shared) S.locations.delete(row.user_id)
      else S.locations.set(row.user_id, row)
      changed()
    })
    .subscribe()

}

// Saying "I'm here" to friends: a row per device, which the server stamps with
// its own time. Refreshed every minute while the app is in view; leaving sets
// here = false (never a delete: realtime would announce it to everyone).
const device = (() => {
  try {
    let id = localStorage.getItem('aroundhere.device')
    if (!id) localStorage.setItem('aroundhere.device', (id = crypto.randomUUID()))
    return id
  } catch {
    return crypto.randomUUID()
  }
})()

let leaving = false // signing out: no more check-ins from this session

function checkIn() {
  if (!S.userId || leaving || document.visibilityState !== 'visible') return
  const sent = Date.now()
  supabase
    .from('presence')
    .upsert({ device, here: true }, { onConflict: 'user_id,device' })
    .select('seen_at')
    .single()
    .then(({ data, error }) => {
      if (error) console.error('Presence', error)
      else clockSkew = time(data.seen_at) - (sent + Date.now()) / 2
    })
}

export async function checkOut() {
  leaving = true
  if (S.userId) await supabase.from('presence').update({ here: false }).eq('user_id', S.userId).eq('device', device)
}

function checkOutNow() {
  if (!S.userId || !S.session) return
  fetch(`${supabaseUrl}/rest/v1/presence?user_id=eq.${S.userId}&device=eq.${device}`, {
    method: 'PATCH',
    keepalive: true,
    headers: { apikey: supabaseKey, Authorization: `Bearer ${S.session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ here: false }),
  }).catch(() => {})
}

// After a friendship starts: their position and presence, which we couldn't read before.
async function refreshFriendsNow() {
  await refreshLocations()
  const { data } = await supabase.from('presence').select('user_id, device, here, seen_at')
  S.seen = new Map()
  for (const p of (data ?? []) as Presence[]) rememberPresence(p)
  changed()
}

async function refreshLocations() {
  const { data, error } = await supabase.from('locations').select('*')
  if (error) return // keep who we had; a blip shouldn't take friends off the map
  S.locations = new Map((data ?? []).filter((l: Location) => l.shared).map((l: Location) => [l.user_id, l]))
  changed()
}

function resetPrivate() {
  if (privateChannel) supabase.removeChannel(privateChannel)
  privateChannel = null
  S.saved = []
  S.notifications = []
  S.messages = []
  S.mutedKinds = []
  S.friendships = []
  S.blocked = new Set()
  S.locations = new Map()
  S.seen = new Map()
  S.sharing = false
  S.sharingUntil = null
}

let started = false

export function start() {
  if (started) return
  started = true
  loadPublic()
  subscribePublic()

  // Sharing only while the app is in view. And coming back after a while
  // (a phone in a pocket, a laptop asleep) reloads what realtime couldn't
  // deliver while we were away.
  let hiddenAt = 0
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now()
      if (S.userId && S.sharing) withdrawNow()
      checkOutNow()
      return
    }
    if (hiddenAt && Date.now() - hiddenAt > 30000) {
      loadPublic()
      if (S.userId) loadPrivate(S.userId) // which also checks in, and puts my dot back if I share
    } else {
      checkIn()
      if (S.userId && S.sharing) pushLocation(true)
    }
  })
  window.addEventListener('pagehide', () => {
    if (S.userId && S.sharing) withdrawNow()
    checkOutNow()
  })
  setInterval(checkIn, 60000)

  // A share for a while ends by itself, even if nothing moves.
  setInterval(endSharingIfTimeIsUp, 15000)

  // Fires once with the stored session, then on every sign-in and sign-out.
  supabase.auth.onAuthStateChange((_event, session) => {
    const userId = session?.user.id ?? null
    S.authKnown = true
    S.session = session
    if (userId !== S.userId) {
      resetPrivate()
      S.userId = userId
      leaving = false
      if (userId) {
        // Outside the callback: supabase-js deadlocks if we query from inside it.
        setTimeout(() => {
          loadPrivate(userId)
          subscribePrivate(userId)
        }, 0)
      }
    }
    changed()
  })
}

//
// Pins.
//

function forgetPost(postId: string) {
  S.posts = S.posts.filter((p) => p.id !== postId)
  S.replies = S.replies.filter((r) => r.post_id !== postId)
  S.interests = S.interests.filter((i) => i.post_id !== postId)
  S.saved = S.saved.filter((s) => s.post_id !== postId)
  changed()
}

export type Draft = { title: string; description: string; flair: Flair; startsAt: string | null; latitude: number; longitude: number; files: File[] }

export async function createPost(draft: Draft) {
  // Posts within 30 m of an existing place join it and share its marker.
  let place: { id: string; latitude: number; longitude: number } | null = null
  let best = 30
  for (const post of S.posts) {
    if (!post.place_id) continue
    const d = distance(post.latitude, post.longitude, draft.latitude, draft.longitude)
    if (d <= best) {
      best = d
      place = { id: post.place_id, latitude: post.latitude, longitude: post.longitude }
    }
  }

  if (!place) {
    const { data, error } = await supabase.from('places').insert({ latitude: draft.latitude, longitude: draft.longitude }).select().single()
    if (error) {
      fail("Couldn't save the spot", error)
      return null
    }
    place = data
  }

  const { data: post, error } = await supabase
    .from('posts')
    .insert({ place_id: place!.id, title: draft.title, description: draft.description, latitude: place!.latitude, longitude: place!.longitude, flair: draft.flair, starts_at: draft.startsAt })
    .select()
    .single()
  if (error) {
    fail("Couldn't post the pin", error)
    return null
  }

  upsert(S.posts, post as Post, byId, true)
  changed()

  // Photos and videos go into storage, one folder per post.
  for (const file of draft.files) {
    const extension = file.name.split('.').pop() ?? 'bin'
    const path = `${post.id}/${crypto.randomUUID()}.${extension}`
    const upload = await supabase.storage.from('post-media').upload(path, file)
    if (upload.error) {
      fail(`Couldn't upload ${file.name}`, upload.error)
      continue
    }
    const { data: row, error: rowError } = await supabase
      .from('post_media')
      .insert({ post_id: post.id, media_type: file.type.startsWith('video/') ? 'video' : 'image', url: supabase.storage.from('post-media').getPublicUrl(path).data.publicUrl })
      .select()
      .single()
    if (rowError) fail("Couldn't attach media", rowError)
    else upsert(S.media, row as Media, byId)
    changed()
  }

  return post as Post
}

export async function updatePost(id: string, patch: Partial<Pick<Post, 'title' | 'description' | 'resolved_at' | 'starts_at' | 'flair'>>) {
  const { data, error } = await supabase.from('posts').update(patch).eq('id', id).select().single()
  if (error) return fail("Couldn't save the change", error)
  upsert(S.posts, data as Post, byId, true)
  changed()
  return true
}

export async function deletePost(id: string) {
  const { error } = await supabase.from('posts').delete().eq('id', id)
  if (error) return fail("Couldn't delete the pin", error)
  forgetPost(id)
  return true
}

export async function loadRevisions(postId: string) {
  const { data } = await supabase.from('post_revisions').select('id, title, description, replaced_at').eq('post_id', postId).order('replaced_at', { ascending: false })
  return (data ?? []) as Revision[]
}

export async function reply(postId: string, content: string) {
  const { data, error } = await supabase.from('replies').insert({ post_id: postId, content }).select().single()
  if (error) return fail("Couldn't send the reply", error)
  upsert(S.replies, data as Reply, byId)
  changed()
  return true
}

export async function report(postId: string, reason: 'spam' | 'unkind' | 'unsafe' | 'other') {
  const { error } = await supabase.from('reports').insert({ post_id: postId, reason })
  // Reporting the same pin twice is fine: the first report stands.
  if (error && error.code !== '23505') return fail("Couldn't send the report", error)
  return true
}

const liking = new Set<string>() // replies with a heart on its way; taps wait for it

export async function toggleLike(replyId: string) {
  if (liking.has(replyId)) return true
  liking.add(replyId)
  try {
    return await flipLike(replyId)
  } finally {
    liking.delete(replyId)
  }
}

async function flipLike(replyId: string) {
  const userId = S.userId!
  const mine = { user_id: userId, reply_id: replyId, created_at: new Date().toISOString() }
  const was = S.likes.some((l) => sameLike(l, mine))
  // Show it straight away; undo if the database says no.
  S.likes = was ? S.likes.filter((l) => !sameLike(l, mine)) : [...S.likes, mine]
  changed()
  const { error } = was
    ? await supabase.from('reply_likes').delete().eq('reply_id', replyId).eq('user_id', userId)
    : await supabase.from('reply_likes').insert({ reply_id: replyId })
  // Liked already (on another device, say): that's the state we wanted.
  if (error && error.code !== '23505') {
    S.likes = was ? [...S.likes, mine] : S.likes.filter((l) => !sameLike(l, mine))
    changed()
    return fail("Couldn't update", error)
  }
  return true
}

export async function deleteReply(id: string) {
  const { error } = await supabase.from('replies').delete().eq('id', id)
  if (error) return fail("Couldn't delete the reply", error)
  S.replies = S.replies.filter((r) => r.id !== id)
  changed()
  return true
}

export async function toggleInterest(postId: string) {
  const userId = S.userId!
  const mine = (i: Interest) => i.post_id === postId && i.user_id === userId
  const was = S.interests.some(mine)
  // Show it straight away; undo if the database says no.
  if (was) S.interests = S.interests.filter((i) => !mine(i))
  else S.interests.push({ user_id: userId, post_id: postId, created_at: new Date().toISOString() })
  changed()

  const { error } = was
    ? await supabase.from('post_interest').delete().eq('post_id', postId).eq('user_id', userId)
    : await supabase.from('post_interest').insert({ post_id: postId })
  if (error) {
    if (was) S.interests.push({ user_id: userId, post_id: postId, created_at: new Date().toISOString() })
    else S.interests = S.interests.filter((i) => !mine(i))
    changed()
    return fail("Couldn't update", error)
  }
  return true
}

export async function toggleSave(postId: string) {
  const was = S.saved.some((s) => s.post_id === postId)
  const { error } = was
    ? await supabase.from('saved_posts').delete().eq('post_id', postId)
    : await supabase.from('saved_posts').insert({ post_id: postId })
  if (error) return fail("Couldn't update your saved pins", error)
  if (was) S.saved = S.saved.filter((s) => s.post_id !== postId)
  else S.saved.push({ post_id: postId, created_at: new Date().toISOString() })
  changed()
  return true
}

//
// People.
//

export async function saveProfile(patch: Partial<Pick<Profile, 'display_name' | 'neighbourhood' | 'bio' | 'avatar_url'>>) {
  const { data, error } = await supabase.from('profiles').update(patch).eq('id', S.userId!).select().single()
  if (error) return fail("Couldn't save your profile", error)
  const profile = data as Profile
  S.profiles.set(profile.id, profile)
  // The database renames old posts and replies too; mirror that here.
  for (const post of S.posts) if (post.author_id === profile.id) post.author_name = profile.display_name
  for (const r of S.replies) if (r.author_id === profile.id) r.author_name = profile.display_name
  changed()
  return true
}

// Crops the middle square of a photo, shrinks it to 256 px and uploads it as a JPEG.
export async function uploadAvatar(file: File) {
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) return fail("That file isn't a photo we can read", null)
  const size = 256
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  canvas.getContext('2d')!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  if (!blob) return fail("Couldn't read that photo", null)

  const previous = storagePath(S.profiles.get(S.userId!)?.avatar_url, 'avatars')
  const path = `${S.userId}/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg' })
  if (error) return fail("Couldn't upload the photo", error)
  const saved = await saveProfile({ avatar_url: supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl })
  if (saved && previous) supabase.storage.from('avatars').remove([previous])
  return saved
}

// The path inside a bucket, from one of its public URLs.
function storagePath(url: string | null | undefined, bucket: string) {
  return url?.split(`/object/public/${bucket}/`)[1] ?? null
}

// Supabase emails both the old and the new address; the change happens once both confirm.
export async function changeEmail(email: string) {
  const { error } = await supabase.auth.updateUser({ email })
  if (error) return fail(error.message, error)
  return true
}

// Everything you made goes with you: the database cascades the rows, and the
// photos in storage are removed first, while we still own them.
export async function deleteAccount() {
  const me = S.userId!
  const mine = new Set(S.posts.filter((p) => p.author_id === me).map((p) => p.id))
  const media = S.media.filter((m) => mine.has(m.post_id)).map((m) => storagePath(m.url, 'post-media')).filter((p) => p !== null)
  if (media.length) await supabase.storage.from('post-media').remove(media)
  const { data: avatars } = await supabase.storage.from('avatars').list(me)
  if (avatars?.length) await supabase.storage.from('avatars').remove(avatars.map((f) => `${me}/${f.name}`))

  rememberSharing(false)
  const { error } = await supabase.rpc('delete_my_account')
  if (error) return fail("Couldn't delete your account", error)
  await supabase.auth.signOut({ scope: 'local' })
  loadPublic()
  return true
}

export async function requestFriend(id: string) {
  const { data, error } = await supabase.from('friendships').insert({ addressee: id }).select().single()
  if (error) return fail("Couldn't send the request", error)
  upsert(S.friendships, data as Friendship, byId)
  changed()
  return true
}

export async function acceptFriend(id: string) {
  const { data, error } = await supabase.from('friendships').update({ accepted_at: new Date().toISOString() }).eq('requester', id).eq('addressee', S.userId!).select().single()
  if (error) return fail("Couldn't accept", error)
  upsert(S.friendships, data as Friendship, byId)
  changed()
  refreshFriendsNow()
  readFriendRequestsFrom(id)
  return true
}

// Answering a request, either way, settles its notification.
function readFriendRequestsFrom(id: string) {
  markNotificationsRead(S.notifications.filter((n) => n.kind === 'friend_request' && n.actor_id === id).map((n) => n.id))
}

export async function removeFriend(id: string) {
  const f = friendshipWith(id)
  if (!f) return true
  const { error } = await supabase.from('friendships').delete().eq('id', f.id)
  if (error) return fail("Couldn't remove", error)
  S.friendships = S.friendships.filter((x) => x.id !== f.id)
  S.locations.delete(id)
  S.seen.delete(id)
  changed()
  readFriendRequestsFrom(id)
  return true
}

//
// Messages and notifications.
//

export async function sendMessage(to: string, body: string) {
  const { data, error } = await supabase.from('messages').insert({ recipient_id: to, body }).select().single()
  // A refusal from row security means they aren't taking messages from you.
  if (error?.code === '42501') return fail(`${nameOf(to)} isn't taking messages right now`, { message: `${nameOf(to)} isn't taking messages right now` })
  if (error) return fail("Couldn't send", error)
  upsert(S.messages, data as Message, byId)
  changed()
  return true
}

export async function markConversationRead(otherId: string) {
  const unread = S.messages.filter((m) => m.sender_id === otherId && m.recipient_id === S.userId && !m.read_at)
  if (!unread.length) return
  const readAt = new Date().toISOString()
  for (const m of unread) m.read_at = readAt
  changed()
  await supabase.from('messages').update({ read_at: readAt }).eq('sender_id', otherId).eq('recipient_id', S.userId!).is('read_at', null)
}

export async function markNotificationsRead(ids: string[]) {
  const unread = S.notifications.filter((n) => ids.includes(n.id) && !n.read_at)
  if (!unread.length) return
  const readAt = new Date().toISOString()
  for (const n of unread) n.read_at = readAt
  changed()
  await supabase.from('notifications').update({ read_at: readAt }).in('id', unread.map((n) => n.id))
}

export async function loadOlderNotifications() {
  const oldest = S.notifications[0]
  if (!oldest) return
  const { data } = await supabase.from('notifications').select('*').lt('created_at', oldest.created_at).order('created_at', { ascending: false }).limit(60)
  S.notifications = [...(data ?? []).reverse(), ...S.notifications]
  S.hasOlderNotifications = (data?.length ?? 0) === 60
  changed()
}

export async function setMutedKinds(kinds: string[]) {
  S.mutedKinds = kinds
  changed()
  const { error } = await supabase.from('notification_settings').upsert({ muted_kinds: kinds }, { onConflict: 'user_id' })
  if (error) fail("Couldn't save notification settings", error)
}

export function describeNotification(n: Notification) {
  const title = `“${n.post_title ?? 'a pin'}”`
  switch (n.kind) {
    case 'reply': return `replied to your pin ${title}`
    case 'saved_reply': return `replied to ${title}, a pin you saved`
    case 'thread_reply': return `also replied to ${title}`
    case 'resolved': return `marked ${title} as resolved`
    case 'save': return `saved your pin ${title}`
    case 'interest': return `is interested in ${title}`
    case 'friend_request': return 'wants to be friends'
    case 'friend_accept': return 'accepted your friend request'
    case 'friend_post': return `pinned ${title}`
    case 'mention': return `mentioned you in ${title}`
  }
}

// "Typing…" in a chat: a broadcast on a private channel only these two people
// may join. Nothing is stored.
export function typingChannel(otherId: string, onTyping: () => void) {
  const me = S.userId
  // Private: the database only lets these two people on (see the typing migration).
  const channel = supabase.channel(`typing:${[me, otherId].sort().join(':')}`, { config: { private: true } })
  channel.on('broadcast', { event: 'typing' }, ({ payload }) => {
    if (payload?.from === otherId) onTyping()
  })
  channel.subscribe()

  let last = 0
  return {
    ping() {
      const now = Date.now()
      if (now - last < 1500) return
      last = now
      channel.send({ type: 'broadcast', event: 'typing', payload: { from: me } })
    },
    close() {
      supabase.removeChannel(channel)
    },
  }
}

// Blocking also ends any friendship, so they drop off your map too.
export async function block(id: string) {
  const { error } = await supabase.from('blocks').insert({ blocked: id })
  if (error) return fail("Couldn't block", error)
  S.blocked.add(id)
  if (friendshipWith(id)) await removeFriend(id)
  changed()
  return true
}

export async function unblock(id: string) {
  const { error } = await supabase.from('blocks').delete().eq('blocked', id)
  if (error) return fail("Couldn't unblock", error)
  S.blocked.delete(id)
  changed()
  return true
}

// A message as a line of text for previews and alerts: links to our own pins
// don't read well as addresses, so they become words.
export function readable(body: string) {
  const text = body.replace(new RegExp(`${window.location.origin.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/#pin/[0-9a-f-]{36}`, 'g'), '').trim()
  return text ? (text === body ? text : `Pin: ${text}`) : 'Sent you a pin'
}

// One entry per person you've messaged, latest first.
export function conversations() {
  const byOther = new Map<string, { other: string; last: Message; unread: number }>()
  for (const m of S.messages) {
    const other = m.sender_id === S.userId ? m.recipient_id : m.sender_id
    if (S.blocked.has(other)) continue
    const unread = m.recipient_id === S.userId && !m.read_at ? 1 : 0
    byOther.set(other, { other, last: m, unread: (byOther.get(other)?.unread ?? 0) + unread })
  }
  return [...byOther.values()].sort((a, b) => time(b.last.created_at) - time(a.last.created_at))
}

//
// Where I am, and sharing it with friends.
//

let watchId: number | null = null
let lastSent = { at: 0, latitude: 0, longitude: 0 }

export function distance(lat1: number, lng1: number, lat2: number, lng2: number) {
  const r = Math.PI / 180
  const h = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2
  return 12742000 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

// Everyone waiting for the first fix; they all hear about it together.
let waiting: ((here: Here | null) => void)[] = []

function answerWaiting(here: Here | null) {
  for (const resolve of waiting) resolve(here)
  waiting = []
}

// Starts following the device's position (once). Resolves with the first fix,
// or null if we can't get one.
export function watchHere(): Promise<Here | null> {
  if (!navigator.geolocation) return Promise.resolve(null)
  if (watchId !== null && S.here) return Promise.resolve(S.here)

  return new Promise((resolve) => {
    waiting.push(resolve)
    if (watchId !== null) return // already looking; this caller joins the queue

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        S.here = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          heading: position.coords.heading ?? S.here?.heading ?? null,
        }
        changed()
        answerWaiting(S.here)
        if (S.sharing) pushLocation(false)
      },
      () => {
        // Denied, or no fix at all: give up so the next ask starts fresh. A
        // hiccup after we've had fixes keeps the watch going.
        if (!S.here && watchId !== null) {
          navigator.geolocation.clearWatch(watchId)
          watchId = null
        }
        answerWaiting(S.here)
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 15000 },
    )
  })
}

// Which way the phone points, for the arrow on the map. iOS asks for permission,
// and only from a tap, so this is called from the locate button.
let compassOn = false
let lastHeadingAt = 0

export async function enableCompass() {
  if (compassOn || typeof DeviceOrientationEvent === 'undefined') return
  const ask = (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission
  if (ask && (await ask().catch(() => 'denied')) !== 'granted') return
  compassOn = true

  const onTurn = (e: DeviceOrientationEvent) => {
    const ios = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading
    const heading = ios ?? (e.absolute && e.alpha !== null ? 360 - e.alpha : null)
    const now = Date.now()
    if (heading === null || !S.here || now - lastHeadingAt < 100) return
    const old = S.here.heading
    if (old !== null && Math.abs(((heading - old + 540) % 360) - 180) < 3) return
    lastHeadingAt = now
    S.here = { ...S.here, heading }
    changed()
  }
  window.addEventListener('ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation', onTurn as EventListener)
}

// Sharing is a choice remembered on this device. The row friends read exists
// only while the app is open and in view, so nobody sees a "here" from hours ago.
const sharingKey = () => `aroundhere.sharing.${S.userId}`

// Stored as 'on', or as the time a "for an hour" share ends.
function remembersSharing() {
  try {
    const value = localStorage.getItem(sharingKey())
    if (value === 'on') return { on: true, until: null, expired: false }
    const until = Number(value)
    if (until > Date.now()) return { on: true, until, expired: false }
    return { on: false, until: until > 0 ? until : null, expired: until > 0 }
  } catch {
    return { on: false, until: null, expired: false }
  }
}

function rememberSharing(on: boolean, until: number | null = null) {
  try {
    if (on) localStorage.setItem(sharingKey(), until ? String(until) : 'on')
    else localStorage.removeItem(sharingKey())
  } catch {
    // Private mode: sharing just won't resume next time.
  }
}

// Location writes go one at a time, so switching sharing off always lands last.
let locationWrites: Promise<unknown> = Promise.resolve()

function queueLocationWrite(write: () => Promise<unknown>) {
  locationWrites = locationWrites.then(write, write)
  return locationWrites
}

// Sends my position to friends, at most every 20 s unless I moved a fair bit.
function pushLocation(force: boolean) {
  const here = S.here
  if (!here || !S.userId || !S.sharing) return
  if (endSharingIfTimeIsUp()) return
  const now = Date.now()
  const moved = distance(lastSent.latitude, lastSent.longitude, here.latitude, here.longitude)
  if (!force && now - lastSent.at < 20000 && moved < 40) return
  lastSent = { at: now, latitude: here.latitude, longitude: here.longitude }

  return queueLocationWrite(async () => {
    // Switched off, or hidden, while this waited its turn.
    if (!S.sharing || !S.userId || document.visibilityState === 'hidden') return
    const { data, error } = await supabase
      .from('locations')
      .upsert({ latitude: here.latitude, longitude: here.longitude, accuracy: here.accuracy, heading: here.heading, shared: true }, { onConflict: 'user_id' })
      .select()
      .single()
    if (error) fail("Couldn't share your location", error)
    else if (S.sharing) S.locations.set(S.userId, data as Location)
    changed()
  })
}

// Not sharing any more: the row stays (a delete would be announced to every
// client), but it no longer says where you are.
const UNSHARED = { shared: false, latitude: 0, longitude: 0, accuracy: null, heading: null }

function withdrawLocation() {
  const userId = S.userId
  if (!userId) return
  S.locations.delete(userId)
  lastSent = { at: 0, latitude: 0, longitude: 0 }
  return queueLocationWrite(async () => {
    const { error } = await supabase.from('locations').update(UNSHARED).eq('user_id', userId)
    if (error) fail("Couldn't stop sharing", error)
  })
}

// The page is going out of view (or away): take my dot off friends' maps now.
// A keepalive request finishes even if the page doesn't.
function withdrawNow() {
  const userId = S.userId
  if (!userId || !S.session) return
  S.locations.delete(userId)
  lastSent = { at: 0, latitude: 0, longitude: 0 }
  fetch(`${supabaseUrl}/rest/v1/locations?user_id=eq.${userId}`, {
    method: 'PATCH',
    keepalive: true,
    headers: { apikey: supabaseKey, Authorization: `Bearer ${S.session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(UNSHARED),
  }).catch(() => {})
}

// A share for a while ends when its time is up; checked on the timer and before every send.
function endSharingIfTimeIsUp() {
  if (!S.sharing || !S.sharingUntil || Date.now() < S.sharingUntil) return false
  setSharing(false)
  onIncoming('Stopped sharing your location', 'Your hour is up', 'friends')
  return true
}

// Share until switched off, or for a while (in ms) after which it stops by itself.
export async function setSharing(on: boolean, forMs: number | null = null) {
  if (!S.userId) return false
  if (on) {
    const here = await watchHere()
    if (!here) return fail("Can't find you: location is blocked or unavailable", null)
    S.sharing = true
    S.sharingUntil = forMs ? Date.now() + forMs : null
    rememberSharing(true, S.sharingUntil)
    changed()
    await pushLocation(true)
    return true
  }
  S.sharing = false
  S.sharingUntil = null
  rememberSharing(false)
  changed()
  await withdrawLocation()
  changed()
  return true
}
