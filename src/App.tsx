import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  LngLatBounds,
  Map,
  Marker,
  NavigationControl,
  Popup,
  setWorkerUrl,
} from 'maplibre-gl'

import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

import 'maplibre-gl/dist/maplibre-gl.css'
import './App.css'
import type { Session } from '@supabase/supabase-js'
import AuthPanel from './AuthPanel'
import { describeNotification, useInbox, type Incoming } from './inbox'
import NotificationCenter from './NotificationCenter'
import PlacePanel from './PlacePanel'
import PostPanel from './PostPanel'
import ProfilePanel from './ProfilePanel'
import SearchBox from './SearchBox'
import { supabase } from './lib/supabase'
import type {
  AuthMode,
  Flair,
  Interest,
  MapFilter,
  NotificationRow,
  Post,
  PostMedia,
  Profile,
  Reply,
  Saved,
} from './types'
import { ago, avatar, flairIcon, flairs } from './ui'

setWorkerUrl(workerUrl)

type Location = {
  latitude: number
  longitude: number
}

// Posts without a place (older ones) each count as their own place.
const placeKey = (post: Post) => post.place_id ?? post.id

// Great-circle distance in metres, for snapping new posts to nearby places.
function metersBetween(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180
  const dLat = toRadians(b.latitude - a.latitude)
  const dLng = toRadians(b.longitude - a.longitude)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLng / 2) ** 2

  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

