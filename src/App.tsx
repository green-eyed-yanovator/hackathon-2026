import { useEffect, useRef, useState } from 'react'
import {
  Map,
  NavigationControl,
  setWorkerUrl,
} from 'maplibre-gl'

import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

import 'maplibre-gl/dist/maplibre-gl.css'
import { supabase } from './lib/supabase'

setWorkerUrl(workerUrl)

function App() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<Map | null>(null)

  const [supabaseStatus, setSupabaseStatus] = useState('Testing Supabase...')

  useEffect(() => {
    async function testSupabase() {
      const { data, error } = await supabase
        .from('posts')
        .select('*')

      if (error) {
        console.error('Supabase error:', error)
        setSupabaseStatus(`Supabase error: ${error.message}`)
        return
      }

      console.log('Supabase posts:', data)
      setSupabaseStatus(`Supabase connected. Posts: ${data.length}`)
    }

    testSupabase()

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
      map.current?.remove()
      map.current = null
    }
  }, [])

  return (
    <div
      ref={mapContainer}
      style={{
        width: '100vw',
        height: '100vh',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '20px',
          left: '20px',
          zIndex: 10,
          padding: '12px 16px',
          background: 'white',
          borderRadius: '8px',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
          fontFamily: 'Arial, sans-serif',
        }}
      >
        {supabaseStatus}
      </div>
    </div>
  )
}

export default App