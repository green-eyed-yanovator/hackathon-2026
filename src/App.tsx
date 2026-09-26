import { useEffect, useRef, useState } from 'react'
import {
  Map,
  Marker,
  NavigationControl,
  setWorkerUrl,
} from 'maplibre-gl'

import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

import 'maplibre-gl/dist/maplibre-gl.css'
import { supabase } from './lib/supabase'

setWorkerUrl(workerUrl)

type Post = {
  id: string
  place_id: string
  title: string
  description: string
  latitude: number
  longitude: number
  flair: string
  created_at: string
}

type Location = {
  latitude: number
  longitude: number
}

type Reply = {
  id: string
  post_id: string
  content: string
  created_at: string
}

type PostMedia = {
  id: string
  post_id: string
  media_type: 'image' | 'video'
  url: string
  created_at: string
}

function formatRelativeTime(dateString: string) {
  const seconds = Math.floor(
    (Date.now() - new Date(dateString).getTime()) / 1000,
  )

  if (seconds < 60) {
    return 'just now'
  }

  const minutes = Math.floor(seconds / 60)

  if (minutes < 60) {
    return `${minutes}m ago`
  }

  const hours = Math.floor(minutes / 60)

  if (hours < 24) {
    return `${hours}h ago`
  }

  const days = Math.floor(hours / 24)

  if (days < 7) {
    return `${days}d ago`
  }

  const weeks = Math.floor(days / 7)

  if (weeks < 5) {
    return `${weeks}w ago`
  }

  return new Date(dateString).toLocaleDateString()
}

