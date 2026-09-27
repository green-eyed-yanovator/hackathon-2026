import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App.tsx'

// The store (data.ts), the map (map.ts) and the UI state are single objects that
// live as long as the page. Swapping code under them in development would leave
// two of each, half the app talking to the old ones, so a code change reloads
// the page instead. Style changes still apply in place.
if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', (payload) => {
    if (payload.updates.some((update) => update.type === 'js-update')) window.location.reload()
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
