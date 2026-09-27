// Explicitly download a map area and include it in the repo for offline use.
// npm run cache:map [-- west south east north]
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { cachedTile, keepTiles } from '../server/offline.mjs'

const args = process.argv.slice(2)
const bounds = args.length ? args.map(Number) : [138.54, -34.96, 138.67, -34.88]
const [west, south, east, north] = bounds
if (bounds.length !== 4 || !bounds.every(Number.isFinite) || west < -180 || east > 180 || south < -85 || north > 85 || west >= east || south >= north) {
  throw new Error('Expected west south east north (longitude -180..180, latitude -85..85).')
}
const root = process.cwd()
console.log('Keeping map tiles through zoom 14…')
const { total, kept } = await keepTiles(root, bounds, 14, (done) => { if (done % 10 === 0) console.log(`${done} tiles checked`) })
if (kept !== total) throw new Error(`Only ${kept}/${total} tiles available. Connect to the internet and try again.`)

const directory = path.join(root, 'public/tiles')
const manifestFile = path.join(directory, 'manifest.json')
const previous = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : null
const tiles = { ...previous?.tiles }
const lonToX = (lon, n) => Math.floor((lon + 180) / 360 * n)
const latToY = (lat, n) => Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n)
for (let z = 0; z <= 14; z++) {
  const n = 2 ** z
  for (let x = lonToX(west, n); x <= lonToX(east, n); x++) {
    for (let y = latToY(north, n); y <= latToY(south, n); y++) {
      const tile = await cachedTile(root, z, x, y)
      const relative = `${z}/${x}/${y}.pbf`
      const file = path.join(directory, relative)
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, tile)
      tiles[relative] = createHash('sha256').update(tile).digest('hex')
    }
  }
}
writeFileSync(manifestFile, JSON.stringify({
  source: 'https://tiles.openfreemap.org/planet',
  attribution: '© OpenStreetMap contributors · © OpenMapTiles · OpenFreeMap',
  areas: [...(previous?.areas ?? []).filter((b) => String(b) !== String(bounds)), bounds],
  maxZoom: 14,
  tiles,
}, null, 2) + '\n')
console.log(`${Object.keys(tiles).length} map tiles bundled in public/tiles. Include this folder when sharing the project.`)