function App() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<Map | null>(null)

  const markers = useRef<Marker[]>([])
  const locationMarker = useRef<Marker | null>(null)
  const isChoosingLocationRef = useRef(false)

  const [posts, setPosts] = useState<Post[]>([])
  const [showAddForm, setShowAddForm] = useState(false)

  const [selectedPost, setSelectedPost] = useState<Post | null>(null)
  const [selectedPlacePosts, setSelectedPlacePosts] = useState<Post[]>([])

  const [replies, setReplies] = useState<Reply[]>([])
  const [replyText, setReplyText] = useState('')

  const [postMedia, setPostMedia] = useState<PostMedia[]>([])

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [flair, setFlair] = useState('general')

  const [mediaFiles, setMediaFiles] = useState<File[]>([])

  const [selectedLocation, setSelectedLocation] =
    useState<Location | null>(null)

  const [isChoosingLocation, setIsChoosingLocation] =
    useState(false)

  const [locationStatus, setLocationStatus] =
    useState('Finding your location...')

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

      setPosts((data ?? []) as Post[])
    }

    loadPosts()
  }, [])

  useEffect(() => {
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

    map.current.on('click', (event) => {
      if (!isChoosingLocationRef.current) {
        return
      }

      setSelectedLocation({
        latitude: event.lngLat.lat,
        longitude: event.lngLat.lng,
      })

      setIsChoosingLocation(false)
      isChoosingLocationRef.current = false
      setLocationStatus('Location selected')
    })

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

          if (selectedPost?.id !== newReply.post_id) {
            return
          }

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
  }, [selectedPost])

  useEffect(() => {
    if (!selectedPost) {
      setReplies([])
      setPostMedia([])
      return
    }

    const postId = selectedPost.id

    async function loadThreadData() {
      const { data: replyData, error: replyError } =
        await supabase
          .from('replies')
          .select('*')
          .eq('post_id', postId)
          .order('created_at', { ascending: true })

      if (replyError) {
        console.error(
          'Failed to load replies:',
          replyError,
        )
      } else {
        setReplies((replyData ?? []) as Reply[])
      }

      const { data: mediaData, error: mediaError } =
        await supabase
          .from('post_media')
          .select('*')
          .eq('post_id', postId)
          .order('created_at', { ascending: true })

      if (mediaError) {
        console.error(
          'Failed to load media:',
          mediaError,
        )
      } else {
        setPostMedia((mediaData ?? []) as PostMedia[])
      }
    }

    loadThreadData()
  }, [selectedPost])

  useEffect(() => {
    if (!map.current) {
      return
    }

    markers.current.forEach((marker) => marker.remove())
    markers.current = []

    const postsByPlace: Record<string, Post[]> = {}

    posts.forEach((post) => {
      const existingPosts =
        postsByPlace[post.place_id] ?? []

      postsByPlace[post.place_id] = [
        ...existingPosts,
        post,
      ]
    })

    Object.values(postsByPlace).forEach((placePosts) => {
      const firstPost = placePosts[0]

      const flairIcons: Record<string, string> = {
        general: '💬',
        food: '🍔',
        music: '🎵',
        sports: '🏀',
        event: '🎉',
        lost: '🚨',
      }

      const markerElement = document.createElement('div')

      markerElement.textContent =
        flairIcons[firstPost.flair] ?? '💬'

      markerElement.style.width = '42px'
      markerElement.style.height = '42px'
      markerElement.style.borderRadius = '50%'
      markerElement.style.background = 'white'
      markerElement.style.display = 'flex'
      markerElement.style.alignItems = 'center'
      markerElement.style.justifyContent = 'center'
      markerElement.style.fontSize = '22px'
      markerElement.style.boxShadow =
        '0 3px 10px rgba(0, 0, 0, 0.3)'
      markerElement.style.border = '2px solid white'
      markerElement.style.cursor = 'pointer'

      markerElement.addEventListener('click', () => {
        setSelectedPlacePosts(placePosts)
        setSelectedPost(null)
      })

      const marker = new Marker({
        element: markerElement,
        anchor: 'center',
      })
        .setLngLat([
          firstPost.longitude,
          firstPost.latitude,
        ])
        .addTo(map.current!)

      markers.current.push(marker)
    })
  }, [posts])

  useEffect(() => {
    if (!selectedLocation || !map.current) {
      return
    }

    map.current.flyTo({
      center: [
        selectedLocation.longitude,
        selectedLocation.latitude,
      ],
      zoom: 16,
      duration: 500,
    })

    locationMarker.current?.remove()

    const markerElement = document.createElement('div')

    markerElement.style.width = '18px'
    markerElement.style.height = '18px'
    markerElement.style.borderRadius = '50%'
    markerElement.style.background = '#2563eb'
    markerElement.style.border = '3px solid white'
    markerElement.style.boxShadow =
      '0 2px 8px rgba(0,0,0,0.3)'

    locationMarker.current = new Marker({
      element: markerElement,
    })
      .setLngLat([
        selectedLocation.longitude,
        selectedLocation.latitude,
      ])
      .addTo(map.current)

    return () => {
      locationMarker.current?.remove()
      locationMarker.current = null
    }
  }, [selectedLocation])

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
      isChoosingLocationRef.current = true
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
        isChoosingLocationRef.current = true
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
      },
    )
  }

  function handleOpenForm() {
    setShowAddForm(true)
    setIsChoosingLocation(false)
    isChoosingLocationRef.current = false

    requestCurrentLocation()
  }

  function handleCloseForm() {
    setShowAddForm(false)
    setIsChoosingLocation(false)
    isChoosingLocationRef.current = false

    setTitle('')
    setDescription('')
    setFlair('general')
    setMediaFiles([])
    setSelectedLocation(null)

    locationMarker.current?.remove()
    locationMarker.current = null
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
      console.error(
        'Failed to create reply:',
        error,
      )
      alert('Failed to post reply.')
      return
    }

    setReplies((currentReplies) => {
      if (
        currentReplies.some(
          (reply) => reply.id === data.id,
        )
      ) {
        return currentReplies
      }

      return [...currentReplies, data as Reply]
    })

    setReplyText('')
  }

  async function handleCreatePost() {
    if (
      !title.trim() ||
      !description.trim() ||
      !selectedLocation
    ) {
      return
    }

    const { data: places, error: placesError } =
      await supabase
        .from('places')
        .select('*')

    if (placesError) {
      console.error(
        'Failed to load places:',
        placesError,
      )
      alert('Failed to find location.')
      return
    }

    const toRadians = (degrees: number) =>
      (degrees * Math.PI) / 180

    const distanceInMeters = (
      latitude1: number,
      longitude1: number,
      latitude2: number,
      longitude2: number,
    ) => {
      const earthRadius = 6371000

      const latitudeDifference = toRadians(
        latitude2 - latitude1,
      )

      const longitudeDifference = toRadians(
        longitude2 - longitude1,
      )

      const a =
        Math.sin(latitudeDifference / 2) ** 2 +
        Math.cos(toRadians(latitude1)) *
          Math.cos(toRadians(latitude2)) *
          Math.sin(longitudeDifference / 2) ** 2

      const c =
        2 *
        Math.atan2(
          Math.sqrt(a),
          Math.sqrt(1 - a),
        )

      return earthRadius * c
    }

    const nearbyPlace = places?.find((place) => {
      const distance = distanceInMeters(
        selectedLocation.latitude,
        selectedLocation.longitude,
        place.latitude,
        place.longitude,
      )

      return distance <= 30
    })

    let place = nearbyPlace

    if (!place) {
      const {
        data: newPlace,
        error: placeCreateError,
      } = await supabase
        .from('places')
        .insert({
          latitude: selectedLocation.latitude,
          longitude: selectedLocation.longitude,
        })
        .select()
        .single()

      if (placeCreateError) {
        console.error(
          'Failed to create place:',
          placeCreateError,
        )
        alert('Failed to create location.')
        return
      }

      place = newPlace
    }

    const { data, error } = await supabase
      .from('posts')
      .insert({
        place_id: place.id,
        title: title.trim(),
        description: description.trim(),
        latitude: place.latitude,
        longitude: place.longitude,
        flair,
      })
      .select()
      .single()

    if (error) {
      console.error(
        'Failed to create post:',
        error,
      )
      alert('Failed to create thread.')
      return
    }

    const post = data as Post

    for (const file of mediaFiles) {
      const fileExtension =
        file.name.split('.').pop() ?? 'file'

      const filePath = `${post.id}/${crypto.randomUUID()}.${fileExtension}`

      const { error: uploadError } =
        await supabase.storage
          .from('post-media')
          .upload(filePath, file)

      if (uploadError) {
        console.error(
          'Failed to upload media:',
          uploadError,
        )
        continue
      }

      const { data: publicUrlData } =
        supabase.storage
          .from('post-media')
          .getPublicUrl(filePath)

      const mediaType = file.type.startsWith('video/')
        ? 'video'
        : 'image'

      const { error: mediaError } =
        await supabase
          .from('post_media')
          .insert({
            post_id: post.id,
            media_type: mediaType,
            url: publicUrlData.publicUrl,
          })

      if (mediaError) {
        console.error(
          'Failed to save media record:',
          mediaError,
        )
      }
    }

    setPosts((currentPosts) => [
      post,
      ...currentPosts,
    ])

    handleCloseForm()
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        fontFamily:
          'Arial, Helvetica, sans-serif',
        background: '#f5f5f5',
      }}
    >
      <div
        ref={mapContainer}
        style={{
          width: '100%',
          height: '100%',
        }}
      />

      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          right: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            background: 'white',
            padding: '10px 16px',
            borderRadius: 12,
            boxShadow:
              '0 2px 10px rgba(0,0,0,0.15)',
            fontSize: 22,
            fontWeight: 700,
          }}
        >
          AroundHere
        </div>

        <button
          type="button"
          onClick={handleOpenForm}
          style={{
            pointerEvents: 'auto',
            border: 'none',
            background: '#111',
            color: 'white',
            borderRadius: 12,
            padding: '11px 17px',
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow:
              '0 2px 10px rgba(0,0,0,0.2)',
          }}
        >
          + Add
        </button>
      </div>

      {showAddForm && isChoosingLocation && (
        <div
          style={{
            position: 'absolute',
            top: 80,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'white',
            padding: '12px 18px',
            borderRadius: 12,
            boxShadow:
              '0 3px 15px rgba(0,0,0,0.2)',
            zIndex: 10,
            fontSize: 14,
          }}
        >
          <strong>
            Tap the map to choose a location
          </strong>
        </div>
      )}

      {showAddForm && (
        <aside
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            width: 360,
            maxHeight: 'calc(100% - 32px)',
            overflowY: 'auto',
            background: 'white',
            borderRadius: 16,
            padding: 20,
            boxShadow:
              '0 4px 20px rgba(0,0,0,0.2)',
            zIndex: 20,
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 20,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: 21,
              }}
            >
              Create a thread
            </h2>

            <button
              type="button"
              onClick={handleCloseForm}
              style={{
                border: 'none',
                background: 'transparent',
                fontSize: 22,
                cursor: 'pointer',
              }}
            >
              ×
            </button>
          </div>

          <label
            style={{
              display: 'block',
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            Title
          </label>

          <input
            value={title}
            onChange={(event) =>
              setTitle(event.target.value)
            }
            placeholder="What's happening?"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: 11,
              border: '1px solid #ccc',
              borderRadius: 9,
              marginBottom: 16,
              fontSize: 14,
            }}
          />

          <label
            style={{
              display: 'block',
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            Description
          </label>

          <textarea
            value={description}
            onChange={(event) =>
              setDescription(event.target.value)
            }
            placeholder="Tell people more..."
            rows={5}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: 11,
              border: '1px solid #ccc',
              borderRadius: 9,
              marginBottom: 16,
              fontSize: 14,
              resize: 'vertical',
            }}
          />

          <label
            style={{
              display: 'block',
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            Flair
          </label>

          <select
            value={flair}
            onChange={(event) =>
              setFlair(event.target.value)
            }
            style={{
              width: '100%',
              padding: 11,
              border: '1px solid #ccc',
              borderRadius: 9,
              marginBottom: 16,
              fontSize: 14,
            }}
          >
            <option value="general">
              💬 General
            </option>
            <option value="food">
              🍔 Food
            </option>
            <option value="music">
              🎵 Music
            </option>
            <option value="sports">
              🏀 Sports
            </option>
            <option value="event">
              🎉 Event
            </option>
            <option value="lost">
              🚨 Lost / Found
            </option>
          </select>

          <label
            style={{
              display: 'block',
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            Photos or videos
          </label>

          <input
            type="file"
            accept="image/*,video/*"
            multiple
            onChange={(event) => {
              setMediaFiles(
                Array.from(
                  event.target.files ?? [],
                ),
              )
            }}
            style={{
              width: '100%',
              marginBottom: 16,
            }}
          />

          {mediaFiles.length > 0 && (
            <div
              style={{
                fontSize: 13,
                color: '#555',
                marginBottom: 16,
              }}
            >
              {mediaFiles.length} file
              {mediaFiles.length === 1 ? '' : 's'} selected
            </div>
          )}

          <div
            style={{
              padding: 12,
              background: '#f5f5f5',
              borderRadius: 10,
              marginBottom: 18,
            }}
          >
            <div
              style={{
                fontWeight: 600,
                marginBottom: 5,
              }}
            >
              Location
            </div>

            <div
              style={{
                fontSize: 13,
                color: '#555',
                marginBottom: 9,
              }}
            >
              📍 {locationStatus}
            </div>

            <button
              type="button"
              onClick={() => {
                setIsChoosingLocation(true)
                isChoosingLocationRef.current = true
                setLocationStatus(
                  'Tap the map to choose a location',
                )
              }}
              style={{
                border: '1px solid #ccc',
                background: 'white',
                padding: '8px 11px',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              Change location
            </button>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 10,
            }}
          >
            <button
              type="button"
              onClick={handleCloseForm}
              style={{
                flex: 1,
                padding: 11,
                border: '1px solid #ccc',
                background: 'white',
                borderRadius: 9,
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleCreatePost}
              disabled={
                !title.trim() ||
                !description.trim() ||
                !selectedLocation
              }
              style={{
                flex: 1,
                padding: 11,
                border: 'none',
                background:
                  !title.trim() ||
                  !description.trim() ||
                  !selectedLocation
                    ? '#aaa'
                    : '#111',
                color: 'white',
                borderRadius: 9,
                cursor:
                  !title.trim() ||
                  !description.trim() ||
                  !selectedLocation
                    ? 'not-allowed'
                    : 'pointer',
                fontWeight: 600,
              }}
            >
              Post
            </button>
          </div>
        </aside>
      )}

      {selectedPlacePosts.length > 0 &&
        !selectedPost && (
          <aside
            style={{
              position: 'absolute',
              top: 16,
              right: 16,
              width: 420,
              maxHeight: 'calc(100% - 32px)',
              overflowY: 'auto',
              background: 'white',
              borderRadius: 16,
              boxShadow:
                '0 4px 20px rgba(0,0,0,0.2)',
              zIndex: 15,
            }}
          >
            <div
              style={{
                padding: '16px 18px',
                borderBottom: '1px solid #eee',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 20,
                    fontWeight: 700,
                  }}
                >
                  Threads here
                </div>

                <div
                  style={{
                    fontSize: 13,
                    color: '#777',
                    marginTop: 3,
                  }}
                >
                  {selectedPlacePosts.length}{' '}
                  thread
                  {selectedPlacePosts.length === 1
                    ? ''
                    : 's'}
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  setSelectedPlacePosts([])
                }
                style={{
                  border: 'none',
                  background: 'transparent',
                  fontSize: 24,
                  cursor: 'pointer',
                }}
              >
                ×
              </button>
            </div>

            <div style={{ padding: 10 }}>
              {selectedPlacePosts.map((post) => {
                const flairIcons: Record<
                  string,
                  string
                > = {
                  general: '💬',
                  food: '🍔',
                  music: '🎵',
                  sports: '🏀',
                  event: '🎉',
                  lost: '🚨',
                }

                return (
                  <button
                    key={post.id}
                    type="button"
                    onClick={() =>
                      setSelectedPost(post)
                    }
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      border: 'none',
                      background: 'white',
                      padding: 14,
                      borderRadius: 10,
                      cursor: 'pointer',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        gap: 8,
                        alignItems: 'center',
                        fontSize: 12,
                        color: '#777',
                        marginBottom: 7,
                      }}
                    >
                      <span>
                        {flairIcons[post.flair] ??
                          '💬'}
                      </span>

                      <span>
                        u/anonymous ·{' '}
                        {formatRelativeTime(
                          post.created_at,
                        )}
                      </span>
                    </div>

                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 16,
                        color: '#111',
                        marginBottom: 5,
                      }}
                    >
                      {post.title}
                    </div>

                    <div
                      style={{
                        fontSize: 13,
                        color: '#555',
                        lineHeight: 1.4,
                      }}
                    >
                      {post.description}
                    </div>
                  </button>
                )
              })}
            </div>
          </aside>
        )}

      {selectedPost && (
        <aside
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            width: 420,
            maxHeight: 'calc(100% - 32px)',
            overflowY: 'auto',
            background: 'white',
            borderRadius: 16,
            boxShadow:
              '0 4px 20px rgba(0,0,0,0.2)',
            zIndex: 15,
          }}
        >
          <div
            style={{
              position: 'sticky',
              top: 0,
              background: 'white',
              borderBottom: '1px solid #eee',
              padding: '13px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              zIndex: 2,
            }}
          >
            <button
              type="button"
              onClick={() => {
                setSelectedPost(null)
              }}
              style={{
                border: 'none',
                background: 'transparent',
                fontSize: 22,
                cursor: 'pointer',
                padding: 2,
              }}
            >
              ←
            </button>

            <div
              style={{
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              Thread
            </div>

            <button
              type="button"
              onClick={() => {
                setSelectedPost(null)
                setSelectedPlacePosts([])
              }}
              style={{
                border: 'none',
                background: 'transparent',
                fontSize: 22,
                cursor: 'pointer',
                padding: 2,
              }}
            >
              ×
            </button>
          </div>

          <div style={{ padding: 18 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: '#777',
                fontSize: 12,
                marginBottom: 10,
              }}
            >
              <span>u/anonymous</span>

              <span>·</span>

              <span>
                {formatRelativeTime(
                  selectedPost.created_at,
                )}
              </span>

              <span>·</span>

              <span>
                {selectedPost.flair}
              </span>
            </div>

            <h1
              style={{
                fontSize: 24,
                lineHeight: 1.2,
                margin: '0 0 12px',
              }}
            >
              {selectedPost.title}
            </h1>

            <div
              style={{
                fontSize: 15,
                lineHeight: 1.55,
                whiteSpace: 'pre-wrap',
                color: '#222',
              }}
            >
              {selectedPost.description}
            </div>

            {postMedia.length > 0 && (
              <div
                style={{
                  marginTop: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                {postMedia.map((media) =>
                  media.media_type === 'video' ? (
                    <video
                      key={media.id}
                      src={media.url}
                      controls
                      style={{
                        width: '100%',
                        maxHeight: 300,
                        borderRadius: 10,
                        background: '#111',
                      }}
                    />
                  ) : (
                    <img
                      key={media.id}
                      src={media.url}
                      alt=""
                      style={{
                        width: '100%',
                        maxHeight: 350,
                        objectFit: 'cover',
                        borderRadius: 10,
                      }}
                    />
                  ),
                )}
              </div>
            )}

            <div
              style={{
                marginTop: 16,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: '#f2f2f2',
                padding: '7px 10px',
                borderRadius: 999,
                fontSize: 12,
                color: '#555',
              }}
            >
              📍 Nearby
            </div>

            <div
              style={{
                marginTop: 22,
                paddingTop: 16,
                borderTop: '1px solid #eee',
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 15,
                  marginBottom: 12,
                }}
              >
                {replies.length}{' '}
                {replies.length === 1
                  ? 'comment'
                  : 'comments'}
              </div>

              {replies.length === 0 ? (
                <div
                  style={{
                    fontSize: 13,
                    color: '#777',
                    padding: '12px 0',
                  }}
                >
                  No comments yet.
                </div>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  {replies.map((reply) => (
                    <div
                      key={reply.id}
                      style={{
                        background: '#f7f7f7',
                        borderRadius: 10,
                        padding: 12,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          color: '#777',
                          marginBottom: 6,
                        }}
                      >
                        u/anonymous ·{' '}
                        {formatRelativeTime(
                          reply.created_at,
                        )}
                      </div>

                      <div
                        style={{
                          fontSize: 14,
                          lineHeight: 1.45,
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {reply.content}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div
                style={{
                  marginTop: 16,
                }}
              >
                <textarea
                  value={replyText}
                  onChange={(event) =>
                    setReplyText(event.target.value)
                  }
                  placeholder="What do you think?"
                  rows={3}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    border: '1px solid #ccc',
                    borderRadius: 10,
                    padding: 11,
                    resize: 'vertical',
                    fontSize: 14,
                  }}
                />

                <button
                  type="button"
                  onClick={handleCreateReply}
                  disabled={!replyText.trim()}
                  style={{
                    marginTop: 8,
                    width: '100%',
                    padding: 10,
                    border: 'none',
                    borderRadius: 9,
                    background:
                      replyText.trim()
                        ? '#111'
                        : '#aaa',
                    color: 'white',
                    cursor:
                      replyText.trim()
                        ? 'pointer'
                        : 'not-allowed',
                    fontWeight: 600,
                  }}
                >
                  Comment
                </button>
              </div>
            </div>
          </div>
        </aside>
      )}
    </div>
  )
}

export default App