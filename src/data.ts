// Everything the app knows, in one place.
//
// A neighbourhood is small, so the whole public picture (pins, replies,
// people) is loaded once and kept live over realtime. The signed-in user's
// private rows (inbox, friends, saved pins) load on sign-in. Actions below
// write to Supabase and then to the store; changed() re-renders the UI.

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
  created_at: string
}

export type Media = { id: string; post_id: string; media_type: 'image' | 'video'; url: string; created_at: string }
export type Interest = { user_id: string; post_id: string; created_at: string }
export type Saved = { post_id: string; created_at: string }
export type Revision = { id: string; title: string; description: string; replaced_at: string }

export type NotificationKind = 'reply' | 'saved_reply' | 'thread_reply' | 'save' | 'interest' | 'resolved' | 'friend_request' | 'friend_accept'

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
export type Friendship = { requester: string; addressee: string; created_at: string; accepted_at: string | null }
export type Location = { user_id: string; latitude: number; longitude: number; accuracy: number | null; heading: number | null; updated_at: string }
export type Here = { latitude: number; longitude: number; accuracy: number; heading: number | null }

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
  authKnown: false, // true once the stored session has been read
  session: null as Session | null,
  userId: null as string | null,

  posts: [] as Post[], // newest first
  replies: [] as Reply[], // oldest first
  media: [] as Media[],
  interests: [] as Interest[],
  profiles: new Map<string, Profile>(),

  saved: [] as Saved[],
  notifications: [] as Notification[], // oldest first
  hasOlderNotifications: false,
  messages: [] as Message[], // oldest first
  mutedKinds: [] as string[],
  friendships: [] as Friendship[],
  locations: new Map<string, Location>(),
  online: new Set<string>(),

  here: null as Here | null,
  sharing: false,
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
}

let statsVersion = -1
let statsCache: Stats