// The open panel lives in the URL (#pin/<id>, #user/<id>, #chat/<id>), so the
// back button closes it and any pin, profile or chat can be shared as a link.
function readRoute() {
  const [kind = '', id = ''] = window.location.hash.replace(/^#\/?/, '').split('/')
  return { kind, id }
}

const filterLabels: Record<Exclude<MapFilter['kind'], 'author'>, string> = {
  mine: 'Your pins',
  saved: 'Saved pins',
  replied: "Pins you've replied to",
  others: "Neighbours' pins",
  new: 'Pins with new activity',
  past: 'Resolved pins',
}

function App() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<Map | null>(null)

  const markers = useRef<Marker[]>([])
  const pinElements = useRef(new globalThis.Map<string, HTMLElement>())
  const locationMarker = useRef<Marker | null>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const [posts, setPosts] = useState<Post[]>([])
  const [showAddForm, setShowAddForm] = useState(false)
const [replies, setReplies] = useState<Reply[]>([])
  const [interests, setInterests] = useState<Interest[]>([])
  const [route, setRoute] = useState(readRoute)
  const [mapFilter, setMapFilter] = useState<MapFilter | null>(null)
  const [search, setSearch] = useState('')
  const [hoveredPostId, setHoveredPostId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)


  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [flair, setFlair] = useState<Flair>('general')
  const [mediaFiles, setMediaFiles] = useState<File[]>([])
  const [media, setMedia] = useState<PostMedia[]>([])

  const [selectedLocation, setSelectedLocation] =
    useState<Location | null>(null)

  const [isChoosingLocation, setIsChoosingLocation] =
    useState(false)

  const [locationStatus, setLocationStatus] =
    useState('Finding your location...')

  const [session, setSession] = useState<Session | null>(null)
  const [myProfile, setMyProfile] = useState<Profile | null>(null)
  const [authMode, setAuthMode] = useState<AuthMode | null>(null)
  const [saved, setSaved] = useState<{ owner: string | null; rows: Saved[] }>({
    owner: null,
    rows: [],
  })
  const [desktopAlerts, setDesktopAlerts] = useState(() => {
    try {
      return localStorage.getItem('aroundhere.desktopAlerts') === 'on'
    } catch {
      return false
    }
  })

  const userId = session?.user.id ?? null

  // Derived from the URL; the post object always comes from the live list.
  const selectedPost =
    route.kind === 'pin'
      ? (posts.find((post) => post.id === route.id) ?? null)
      : null
  const profileId =
    route.kind === 'user' ? route.id : route.kind === 'chat' ? userId : null
  const chatWith = route.kind === 'chat' ? route.id : null

  function go(path: string) {
    const url = path
      ? `#${path}`
      : window.location.pathname + window.location.search

    if (window.location.hash !== (path ? `#${path}` : '')) {
      window.history.pushState(null, '', url)
    }

    setRoute(readRoute())
  }

  useEffect(() => {
    const onPop = () => setRoute(readRoute())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  function showToast(message: string) {
    setToast(message)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2500)
  }
  // Ignore a profile or saved pins left over from a previous session.
  const me = myProfile?.id === userId ? myProfile : null
  const savedIds = useMemo(
    () => (saved.owner === userId ? saved.rows.map((row) => row.post_id) : []),
    [saved, userId],
  )
  const savedRows = saved.owner === userId ? saved.rows : []

  // A notification or message arrived: pop a desktop alert if the tab isn't in view.
  function handleIncoming(incoming: Incoming) {
    if (
      !desktopAlerts ||
      typeof Notification === 'undefined' ||
      Notification.permission !== 'granted' ||
      document.visibilityState === 'visible'
    ) {
      return
    }

    const alert =
      incoming.type === 'notification'
        ? new Notification(
            `${incoming.notification.actor_name ?? 'Someone'} ${describeNotification(incoming.notification).text}`,
            { body: incoming.notification.preview ?? '', tag: incoming.notification.id },
          )
        : new Notification('New message on AroundHere', {
            body: incoming.message.body,
            tag: incoming.message.id,
          })

    alert.onclick = () => {
      window.focus()
      if (incoming.type === 'message') go(`chat/${incoming.message.sender_id}`)
      else if (incoming.notification.post_id) go(`pin/${incoming.notification.post_id}`)
      alert.close()
    }
  }

  async function toggleDesktopAlerts() {
    let enabled = !desktopAlerts

    if (enabled && Notification.permission !== 'granted') {
      enabled = (await Notification.requestPermission()) === 'granted'
    }

    setDesktopAlerts(enabled)
    try {
      localStorage.setItem('aroundhere.desktopAlerts', enabled ? 'on' : 'off')
    } catch {
      // Private mode: the choice just won't be remembered.
    }
    showToast(enabled ? 'Desktop alerts on' : 'Desktop alerts off')
  }

  const inbox = useInbox(userId, handleIncoming)
  const unreadTotal = inbox.unreadNotifications + inbox.unreadMessages

  useEffect(() => {
    document.title = unreadTotal > 0 ? `(${unreadTotal}) AroundHere` : 'AroundHere'
  }, [unreadTotal])

  // Pins with unread notifications get a red dot on the map.
  const newActivityIds = useMemo(
    () =>
      new Set(
        inbox.notifications
          .filter((notification) => !notification.read_at)
          .map((notification) => notification.post_id),
      ),
    [inbox.notifications],
  )

  useEffect(() => {
    if (!userId) {
      return
    }

    let ignore = false

    supabase
      .from('saved_posts')
      .select('post_id, created_at')
      .then(({ data, error }) => {
        if (ignore) {
          return
        }

        if (error) {
          console.error('Failed to load saved pins:', error)
          return
        }

        setSaved({ owner: userId, rows: data })
      })

    return () => {
      ignore = true
    }
  }, [userId])

  useEffect(() => {
    // Fires once with the stored session (INITIAL_SESSION), then on every sign-in/out.
    const { data } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession)
      },
    )

    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!userId) {
      return
    }

    let ignore = false

    supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
      .then(({ data, error }) => {
        if (ignore) {
          return
        }

        if (error) {
          console.error('Failed to load profile:', error)
          return
        }

        setMyProfile(data)
      })

    return () => {
      ignore = true
    }
  }, [userId])

  useEffect(() => {
    async function loadPosts() {
      const { data, error } = await supabase
        .from('posts')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Supabase error:', error)
        return
      }

      setPosts(data ?? [])
    }

    // A neighbourhood's replies are small: load them once, then threads,
    // reply counts and "replied to" lists are instant and need no more requests.
    async function loadReplies() {
      const { data, error } = await supabase
        .from('replies')
        .select('*')
        .order('created_at', { ascending: true })

      if (error) {
        console.error('Failed to load replies:', error)
        return
      }

      setReplies(data ?? [])
    }

    async function loadInterests() {
      const { data, error } = await supabase
        .from('post_interest')
        .select('user_id, post_id, created_at')

      if (error) {
        console.error('Failed to load interest:', error)
        return
      }

      setInterests(data ?? [])
    }

    async function loadMedia() {
      const { data, error } = await supabase
        .from('post_media')
        .select('*')
        .order('created_at', { ascending: true })

      if (error) {
        console.error('Failed to load media:', error)
        return
      }

      setMedia(data ?? [])
    }

    loadPosts()
    loadReplies()
    loadInterests()
    loadMedia()

    if (!mapContainer.current || map.current) {
      return
    }

    map.current = new Map({
      container: mapContainer.current,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [138.6007, -34.9285],
      zoom: 15,
    })

    map.current.addControl(
      new NavigationControl(),
      'top-right',
    )

    return () => {
      markers.current.forEach((marker) => marker.remove())
      markers.current = []

      locationMarker.current?.remove()
      locationMarker.current = null

      map.current?.remove()
      map.current = null
    }
  }, [])

  const handlePostChangedLive = useEffectEvent((post: Post) => handlePostChanged(post))
  const forgetPostLive = useEffectEvent((postId: string) => forgetPost(postId))

  useEffect(() => {
  const channel = supabase
    .channel('posts-realtime')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'posts',
      },
      (payload) => {
        const newPost = payload.new as Post

        setPosts((currentPosts) => {
          // Prevent duplicates from our own insert
          if (
            currentPosts.some(
              (post) => post.id === newPost.id,
            )
          ) {
            return currentPosts
          }

          return [newPost, ...currentPosts]
        })
      },
    )
    // Edits, resolves and renames from anyone show up live.
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'posts' },
      (payload) => handlePostChangedLive(payload.new as Post),
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'posts' },
      (payload) => forgetPostLive((payload.old as Post).id),
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}, [])

  useEffect(() => {
    const same = (a: Interest, b: Interest) =>
      a.user_id === b.user_id && a.post_id === b.post_id

    const channel = supabase
      .channel('interest-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'post_interest' },
        (payload) => {
          const row = payload.new as Interest
          setInterests((current) =>
            current.some((existing) => same(existing, row)) ? current : [...current, row],
          )
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'post_media' },
        (payload) => {
          const row = payload.new as PostMedia
          setMedia((current) =>
            current.some((existing) => existing.id === row.id) ? current : [...current, row],
          )
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'post_interest' },
        (payload) => {
          const row = payload.old as Interest
          setInterests((current) => current.filter((existing) => !same(existing, row)))
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
  const channel = supabase
    .channel('replies-realtime')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'replies',
      },
      (payload) => {
        const newReply = payload.new as Reply

        // Replies for other threads are harmless: the panel only shows
        // replies whose post_id matches the open thread.
        setReplies((currentReplies) => {
          if (
            currentReplies.some(
              (reply) => reply.id === newReply.id,
            )
          ) {
            return currentReplies
          }

          return [...currentReplies, newReply]
        })
      },
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}, [])

  const replyCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const reply of replies) counts[reply.post_id] = (counts[reply.post_id] ?? 0) + 1
    return counts
  }, [replies])

  const interestCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const interest of interests) counts[interest.post_id] = (counts[interest.post_id] ?? 0) + 1
    return counts
  }, [interests])

  const repliedByMe = useMemo(
    () =>
      new Set(
        replies
          .filter((reply) => userId && reply.author_id === userId)
          .map((reply) => reply.post_id),
      ),
    [replies, userId],
  )

  function matchesFilter(post: Post, filter: MapFilter | null) {
    switch (filter?.kind) {
      case undefined:
        return !post.resolved_at
      case 'past':
        return !!post.resolved_at
      case 'mine':
        return post.author_id === userId
      case 'saved':
        return savedIds.includes(post.id)
      case 'replied':
        return repliedByMe.has(post.id)
      case 'others':
        return post.author_id !== userId && !post.resolved_at
      case 'new':
        return newActivityIds.has(post.id) && !post.resolved_at
      case 'author':
        return post.author_id === filter.authorId
    }
  }

  const query = search.trim().toLowerCase()
  const visiblePosts = posts.filter(
    (post) =>
      matchesFilter(post, mapFilter) &&
      (!query ||
        [post.title, post.description, post.author_name ?? ''].some((text) =>
          text.toLowerCase().includes(query),
        )),
  )
  const visibleKey = visiblePosts.map((post) => post.id).join(',')

  // Called from marker listeners, so it always sees the latest go().
  const openRoute = useEffectEvent((path: string) => go(path))

  useEffect(() => {
    if (!map.current) {
      return
    }

    markers.current.forEach((marker) => marker.remove())
    pinElements.current.clear()

    const visible = new Set(visibleKey.split(','))

    // One marker per place (posts within ~30 m), showing the newest post's
    // flair; a number when several threads share the spot. Black if any are
    // yours, gold if saved, a red dot for unread activity.
    const places = new globalThis.Map<string, Post[]>()
    for (const post of posts) {
      if (!visible.has(post.id)) continue
      const key = placeKey(post)
      places.set(key, [...(places.get(key) ?? []), post])
    }

    markers.current = [...places.entries()].map(([key, placePosts]) => {
      // posts are newest first
      const newest = placePosts[0]
      const element = document.createElement('div')
      element.className = [
        'pin',
        userId && placePosts.some((post) => post.author_id === userId) && 'mine',
        placePosts.some((post) => savedIds.includes(post.id)) && 'saved',
        placePosts.some((post) => newActivityIds.has(post.id)) && 'new',
        placePosts.every((post) => post.resolved_at) && 'resolved',
      ]
        .filter(Boolean)
        .join(' ')
      element.setAttribute(
        'aria-label',
        placePosts.length === 1 ? newest.title : `${placePosts.length} threads here`,
      )
      element.innerHTML = '<div class="pin-head"><span></span></div>'
      element.querySelector('span')!.textContent = flairIcon(newest.flair)

      if (placePosts.length > 1) {
        const count = document.createElement('b')
        count.className = 'pin-count'
        count.textContent = String(placePosts.length)
        element.append(count)
      }

      element.addEventListener('click', () =>
        openRoute(placePosts.length === 1 ? `pin/${newest.id}` : `place/${key}`),
      )
      element.addEventListener('mouseenter', () => setHoveredPostId(newest.id))
      element.addEventListener('mouseleave', () => setHoveredPostId(null))

      for (const post of placePosts) pinElements.current.set(post.id, element)

      return new Marker({ element, anchor: 'bottom' })
        .setLngLat([newest.longitude, newest.latitude])
        .addTo(map.current!)
    })
  }, [posts, visibleKey, savedIds, newActivityIds, userId])

  // Hover and "open" states just toggle classes; no need to rebuild markers.
  const selectedPostId = selectedPost?.id ?? null

  useEffect(() => {
    for (const [id, element] of pinElements.current) {
      element.classList.toggle('hover', id === hoveredPostId)
      element.classList.toggle('active', id === selectedPostId)
    }
  }, [hoveredPostId, selectedPostId, posts, visibleKey, replyCounts, savedIds, newActivityIds, userId])

  // A quick look at a pin without opening it: hover it on the map, or hover
  // its row in a list.
  useEffect(() => {
    const post = posts.find((candidate) => candidate.id === hoveredPostId)

    if (!map.current || !post || post.id === selectedPostId) {
      return
    }

    const card = document.createElement('div')
    card.className = 'pin-preview'
    const title = document.createElement('strong')
    title.textContent = post.title
    const meta = document.createElement('div')
    meta.className = 'pin-preview-meta'
    meta.textContent = [
      `${flairIcon(post.flair)} ${post.author_name ?? 'Anonymous'}`,
      ago(post.created_at),
      `💬 ${replyCounts[post.id] ?? 0}`,
      interestCounts[post.id] ? `👍 ${interestCounts[post.id]}` : null,
    ]
      .filter(Boolean)
      .join(' · ')
    const description = document.createElement('div')
    description.className = 'pin-preview-description'
    description.textContent = post.description
    card.append(title, meta, description)

    const others = posts.filter(
      (candidate) => candidate.id !== post.id && placeKey(candidate) === placeKey(post),
    ).length
    if (others > 0) {
      const more = document.createElement('div')
      more.className = 'pin-preview-meta'
      more.textContent = `+ ${others} more ${others === 1 ? 'thread' : 'threads'} here`
      card.append(more)
    }

    const popup = new Popup({
      closeButton: false,
      closeOnClick: false,
      offset: [0, -42],
      className: 'pin-popup',
      maxWidth: '260px',
    })
      .setLngLat([post.longitude, post.latitude])
      .setDOMContent(card)
      .addTo(map.current)

    return () => {
      popup.remove()
    }
  }, [hoveredPostId, selectedPostId, posts, replyCounts, interestCounts])

  // Bring the open pin into view if it's off-screen or hidden behind the panel.
  const revealSelected = useEffectEvent(() => {
    const current = map.current

    if (!current || !selectedPost) {
      return
    }

    const center: [number, number] = [selectedPost.longitude, selectedPost.latitude]
    const point = current.project(center)
    const { width, height } = current.getContainer().getBoundingClientRect()

    if (point.x < 40 || point.x > width - 420 || point.y < 100 || point.y > height - 40) {
      current.flyTo({
        center,
        zoom: Math.max(current.getZoom(), 14),
        padding: { top: 0, bottom: 0, left: 0, right: 380 },
        duration: 700,
      })
    }
  })

  useEffect(() => {
    revealSelected()
  }, [selectedPostId, posts.length])

  // Narrow the map and zoom to fit what's left.
  function applyFilter(filter: MapFilter | null) {
    setMapFilter(filter)

    const matching = posts.filter((post) => matchesFilter(post, filter))

    if (!filter || !map.current || matching.length === 0) {
      return
    }

    const bounds = new LngLatBounds()
    for (const post of matching) bounds.extend([post.longitude, post.latitude])

    map.current.fitBounds(bounds, {
      padding: { top: 110, bottom: 80, left: 80, right: profileId || selectedPost ? 420 : 80 },
      maxZoom: 15,
      duration: 700,
    })
  }

  function toggleFilter(filter: MapFilter) {
    applyFilter(mapFilter?.kind === filter.kind ? null : filter)
  }

