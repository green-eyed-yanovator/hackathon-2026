import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin, type PreviewServer, type ViteDevServer } from 'vite'
import type { Backend } from './server/offline.mjs'

// In offline mode (the default for npm run setup), the backend runs here, on the
// app's own address: Postgres in WebAssembly and the parts of Supabase the app
// uses (server/offline.mjs). Nothing needs Docker or the internet.
//
// Only one process may have the database open, and Vite builds its new server
// before closing the old one when it restarts, so there's one backend for the
// whole process, kept across restarts and closed when the process ends.
const shared = globalThis as typeof globalThis & { aroundhereBackend?: Promise<Backend> }

function offlineBackend(): Plugin {
  const attach = async (server: ViteDevServer | PreviewServer) => {
    const { openBackend } = await import('./server/offline.mjs')
    if (!shared.aroundhereBackend) {
      shared.aroundhereBackend = openBackend(process.cwd(), (line) => server.config.logger.info(line))
      shared.aroundhereBackend.catch(() => (shared.aroundhereBackend = undefined))
      // Ctrl-C: the database closed properly and let go of (a second one quits at once).
      const stop = () => void shared.aroundhereBackend?.then((b) => b.close()).finally(() => process.exit(130))
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
    }
    const b = await shared.aroundhereBackend
    server.middlewares.use((req, res, next) => void b.handle(req, res, next))
    server.httpServer?.on('upgrade', (req, socket) => b.upgrade(req, socket))
    const served = () => {
      const address = server.httpServer?.address()
      if (address && typeof address === 'object') b.served(`http://127.0.0.1:${address.port}`)
    }
    if (server.httpServer?.listening) served()
    else server.httpServer?.once('listening', served)
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
    define: { 'import.meta.env.VITE_OFFLINE': JSON.stringify(String(offline)) },
    plugins: offline ? [react(), offlineBackend()] : [react()],
    server: serve,
    preview: serve,
  }
})