export function stats() {
  if (statsVersion === version) return statsCache
  const st: Stats = { replies: new Map(), interested: new Map(), active: new Map(), unread: new Set(), joined: new Set() }
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

// Where something went wrong, in words for a toast. Set by actions, read by the UI.
export let lastError = ''
function fail(what: string, error: { message: string } | null) {
  console.error(what, error)
  lastError = error?.message ?? what
  return false
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
const samePair = (a: Friendship, b: Friendship) => a.requester === b.requester && a.addressee === b.addressee

async function loadPublic() {
  const [posts, replies, media, interests, profiles] = await Promise.all([
    supabase.from('posts').select('*').order('created_at', { ascending: false }),
    supabase.from('replies').select('*').order('created_at', { ascending: true }),
    supabase.from('post_media').select('*').order('created_at', { ascending: true }),
    supabase.from('post_interest').select('user_id, post_id, created_at'),
    supabase.from('profiles').select('*'),
  ])

  if (posts.error) fail('Loading pins', posts.error)
  S.posts = posts.data ?? []
  S.replies = replies.data ?? []
  S.media = media.data ?? []
  S.interests = interests.data ?? []
  S.profiles = new Map((profiles.data ?? []).map((p: Profile) => [p.id, p]))
  S.ready = true
  changed()
}

function subscribePublic() {
  supabase
    .channel('public-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, ({ new: row }) => {
      upsert(S.posts, row as Post, byId, true)
      changed()
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, ({ new: row }) => {
      const profile = row as Profile
      if (profile.id) S.profiles.set(profile.id, profile)
      changed()
    })
    .subscribe()
}

type Channel = ReturnType<typeof supabase.channel>
let privateChannel: Channel | null = null
let presenceChannel: Channel | null = null

// Something arrived for the signed-in user; the UI may raise a desktop alert.
export let onIncoming: (title: string, body: string, route: string) => void = () => {}
export function setIncomingHandler(handler: typeof onIncoming) {
  onIncoming = handler
}

async function loadPrivate(userId: string) {
  const [saved, notifications, messages, settings, friendships, locations] = await Promise.all([
    supabase.from('saved_posts').select('post_id, created_at'),
    supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(60),
    supabase.from('messages').select('*').order('created_at', { ascending: false }).limit(1000),
    supabase.from('notification_settings').select('muted_kinds').maybeSingle(),
    supabase.from('friendships').select('*'),
    supabase.from('locations').select('*'),
  ])
  if (S.userId !== userId) return

  S.saved = saved.data ?? []
  S.notifications = (notifications.data ?? []).reverse()
  S.hasOlderNotifications = (notifications.data?.length ?? 0) === 60
  S.messages = (messages.data ?? []).reverse()
  S.mutedKinds = settings.data?.muted_kinds ?? []
  S.friendships = friendships.data ?? []
  S.locations = new Map((locations.data ?? []).map((l: Location) => [l.user_id, l]))
  S.sharing = S.locations.has(userId)
  changed()
  // Still sharing from last time: keep the position fresh.
  if (S.sharing) watchHere().then(() => pushLocation(true))
}

function subscribePrivate(userId: string) {
  privateChannel = supabase
    .channel(`private-${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, ({ new: row }) => {
      const n = row as Notification
      upsert(S.notifications, n, byId)
      changed()
      const text = describeNotification(n)
      onIncoming(`${n.actor_name ?? 'Someone'} ${text}`, n.preview ?? '', n.post_id ? `pin/${n.post_id}` : n.actor_id ? `user/${n.actor_id}` : 'inbox')
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: row }) => {
      const message = row as Message
      upsert(S.messages, message, byId)
      changed()
      if (message.sender_id !== userId) onIncoming(nameOf(message.sender_id), message.body, `chat/${message.sender_id}`)
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, ({ new: row }) => {
      upsert(S.messages, row as Message, byId)
      changed()
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, (payload) => {
      if (payload.eventType === 'DELETE') {
        const old = payload.old as Friendship
        S.friendships = S.friendships.filter((f) => !samePair(f, old))
        // Their dot leaves the map with the friendship.
        const other = old.requester === userId ? old.addressee : old.requester
        if (other) S.locations.delete(other)
      } else {
        upsert(S.friendships, payload.new as Friendship, samePair)
        // A new friend may already be sharing.
        if ((payload.new as Friendship).accepted_at) refreshLocations()
      }
      changed()
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'locations' }, (payload) => {
      if (payload.eventType === 'DELETE') S.locations.delete((payload.old as Location).user_id)
      else S.locations.set((payload.new as Location).user_id, payload.new as Location)
      changed()
    })
    .subscribe()

  // Who's got the app open right now.
  presenceChannel = supabase.channel('online', { config: { presence: { key: userId } } })
  presenceChannel
    .on('presence', { event: 'sync' }, () => {
      S.online = new Set(Object.keys(presenceChannel!.presenceState()))
      changed()
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') presenceChannel!.track({ at: new Date().toISOString() })
    })
}

async function refreshLocations() {
  const { data } = await supabase.from('locations').select('*')
  S.locations = new Map((data ?? []).map((l: Location) => [l.user_id, l]))
  changed()
}

function resetPrivate() {
  if (privateChannel) supabase.removeChannel(privateChannel)
  if (presenceChannel) supabase.removeChannel(presenceChannel)
  privateChannel = presenceChannel = null
  S.saved = []
  S.notifications = []
  S.messages = []
  S.mutedKinds = []
  S.friendships = []
  S.locations = new Map()
  S.online = new Set()
  S.sharing = false
}

let started = false

export function start() {
  if (started) return
  started = true
  loadPublic()
  subscribePublic()

  // Fires once with the stored session, then on every sign-in and sign-out.
  supabase.auth.onAuthStateChange((_event, session) => {
    const userId = session?.user.id ?? null
    S.authKnown = true
    S.session = session
    if (userId !== S.userId) {
      resetPrivate()
      S.userId = userId
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

export type Draft = { title: string; description: string; flair: Flair; latitude: number; longitude: number; files: File[] }

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
    .insert({ place_id: place!.id, title: draft.title, description: draft.description, latitude: place!.latitude, longitude: place!.longitude, flair: draft.flair })
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

export async function updatePost(id: string, patch: Partial<Pick<Post, 'title' | 'description' | 'resolved_at'>>) {
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

export async function saveProfile(patch: Partial<Pick<Profile, 'display_name' | 'neighbourhood' | 'bio'>>) {
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

export async function requestFriend(id: string) {
  const { data, error } = await supabase.from('friendships').insert({ addressee: id }).select().single()
  if (error) return fail("Couldn't send the request", error)
  upsert(S.friendships, data as Friendship, samePair)
  changed()
  return true
}

export async function acceptFriend(id: string) {
  const { data, error } = await supabase.from('friendships').update({ accepted_at: new Date().toISOString() }).eq('requester', id).eq('addressee', S.userId!).select().single()
  if (error) return fail("Couldn't accept", error)
  upsert(S.friendships, data as Friendship, samePair)
  changed()
  refreshLocations()
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
  const { error } = await supabase.from('friendships').delete().eq('requester', f.requester).eq('addressee', f.addressee)
  if (error) return fail("Couldn't remove", error)
  S.friendships = S.friendships.filter((x) => !samePair(x, f))
  S.locations.delete(id)
  changed()
  readFriendRequestsFrom(id)
  return true
}

//
// Messages and notifications.
//

export async function sendMessage(to: string, body: string) {
  const { data, error } = await supabase.from('messages').insert({ recipient_id: to, body }).select().single()
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
  }
}

// "Typing…" in a chat: a broadcast on a channel only these two people join. Nothing is stored.
export function typingChannel(otherId: string, onTyping: () => void) {
  const me = S.userId
  const channel = supabase.channel(`typing:${[me, otherId].sort().join(':')}`)
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

// One entry per person you've messaged, latest first.
export function conversations() {
  const byOther = new Map<string, { other: string; last: Message; unread: number }>()
  for (const m of S.messages) {
    const other = m.sender_id === S.userId ? m.recipient_id : m.sender_id
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

// Starts following the device's position. Resolves with the first fix, or null if we can't get one.
export function watchHere(): Promise<Here | null> {
  if (!navigator.geolocation) return Promise.resolve(null)
  if (watchId !== null && S.here) return Promise.resolve(S.here)

  return new Promise((resolve) => {
    let first = true
    const settle = (value: Here | null) => {
      if (first) {
        first = false
        resolve(value)
      }
    }
    if (watchId !== null) navigator.geolocation.clearWatch(watchId)
    watchId = navigator.geolocation.watchPosition(
      (position) => {
        S.here = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          heading: position.coords.heading ?? S.here?.heading ?? null,
        }
        changed()
        settle(S.here)
        if (S.sharing) pushLocation(false)
      },
      () => settle(null),
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

// Sends my position to friends, at most every 20 s unless I moved a fair bit.
async function pushLocation(force: boolean) {
  const here = S.here
  if (!here || !S.userId) return
  const now = Date.now()
  const moved = distance(lastSent.latitude, lastSent.longitude, here.latitude, here.longitude)
  if (!force && now - lastSent.at < 20000 && moved < 40) return
  lastSent = { at: now, latitude: here.latitude, longitude: here.longitude }

  const { data, error } = await supabase
    .from('locations')
    .upsert({ latitude: here.latitude, longitude: here.longitude, accuracy: here.accuracy, heading: here.heading }, { onConflict: 'user_id' })
    .select()
    .single()
  if (error) fail("Couldn't share your location", error)
  else S.locations.set(S.userId, data as Location)
  changed()
}

export async function setSharing(on: boolean) {
  if (!S.userId) return false
  if (on) {
    const here = await watchHere()
    if (!here) return fail("Can't find you: location is blocked or unavailable", null)
    S.sharing = true
    changed()
    await pushLocation(true)
    return true
  }
  S.sharing = false
  changed()
  const { error } = await supabase.from('locations').delete().eq('user_id', S.userId)
  if (error) return fail("Couldn't stop sharing", error)
  S.locations.delete(S.userId)
  changed()
  return true
}