async function createReply(postId: string, content: string) {
  const { data, error } = await supabase
    .from('replies')
    .insert({ post_id: postId, content })
    .select()
    .single()

  if (error) {
    console.error('Failed to create reply:', error)
    showToast("Couldn't post your reply, try again")
    return false
  }

  // Realtime may have delivered it first.
  setReplies((currentReplies) =>
    currentReplies.some((reply) => reply.id === data.id)
      ? currentReplies
      : [...currentReplies, data],
  )
  return true
}

// After the author edits or resolves a pin (realtime tells everyone else).
function handlePostChanged(post: Post) {
  setPosts((currentPosts) =>
    currentPosts.map((current) => (current.id === post.id ? post : current)),
  )
}

function forgetPost(postId: string) {
  setPosts((currentPosts) => currentPosts.filter((post) => post.id !== postId))
  setReplies((currentReplies) => currentReplies.filter((reply) => reply.post_id !== postId))
  setInterests((current) => current.filter((interest) => interest.post_id !== postId))
}

function handlePostDeleted(postId: string) {
  forgetPost(postId)
  go('')
  showToast('Pin deleted')
}

  function setLocation(location: Location) {
    setSelectedLocation(location)

    locationMarker.current?.remove()

    if (!map.current) {
      return
    }

    const dot = document.createElement('div')
    dot.className = 'location-dot'

    locationMarker.current = new Marker({ element: dot })
      .setLngLat([
        location.longitude,
        location.latitude,
      ])
      .addTo(map.current)

    map.current.flyTo({
      center: [
        location.longitude,
        location.latitude,
      ],
      zoom: 15,
    })
  }

  function requestCurrentLocation() {
    setLocationStatus('Finding your location...')

    if (!navigator.geolocation) {
      setLocationStatus(
        'Location unavailable. Choose a location on the map.',
      )

      setIsChoosingLocation(true)
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }

        setLocation(location)
        setLocationStatus('Using your current location')
      },
      () => {
        setLocationStatus(
          'Location unavailable. Choose a location on the map.',
        )

        setIsChoosingLocation(true)
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
      },
    )
  }

  function handleOpenForm() {
    if (!session) {
      setAuthMode('signup')
      return
    }

    setShowAddForm(true)
    setIsChoosingLocation(false)
    requestCurrentLocation()
  }

  async function handleCreatePost() {
  if (!title.trim() || !description.trim() || !selectedLocation) {
    return
  }

  // Posts within 30 m of an existing place join it and share its marker.
  // Every place already has posts in memory, so no extra request is needed.
  const nearby = posts.find(
    (post) =>
      post.place_id &&
      metersBetween(post, selectedLocation) <= 30,
  )

  let place = nearby
    ? { id: nearby.place_id!, latitude: nearby.latitude, longitude: nearby.longitude }
    : null

  if (!place) {
    const { data: newPlace, error: placeError } = await supabase
      .from('places')
      .insert({
        latitude: selectedLocation.latitude,
        longitude: selectedLocation.longitude,
      })
      .select()
      .single()

    if (placeError) {
      console.error('Failed to create place:', placeError)
      showToast("Couldn't save the location, try again")
      return
    }

    place = newPlace
  }

  const { data, error } = await supabase
    .from('posts')
    .insert({
      place_id: place!.id,
      title: title.trim(),
      description: description.trim(),
      latitude: place!.latitude,
      longitude: place!.longitude,
      flair,
    })
    .select()
    .single()

  if (error) {
    console.error('Failed to create post:', error)
    alert('Failed to create thread.')
    return
  }

  // Photos and videos go to storage in a folder named after the post.
  for (const file of mediaFiles) {
    const extension = file.name.split('.').pop() ?? 'file'
    const path = `${data.id}/${crypto.randomUUID()}.${extension}`

    const { error: uploadError } = await supabase.storage
      .from('post-media')
      .upload(path, file)

    if (uploadError) {
      console.error('Failed to upload media:', uploadError)
      showToast(`Couldn't upload ${file.name}`)
      continue
    }

    const { data: row, error: mediaError } = await supabase
      .from('post_media')
      .insert({
        post_id: data.id,
        media_type: file.type.startsWith('video/') ? 'video' : 'image',
        url: supabase.storage.from('post-media').getPublicUrl(path).data.publicUrl,
      })
      .select()
      .single()

    if (mediaError) {
      console.error('Failed to save media record:', mediaError)
      continue
    }

    setMedia((current) =>
      current.some((existing) => existing.id === row.id) ? current : [...current, row],
    )
  }

  // Immediately show the new marker; realtime may have added it already.
  setPosts((currentPosts) =>
    currentPosts.some((post) => post.id === data.id)
      ? currentPosts
      : [data, ...currentPosts],
  )

  // Close the form and open the new pin, so you see what neighbours see.
  handleCloseForm()
  go(`pin/${data.id}`)
  showToast('Pinned! Neighbours can see it now')
}

  function handleCloseForm() {
    setShowAddForm(false)
    setIsChoosingLocation(false)

    setTitle('')
    setDescription('')
    setFlair('general')
    setMediaFiles([])
    setSelectedLocation(null)

    locationMarker.current?.remove()
    locationMarker.current = null
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    handleCloseForm()
    setMapFilter(null)
    go('')
  }

  function openProfile(id: string) {
    go(`user/${id}`)
  }

  // Your own profile is the menu; pass someone's id to open your chat with them.
  function openMenu(withUser: string | null = null) {
    if (userId) {
      go(withUser ? `chat/${withUser}` : `user/${userId}`)
    }
  }

  function openNotification(notification: NotificationRow) {
    inbox.markNotificationsRead([notification.id])

    const post = posts.find((candidate) => candidate.id === notification.post_id)

    if (post) {
      openPostFromProfile(post)
    }
  }

  async function toggleSave(postId: string) {
    const isSaved = savedIds.includes(postId)

    const { error } = isSaved
      ? await supabase.from('saved_posts').delete().eq('post_id', postId)
      : await supabase.from('saved_posts').insert({ post_id: postId })

    if (error) {
      console.error('Failed to update saved pins:', error)
      showToast("Couldn't update your saved pins")
      return
    }

    setSaved({
      owner: userId,
      rows: isSaved
        ? savedRows.filter((row) => row.post_id !== postId)
        : [...savedRows, { post_id: postId, created_at: new Date().toISOString() }],
    })
    showToast(isSaved ? 'Removed from your saved pins' : 'Saved to your pins ★')
  }

  async function toggleInterest(postId: string) {
    if (!userId) {
      setAuthMode('signup')
      return
    }

    const mine = (interest: Interest) =>
      interest.post_id === postId && interest.user_id === userId
    const wasInterested = interests.some(mine)

    // Show it straight away; the database catches up.
    setInterests((current) =>
      wasInterested
        ? current.filter((interest) => !mine(interest))
        : [...current, { user_id: userId, post_id: postId, created_at: new Date().toISOString() }],
    )

    const { error } = wasInterested
      ? await supabase.from('post_interest').delete().eq('post_id', postId).eq('user_id', userId)
      : await supabase.from('post_interest').insert({ post_id: postId })

    if (error) {
      console.error('Failed to update interest:', error)
      setInterests((current) =>
        wasInterested
          ? [...current, { user_id: userId, post_id: postId, created_at: new Date().toISOString() }]
          : current.filter((interest) => !mine(interest)),
      )
      showToast("Couldn't update, try again")
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      showToast('Link copied')
    } catch {
      showToast(window.location.href)
    }
  }

  function openPostFromProfile(post: Post) {
    go(`pin/${post.id}`)
  }

  // Esc closes whatever is on top; / searches; N drops a new pin.
  const handleKey = useEffectEvent((event: KeyboardEvent) => {
    const typing =
      event.target instanceof HTMLElement &&
      event.target.closest('input, textarea') !== null

    if (event.key === 'Escape') {
      if (authMode) setAuthMode(null)
      else if (chatWith) go(`user/${userId}`)
      else if (route.kind) go('')
      else if (showAddForm) handleCloseForm()
      else if (mapFilter) setMapFilter(null)
      else return

      event.preventDefault()
      return
    }

    if (typing || event.metaKey || event.ctrlKey || event.altKey) {
      return
    }

    if (event.key === '/') {
      event.preventDefault()
      searchInput.current?.focus()
    } else if (event.key === 'n' || event.key === 'N') {
      event.preventDefault()
      handleOpenForm()
    }
  })

  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleKey(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  // The database renames old posts and replies too; mirror that locally.
  function handleProfileSaved(profile: Profile) {
    setMyProfile(profile)

    setPosts((currentPosts) =>
      currentPosts.map((post) =>
        post.author_id === profile.id
          ? { ...post, author_name: profile.display_name }
          : post,
      ),
    )

    setReplies((currentReplies) =>
      currentReplies.map((reply) =>
        reply.author_id === profile.id
          ? { ...reply, author_name: profile.display_name }
          : reply,
      ),
    )
  }

  useEffect(() => {
    if (!map.current || !isChoosingLocation) {
      return
    }

    function handleMapClick(event: {
      lngLat: {
        lng: number
        lat: number
      }
    }) {
      setLocation({
        latitude: event.lngLat.lat,
        longitude: event.lngLat.lng,
      })

      setLocationStatus('Location selected')
      setIsChoosingLocation(false)
    }

    map.current.on('click', handleMapClick)

    return () => {
      map.current?.off('click', handleMapClick)
    }
  }, [isChoosingLocation])

  const interestedIds = selectedPost
    ? interests
        .filter((interest) => interest.post_id === selectedPost.id)
        .map((interest) => interest.user_id)
    : []

  const threadReplies = selectedPost
    ? replies.filter((reply) => reply.post_id === selectedPost.id)
    : []

  const placePosts = route.kind === 'place'
    ? posts.filter((post) => placeKey(post) === route.id)
    : []
  const selectedPlacePosts = selectedPost
    ? posts.filter((post) => placeKey(post) === placeKey(selectedPost))
    : []

  return (
    <div className="app">
      <div ref={mapContainer} className="map-canvas" />

      {/* Header */}
      <header
        style={{
          position: 'absolute',
          top: '16px',
          left: '16px',
          zIndex: 10,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            background: 'white',
            padding: '12px 20px',
            borderRadius: '16px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
            fontFamily: 'Arial, sans-serif',
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: '20px',
              fontWeight: 700,
              color: '#111',
            }}
          >
            AroundHere
          </h1>

          <SearchBox
            query={search}
            onQuery={setSearch}
            results={visiblePosts}
            onOpen={(post) => go(`pin/${post.id}`)}
            inputRef={searchInput}
          />

          {session && (
            <button
              onClick={() => go(route.kind === 'notifications' ? '' : 'notifications')}
              className="bell"
              aria-label={unreadTotal > 0 ? `Notifications, ${unreadTotal} unread` : 'Notifications'}
              aria-pressed={route.kind === 'notifications'}
              title="Notifications"
            >
              🔔
              {unreadTotal > 0 && (
                <span className="bell-badge" title={`${unreadTotal} unread`}>
                  {unreadTotal > 99 ? '99+' : unreadTotal}
                </span>
              )}
            </button>
          )}

          {session && (
            <button
              onClick={() => openMenu()}
              title="Your profile, pins and messages"
              className="row"
              style={{ width: 'auto', padding: '4px 8px 4px 4px', fontWeight: 600 }}
            >
              {avatar(userId, me?.display_name ?? null, 28)}
              {me?.display_name ?? session.user.email}
            </button>
          )}

          <button
            onClick={session ? handleSignOut : () => setAuthMode('login')}
            style={{
              border: '1px solid #ccc',
              background: 'white',
              color: '#222',
              padding: '8px 14px',
              borderRadius: '999px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {session ? 'Log out' : 'Log in'}
          </button>
        </div>
      </header>

      {session && (
        <div className="legend" role="group" aria-label="Show only">
          {(
            [
              ['mine', 'Yours', '#111'],
              ['saved', 'Saved', '#f59e0b'],
              ['others', 'Neighbours', '#2563eb'],
              ['new', 'New activity', '#dc2626'],
              ['past', 'Past', '#9ca3af'],
            ] as const
          ).map(([kind, label, color]) => (
            <button
              key={kind}
              className={mapFilter?.kind === kind ? 'active' : ''}
              aria-pressed={mapFilter?.kind === kind}
              title={mapFilter?.kind === kind ? 'Show all pins' : `Show only ${label.toLowerCase()}`}
              onClick={() => toggleFilter({ kind })}
            >
              <i style={{ background: color }} />
              {label}
            </button>
          ))}
        </div>
      )}

      {(mapFilter || query) && (
        <div className="filter-chip">
          {mapFilter
            ? mapFilter.kind === 'author'
              ? `${mapFilter.name}'s pins`
              : filterLabels[mapFilter.kind]
            : `“${search.trim()}”`}
          {mapFilter && query && ` matching “${search.trim()}”`}
          <span className="filter-count">{visiblePosts.length}</span>
          <button
            aria-label="Show all pins"
            onClick={() => {
              setMapFilter(null)
              setSearch('')
            }}
          >
            ×
          </button>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      {/* Add button */}
      {!showAddForm && (
        <button
          onClick={handleOpenForm}
          style={{
            position: 'absolute',
            right: '24px',
            bottom: '24px',
            zIndex: 10,
            border: 'none',
            borderRadius: '999px',
            background: '#000',
            color: '#fff',
            padding: '16px 24px',
            fontSize: '18px',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          }}
        >
          + Add
        </button>
      )}
      {/* Thread details */}
{placePosts.length > 0 && (
  <PlacePanel
    posts={placePosts}
    replyCounts={replyCounts}
    onOpenPost={(post) => go(`pin/${post.id}`)}
    onHoverPost={setHoveredPostId}
    onClose={() => go('')}
  />
)}

{selectedPost && (
  <PostPanel
    key={selectedPost.id}
    post={selectedPost}
    media={media.filter((item) => item.post_id === selectedPost.id)}
    placeCount={selectedPlacePosts.length}
    onBackToPlace={() => go(`place/${placeKey(selectedPost)}`)}
    replies={threadReplies}
    userId={userId}
    saved={savedIds.includes(selectedPost.id)}
    interestedIds={interestedIds}
    onClose={() => go('')}
    onOpenProfile={openProfile}
    onMessage={(authorId) => openMenu(authorId)}
    onToggleSave={() => toggleSave(selectedPost.id)}
    onToggleInterest={() => toggleInterest(selectedPost.id)}
    onCopyLink={copyLink}
    onSignUp={() => setAuthMode('signup')}
    onReply={(text) => createReply(selectedPost.id, text)}
    onChanged={handlePostChanged}
    onDeleted={handlePostDeleted}
  />
)}

{route.kind === 'notifications' && userId && (
  <NotificationCenter
    userId={userId}
    inbox={inbox}
    desktop={{
      permission: typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
      enabled: desktopAlerts,
      onToggle: toggleDesktopAlerts,
    }}
    onOpenNotification={openNotification}
    onChat={(otherId) => go(`chat/${otherId}`)}
    onHoverPost={setHoveredPostId}
    onClose={() => go('')}
  />
)}

      {/* Location selection message */}
      {showAddForm && isChoosingLocation && (
        <div
          style={{
            position: 'absolute',
            top: '20px',
            left: '390px',
            zIndex: 20,
            background: 'white',
            padding: '14px 20px',
            borderRadius: '14px',
            boxShadow: '0 4px 15px rgba(0, 0, 0, 0.25)',
            fontFamily: 'Arial, sans-serif',
          }}
        >
          <strong>
            Tap the map to choose a location
          </strong>
        </div>
      )}

      {/* Side panel */}
      {showAddForm && (
        <aside
          style={{
            position: 'absolute',
            top: '16px',
            left: '16px',
            bottom: '16px',
            width: '340px',
            zIndex: 20,
            background: 'white',
            borderRadius: '20px',
            padding: '24px',
            boxSizing: 'border-box',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.25)',
            fontFamily: 'Arial, sans-serif',
            overflowY: 'auto',
          }}
        >
          <h2
            style={{
              margin: '0 0 24px',
              fontSize: '24px',
              fontWeight: 700,
              color: '#111',
            }}
          >
            Create a thread
          </h2>

          <label
            style={{
              display: 'block',
              marginBottom: '6px',
              fontWeight: 600,
              color: '#333',
            }}
          >
            Title
          </label>

          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. BBQ tonight"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '12px',
              marginBottom: '20px',
              border: '1px solid #ccc',
              borderRadius: '10px',
              fontSize: '16px',
            }}
          />

          <label
            style={{
              display: 'block',
              marginBottom: '6px',
              fontWeight: 600,
              color: '#333',
            }}
          >
            Description
          </label>

          <textarea
            value={description}
            onChange={(event) =>
              setDescription(event.target.value)
            }
            placeholder="What's happening?"
            rows={6}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '12px',
              marginBottom: '20px',
              border: '1px solid #ccc',
              borderRadius: '10px',
              fontSize: '16px',
              resize: 'vertical',
            }}
          />

          <div className="form-label">Flair</div>
          <div className="flair-picker" role="radiogroup" aria-label="Flair">
            {(Object.keys(flairs) as Flair[]).map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={flair === key}
                onClick={() => setFlair(key)}
              >
                {flairs[key].icon} {flairs[key].label}
              </button>
            ))}
          </div>

          <div className="form-label">Photos or videos</div>
          <label className="media-picker">
            <input
              type="file"
              accept="image/*,video/*"
              multiple
              onChange={(event) => setMediaFiles(Array.from(event.target.files ?? []))}
            />
            {mediaFiles.length === 0
              ? '📷 Add photos or videos'
              : `📎 ${mediaFiles.length} file${mediaFiles.length === 1 ? '' : 's'} selected`}
          </label>

          {/* Location */}
          <div
            style={{
              border: '1px solid #ddd',
              borderRadius: '12px',
              padding: '14px',
              marginBottom: '24px',
            }}
          >
            <div
              style={{
                fontSize: '13px',
                color: '#666',
                marginBottom: '6px',
              }}
            >
              Location
            </div>

            <div
              style={{
                fontWeight: 600,
                color: '#222',
                marginBottom: '12px',
              }}
            >
              📍 {locationStatus}
            </div>

            <button
              onClick={() => {
                setIsChoosingLocation(true)
                setLocationStatus(
                  'Tap the map to choose a location',
                )
              }}
              style={{
                width: '100%',
                border: 'none',
                background: '#f3f4f6',
                color: '#222',
                padding: '11px 14px',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Change location
            </button>
          </div>

          {/* Actions */}
          <div
            style={{
              display: 'flex',
              gap: '10px',
            }}
          >
            <button
              onClick={handleCloseForm}
              style={{
                flex: 1,
                border: '1px solid #ccc',
                background: 'white',
                color: '#333',
                padding: '12px',
                borderRadius: '10px',
                fontSize: '16px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>

            <button
              onClick={handleCreatePost}
              disabled={
                !title.trim() ||
                !description.trim() ||
                !selectedLocation
              }
              style={{
                flex: 1,
                border: 'none',
                background:
                  !title.trim() ||
                  !description.trim() ||
                  !selectedLocation
                    ? '#ccc'
                    : '#000',
                color: 'white',
                padding: '12px',
                borderRadius: '10px',
                fontSize: '16px',
                fontWeight: 600,
                cursor:
                  !title.trim() ||
                  !description.trim() ||
                  !selectedLocation
                    ? 'not-allowed'
                    : 'pointer',
              }}
            >
              Post
            </button>
          </div>
        </aside>
      )}

      {profileId && (
        <ProfilePanel
          key={profileId}
          profileId={profileId}
          seed={profileId === userId ? me : null}
          own={
            profileId === userId
              ? {
                  email: session?.user.email ?? '',
                  inbox,
                  chatWith,
                  onChat: (otherId) =>
                    go(otherId ? `chat/${otherId}` : `user/${userId}`),
                  onOpenNotification: openNotification,
                  onOpenProfile: openProfile,
                  onSeeAllNotifications: () => go('notifications'),
                  onChangePassword: () => setAuthMode('new-password'),
                  onSignOut: handleSignOut,
                }
              : null
          }
          posts={posts}
          replies={replies}
          interests={interests}
          saved={savedRows}
          onOpenPost={openPostFromProfile}
          onHoverPost={setHoveredPostId}
          onFilter={applyFilter}
          onSaved={handleProfileSaved}
          onMessage={
            userId && profileId !== userId
              ? () => openMenu(profileId)
              : null
          }
          onClose={() => go('')}
        />
      )}

      {authMode && (
        <AuthPanel
          initialMode={authMode}
          onClose={() => setAuthMode(null)}
        />
      )}
    </div>
  )
}

export default App