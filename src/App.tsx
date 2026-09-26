import { useEffect, useRef, useState } from 'react'
import {
  Map,
  Marker,
  NavigationControl,
  setWorkerUrl,
} from 'maplibre-gl'

import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

import 'maplibre-gl/dist/maplibre-gl.css'
import type { Session } from '@supabase/supabase-js'
import AuthPanel from './AuthPanel'
import ProfilePanel from './ProfilePanel'
import { supabase } from './lib/supabase'
import type { AuthMode, Post, Profile, Reply } from './types'
import { linkButtonStyle, rightPanelStyle } from './ui'

setWorkerUrl(workerUrl)

type Location = {
  latitude: number
  longitude: number
}

function App() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<Map | null>(null)

  const markers = useRef<Marker[]>([])
  const locationMarker = useRef<Marker | null>(null)

  const [posts, setPosts] = useState<Post[]>([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [selectedPost, setSelectedPost] = useState<Post | null>(null)
const [replies, setReplies] = useState<Reply[]>([])
const [replyText, setReplyText] = useState('')


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
  const [profileId, setProfileId] = useState<string | null>(null)

  const userId = session?.user.id ?? null
  // Ignore a profile left over from a previous session.
  const me = myProfile?.id === userId ? myProfile : null

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

    loadPosts()

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

  useEffect(() => {
    if (!map.current || posts.length === 0) {
      return
    }

    markers.current.forEach((marker) => marker.remove())
    markers.current = []

    posts.forEach((post) => {
      const marker = new Marker()
        .setLngLat([post.longitude, post.latitude])
        .addTo(map.current!)

      marker.getElement().addEventListener('click', () => {
        setProfileId(null)
        setSelectedPost(post)
      })

      markers.current.push(marker)
    })
  }, [posts])

  useEffect(() => {
    if (!selectedPost) {
      return
    }

    // Drop the response if another thread was opened before it arrived.
    let ignore = false

    supabase
      .from('replies')
      .select('*')
      .eq('post_id', selectedPost.id)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (ignore) {
          return
        }

        if (error) {
          console.error('Failed to load replies:', error)
          return
        }

        setReplies(data ?? [])
      })

    return () => {
      ignore = true
    }
  }, [selectedPost])

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

  // Immediately show the new marker
  setPosts((currentPosts) => [data, ...currentPosts])

  // Close and reset the form
  handleCloseForm()
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
    setProfileId(null)
  }

  function openProfile(id: string) {
    setSelectedPost(null)
    setProfileId(id)
  }

  function openPostFromProfile(post: Post) {
    setProfileId(null)
    setSelectedPost(post)

    map.current?.flyTo({
      center: [post.longitude, post.latitude],
      zoom: 15,
    })
  }

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

          {session && (
            <button
              onClick={() => openProfile(session.user.id)}
              title="Your profile"
              style={{ ...linkButtonStyle, color: '#222' }}
            >
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
  <aside style={rightPanelStyle}>
    <button
      onClick={() => setSelectedPost(null)}
      style={{
        border: 'none',
        background: 'transparent',
        fontSize: '24px',
        cursor: 'pointer',
        padding: 0,
        marginBottom: '20px',
      }}
    >
      ×
    </button>

    <h2
      style={{
        margin: '0 0 12px',
        fontSize: '26px',
        color: '#111',
      }}
    >
      {selectedPost.title}
    </h2>

    {selectedPost.author_id && (
      <p
        style={{
          margin: '0 0 12px',
          fontSize: '14px',
          color: '#777',
        }}
      >
        by{' '}
        <button
          onClick={() => openProfile(selectedPost.author_id!)}
          style={{ ...linkButtonStyle, color: '#444' }}
        >
          {selectedPost.author_name}
        </button>
      </p>
    )}

    <p
      style={{
        margin: '0 0 24px',
        fontSize: '16px',
        lineHeight: 1.5,
        color: '#444',
      }}
    >
      {selectedPost.description}
    </p>

    <div
  style={{
    padding: '12px',
    background: '#f3f4f6',
    borderRadius: '10px',
    fontSize: '13px',
    color: '#666',
    marginBottom: '24px',
  }}
>
  📍 Thread location
</div>

<h3
  style={{
    margin: '0 0 12px',
    fontSize: '18px',
    color: '#111',
  }}
>
  Replies
</h3>

<div
  style={{
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    marginBottom: '20px',
  }}
>
  {threadReplies.length === 0 ? (
    <p
      style={{
        margin: 0,
        color: '#777',
        fontSize: '14px',
      }}
    >
      No replies yet.
    </p>
  ) : (
    threadReplies.map((reply) => (
      <div
        key={reply.id}
        style={{
          padding: '12px',
          background: '#f3f4f6',
          borderRadius: '10px',
          color: '#333',
        }}
      >
        {reply.author_id && (
          <button
            onClick={() => openProfile(reply.author_id!)}
            style={{
              ...linkButtonStyle,
              display: 'block',
              marginBottom: '4px',
              fontSize: '12px',
              fontWeight: 600,
              color: '#666',
              textDecoration: 'none',
            }}
          >
            {reply.author_name}
          </button>
        )}
        {reply.content}
      </div>
    ))
  )}
</div>

{session ? (
  <>
    <textarea
      value={replyText}
      onChange={(event) => setReplyText(event.target.value)}
      placeholder="Write a reply..."
      rows={3}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        padding: '12px',
        border: '1px solid #ccc',
        borderRadius: '10px',
        fontSize: '14px',
        resize: 'vertical',
        marginBottom: '10px',
      }}
    />

    <button
      onClick={handleCreateReply}
      disabled={!replyText.trim()}
      style={{
        width: '100%',
        border: 'none',
        background: replyText.trim() ? '#000' : '#ccc',
        color: 'white',
        padding: '12px',
        borderRadius: '10px',
        fontSize: '15px',
        fontWeight: 600,
        cursor: replyText.trim()
          ? 'pointer'
          : 'not-allowed',
      }}
    >
      Reply
    </button>
  </>
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
          ownEmail={
            profileId === userId ? (session?.user.email ?? '') : null
          }
          posts={posts}
          onOpenPost={openPostFromProfile}
          onSaved={handleProfileSaved}
          onChangePassword={() => setAuthMode('new-password')}
          onClose={() => setProfileId(null)}
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