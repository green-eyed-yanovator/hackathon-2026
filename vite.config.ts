import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin, type PreviewServer, type ViteDevServer } from 'vite'
import type { Backend } from './server/offline.mjs'

// With no Docker (npm run setup decides), the backend runs in here, on the
// app's own address: Postgres in WebAssembly and the parts of Supabase the app
// uses (server/offline.mjs). Nothing needs Docker or the internet.
function offlineBackend(): Plugin {
  let backend: Backend | null = null
  const attach = async (server: ViteDevServer | PreviewServer) => {
    const { openBackend } = await import('./server/offline.mjs')
    backend = await openBackend(process.cwd(), (line) => server.config.logger.info(line))
    const b = backend
    server.middlewares.use((req, res, next) => void b.handle(req, res, next))
    server.httpServer?.on('upgrade', (req, socket) => b.upgrade(req, socket))
    server.httpServer?.on('close', () => void b.close())
    server.config.logger.info('Offline backend on this address; emails land in /_mail')
  }
  return { name: 'aroundhere-offline', configureServer: attach, configurePreviewServer: attach }
}

// Opened from another device (a phone over Tailscale, say), the app reaches
// Supabase through this server, on the same address: one HTTPS certificate
// covers both, and nothing but this server has to be reachable.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const offline = env.AROUNDHERE_BACKEND === 'offline'
  const target = env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321'
  const pass = { target, changeOrigin: true }
  // The same for the development server and for the built app (`vite preview`,
  // much quicker on a phone), on the same port, so one `tailscale serve` covers both.
  const serve = {
    host: '127.0.0.1', // where `tailscale serve` passes the tailnet's requests to
    port: 5173,
    strictPort: true,
    allowedHosts: ['nicks-macbook-pro.tail1185f0.ts.net'],
    // Offline, those paths are the backend itself (the plugin below).
    proxy: offline
      ? undefined
      : {
          '/auth/v1': pass,
          '/rest/v1': pass,
          '/storage/v1': pass,
          '/functions/v1': pass,
          '/realtime/v1': { ...pass, ws: true },
        },
  }
  return {
    plugins: offline ? [react(), offlineBackend()] : [react()],
    server: serve,
    preview: serve,
  }
})
