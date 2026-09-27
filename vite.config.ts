import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// Opened from another device (a phone over Tailscale, say), the app reaches
// Supabase through this server, on the same address: one HTTPS certificate
// covers both, and nothing but this server has to be reachable.
export default defineConfig(({ mode }) => {
  const target = loadEnv(mode, process.cwd(), '').VITE_SUPABASE_URL || 'http://127.0.0.1:54321'
  const pass = { target, changeOrigin: true }
  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1', // where `tailscale serve` passes the tailnet's requests to
      allowedHosts: ['nicks-macbook-pro.tail1185f0.ts.net'],
      proxy: {
        '/auth/v1': pass,
        '/rest/v1': pass,
        '/storage/v1': pass,
        '/functions/v1': pass,
        '/realtime/v1': { ...pass, ws: true },
      },
    },
  }
})
