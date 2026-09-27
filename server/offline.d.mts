// Types for vite.config.ts; the server itself is plain JavaScript (offline.mjs),
// so npm run setup can use it with nothing but Node.
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'

export type Backend = {
  handle(req: IncomingMessage, res: ServerResponse, next?: () => void): Promise<void>
  upgrade(req: IncomingMessage, socket: Duplex): boolean
  keys: { secret: string; anon: string; service: string }
  sql(query: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
  close(): Promise<void>
}

export function openBackend(root: string, log?: (line: string) => void): Promise<Backend>
export function keys(root: string): { secret: string; anon: string; service: string }
export function cachedTile(root: string, z: number, x: number, y: number): Promise<Buffer | null>
export function keepTiles(root: string, box: [number, number, number, number], maxZoom?: number, progress?: (done: number) => void): Promise<{ total: number; kept: number }>
