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
import { useInbox, useNames } from './inbox'
import ProfilePanel from './ProfilePanel'
import SearchBox from './SearchBox'
import { supabase } from './lib/supabase'
import type {
  AuthMode,
  Interest,
  MapFilter,
  NotificationRow,
  Post,
  Profile,
  Reply,
} from './types'
import { ago, avatar, linkButtonStyle, rightPanelStyle } from './ui'

setWorkerUrl(workerUrl)

type Location = {
  latitude: number
  longitude: number
}

// The open panel lives in the URL (#pin/<id>, #user/<id>, #chat/<id>), so the
// back button closes it and any pin, profile or chat can be shared as a link.
function readRoute() {
  const [kind = '', id = ''] = window.location.hash.replace(/^#\/?/, '').split('/')
  return { kind, id }
}

// "You", "You and Sam", "You, Sam and 3 others" ... are interested.
function describeInterested(names: string[]) {
  const verb = names.length === 1 && names[0] !== 'You' ? 'is' : 'are'

  if (names.length <= 2) return `${names.join(' and ')} ${verb} interested`

  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} ${names.length === 3 ? 'other' : 'others'} are interested`
}

const filterLabels: Record<Exclude<MapFilter['kind'], 'author'>, string> = {
  mine: 'Your pins',
  saved: 'Saved pins',
  replied: "Pins you've replied to",
  others: "Neighbours' pins",
  new: 'Pins with new activity',
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
const [replyText, setReplyText] = useState('')
  const [interests, setInterests] = useState<Interest[]>([])
  const [route, setRoute] = useState(readRoute)
  const [mapFilter, setMapFilter] = useState<MapFilter | null>(null)
  const [search, setSearch] = useState('')
  const [hoveredPostId, setHoveredPostId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)


  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  const [selectedLocation, setSelectedLocation] =
    useState<Location | null>(null)

  const [isChoosingLocation, setIsChoosingLocation] =
    useState(false)

  const [locationStatus, setLocationStatus] =
    useState('Finding your location...')

  const [session, setSession] = useState<Session | null>(null)
  const [myProfile, setMyProfile] = useState<Profile | null>(null)
  const [authMode, setAuthMode] = useState<AuthMode | null>(null)
  const [saved, setSaved] = useState<{ owner: string | null; ids: string[] }>({
    owner: null,
    ids: [],
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
    () => (saved.owner === userId ? saved.ids : []),
    [saved, userId],
  )

  const inbox = useInbox(userId)
  const unreadTotal = inbox.unreadNotifications + inbox.unreadMessages

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
      .select('post_id')
      .then(({ data, error }) => {
        if (ignore) {
          return
        }

        if (error) {
          console.error('Failed to load saved pins:', error)
          return
        }

        setSaved({ owner: userId, ids: data.map((row) => row.post_id) })
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
        .select('user_id, post_id')

      if (error) {
        console.error('Failed to load interest:', error)
        return
      }

      setInterests(data ?? [])
    }

    loadPosts()
    loadReplies()
    loadInterests()

    if (!mapContainer.current || map.current) {
      return
    }

    map.current = new Map({
      container: mapContainer.current,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [138.6007, -34.9285],
      zoom: 12,
    })

    map.current.addControl(
      new NavigationControl(),
      'bottom-right',
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
        return true
      case 'mine':
        return post.author_id === userId
      case 'saved':
        return savedIds.includes(post.id)
      case 'replied':
        return repliedByMe.has(post.id)
      case 'others':
        return post.author_id !== userId
      case 'new':
        return newActivityIds.has(post.id)
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
  const openPin = useEffectEvent((postId: string) => go(`pin/${postId}`))

  useEffect(() => {
    if (!map.current) {
      return
    }

    markers.current.forEach((marker) => marker.remove())
    pinElements.current.clear()

    const visible = new Set(visibleKey.split(','))

    // Your pins are black, saved pins gold, the rest blue; a red dot means
    // unread activity. The number is the reply count.
    markers.current = posts
      .filter((post) => visible.has(post.id))
      .map((post) => {
        const element = document.createElement('div')
        element.className = [
          'pin',
          userId && post.author_id === userId && 'mine',
          savedIds.includes(post.id) && 'saved',
          newActivityIds.has(post.id) && 'new',
        ]
          .filter(Boolean)
          .join(' ')
        element.setAttribute('aria-label', post.title)
        element.innerHTML = '<div class="pin-head"><span></span></div>'
        element.querySelector('span')!.textContent = replyCounts[post.id]
          ? String(replyCounts[post.id])
          : ''

        element.addEventListener('click', () => openPin(post.id))
        element.addEventListener('mouseenter', () => setHoveredPostId(post.id))
        element.addEventListener('mouseleave', () => setHoveredPostId(null))

        pinElements.current.set(post.id, element)

        return new Marker({ element, anchor: 'bottom' })
          .setLngLat([post.longitude, post.latitude])
          .addTo(map.current!)
      })
  }, [posts, visibleKey, replyCounts, savedIds, newActivityIds, userId])

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
      post.author_name ?? 'Anonymous',
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

async function handleCreateReply() {
  if (!selectedPost || !replyText.trim()) {
    return
  }

  const { data, error } = await supabase
    .from('replies')
    .insert({
      post_id: selectedPost.id,
      content: replyText.trim(),
    })
    .select()
    .single()

  if (error) {
    console.error('Failed to create reply:', error)
    alert('Failed to post reply.')
    return
  }

  setReplies((currentReplies) => [
    ...currentReplies,
    data,
  ])

  setReplyText('')
}

  function setLocation(location: Location) {
    setSelectedLocation(location)

    locationMarker.current?.remove()

    if (!map.current) {
      return
    }

    locationMarker.current = new Marker({
      color: '#000000',
    })
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

  const { data, error } = await supabase
    .from('posts')
    .insert({
      title: title.trim(),
      description: description.trim(),
      latitude: selectedLocation.latitude,
      longitude: selectedLocation.longitude,
    })
    .select()
    .single()

  if (error) {
    console.error('Failed to create post:', error)
    alert('Failed to create thread.')
    return
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
      ids: isSaved
        ? savedIds.filter((id) => id !== postId)
        : [...savedIds, postId],
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
        : [...current, { user_id: userId, post_id: postId }],
    )

    const { error } = wasInterested
      ? await supabase.from('post_interest').delete().eq('post_id', postId).eq('user_id', userId)
      : await supabase.from('post_interest').insert({ post_id: postId })

    if (error) {
      console.error('Failed to update interest:', error)
      setInterests((current) =>
        wasInterested
          ? [...current, { user_id: userId, post_id: postId }]
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
  const interestedHere = userId !== null && interestedIds.includes(userId)
  const interestedNames = useNames(interestedIds)

  const threadReplies = selectedPost
    ? replies.filter((reply) => reply.post_id === selectedPost.id)
    : []

  return (
    <div
      ref={mapContainer}
      style={{
        width: '100%',
        height: '100vh',
      }}
    >
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
              onClick={() => openMenu()}
              title="Your profile, pins and messages"
              className="row"
              style={{ width: 'auto', padding: '4px 8px 4px 4px', fontWeight: 600 }}
            >
              {avatar(userId, me?.display_name ?? null, 28)}
              {me?.display_name ?? session.user.email}
              {unreadTotal > 0 && (
                <span
                  title={`${unreadTotal} unread`}
                  style={{
                    marginLeft: '6px',
                    padding: '1px 7px',
                    borderRadius: '999px',
                    background: '#dc2626',
                    color: 'white',
                    fontSize: '12px',
                    fontWeight: 700,
                    display: 'inline-block',
                  }}
                >
                  {unreadTotal}
                </span>
              )}
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
{selectedPost && (
  <aside className="menu" style={rightPanelStyle}>
    <button
      onClick={() => go('')}
      aria-label="Close"
      style={{
        float: 'right',
        border: 'none',
        background: 'transparent',
        fontSize: '24px',
        lineHeight: 1,
        cursor: 'pointer',
        padding: 0,
      }}
    >
      ×
    </button>

    {selectedPost.author_id ? (
      <button
        className="row"
        onClick={() => openProfile(selectedPost.author_id!)}
        style={{ width: 'auto', padding: '4px 10px 4px 4px', marginBottom: '12px' }}
      >
        {avatar(selectedPost.author_id, selectedPost.author_name, 36)}
        <div className="row-main">
          <div style={{ fontWeight: 600 }}>{selectedPost.author_name}</div>
          <div className="row-meta">Posted {ago(selectedPost.created_at)}</div>
        </div>
      </button>
    ) : (
      <div className="row-meta" style={{ marginBottom: '12px' }}>
        Posted {ago(selectedPost.created_at)}
      </div>
    )}

    <h2 style={{ margin: '0 0 8px', fontSize: '24px', color: '#111' }}>
      {selectedPost.title}
    </h2>

    <p
      style={{
        margin: '0 0 16px',
        fontSize: '16px',
        lineHeight: 1.5,
        color: '#444',
        whiteSpace: 'pre-wrap',
      }}
    >
      {selectedPost.description}
    </p>

    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
      <button
        className={interestedHere ? 'pill on-blue' : 'pill'}
        aria-pressed={interestedHere}
        onClick={() => toggleInterest(selectedPost.id)}
        title={session ? undefined : 'Sign up to show interest'}
      >
        👍 Interested{interestedIds.length > 0 && ` · ${interestedIds.length}`}
      </button>

      {session && (
        <button
          className={savedIds.includes(selectedPost.id) ? 'pill on-gold' : 'pill'}
          aria-pressed={savedIds.includes(selectedPost.id)}
          onClick={() => toggleSave(selectedPost.id)}
        >
          {savedIds.includes(selectedPost.id) ? '★ Saved' : '☆ Save'}
        </button>
      )}

      {session && selectedPost.author_id && selectedPost.author_id !== userId && (
        <button className="pill" onClick={() => openMenu(selectedPost.author_id)}>
          ✉️ Message
        </button>
      )}

      <button className="pill" onClick={copyLink} title="Copy a link to this pin">
        🔗 Copy link
      </button>
    </div>

    {interestedIds.length > 0 && (
      <div className="row-meta" style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ display: 'flex' }}>
          {interestedIds.slice(0, 4).map((id, index) => (
            <span key={id} style={{ marginLeft: index ? '-8px' : 0, borderRadius: '50%', boxShadow: '0 0 0 2px white' }}>
              {avatar(id, interestedNames[id] ?? null, 22)}
            </span>
          ))}
        </span>
        <span>
          {describeInterested(interestedIds.map((id) => (id === userId ? 'You' : (interestedNames[id] ?? '…'))))}
        </span>
      </div>
    )}

    <div className="section-title">
      <span>
        {threadReplies.length === 0
          ? 'Replies'
          : `${threadReplies.length} ${threadReplies.length === 1 ? 'reply' : 'replies'}`}
      </span>
    </div>

    {threadReplies.length === 0 ? (
      <p className="empty">No replies yet. Be the first.</p>
    ) : (
      threadReplies.map((reply) => (
        <div key={reply.id} style={{ display: 'flex', gap: '10px', padding: '8px 0' }}>
          {avatar(reply.author_id, reply.author_name, 30)}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row-meta" style={{ marginTop: 0 }}>
              {reply.author_id ? (
                <button
                  onClick={() => openProfile(reply.author_id!)}
                  style={{
                    ...linkButtonStyle,
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#222',
                    textDecoration: 'none',
                  }}
                >
                  {reply.author_name}
                </button>
              ) : (
                <strong>Anonymous</strong>
              )}
              {' · '}
              {ago(reply.created_at)}
            </div>
            <div
              style={{
                marginTop: '2px',
                fontSize: '14px',
                lineHeight: 1.45,
                color: '#333',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
              }}
            >
              {reply.content}
            </div>
          </div>
        </div>
      ))
    )}

    <div
      style={{
        position: 'sticky',
        bottom: '-24px',
        margin: '16px -24px -24px',
        padding: '12px 24px 24px',
        background: 'white',
        borderTop: '1px solid #eee',
      }}
    >
      {session ? (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
          <textarea
            value={replyText}
            onChange={(event) => setReplyText(event.target.value)}
            placeholder="Write a reply..."
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                handleCreateReply()
              }
            }}
            title="Ctrl+Enter to send"
            rows={2}
            style={{
              flex: 1,
              boxSizing: 'border-box',
              padding: '10px 14px',
              border: '1px solid #ddd',
              borderRadius: '16px',
              fontSize: '14px',
              fontFamily: 'inherit',
              resize: 'none',
            }}
          />
          <button
            onClick={handleCreateReply}
            disabled={!replyText.trim()}
            style={{
              padding: '10px 16px',
              border: 'none',
              borderRadius: '20px',
              background: replyText.trim() ? '#111' : '#ccc',
              color: 'white',
              fontWeight: 600,
              cursor: replyText.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            Reply
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAuthMode('signup')}
          style={{
            width: '100%',
            border: '1px solid #ccc',
            background: 'white',
            color: '#222',
            padding: '12px',
            borderRadius: '10px',
            fontSize: '15px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Sign up to reply
        </button>
      )}
    </div>
  </aside>
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
                  onChangePassword: () => setAuthMode('new-password'),
                  onSignOut: handleSignOut,
                }
              : null
          }
          posts={posts}
          replies={replies}
          interests={interests}
          savedIds={savedIds}
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