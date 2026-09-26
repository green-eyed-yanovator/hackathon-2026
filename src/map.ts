// The map, drawn from scratch on one canvas.
//
// Vector tiles (OpenMapTiles schema, served free by OpenFreeMap) are fetched,
// decoded here, painted once per zoom level into tile bitmaps, and composited
// every frame. Labels, blips and people are placed per frame in screen space,
// so they never get cut at tile edges and never overlap each other.
//
// Coordinates: "world" is Web Mercator squashed into [0, 1] on both axes, y down.
// Zoom z means the world is TILE * 2^z css pixels wide.

const TILE = 256
const SOURCE_MAX_ZOOM = 14
const MIN_ZOOM = 3
const MAX_ZOOM = 20
const TILEJSON_URL = 'https://tiles.openfreemap.org/planet'
const FALLBACK_TILES = 'https://tiles.openfreemap.org/planet/20260913_164504_pt/{z}/{x}/{y}.pbf'

export function lngToX(lng: number) {
  return (lng + 180) / 360
}

export function latToY(lat: number) {
  const s = Math.sin((lat * Math.PI) / 180)
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)
}

export function xToLng(x: number) {
  return x * 360 - 180
}

export function yToLat(y: number) {
  return (360 / Math.PI) * Math.atan(Math.exp((1 - 2 * y) * Math.PI)) - 90
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

//
// Icons. Hand-made 24x24 paths, shared by the canvas (Path2D) and the UI (<svg>).
// A leading '!' means fill with the even-odd rule, which is how holes are cut.
//

export const icons = {
  chat: 'M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  burger: 'M3 10.5C3 6.4 7 4 12 4s9 2.4 9 6.5zM2 12h20v3H2zM3 16.5h18v.5a3.5 3.5 0 0 1-3.5 3.5h-11A3.5 3.5 0 0 1 3 17z',
  note: 'M10 3h2v14.5h-2zM12 3c0 3 5 4 5 8-1-2-3-3-5-3zM5 17.5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 1 1-7 0z',
  ball: '!M12 2a10 10 0 1 1 0 20 10 10 0 1 1 0-20zM11.2 2h1.6v9.2H22v1.6h-9.2V22h-1.6v-9.2H2v-1.6h9.2z',
  star: 'M12 2.5l2.5 6.6 7 .3-5.5 4.4 1.9 6.8L12 16.7l-5.9 3.9 1.9-6.8-5.5-4.4 7-.3z',
  alert: 'M10 3h4l-.8 12h-2.4zM12 17a2 2 0 1 1 0 4 2 2 0 1 1 0-4z',
  fork: 'M4 2h1.4v6h1.2V2H8v6h1.2V2h1.4v7.4a3 3 0 0 1-2.2 2.9V22H6.2v-9.7A3 3 0 0 1 4 9.4zM15 2c3 1.4 4 5.5 4 10h-2.2v10H15z',
  cup: '!M3 7h14v6a6 6 0 0 1-6 6H9a6 6 0 0 1-6-6zM17 8a4 4 0 0 1 0 8zM17 10a2 2 0 0 1 0 4zM6 1.5h1.5v4H6zM10.5 1.5H12v4h-1.5zM2 20.5h17V22H2z',
  glass: 'M3 3h18l-8 9v7h4v2H7v-2h4v-7z',
  bag: 'M4 7h16l-1.2 14H5.2zM8 7a4 4 0 0 1 8 0h-1.8a2.2 2.2 0 0 0-4.4 0z',
  cross: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z',
  shield: 'M12 2l8 3v6c0 5-3.4 9.2-8 11-4.6-1.8-8-6-8-11V5z',
  fuel: '!M4 3h10v18H4zM6 5h6v5H6zM14 9h3v8.5a1 1 0 0 0 2 0V8.5L17.5 7l1-1 2.5 2.5v9a3 3 0 0 1-6 0V11H14z',
  bed: 'M2 6h2v7h18v7h-2v-3H4v3H2zM6 9h4v3H6zM11 9h8a2 2 0 0 1 2 2v1H11z',
  film: 'M3 9h18v11H3zM3 4.5l16.5-2.7.6 3.5L3.6 8z',
  book: '!M4 3h13a3 3 0 0 1 3 3v15H7a3 3 0 0 1-3-3zM6 17.5A1.5 1.5 0 0 0 7.5 19H18v-3H7.5A1.5 1.5 0 0 0 6 17.5z',
  tree: 'M12 2l7 9h-3l4 6h-7v5h-2v-5H4l4-6H5z',
  train: '!M6 2h12a2 2 0 0 1 2 2v11a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V4a2 2 0 0 1 2-2zM6.5 5h11v5h-11zM6.5 14a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0zM14.5 14a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0zM6 19h2.5L7 22H4.5zM15.5 19H18l1.5 3H17z',
  wrench: 'M14.5 2a5.5 5.5 0 0 0-5.2 7.3L2.6 16a2 2 0 0 0 0 2.8l2.6 2.6a2 2 0 0 0 2.8 0l6.7-6.7A5.5 5.5 0 0 0 22 9.5l-3.3 3.3-3.5-1-1-3.5L17.5 5a5.5 5.5 0 0 0-3-3z',
  scissors: '!M6 3a3 3 0 1 1 0 6 3 3 0 1 1 0-6zM6 4.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3zM6 15a3 3 0 1 1 0 6 3 3 0 1 1 0-6zM6 16.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3zM8.5 7.8L21 17l-1 1.5-11.5-7zM8.5 16.2L21 7l-1-1.5-11.5 7z',
  shirt: 'M8 3L2 7l2.5 4L6 10v11h12V10l1.5 1L22 7l-6-4c-.5 1.6-2 2.5-4 2.5S8.5 4.6 8 3z',
  dumbbell: 'M1 10h2V8h3v8H3v-2H1zM23 10h-2V8h-3v8h3v-2h2zM6 11h12v2H6z',
  dollar: 'M11 2h2v2.1c2 .3 3.5 1.4 4 3.4l-2 .6c-.4-1.3-1.5-2.1-3-2.1-1.8 0-3 .9-3 2.1 0 1.3 1.1 1.8 3.3 2.3 2.8.6 4.8 1.6 4.8 4.2 0 2.1-1.7 3.6-4.1 3.9V22h-2v-2.1c-2.3-.3-4-1.6-4.5-3.7l2-.6c.4 1.5 1.8 2.4 3.5 2.4 1.9 0 3.1-.9 3.1-2.1 0-1.3-1-1.9-3.4-2.4C8.9 12.9 7 11.9 7 9.4c0-2 1.6-3.5 4-3.8z',
  search: '!M10.5 3a7.5 7.5 0 1 1 0 15 7.5 7.5 0 1 1 0-15zM10.5 5.2a5.3 5.3 0 1 0 0 10.6 5.3 5.3 0 1 0 0-10.6zM15.6 17.2l1.6-1.6 5 5-1.6 1.6z',
  plus: 'M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z',
  close: 'M5.6 4.2l6.4 6.4 6.4-6.4 1.4 1.4-6.4 6.4 6.4 6.4-1.4 1.4-6.4-6.4-6.4 6.4-1.4-1.4 6.4-6.4-6.4-6.4z',
  locate: '!M11 2h2v2.1a8 8 0 0 1 6.9 6.9H22v2h-2.1a8 8 0 0 1-6.9 6.9V22h-2v-2.1A8 8 0 0 1 4.1 13H2v-2h2.1A8 8 0 0 1 11 4.1zM12 6a6 6 0 1 0 0 12 6 6 0 1 0 0-12zM12 9a3 3 0 1 1 0 6 3 3 0 1 1 0-6z',
  palette: '!M12 2C6.5 2 2 6.2 2 11.5S6.5 21 11.5 21c1.4 0 2-1 1.5-2.2-.5-1.3.2-2.3 1.6-2.3H17c2.8 0 5-2 5-4.8C22 6.3 17.5 2 12 2zM7 12.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM9.5 8a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM14.5 8a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM17.5 12a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
  bell: 'M12 2a1.5 1.5 0 0 1 1.5 1.5v.7A6 6 0 0 1 18 10v5l2 2.5V19H4v-1.5L6 15v-5a6 6 0 0 1 4.5-5.8v-.7A1.5 1.5 0 0 1 12 2zM9.5 20h5a2.5 2.5 0 0 1-5 0z',
  user: 'M12 3a4.5 4.5 0 1 1 0 9 4.5 4.5 0 1 1 0-9zM3 21c0-4.4 4-7 9-7s9 2.6 9 7z',
  users: 'M9 4a4 4 0 1 1 0 8 4 4 0 1 1 0-8zM1 20c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5zM16.5 5a3.3 3.3 0 1 1 0 6.6 3.3 3.3 0 0 1 0-6.6zM18.4 13.6c2.7.5 4.6 2.6 4.6 5.9v.5h-4.5c0-2.6-.8-4.6-2.3-6.1z',
  userplus: 'M9 3a4.5 4.5 0 1 1 0 9 4.5 4.5 0 1 1 0-9zM1 21c0-4.4 3.6-7 8-7s8 2.6 8 7zM19 7h2v3h3v2h-3v3h-2v-3h-3v-2h3z',
  sliders: 'M3 6h10v2H3zM17 6h4v2h-4zM13 4h4v6h-4zM3 16h4v2H3zM11 16h10v2H11zM7 14h4v6H7z',
  thumb: 'M2 10h4v11H2zM8 10l4-7.5c1.5 0 2.5 1 2.5 2.5L14 9h5.5a2 2 0 0 1 2 2.4l-1.6 7.8a2.2 2.2 0 0 1-2.2 1.8H8z',
  link: 'M10 7H7a5 5 0 0 0 0 10h3v-2H7a3 3 0 0 1 0-6h3zM14 7h3a5 5 0 0 1 0 10h-3v-2h3a3 3 0 0 0 0-6h-3zM8 11h8v2H8z',
  trash: 'M9 2h6v2h5v2H4V4h5zM5 7h14l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1z',
  check: 'M9 16.2l-4.2-4.2-1.4 1.4L9 19 21 7l-1.4-1.4z',
  pencil: 'M3 17.2V21h3.8L17.8 9.9l-3.8-3.8zM20.7 7a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.8 3.8z',
  back: 'M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z',
  send: 'M2 21l21-9L2 3v7l15 2-15 2z',
  image: '!M3 4h18v16H3zM5 6v12h14V6zM6 16l4-5 3 3.5 2-2.5 3 4zM8.5 8a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
  pin: '!M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7zM12 6.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5z',
  calendar: '!M4 5h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM5 10v9h14v-9zM7 2h2v3H7zM15 2h2v3h-2zM7 12h3v3H7z',
  list: 'M3 5h2v2H3zM7 5h14v2H7zM3 11h2v2H3zM7 11h14v2H7zM3 17h2v2H3zM7 17h14v2H7z',
  logout: 'M4 3h9v2H6v14h7v2H4zM15 7l5 5-5 5-1.4-1.4 2.6-2.6H9v-2h7.2l-2.6-2.6z',
  arrow: 'M12 2l7 19-7-4-7 4z',
  map: '!M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2zM9 5.2v13.6l6 2V7.2z',
  minus: 'M4 11h16v2H4z',
  info: '!M12 2a10 10 0 1 1 0 20 10 10 0 1 1 0-20zM11 10h2v8h-2zM11 6h2v2h-2z',
  heart: 'M12 20.5C6 16 2.5 12.5 2.5 8.6A4.6 4.6 0 0 1 7.1 4c2 0 3.6 1 4.9 2.8C13.3 5 14.9 4 16.9 4a4.6 4.6 0 0 1 4.6 4.6c0 3.9-3.5 7.4-9.5 11.9z',
}

export type IconName = keyof typeof icons

const iconPaths = new Map<string, { path: Path2D; rule: CanvasFillRule }>()

export function drawIcon(ctx: CanvasRenderingContext2D, name: IconName, cx: number, cy: number, size: number, color: string) {
  let entry = iconPaths.get(name)
  if (!entry) {
    const d = icons[name]
    entry = d[0] === '!' ? { path: new Path2D(d.slice(1)), rule: 'evenodd' } : { path: new Path2D(d), rule: 'nonzero' }
    iconPaths.set(name, entry)
  }

  const s = size / 24
  ctx.save()
  ctx.translate(cx - size / 2, cy - size / 2)
  ctx.scale(s, s)
  ctx.fillStyle = color
  ctx.fill(entry.path, entry.rule)
  ctx.restore()
}

//
// Themes. Each one is just colours and a few switches the painter checks.
//

type RoadClass = 'motorway' | 'trunk' | 'primary' | 'secondary' | 'tertiary' | 'minor' | 'service' | 'path' | 'rail'

export type BlipStyle = 'pin' | 'square' | 'round' | 'stamp' | 'ring'

export type MapTheme = {
  land: string
  texture: 'none' | 'parchment' | 'grain'
  water: string
  waterShore: string | null // lines along coasts: ink rings in Frontier, a glow in the dark styles
  waterHatch: string | null
  wood: string
  woodMarks: string | null // little tree marks on forests
  grass: string
  park: string
  sand: string
  farm: string
  residential: string | null
  commercial: string
  industrial: string
  institution: string
  pitch: string
  building: string
  buildingLine: string | null
  buildingShadow: string | null
  casing: string | null
  road: Record<RoadClass, string>
  roadWidth: number
  wobble: number
  boundary: string
  glow: string | null
  font: string
  labelColor: string
  labelHalo: string
  placeColor: string
  waterLabel: string
  caps: boolean
  italic: boolean
  blip: BlipStyle
  blipInk: string // outline / glyph colour for blips
  poiAlpha: number
  me: string
  route: string // the walking route's line
  routeDash: boolean // inked styles dash it
  photo: string // canvas filter that gives people's photos the map's look
}

const sans = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

export const mapThemes: Record<string, MapTheme> = {
  day: {
    land: '#f3f1ec', texture: 'none',
    water: '#a8d0ec', waterShore: null, waterHatch: null,
    wood: '#cfe3c1', woodMarks: null, grass: '#dcecd0', park: '#d2e8c4', sand: '#f1e6c8', farm: '#ece9d6',
    residential: '#efece6', commercial: '#f2e9e6', industrial: '#ebe7ef', institution: '#efe6dc', pitch: '#c6e3bb',
    building: '#e3dfd8', buildingLine: '#d6d1c8', buildingShadow: null,
    casing: '#d4d0c7',
    road: { motorway: '#ffcf73', trunk: '#ffe29a', primary: '#fff3c4', secondary: '#ffffff', tertiary: '#ffffff', minor: '#ffffff', service: '#fbfaf7', path: '#c9bfae', rail: '#b9b4ab' },
    roadWidth: 1, wobble: 0, boundary: '#b7a6c9', glow: null,
    font: sans, labelColor: '#4a4d52', labelHalo: '#f3f1ec', placeColor: '#2b2d31', waterLabel: '#4f7ea3',
    caps: false, italic: false, blip: 'pin', blipInk: '#ffffff', poiAlpha: 0.85, me: '#2f7cf6', route: '#2f7cf6', routeDash: false, photo: 'none',
  },
  night: {
    land: '#16181d', texture: 'none',
    water: '#0d2233', waterShore: null, waterHatch: null,
    wood: '#17261d', woodMarks: null, grass: '#18241b', park: '#172a1f', sand: '#25231d', farm: '#1c1e1b',
    residential: '#1a1c22', commercial: '#1f1c22', industrial: '#1d1d24', institution: '#211e1c', pitch: '#1a2d21',
    building: '#23262e', buildingLine: '#2c3039', buildingShadow: null,
    casing: '#0f1115',
    road: { motorway: '#6b5a33', trunk: '#4d4636', primary: '#3b3d44', secondary: '#34363d', tertiary: '#303239', minor: '#2a2c33', service: '#25272d', path: '#34373f', rail: '#3a3d45' },
    roadWidth: 1, wobble: 0, boundary: '#5b4d72', glow: null,
    font: sans, labelColor: '#8e96a3', labelHalo: '#16181d', placeColor: '#c5ccd6', waterLabel: '#4d7394',
    caps: false, italic: false, blip: 'pin', blipInk: '#ffffff', poiAlpha: 0.75, me: '#4c9bff', route: '#4c9bff', routeDash: false, photo: 'none',
  },
  // Sun-bleached radar from a certain early-2000s west coast crime saga.
  coast: {
    land: '#8b9468', texture: 'grain',
    water: '#44698f', waterShore: null, waterHatch: null,
    wood: '#6f844d', woodMarks: null, grass: '#7f9159', park: '#6d8a4a', sand: '#c9b47e', farm: '#94975f',
    residential: '#8f9070', commercial: '#9a927a', industrial: '#8a8577', institution: '#978f73', pitch: '#6f8b4c',
    building: '#a09a86', buildingLine: '#5d5a4f', buildingShadow: null,
    casing: '#2e2c27',
    road: { motorway: '#d8d2bd', trunk: '#d0cab4', primary: '#c8c2ab', secondary: '#bfb9a3', tertiary: '#b8b29c', minor: '#aea893', service: '#a39e8a', path: '#9c966f', rail: '#4a473f' },
    roadWidth: 1.25, wobble: 0, boundary: '#3a3830', glow: null,
    font: '"Arial Black", "Helvetica Neue", Arial, sans-serif', labelColor: '#ffffff', labelHalo: '#1b1a17', placeColor: '#f4e7b8', waterLabel: '#d6e4f2',
    caps: true, italic: false, blip: 'square', blipInk: '#111111', poiAlpha: 1, me: '#ffffff', route: '#e0409a', routeDash: false, photo: 'saturate(1.3) contrast(1.1)',
  },
  // Pause-menu atlas of a modern sun-soaked sprawl.
  metro: {
    land: '#2b3138', texture: 'none',
    water: '#355f8c', waterShore: '#3f6e9e', waterHatch: null,
    wood: '#2f4234', woodMarks: null, grass: '#314236', park: '#34503b', sand: '#5a5443', farm: '#353b35',
    residential: '#30363d', commercial: '#343840', industrial: '#33353b', institution: '#363a40', pitch: '#35523c',
    building: '#3c434c', buildingLine: null, buildingShadow: '#1f2328',
    casing: null,
    road: { motorway: '#c2c7cc', trunk: '#b2b7bd', primary: '#9aa0a7', secondary: '#8a9097', tertiary: '#7b8188', minor: '#636970', service: '#565c63', path: '#4f555c', rail: '#4a5057' },
    roadWidth: 0.9, wobble: 0, boundary: '#717880', glow: null,
    font: '"Avenir Next Condensed", "Roboto Condensed", "Arial Narrow", sans-serif-condensed, sans-serif', labelColor: '#e8ebee', labelHalo: '#1b1f24', placeColor: '#ffffff', waterLabel: '#a9c6e6',
    caps: true, italic: false, blip: 'round', blipInk: '#ffffff', poiAlpha: 1, me: '#ffffff', route: '#b25ce6', routeDash: false, photo: 'none',
  },
  // A hand-inked survey map of the old frontier.
  frontier: {
    land: '#dcc9a0', texture: 'parchment',
    water: '#a9b7a4', waterShore: '#6f6a52', waterHatch: '#7e8b78',
    wood: '#c7bd8e', woodMarks: '#6b6340', grass: '#d4c696', park: '#cfc38f', sand: '#e2cf9f', farm: '#d6c595',
    residential: null, commercial: '#d3bf96', industrial: '#cfbd97', institution: '#d5c197', pitch: '#cbbf8d',
    building: '#d2bf95', buildingLine: 'rgba(90, 66, 40, 0.45)', buildingShadow: null,
    casing: null,
    road: { motorway: '#4a3624', trunk: '#4a3624', primary: '#523d29', secondary: '#5a4430', tertiary: '#634c36', minor: '#6f573f', service: '#7d6549', path: '#7d6549', rail: '#3b2a1b' },
    roadWidth: 0.55, wobble: 1.4, boundary: '#8a4b32', glow: null,
    font: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif', labelColor: '#3f2e1e', labelHalo: '#dcc9a0', placeColor: '#2e2115', waterLabel: '#3f4c43',
    caps: false, italic: true, blip: 'stamp', blipInk: '#3f2e1e', poiAlpha: 0.9, me: '#8f2b1c', route: '#8f2b1c', routeDash: true, photo: 'sepia(0.8) contrast(0.95)',
  },
  // Green phosphor tracking screen.
  radar: {
    land: '#030b06', texture: 'none',
    water: '#04150d', waterShore: '#0c5a33', waterHatch: null,
    wood: '#041109', woodMarks: null, grass: '#041109', park: '#051309', sand: '#060f08', farm: '#040d07',
    residential: null, commercial: '#050f09', industrial: '#050f09', institution: '#050f09', pitch: '#051309',
    building: '#06140c', buildingLine: '#0f5530', buildingShadow: null,
    casing: null,
    road: { motorway: '#58ff9c', trunk: '#4ef090', primary: '#3fd67c', secondary: '#34bb6b', tertiary: '#2ca25d', minor: '#1f7c46', service: '#18643a', path: '#145331', rail: '#1b6b3f' },
    roadWidth: 0.45, wobble: 0, boundary: '#2ca25d', glow: '#2dff88',
    font: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', labelColor: '#6dffaa', labelHalo: '#030b06', placeColor: '#b4ffd2', waterLabel: '#3fd67c',
    caps: true, italic: false, blip: 'ring', blipInk: '#6dffaa', poiAlpha: 0.9, me: '#b4ffd2', route: '#b4ffd2', routeDash: true,
    photo: 'grayscale(1) sepia(1) hue-rotate(80deg) saturate(3) brightness(0.9)',
  },
  // Beachfront nights in the eighties: hot pink roads glowing over a purple dusk.
  neon: {
    land: '#1a0b2e', texture: 'none',
    water: '#0b2346', waterShore: '#19e3ff', waterHatch: null,
    wood: '#1f1236', woodMarks: null, grass: '#1f1236', park: '#241342', sand: '#2b1640', farm: '#1c0f30',
    residential: null, commercial: '#210f38', industrial: '#1f0f33', institution: '#221038', pitch: '#291549',
    building: '#28144a', buildingLine: '#4f2479', buildingShadow: null,
    casing: null,
    road: { motorway: '#ff5ad9', trunk: '#ff4fd0', primary: '#ff3fa4', secondary: '#e23d9e', tertiary: '#bf3a92', minor: '#83308c', service: '#622775', path: '#4d2263', rail: '#19e3ff' },
    roadWidth: 0.55, wobble: 0, boundary: '#19e3ff', glow: '#ff2ea6',
    font: '"Futura", "Avenir Next", "Trebuchet MS", sans-serif', labelColor: '#ffd8f4', labelHalo: '#1a0b2e', placeColor: '#8af6ff', waterLabel: '#8af6ff',
    caps: true, italic: true, blip: 'ring', blipInk: '#ff6ad5', poiAlpha: 0.95, me: '#8af6ff', route: '#8af6ff', routeDash: false,
    photo: 'saturate(1.4) hue-rotate(-20deg) contrast(1.1)',
  },
}

//
// Protocol buffers and Mapbox Vector Tiles, just enough to read OpenMapTiles.
//

type Pbf = { buf: Uint8Array; pos: number }

function readVarint(p: Pbf) {
  let result = 0
  let shift = 0
  let b: number
  do {
    b = p.buf[p.pos++]
    if (shift < 28) result |= (b & 0x7f) << shift
    else result += (b & 0x7f) * 2 ** shift
    shift += 7
  } while (b & 0x80)
  return result
}

const zigzag = (n: number) => (n >>> 1) ^ -(n & 1)
const utf8 = new TextDecoder()

function skipField(p: Pbf, wire: number) {
  if (wire === 0) readVarint(p)
  else if (wire === 1) p.pos += 8
  else if (wire === 2) {
    const length = readVarint(p)
    p.pos += length
  } else if (wire === 5) p.pos += 4
}

function readString(p: Pbf) {
  const length = readVarint(p)
  const s = utf8.decode(p.buf.subarray(p.pos, p.pos + length))
  p.pos += length
  return s
}

// Layers the map never draws, so they aren't worth decoding. (A deny-list: a
// layer someone starts drawing later still decodes without anyone remembering this.)
const SKIPPED_LAYERS = new Set(['housenumber', 'aerodrome_label', 'aeroway'])

// Only these properties are kept; the tiles carry dozens of translated names we never show.
const KEPT = new Set(['class', 'subclass', 'name', 'name:latin', 'rank', 'brunnel', 'admin_level', 'maritime', 'layer', 'intermittent', 'ele'])

type Props = Record<string, string | number | boolean>

type Feature = {
  type: number // 1 point, 2 line, 3 polygon
  props: Props
  rings: Int32Array[] // flat [x0, y0, x1, y1, ...] in tile units; half the memory of plain arrays
  minX: number
  minY: number
  maxX: number
  maxY: number
}

// A tile's own ring and how to turn it into world units, so names that bend
// along a line don't need a copy of its coordinates.
type Line = { ring: Int32Array; baseX: number; baseY: number; scale: number }

function lineLength(ring: Int32Array) {
  let length = 0
  for (let i = 2; i < ring.length; i += 2) length += Math.hypot(ring[i] - ring[i - 2], ring[i + 1] - ring[i - 1])
  return length
}

type Label = {
  kind: 'place' | 'road' | 'water' | 'park' | 'poi'
  text: string
  x: number // world
  y: number
  angle: number
  length: number // world units of straight road available for the text
  line: Line | null // roads and rivers: their whole line, for names that follow a bend
  pathLength: number // that line's length in world units
  rank: number // lower goes first
  minZoom: number
  maxZoom: number
  size: number
  icon: IconName | null
  color: string | null
}

type SourceTile = {
  z: number
  x: number
  y: number
  extent: number
  layers: Record<string, Feature[]>
  labels: Label[]
}

function decodeFeature(p: Pbf, end: number, keys: string[], values: (string | number | boolean)[]): Feature {
  const feature: Feature = { type: 0, props: {}, rings: [], minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  const rings: number[][] = []

  while (p.pos < end) {
    const tag = readVarint(p)
    const field = tag >> 3

    if (field === 2) {
      const tagsEnd = readVarint(p) + p.pos
      while (p.pos < tagsEnd) {
        const key = keys[readVarint(p)]
        const value = values[readVarint(p)]
        if (KEPT.has(key)) feature.props[key] = value
      }
    } else if (field === 3) {
      feature.type = readVarint(p)
    } else if (field === 4) {
      const geometryEnd = readVarint(p) + p.pos
      let x = 0
      let y = 0
      let ring: number[] | null = null

      while (p.pos < geometryEnd) {
        const command = readVarint(p)
        const id = command & 7
        const count = command >> 3

        if (id === 1 || id === 2) {
          for (let i = 0; i < count; i++) {
            x += zigzag(readVarint(p))
            y += zigzag(readVarint(p))
            if (id === 1) {
              ring = [x, y]
              rings.push(ring)
            } else {
              ring!.push(x, y)
            }
            if (x < feature.minX) feature.minX = x
            if (y < feature.minY) feature.minY = y
            if (x > feature.maxX) feature.maxX = x
            if (y > feature.maxY) feature.maxY = y
          }
        } else if (id === 7 && ring) {
          ring.push(ring[0], ring[1])
        }
      }
    } else {
      skipField(p, tag & 7)
    }
  }

  feature.rings = rings.map((ring) => Int32Array.from(ring))
  return feature
}

function decodeTile(buf: Uint8Array, z: number, x: number, y: number): SourceTile {
  const p: Pbf = { buf, pos: 0 }
  const tile: SourceTile = { z, x, y, extent: 4096, layers: {}, labels: [] }

  while (p.pos < buf.length) {
    const tag = readVarint(p)
    if (tag >> 3 !== 3) {
      skipField(p, tag & 7)
      continue
    }

    const layerEnd = readVarint(p) + p.pos
    let name = ''
    const keys: string[] = []
    const values: (string | number | boolean)[] = []
    const featureRanges: number[] = []

    // Keys and values may come after the features that use them, so features are decoded last.
    while (p.pos < layerEnd) {
      const layerTag = readVarint(p)
      const field = layerTag >> 3

      if (field === 1) name = readString(p)
      else if (field === 3) keys.push(readString(p))
      else if (field === 5) tile.extent = readVarint(p)
      else if (field === 2) {
        const length = readVarint(p)
        featureRanges.push(p.pos, p.pos + length)
        p.pos += length
      } else if (field === 4) {
        const valueEnd = readVarint(p) + p.pos
        let value: string | number | boolean = ''
        while (p.pos < valueEnd) {
          const valueTag = readVarint(p)
          switch (valueTag >> 3) {
            case 1: value = readString(p); break
            case 2: value = new DataView(buf.buffer, buf.byteOffset + p.pos, 4).getFloat32(0, true); p.pos += 4; break
            case 3: value = new DataView(buf.buffer, buf.byteOffset + p.pos, 8).getFloat64(0, true); p.pos += 8; break
            case 4: case 5: value = readVarint(p); break
            case 6: value = zigzag(readVarint(p)); break
            case 7: value = readVarint(p) !== 0; break
            default: skipField(p, valueTag & 7)
          }
        }
        values.push(value)
      } else {
        skipField(p, layerTag & 7)
      }
    }

    // Layers we never draw aren't worth decoding.
    const features: Feature[] = []
    if (SKIPPED_LAYERS.has(name)) featureRanges.length = 0
    for (let i = 0; i < featureRanges.length; i += 2) {
      p.pos = featureRanges[i]
      features.push(decodeFeature(p, featureRanges[i + 1], keys, values))
    }
    tile.layers[name] = features
    p.pos = layerEnd
  }

  collectLabels(tile)
  return tile
}

//
// Label candidates, worked out once per source tile.
//

const POI_ICONS: Record<string, IconName> = {
  restaurant: 'fork', fast_food: 'burger', cafe: 'cup', ice_cream: 'cup', bakery: 'cup',
  bar: 'glass', beer: 'glass', alcohol_shop: 'glass',
  shop: 'bag', grocery: 'bag', clothing_store: 'shirt', jewelry: 'bag',
  hospital: 'cross', pharmacy: 'cross',
  police: 'shield', fire_station: 'shield', town_hall: 'shield',
  fuel: 'fuel', car: 'wrench', lodging: 'bed', bank: 'dollar',
  cinema: 'film', theatre: 'film', music: 'note',
  library: 'book', school: 'book', college: 'book', kindergarten: 'book',
  campsite: 'tree',
  railway: 'train', attraction: 'star', museum: 'star', art_gallery: 'star', monument: 'star', castle: 'star', zoo: 'star',
  hairdresser: 'scissors', fitness: 'dumbbell', stadium: 'ball', sports: 'ball',
}

// Blip colours by icon, so the same kind of place always looks the same.
const POI_COLORS: Partial<Record<IconName, string>> = {
  fork: '#e8743b', burger: '#e8743b', cup: '#b7773f', glass: '#b04fc4', bag: '#3f8fd8', shirt: '#3f8fd8',
  cross: '#e04848', shield: '#3b5bd6', fuel: '#6b8e23', wrench: '#7c7c7c', bed: '#8b5bd6', dollar: '#2e9e5b',
  film: '#d6456d', note: '#d6456d', book: '#c49a2c', tree: '#3f9e4f', train: '#4d6fa8', star: '#d8b02c',
  scissors: '#d06aa8', dumbbell: '#c4572c', ball: '#c4572c',
}

// What the place blips mean, for the legend.
export const LEGEND: [IconName, string][] = [
  ['fork', 'Restaurant'], ['burger', 'Fast food'], ['cup', 'Café, bakery'], ['glass', 'Bar, pub'],
  ['bag', 'Shop'], ['shirt', 'Clothes'], ['cross', 'Hospital, pharmacy'], ['shield', 'Police, fire'],
  ['fuel', 'Fuel'], ['wrench', 'Car repair'], ['bed', 'Hotel'], ['dollar', 'Bank'],
  ['film', 'Cinema, theatre'], ['book', 'School, library'], ['tree', 'Campsite'], ['train', 'Station'],
  ['star', 'Sights'], ['scissors', 'Hairdresser'], ['dumbbell', 'Gym'], ['ball', 'Sports ground'],
]

export const poiColor = (icon: IconName) => POI_COLORS[icon] ?? '#888888'

function nameOf(props: Props) {
  const name = props['name:latin'] ?? props.name
  return typeof name === 'string' ? name : ''
}

const PLACE_RANK: Record<string, [number, number, number, number]> = {
  // class: [priority, min zoom, max zoom, font size]
  country: [0, 3, 8, 14], state: [1, 5, 10, 13], city: [2, 6, 16.5, 17], town: [3, 9, 17, 15],
  village: [5, 11, 18, 13], suburb: [4, 12, 18, 13], quarter: [6, 14, 19, 12], neighbourhood: [7, 14.5, 19, 12],
  hamlet: [8, 13, 19, 12], island: [6, 10, 20, 12], locality: [9, 15, 20, 11], isolated_dwelling: [10, 16, 20, 11],
}

const ROAD_RANK: Record<string, number> = { motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4, minor: 5, service: 7, path: 8 }

function collectLabels(tile: SourceTile) {
  const scale = 2 ** tile.z * tile.extent
  const toWorldX = (u: number) => (tile.x * tile.extent + u) / scale
  const toWorldY = (v: number) => (tile.y * tile.extent + v) / scale
  const inside = (u: number, v: number) => u >= 0 && v >= 0 && u < tile.extent && v < tile.extent
  const lineOf = (ring: Int32Array): Line => ({ ring, baseX: tile.x * tile.extent, baseY: tile.y * tile.extent, scale })

  for (const f of tile.layers.place ?? []) {
    const text = nameOf(f.props)
    const rank = PLACE_RANK[String(f.props.class)]
    if (!text || !rank || !inside(f.rings[0][0], f.rings[0][1])) continue
    tile.labels.push({
      kind: 'place', text, x: toWorldX(f.rings[0][0]), y: toWorldY(f.rings[0][1]), angle: 0, length: 0, line: null, pathLength: 0,
      rank: rank[0] * 10 + Number(f.props.rank ?? 0) / 10, minZoom: rank[1], maxZoom: rank[2], size: rank[3], icon: null, color: null,
    })
  }

  // Rivers and creeks: their name runs along the water.
  for (const f of tile.layers.waterway ?? []) {
    const text = nameOf(f.props)
    const cls = String(f.props.class)
    if (!text || f.type !== 2 || (cls !== 'river' && cls !== 'stream' && cls !== 'canal')) continue
    for (const ring of f.rings) {
      const mid = ring.length >> 2 << 1
      if (ring.length < 4 || !inside(ring[mid], ring[mid + 1])) continue
      tile.labels.push({
        kind: 'water', text, x: toWorldX(ring[mid]), y: toWorldY(ring[mid + 1]), angle: 0, length: 0,
        line: lineOf(ring), pathLength: lineLength(ring) / scale,
        rank: cls === 'river' ? 45 : 65, minZoom: cls === 'river' ? 12 : 14.5, maxZoom: 20, size: 11, icon: null, color: null,
      })
    }
  }

  for (const f of tile.layers.water_name ?? []) {
    const text = nameOf(f.props)
    if (!text || f.type !== 1 || !inside(f.rings[0][0], f.rings[0][1])) continue
    const cls = String(f.props.class)
    tile.labels.push({
      kind: 'water', text, x: toWorldX(f.rings[0][0]), y: toWorldY(f.rings[0][1]), angle: 0, length: 0, line: null, pathLength: 0,
      rank: cls === 'ocean' || cls === 'sea' ? 5 : 40, minZoom: cls === 'ocean' ? 3 : cls === 'sea' ? 6 : 13, maxZoom: 20,
      size: cls === 'ocean' || cls === 'sea' ? 15 : 12, icon: null, color: null,
    })
  }

  for (const f of tile.layers.mountain_peak ?? []) {
    const name = nameOf(f.props)
    if (!name || f.type !== 1 || !inside(f.rings[0][0], f.rings[0][1])) continue
    const ele = Number(f.props.ele)
    tile.labels.push({
      kind: 'park', text: `▲ ${name}${ele ? ` ${Math.round(ele)} m` : ''}`, x: toWorldX(f.rings[0][0]), y: toWorldY(f.rings[0][1]),
      angle: 0, length: 0, line: null, pathLength: 0, rank: 60 + Number(f.props.rank ?? 0), minZoom: 10.5, maxZoom: 18, size: 11, icon: null, color: null,
    })
  }

  for (const f of tile.layers.park ?? []) {
    const text = nameOf(f.props)
    if (!text || f.type !== 1 || !inside(f.rings[0][0], f.rings[0][1])) continue
    tile.labels.push({
      kind: 'park', text, x: toWorldX(f.rings[0][0]), y: toWorldY(f.rings[0][1]), angle: 0, length: 0, line: null, pathLength: 0,
      rank: 70 + Number(f.props.rank ?? 0), minZoom: 14.5, maxZoom: 20, size: 11, icon: null, color: null,
    })
  }

  for (const f of tile.layers.poi ?? []) {
    if (f.type !== 1 || !inside(f.rings[0][0], f.rings[0][1])) continue
    const cls = String(f.props.class)
    const subclass = String(f.props.subclass ?? '')
    const icon = POI_ICONS[cls]
    // Artworks and bus stops are everywhere; they'd drown out the rest.
    if (!icon || subclass === 'artwork' || subclass === 'bus_stop' || subclass === 'tram_stop') continue
    const rank = Number(f.props.rank ?? 30)
    tile.labels.push({
      kind: 'poi', text: nameOf(f.props), x: toWorldX(f.rings[0][0]), y: toWorldY(f.rings[0][1]), angle: 0, length: 0, line: null, pathLength: 0,
      rank: 100 + rank, minZoom: rank <= 4 ? 15 : rank <= 12 ? 16 : 17, maxZoom: 20, size: 11, icon, color: POI_COLORS[icon] ?? '#888888',
    })
  }

  // Roads: label the longest nearly-straight run of each named line.
  for (const f of tile.layers.transportation_name ?? []) {
    const text = nameOf(f.props)
    const rank = ROAD_RANK[String(f.props.class)]
    if (!text || rank === undefined || f.type !== 2) continue

    for (const ring of f.rings) {
      let bestLength = 0
      let bestA = 0
      let bestB = 0
      let runStart = 0
      let runLength = 0
      let runAngle = 0

      for (let i = 0; i + 3 < ring.length; i += 2) {
        const dx = ring[i + 2] - ring[i]
        const dy = ring[i + 3] - ring[i + 1]
        const length = Math.hypot(dx, dy)
        const angle = Math.atan2(dy, dx)
        let turn = Math.abs(angle - runAngle)
        if (turn > Math.PI) turn = 2 * Math.PI - turn

        if (runLength === 0 || turn > 0.35) {
          runStart = i
          runLength = 0
          runAngle = angle
        }
        runLength += length
        if (runLength > bestLength) {
          bestLength = runLength
          bestA = runStart
          bestB = i + 2
        }
      }

      if (bestLength === 0) continue
      const ax = ring[bestA]
      const ay = ring[bestA + 1]
      const bx = ring[bestB]
      const by = ring[bestB + 1]
      const mx = (ax + bx) / 2
      const my = (ay + by) / 2
      if (!inside(mx, my)) continue

      let angle = Math.atan2(by - ay, bx - ax)
      if (angle > Math.PI / 2) angle -= Math.PI
      if (angle < -Math.PI / 2) angle += Math.PI

      tile.labels.push({
        kind: 'road', text, x: toWorldX(mx), y: toWorldY(my), angle, length: Math.hypot(bx - ax, by - ay) / scale,
        line: lineOf(ring), pathLength: lineLength(ring) / scale,
        rank: 50 + rank, minZoom: rank <= 2 ? 13 : rank <= 4 ? 14.5 : 15.5, maxZoom: 20, size: 11, icon: null, color: null,
      })
    }
  }

  tile.labels.sort((a, b) => a.rank - b.rank)
}

// The closest named road to a point, from tiles already loaded; '' if none is near.
// Good enough to say "near Rundle Street" without a geocoding service.
export function nearestStreet(m: MapState, lng: number, lat: number) {
  const n = 2 ** SOURCE_MAX_ZOOM
  const x = lngToX(lng) * n
  const y = latToY(lat) * n
  let best = ''
  let bestDistance = 160 // tile units at z14, roughly 100 m

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tile = m.sources.get(`${SOURCE_MAX_ZOOM}/${Math.floor(x) + dx}/${Math.floor(y) + dy}`)?.tile
      if (!tile) continue
      const px = (x - tile.x) * tile.extent
      const py = (y - tile.y) * tile.extent

      for (const f of tile.layers.transportation_name ?? []) {
        if (f.type !== 2) continue
        if (px < f.minX - bestDistance || px > f.maxX + bestDistance || py < f.minY - bestDistance || py > f.maxY + bestDistance) continue
        const name = nameOf(f.props)
        if (!name) continue

        for (const ring of f.rings) {
          for (let i = 0; i + 3 < ring.length; i += 2) {
            const ax = ring[i]
            const ay = ring[i + 1]
            const vx = ring[i + 2] - ax
            const vy = ring[i + 3] - ay
            const t = clamp(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1), 0, 1)
            const d = Math.hypot(px - (ax + vx * t), py - (ay + vy * t))
            if (d < bestDistance) {
              bestDistance = d
              best = name
            }
          }
        }
      }
    }
  }
  return best
}

// Streets, suburbs, parks and places in the tiles we've loaded whose name
// matches: a geocoder for the neighbourhood you're looking at, with no service.
export function findPlaces(m: MapState, query: string, limit = 6) {
  const q = query.trim().toLowerCase()
  const found = new Map<string, { name: string; kind: string; lng: number; lat: number; rank: number }>()
  if (q.length < 2) return []

  for (const entry of m.sources.values()) {
    for (const label of entry.tile?.labels ?? []) {
      if (!label.text || !label.text.toLowerCase().includes(q)) continue
      const kind = label.kind === 'road' ? 'Street' : label.kind === 'place' ? 'Area' : label.kind === 'poi' ? 'Place' : label.kind === 'water' ? 'Water' : 'Park'
      const key = `${kind}:${label.text}`
      // Prefer names that start with the query, then the more important ones.
      const rank = (label.text.toLowerCase().startsWith(q) ? 0 : 1000) + label.rank
      const seen = found.get(key)
      if (!seen || rank < seen.rank) found.set(key, { name: label.text, kind, lng: xToLng(label.x), lat: yToLat(label.y), rank })
    }
  }
  return [...found.values()].sort((a, b) => a.rank - b.rank).slice(0, limit)
}

//
// Map state.
//

export const MARK_MINE = 1
export const MARK_SAVED = 2
export const MARK_NEW = 4
export const MARK_RESOLVED = 8
export const MARK_SELECTED = 16
export const MARK_STALE = 32 // a person whose last position is old
export const MARK_ONLINE = 64 // a person with the app open right now
export const MARK_LIVE = 128 // a pin happening now or within the next few hours

export type Marker = {
  id: string
  kind: 'pin' | 'person' | 'me' | 'draft' | 'cluster'
  x: number // world
  y: number
  icon: IconName
  color: string
  count: number
  flags: number
  text: string // initials for people, count or empty for pins
  name: string // shown under people
  accuracy: number // metres, for 'me'
  heading: number | null
  image: string | null // a person's photo
}

type SourceEntry = { state: 'loading' | 'ready' | 'error'; tile: SourceTile | null; used: number }
type Raster = { canvas: HTMLCanvasElement; used: number; born: number }
type Sprite = { canvas: HTMLCanvasElement; width: number; height: number; used: number }

export type MapState = {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  ratio: number

  x: number
  y: number
  zoom: number
  theme: MapTheme
  themeName: string

  markers: Marker[]
  visible: Marker[] // markers as drawn this frame, with crowded pins merged into clusters
  labelAlpha: Map<Label, number> // labels fade in rather than pop
  hovered: Marker | null
  highlight: string | null // a marker lit up from outside, e.g. hovering its row in a list
  draftMode: boolean

  // Camera motion.
  fly: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; start: number; duration: number; bump: number } | null
  zoomTarget: number | null
  zoomAnchorX: number
  zoomAnchorY: number
  vx: number
  vy: number
  lastTime: number

  // Pointers: two of them is a pinch.
  pointers: Map<number, { x: number; y: number }>
  downX: number
  downY: number
  downTime: number
  moved: boolean
  pinchDistance: number
  lastTap: number
  lastPointer: string // 'mouse', 'touch' or 'pen'
  samples: { x: number; y: number; t: number }[]

  fade: { canvas: HTMLCanvasElement; start: number } | null // the old style, fading out after a switch
  radar: { x: number; y: number; r: number } | null // the corner minimap, in css px; null when hidden

  // The settled map (land, tiles, labels) kept as one bitmap, so frames that only
  // animate pins, the radar sweep or pulses just blit it and draw those on top.
  base: HTMLCanvasElement
  baseDirty: boolean // something besides the camera changed (tiles, markers, style, size)
  baseCamera: string // the camera the base was taken at; any other camera redraws
  markerKey: string // what the markers were last time, so an unchanged set doesn't redraw

  tileUrl: string | null
  sources: Map<string, SourceEntry>
  queue: { key: string; z: number; x: number; y: number; entry: SourceEntry }[] // tiles waiting to download
  fetching: number
  rasters: Map<string, Raster>
  sprites: Map<string, Sprite>
  textures: Map<string, CanvasPattern>
  images: Map<string, HTMLImageElement>
  born: Map<string, number> // when each pin first appeared, so new ones drop in
  frameCount: number
  frameRequested: boolean
  destroyed: boolean
  cleanup: () => void

  onClick: (marker: Marker | null, lng: number, lat: number) => void
  onHover: (marker: Marker | null) => void
  onFrame: () => void
  onUserMove: () => void // the person moved the map themselves
  onTile: () => void // a source tile arrived: street names nearby are now known
  route: Route | null // walking directions, drawn under the names
  onRoute: () => void // the route was worked out, or couldn't be
}

export function worldSize(m: MapState) {
  return TILE * 2 ** m.zoom
}

export function project(m: MapState, x: number, y: number) {
  const size = worldSize(m)
  return { x: (x - m.x) * size + m.width / 2, y: (y - m.y) * size + m.height / 2 }
}

export function unproject(m: MapState, sx: number, sy: number) {
  const size = worldSize(m)
  return { x: m.x + (sx - m.width / 2) / size, y: m.y + (sy - m.height / 2) / size }
}

export function center(m: MapState) {
  return { lng: xToLng(m.x), lat: yToLat(m.y), zoom: m.zoom }
}

export function requestFrame(m: MapState) {
  if (m.frameRequested || m.destroyed) return
  m.frameRequested = true
  requestAnimationFrame((time) => frame(m, time))
}

export function createMap(canvas: HTMLCanvasElement, lng: number, lat: number, zoom: number, themeName: string): MapState {
  const m: MapState = {
    canvas, ctx: canvas.getContext('2d')!, width: 0, height: 0, ratio: 1,
    x: lngToX(lng), y: latToY(lat), zoom, theme: mapThemes[themeName] ?? mapThemes.day, themeName,
    markers: [], visible: [], labelAlpha: new Map(), hovered: null, highlight: null, draftMode: false,
    fly: null, zoomTarget: null, zoomAnchorX: 0, zoomAnchorY: 0, vx: 0, vy: 0, lastTime: 0,
    pointers: new Map(), downX: 0, downY: 0, downTime: 0, moved: false, pinchDistance: 0, lastTap: 0, lastPointer: 'mouse', samples: [],
    fade: null, radar: null, base: document.createElement('canvas'), baseDirty: true, baseCamera: '', markerKey: '', tileUrl: null, sources: new Map(), queue: [], fetching: 0, rasters: new Map(), sprites: new Map(), textures: new Map(), images: new Map(), born: new Map(),
    frameCount: 0, frameRequested: false, destroyed: false, cleanup: () => {},
    onClick: () => {}, onHover: () => {}, onFrame: () => {}, onUserMove: () => {}, onTile: () => {},
    route: null, onRoute: () => {},
  }

  fetch(TILEJSON_URL)
    .then((response) => response.json())
    .then((json) => { m.tileUrl = json.tiles?.[0] ?? FALLBACK_TILES })
    .catch(() => { m.tileUrl = FALLBACK_TILES })
    .finally(() => requestFrame(m))

  const resize = () => {
    const rect = canvas.getBoundingClientRect()
    m.ratio = Math.min(window.devicePixelRatio || 1, 2)
    m.width = rect.width
    m.height = rect.height
    canvas.width = Math.round(rect.width * m.ratio)
    canvas.height = Math.round(rect.height * m.ratio)
    m.base.width = canvas.width
    m.base.height = canvas.height
    m.baseDirty = true
    requestFrame(m)
  }
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  resize()

  const removeInput = attachInput(m)
  m.cleanup = () => {
    observer.disconnect()
    removeInput()
  }
  return m
}

export function destroyMap(m: MapState) {
  m.destroyed = true
  m.cleanup()
}

export function setTheme(m: MapState, name: string) {
  if (name === m.themeName) return
  m.themeName = name
  m.theme = mapThemes[name] ?? mapThemes.day

  // Keep a picture of the old style and fade it out while the new one paints in.
  const snapshot = document.createElement('canvas')
  snapshot.width = m.canvas.width
  snapshot.height = m.canvas.height
  snapshot.getContext('2d')!.drawImage(m.canvas, 0, 0)
  m.fade = { canvas: snapshot, start: performance.now() }

  m.rasters.clear()
  m.sprites.clear()
  m.baseDirty = true
  requestFrame(m)
}

// The rectangular radar is this much wider than tall (its half width over r).
export const RADAR_WIDE = 1.35

export function setRadar(m: MapState, radar: { x: number; y: number; r: number } | null) {
  const same = radar && m.radar && radar.x === m.radar.x && radar.y === m.radar.y && radar.r === m.radar.r
  if (same || (!radar && !m.radar)) return
  m.radar = radar
  requestFrame(m)
}

export function setMarkers(m: MapState, markers: Marker[]) {
  // Pins seen for the first time after the first batch drop onto the map.
  const now = performance.now()
  const first = m.born.size === 0
  for (const marker of markers) {
    if (marker.kind === 'pin' && !m.born.has(marker.id)) m.born.set(marker.id, first ? 0 : now)
  }
  m.markers = markers
  // Markers claim label space, so the labels move with them; but only a change in
  // where they are (or what kind) matters, not every render.
  let key = ''
  for (const marker of markers) key += `${marker.id}:${marker.kind}:${marker.x}:${marker.y};`
  if (key !== m.markerKey) {
    m.markerKey = key
    m.baseDirty = true
  }
  if (m.hovered) m.hovered = markers.find((marker) => marker.id === m.hovered!.id) ?? null
  requestFrame(m)
}

export function flyTo(m: MapState, lng: number, lat: number, zoom = m.zoom, offsetX = 0, offsetY = 0) {
  // offset: keep the target this many css px away from the centre (e.g. clear of a side panel).
  const z1 = clamp(zoom, MIN_ZOOM, MAX_ZOOM)
  const size = TILE * 2 ** z1
  const x1 = lngToX(lng) - offsetX / size
  const y1 = latToY(lat) - offsetY / size
  const distance = Math.hypot(x1 - m.x, y1 - m.y) * worldSize(m)
  // Far jumps zoom out on the way, so you see where you're going.
  const bump = distance > m.width * 1.5 ? Math.min(Math.log2(distance / m.width) + 0.5, 6) : 0
  // People who asked for less motion get there straight away.
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  m.fly = { x0: m.x, y0: m.y, z0: m.zoom, x1, y1, z1, start: performance.now(), duration: still ? 1 : bump ? 1100 : 550, bump: still ? 0 : bump }
  m.zoomTarget = null
  m.vx = m.vy = 0
  requestFrame(m)
}

export function zoomBy(m: MapState, delta: number) {
  m.fly = null
  m.zoomTarget = clamp((m.zoomTarget ?? m.zoom) + delta, MIN_ZOOM, MAX_ZOOM)
  m.zoomAnchorX = m.width / 2
  m.zoomAnchorY = m.height / 2
  requestFrame(m)
}

export function panBy(m: MapState, dx: number, dy: number) {
  m.fly = null
  const size = worldSize(m)
  m.x = clamp(m.x + dx / size, 0, 1)
  m.y = clamp(m.y + dy / size, 0, 1)
  requestFrame(m)
}

// Like a fling: sets the map drifting so it comes to rest about (dx, dy) px away.
export function glideBy(m: MapState, dx: number, dy: number) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    panBy(m, dx, dy)
    return
  }
  m.fly = null
  // Setting the speed rather than adding to it: a held key's repeats glide
  // steadily instead of piling up. The fling's decay (280 ms) turns it into distance.
  m.vx = dx / 280
  m.vy = dy / 280
  requestFrame(m)
}

function zoomAround(m: MapState, zoom: number, sx: number, sy: number) {
  const before = unproject(m, sx, sy)
  m.zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM)
  const size = worldSize(m)
  m.x = clamp(before.x - (sx - m.width / 2) / size, 0, 1)
  m.y = clamp(before.y - (sy - m.height / 2) / size, 0, 1)
}

//
// Input.
//

function pickMarker(m: MapState, sx: number, sy: number) {
  // Last drawn is on top, so search backwards.
  for (let i = m.visible.length - 1; i >= 0; i--) {
    const marker = m.visible[i]
    if (marker.kind === 'draft') continue
    const p = project(m, marker.x, marker.y)
    const cy = marker.kind === 'pin' && m.theme.blip === 'pin' ? p.y - 20 : p.y
    const r = marker.kind === 'me' ? 14 : marker.kind === 'cluster' ? 24 : 18
    if ((sx - p.x) ** 2 + (sy - cy) ** 2 <= r * r) return marker
  }
  return null
}

function attachInput(m: MapState) {
  const canvas = m.canvas
  const local = (event: PointerEvent | WheelEvent | MouseEvent) => {
    const rect = canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const pinchInfo = () => {
    const [a, b] = [...m.pointers.values()]
    return { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }

  const onDown = (event: PointerEvent) => {
    canvas.setPointerCapture(event.pointerId)
    m.lastPointer = event.pointerType
    const p = local(event)
    m.pointers.set(event.pointerId, p)
    m.fly = null
    m.vx = m.vy = 0
    m.zoomTarget = null

    if (m.pointers.size === 1) {
      m.downX = p.x
      m.downY = p.y
      m.downTime = performance.now()
      m.moved = false
      m.samples = [{ x: p.x, y: p.y, t: m.downTime }]
    } else if (m.pointers.size === 2) {
      m.pinchDistance = pinchInfo().distance
      m.moved = true
      m.onUserMove()
    }
  }

  const onMove = (event: PointerEvent) => {
    const p = local(event)
    const previous = m.pointers.get(event.pointerId)

    if (!previous) {
      // Just hovering with a mouse.
      if (event.pointerType === 'mouse') {
        const marker = pickMarker(m, p.x, p.y)
        canvas.style.cursor = marker ? 'pointer' : m.draftMode ? 'crosshair' : 'grab'
        if (marker?.id !== m.hovered?.id) {
          m.hovered = marker
          m.onHover(marker)
          requestFrame(m)
        }
      }
      return
    }

    if (m.pointers.size === 1) {
      if (!m.moved && Math.hypot(p.x - m.downX, p.y - m.downY) < 4) return
      if (!m.moved) m.onUserMove()
      m.moved = true
      canvas.style.cursor = 'grabbing'
      panBy(m, previous.x - p.x, previous.y - p.y)
      m.samples.push({ x: p.x, y: p.y, t: performance.now() })
      if (m.samples.length > 6) m.samples.shift()
      m.pointers.set(event.pointerId, p)
    } else if (m.pointers.size === 2) {
      const before = pinchInfo()
      m.pointers.set(event.pointerId, p)
      const after = pinchInfo()
      panBy(m, before.x - after.x, before.y - after.y)
      zoomAround(m, m.zoom + Math.log2(after.distance / before.distance), after.x, after.y)
      requestFrame(m)
    }
  }

  const onUp = (event: PointerEvent) => {
    if (!m.pointers.has(event.pointerId)) return
    const p = local(event)
    const wasPinch = m.pointers.size > 1
    m.pointers.delete(event.pointerId)
    canvas.style.cursor = m.draftMode ? 'crosshair' : 'grab'

    if (wasPinch) {
      // The remaining finger continues as a drag from where it is now.
      const rest = [...m.pointers.values()][0]
      if (rest) m.samples = [{ x: rest.x, y: rest.y, t: performance.now() }]
      return
    }

    const now = performance.now()
    if (!m.moved) {
      if (now - m.lastTap < 300 && event.pointerType !== 'mouse') {
        // Double tap zooms in.
        m.zoomTarget = clamp(m.zoom + 1, MIN_ZOOM, MAX_ZOOM)
        m.zoomAnchorX = p.x
        m.zoomAnchorY = p.y
        m.lastTap = 0
        requestFrame(m)
        return
      }
      m.lastTap = now
      const me = m.markers.find((marker) => marker.kind === 'me')
      const wide = m.theme.blip === 'round' ? RADAR_WIDE : 1
      if (me && m.radar && Math.abs(p.x - m.radar.x) <= m.radar.r * wide && Math.abs(p.y - m.radar.y) <= m.radar.r) {
        // The radar is a button: back to where you are.
        flyTo(m, xToLng(me.x), yToLat(me.y), Math.max(m.zoom, 16))
        return
      }
      const marker = pickMarker(m, p.x, p.y)
      if (marker?.kind === 'cluster') {
        // A crowd of pins: go closer until they separate.
        flyTo(m, xToLng(marker.x), yToLat(marker.y), m.zoom + 2)
        return
      }
      const world = unproject(m, p.x, p.y)
      m.onClick(marker, xToLng(world.x), yToLat(world.y))
      return
    }

    // Fling: keep the recent velocity and let it decay.
    const first = m.samples[0]
    const last = m.samples[m.samples.length - 1]
    if (first && last && now - last.t < 60 && last.t > first.t) {
      const dt = last.t - first.t
      m.vx = (first.x - last.x) / dt
      m.vy = (first.y - last.y) / dt
      requestFrame(m)
    }
  }

  const onDoubleClick = (event: MouseEvent) => {
    // Touch has its own double tap above; browsers also send dblclick for it.
    if (m.lastPointer !== 'mouse') return
    const p = local(event)
    m.fly = null
    m.zoomTarget = clamp(Math.round(m.zoom) + (event.shiftKey ? -1 : 1), MIN_ZOOM, MAX_ZOOM)
    m.zoomAnchorX = p.x
    m.zoomAnchorY = p.y
    requestFrame(m)
  }

  const onWheel = (event: WheelEvent) => {
    event.preventDefault()
    const p = local(event)
    let delta = event.deltaY
    if (event.deltaMode === 1) delta *= 16
    // Trackpad pinches arrive as ctrl+wheel with small deltas.
    const amount = event.ctrlKey ? -delta / 100 : -delta / 450
    m.onUserMove()
    m.fly = null
    m.vx = m.vy = 0
    m.zoomTarget = clamp((m.zoomTarget ?? m.zoom) + clamp(amount, -1, 1), MIN_ZOOM, MAX_ZOOM)
    m.zoomAnchorX = p.x
    m.zoomAnchorY = p.y
    requestFrame(m)
  }

  const onLeave = () => {
    if (m.hovered) {
      m.hovered = null
      m.onHover(null)
      requestFrame(m)
    }
  }

  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)
  canvas.addEventListener('pointerleave', onLeave)
  canvas.addEventListener('dblclick', onDoubleClick)
  canvas.addEventListener('wheel', onWheel, { passive: false })

  return () => {
    canvas.removeEventListener('pointerdown', onDown)
    canvas.removeEventListener('pointermove', onMove)
    canvas.removeEventListener('pointerup', onUp)
    canvas.removeEventListener('pointercancel', onUp)
    canvas.removeEventListener('pointerleave', onLeave)
    canvas.removeEventListener('dblclick', onDoubleClick)
    canvas.removeEventListener('wheel', onWheel)
  }
}

// Advances flights, smooth zoom and flings. Returns true while something is still moving.
function stepCamera(m: MapState, now: number) {
  const dt = Math.min(now - (m.lastTime || now), 50)
  m.lastTime = now
  let moving = false

  if (m.fly) {
    const f = m.fly
    const t = clamp((now - f.start) / f.duration, 0, 1)
    const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
    m.x = f.x0 + (f.x1 - f.x0) * e
    m.y = f.y0 + (f.y1 - f.y0) * e
    m.zoom = f.z0 + (f.z1 - f.z0) * e - f.bump * Math.sin(Math.PI * e)
    if (t >= 1) m.fly = null
    moving = true
  }

  if (m.zoomTarget !== null) {
    const next = m.zoom + (m.zoomTarget - m.zoom) * (1 - Math.exp(-dt / 70))
    if (Math.abs(m.zoomTarget - next) < 0.002) {
      zoomAround(m, m.zoomTarget, m.zoomAnchorX, m.zoomAnchorY)
      m.zoomTarget = null
    } else {
      zoomAround(m, next, m.zoomAnchorX, m.zoomAnchorY)
    }
    moving = true
  }

  if (m.vx !== 0 || m.vy !== 0) {
    const size = worldSize(m)
    m.x = clamp(m.x + (m.vx * dt) / size, 0, 1)
    m.y = clamp(m.y + (m.vy * dt) / size, 0, 1)
    const decay = Math.exp(-dt / 280)
    m.vx *= decay
    m.vy *= decay
    if (Math.hypot(m.vx, m.vy) < 0.02) m.vx = m.vy = 0
    moving = true
  }

  return moving
}

//
// Tiles: fetching, caching, painting.
//

function requestSource(m: MapState, z: number, x: number, y: number) {
  const key = `${z}/${x}/${y}`
  const entry = m.sources.get(key)
  if (entry) {
    entry.used = m.frameCount
    return entry
  }
  if (!m.tileUrl) return null

  const fresh: SourceEntry = { state: 'loading', tile: null, used: m.frameCount }
  m.sources.set(key, fresh)
  m.queue.push({ key, z, x, y, entry: fresh })
  pumpFetches(m)
  return fresh
}

// A few downloads at a time, in the order the frame asked (middle of the screen
// first), so on a slow connection the middle fills in first instead of every tile
// crawling in together. Tiles nobody has wanted for a while are dropped unfetched.
function pumpFetches(m: MapState) {
  while (m.fetching < 4 && m.queue.length) {
    const job = m.queue.shift()!
    if (m.frameCount - job.entry.used > 2) {
      if (m.sources.get(job.key) === job.entry) m.sources.delete(job.key)
      continue
    }

    m.fetching++
    const url = m.tileUrl!.replace('{z}', String(job.z)).replace('{x}', String(job.x)).replace('{y}', String(job.y))
    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`tile ${job.key}: ${response.status}`)
        return response.arrayBuffer()
      })
      .then((buffer) => {
        job.entry.tile = decodeTile(new Uint8Array(buffer), job.z, job.x, job.y)
        job.entry.state = 'ready'
        m.baseDirty = true
        m.onTile()
      })
      .catch(() => {
        // Forget it after a while so a network blip doesn't leave a hole for good.
        job.entry.state = 'error'
        setTimeout(() => {
          if (m.sources.get(job.key) === job.entry) m.sources.delete(job.key)
          m.baseDirty = true // so the frame asks for it again
          requestFrame(m)
        }, 5000)
      })
      .finally(() => {
        m.fetching--
        pumpFetches(m)
        requestFrame(m)
      })
  }
}

// Keeps caches bounded: least recently drawn goes first. Lets them run a quarter
// over before trimming, so the sort happens now and then rather than every frame.
function evict<T extends { used: number }>(cache: Map<string, T>, limit: number) {
  if (cache.size <= limit * 1.25) return
  const entries = [...cache.entries()].sort((a, b) => a[1].used - b[1].used)
  for (let i = 0; i < entries.length - limit; i++) cache.delete(entries[i][0])
}

// Deterministic jitter for the hand-drawn look: same vertex, same wobble, in every tile.
function jitter(x: number, y: number) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) & 0xffff) / 0x7fff - 1
}

function texture(m: MapState, ctx: CanvasRenderingContext2D, kind: string) {
  let pattern = m.textures.get(kind)
  if (pattern) return pattern

  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const c = canvas.getContext('2d')!
  const image = c.createImageData(size, size)
  let seed = 1234567
  const random = () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822507) + 1013904223) >>> 0) / 4294967296

  // Value noise on a wrapping lattice, so the texture tiles seamlessly.
  const noise = (cells: number) => {
    const lattice = new Float32Array(cells * cells)
    for (let i = 0; i < lattice.length; i++) lattice[i] = random()
    const out = new Float32Array(size * size)
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const fx = (px / size) * cells
        const fy = (py / size) * cells
        const ix = Math.floor(fx)
        const iy = Math.floor(fy)
        const tx = fx - ix
        const ty = fy - iy
        const sx = tx * tx * (3 - 2 * tx)
        const sy = ty * ty * (3 - 2 * ty)
        const at = (i: number, j: number) => lattice[((j % cells) * cells + (i % cells)) | 0]
        const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx
        const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx
        out[py * size + px] = top + (bottom - top) * sy
      }
    }
    return out
  }

  const coarse = noise(4)
  const medium = noise(16)
  for (let i = 0; i < size * size; i++) {
    const grain = random()
    let r: number, g: number, b: number, a: number
    if (kind === 'parchment') {
      // Blotchy stains plus fibre grain, as darkening over the land colour.
      const stain = coarse[i] * 0.6 + medium[i] * 0.4
      r = 90; g = 60; b = 25
      a = Math.max(0, stain - 0.35) * 110 + grain * 22
    } else {
      r = g = b = grain > 0.5 ? 255 : 0
      a = Math.abs(grain - 0.5) * 34 + medium[i] * 6
    }
    image.data[i * 4] = r
    image.data[i * 4 + 1] = g
    image.data[i * 4 + 2] = b
    image.data[i * 4 + 3] = a
  }
  c.putImageData(image, 0, 0)

  pattern = ctx.createPattern(canvas, 'repeat')!
  m.textures.set(kind, pattern)
  return pattern
}

function roadClass(props: Props): RoadClass | null {
  const cls = String(props.class)
  switch (cls) {
    case 'motorway': case 'trunk': case 'primary': case 'secondary': case 'tertiary': case 'minor': case 'service':
      return cls
    case 'track': case 'raceway': case 'busway':
      return 'service'
    case 'path': case 'bridleway':
      return 'path'
    case 'rail': case 'transit':
      return 'rail'
  }
  return null
}

const ROAD_BASE: Record<RoadClass, [number, number]> = {
  // [width in css px at zoom 16, first zoom it shows]
  motorway: [7, 5], trunk: [6.5, 6], primary: [6, 8], secondary: [5, 10], tertiary: [4.5, 11],
  minor: [3.5, 13], service: [2, 14.5], path: [1.3, 15], rail: [1.6, 11],
}

const DRAW_ORDER: RoadClass[] = ['path', 'service', 'minor', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway']

function paintTile(m: MapState, ctx: CanvasRenderingContext2D, size: number, src: SourceTile, z: number, x: number, y: number) {
  const t = m.theme
  const k = 2 ** (z - src.z)
  const ox = x - src.x * k
  const oy = y - src.y * k
  const scale = (k * size) / src.extent // tile units -> bitmap pixels
  const px = size / TILE // bitmap pixels per css pixel
  const unit = px / scale // one css pixel, in tile units

  // Visible window in tile units, padded for wide strokes.
  const pad = 24 * unit
  const minU = (ox * src.extent) / k - pad
  const minV = (oy * src.extent) / k - pad
  const maxU = ((ox + 1) * src.extent) / k + pad
  const maxV = ((oy + 1) * src.extent) / k + pad
  const visible = (f: Feature) => f.maxX >= minU && f.minX <= maxU && f.maxY >= minV && f.minY <= maxV

  const baseX = src.x * src.extent
  const baseY = src.y * src.extent
  const wobble = t.wobble * unit

  // Rings come back from the decoder already closed (first point repeated), so there's
  // no closePath() here: Chrome makes it slow on paths with thousands of subpaths.
  const trace = (f: Feature) => {
    for (const ring of f.rings) {
      if (wobble > 0) {
        ctx.moveTo(ring[0] + jitter(baseX + ring[0], baseY + ring[1]) * wobble, ring[1] + jitter(baseY + ring[1], baseX + ring[0]) * wobble)
        for (let i = 2; i < ring.length; i += 2) {
          const u = ring[i]
          const v = ring[i + 1]
          ctx.lineTo(u + jitter(baseX + u, baseY + v) * wobble, v + jitter(baseY + v, baseX + u) * wobble)
        }
      } else {
        ctx.moveTo(ring[0], ring[1])
        for (let i = 2; i < ring.length; i += 2) ctx.lineTo(ring[i], ring[i + 1])
      }
    }
  }

  const fillWhere = (layer: string, color: string | null, test: (f: Feature) => boolean) => {
    if (!color) return
    ctx.beginPath()
    let any = false
    for (const f of src.layers[layer] ?? []) {
      if (f.type === 3 && visible(f) && test(f)) {
        trace(f)
        any = true
      }
    }
    if (any) {
      ctx.fillStyle = color
      ctx.fill('evenodd')
    }
  }

  // Background: land colour, then texture in bitmap space so every tile lines up.
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = t.land
  ctx.fillRect(0, 0, size, size)
  if (t.texture !== 'none') {
    ctx.fillStyle = texture(m, ctx, t.texture)
    ctx.fillRect(0, 0, size, size)
  }

  ctx.setTransform(scale, 0, 0, scale, -ox * size, -oy * size)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  const cls = (f: Feature) => String(f.props.class)

  // Land use and cover, least important first.
  if (z >= 11) {
    fillWhere('landuse', t.residential, (f) => cls(f) === 'residential' || cls(f) === 'suburb' || cls(f) === 'neighbourhood')
    fillWhere('landuse', t.commercial, (f) => cls(f) === 'commercial' || cls(f) === 'retail')
    fillWhere('landuse', t.industrial, (f) => cls(f) === 'industrial' || cls(f) === 'railway' || cls(f) === 'garages')
    fillWhere('landuse', t.institution, (f) => ['school', 'university', 'college', 'hospital', 'kindergarten', 'library', 'cemetery'].includes(cls(f)))
  }
  fillWhere('landcover', t.farm, (f) => cls(f) === 'farmland')
  fillWhere('landcover', t.sand, (f) => cls(f) === 'sand' || cls(f) === 'rock')
  fillWhere('landcover', t.grass, (f) => cls(f) === 'grass' || cls(f) === 'wetland')
  fillWhere('landcover', t.wood, (f) => cls(f) === 'wood')
  fillWhere('park', t.park, () => true)
  if (z >= 13) fillWhere('landuse', t.pitch, (f) => ['pitch', 'playground', 'stadium', 'track'].includes(cls(f)))

  // Little tree marks over woods and parks.
  if (t.woodMarks && z >= 12) {
    const marks: Feature[] = []
    for (const f of src.layers.landcover ?? []) if (f.type === 3 && cls(f) === 'wood' && visible(f)) marks.push(f)
    for (const f of src.layers.park ?? []) if (f.type === 3 && visible(f)) marks.push(f)
    if (marks.length) {
      ctx.save()
      ctx.beginPath()
      for (const f of marks) trace(f)
      ctx.clip('evenodd')
      ctx.fillStyle = t.woodMarks
      const step = 14 * unit
      const startU = Math.floor(minU / step) * step
      const startV = Math.floor(minV / step) * step
      ctx.beginPath()
      for (let v = startV; v < maxV; v += step) {
        for (let u = startU; u < maxU; u += step) {
          const shift = ((Math.round(v / step) & 1) * step) / 2
          const cu = u + shift + jitter(baseX + u, baseY + v) * step * 0.25
          const cv = v + jitter(baseY + v, baseX + u) * step * 0.25
          const h = 4 * unit
          ctx.moveTo(cu, cv - h)
          ctx.lineTo(cu + h * 0.7, cv + h * 0.6)
          ctx.lineTo(cu - h * 0.7, cv + h * 0.6)
        }
      }
      ctx.globalAlpha = 0.55
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.restore()
    }
  }

  // Water: shore lines first (only the land side survives the fill), then the water, then hatching.
  const water = (src.layers.water ?? []).filter((f) => f.type === 3 && visible(f) && cls(f) !== 'swimming_pool')
  if (water.length) {
    ctx.beginPath()
    for (const f of water) trace(f)

    if (t.waterShore) {
      ctx.strokeStyle = t.waterShore
      for (const [width, alpha] of [[14, 0.12], [9, 0.2], [5, 0.35]]) {
        ctx.globalAlpha = alpha
        ctx.lineWidth = width * unit
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    ctx.fillStyle = t.water
    ctx.fill('evenodd')

    if (t.waterHatch) {
      ctx.save()
      ctx.clip('evenodd')
      ctx.strokeStyle = t.waterHatch
      ctx.lineWidth = 0.8 * unit
      ctx.globalAlpha = 0.5
      const step = 7 * unit
      ctx.beginPath()
      for (let v = Math.floor(minV / step) * step; v < maxV; v += step) {
        // Short broken strokes read as engraved water.
        for (let u = minU; u < maxU; u += step * 6) {
          const off = jitter(baseX + u, baseY + v) * step * 2
          ctx.moveTo(u + off, v)
          ctx.lineTo(u + off + step * 3.2, v)
        }
      }
      ctx.stroke()
      ctx.restore()
    }
  }

  ctx.beginPath()
  let anyWaterway = false
  for (const f of src.layers.waterway ?? []) {
    if (f.type === 2 && visible(f) && (z >= 13 || cls(f) === 'river')) {
      trace(f)
      anyWaterway = true
    }
  }
  if (anyWaterway) {
    ctx.strokeStyle = t.water
    ctx.lineWidth = (z >= 15 ? 3 : 1.6) * unit
    ctx.stroke()
  }

  // Buildings.
  if (z >= 15) {
    const buildings = (src.layers.building ?? []).filter((f) => f.type === 3 && visible(f))
    if (buildings.length) {
      if (t.buildingShadow) {
        ctx.save()
        ctx.translate(1.5 * unit, 1.5 * unit)
        ctx.beginPath()
        for (const f of buildings) trace(f)
        ctx.fillStyle = t.buildingShadow
        ctx.fill('evenodd')
        ctx.restore()
      }
      ctx.beginPath()
      for (const f of buildings) trace(f)
      ctx.fillStyle = t.building
      ctx.fill('evenodd')
      if (t.buildingLine) {
        ctx.strokeStyle = t.buildingLine
        ctx.lineWidth = 0.6 * unit
        ctx.stroke()
      }
    }
  }

  // Roads: gather lines per class, then casings under everything, then fills.
  const roads: Record<RoadClass, Feature[]> = { motorway: [], trunk: [], primary: [], secondary: [], tertiary: [], minor: [], service: [], path: [], rail: [] }
  const tunnels: Feature[] = []
  for (const f of src.layers.transportation ?? []) {
    if (f.type !== 2 || !visible(f)) continue
    const rc = roadClass(f.props)
    if (!rc || z < ROAD_BASE[rc][1]) continue
    if (f.props.brunnel === 'tunnel' && rc !== 'path') tunnels.push(f)
    else roads[rc].push(f)
  }

  // Roads widen with zoom, but slower past street level so they don't swallow the blocks.
  const widthOf = (rc: RoadClass) => Math.max(0.6, ROAD_BASE[rc][0] * 2 ** ((Math.min(z, 17) - 16) * 0.75 + (Math.max(z, 17) - 17) * 0.4) * t.roadWidth)

  // Glowing styles: two wide, faint strokes of the glow colour under every road.
  // Much cheaper than a blur on each stroke, and it reads the same.
  if (t.glow) {
    ctx.strokeStyle = t.glow
    for (const [spread, alpha] of [[9, 0.07], [4, 0.14]]) {
      ctx.globalAlpha = alpha
      for (const rc of DRAW_ORDER) {
        if (!roads[rc].length || rc === 'path' || rc === 'service') continue
        ctx.beginPath()
        for (const f of roads[rc]) trace(f)
        ctx.lineWidth = (widthOf(rc) + spread) * unit
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
  }

  if (tunnels.length) {
    ctx.globalAlpha = 0.35
    for (const f of tunnels) {
      const rc = roadClass(f.props)!
      ctx.beginPath()
      trace(f)
      ctx.strokeStyle = t.road[rc]
      ctx.lineWidth = widthOf(rc) * unit
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  if (t.casing) {
    for (const rc of DRAW_ORDER) {
      if (!roads[rc].length || rc === 'path') continue
      ctx.beginPath()
      for (const f of roads[rc]) trace(f)
      ctx.strokeStyle = t.casing
      ctx.lineWidth = (widthOf(rc) + (z >= 15 ? 2 : 1.2)) * unit
      ctx.stroke()
    }
  }

  for (const rc of DRAW_ORDER) {
    if (!roads[rc].length) continue
    ctx.beginPath()
    for (const f of roads[rc]) trace(f)
    ctx.strokeStyle = t.road[rc]
    ctx.lineWidth = widthOf(rc) * unit
    if (rc === 'path') ctx.setLineDash([2 * unit, 2.5 * unit])
    ctx.stroke()
    ctx.setLineDash([])

    // Ink maps draw big roads as a double line.
    if (t.wobble > 0 && (rc === 'motorway' || rc === 'trunk' || rc === 'primary') && z >= 12) {
      ctx.strokeStyle = t.land
      ctx.lineWidth = widthOf(rc) * 0.45 * unit
      ctx.stroke()
    }
  }

  if (roads.rail.length) {
    ctx.beginPath()
    for (const f of roads.rail) trace(f)
    ctx.strokeStyle = t.road.rail
    ctx.lineWidth = widthOf('rail') * unit
    ctx.stroke()
    if (z >= 14) {
      // Sleepers.
      ctx.lineWidth = widthOf('rail') * 3 * unit
      ctx.setLineDash([0.8 * unit, 6 * unit])
      ctx.lineCap = 'butt'
      ctx.stroke()
      ctx.setLineDash([])
      ctx.lineCap = 'round'
    }
  }

  // Country and state borders.
  ctx.beginPath()
  let anyBoundary = false
  for (const f of src.layers.boundary ?? []) {
    if (f.type === 2 && visible(f) && Number(f.props.admin_level) <= 4 && !f.props.maritime) {
      trace(f)
      anyBoundary = true
    }
  }
  if (anyBoundary) {
    ctx.strokeStyle = t.boundary
    ctx.lineWidth = 1.2 * unit
    ctx.setLineDash([6 * unit, 3 * unit])
    ctx.stroke()
    ctx.setLineDash([])
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0)
}

function sourceFor(z: number) {
  return Math.min(z, SOURCE_MAX_ZOOM)
}

// Returns the bitmap for display tile z/x/y, painting it if its data is here.
// Painting is budgeted per frame, so a zoom never stalls on a pile of tiles.
function tileRaster(m: MapState, z: number, x: number, y: number, allowPaint: boolean) {
  const key = `${z}/${x}/${y}`
  const raster = m.rasters.get(key)
  if (raster) {
    raster.used = m.frameCount
    return raster
  }

  const sz = sourceFor(z)
  const shift = z - sz
  const entry = requestSource(m, sz, x >> shift, y >> shift)
  if (!entry || entry.state !== 'ready' || !allowPaint) return null

  const size = TILE * m.ratio
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  paintTile(m, canvas.getContext('2d')!, size, entry.tile!, z, x, y)
  const fresh = { canvas, used: m.frameCount, born: performance.now() }
  m.rasters.set(key, fresh)
  return fresh
}

//
// Labels, blips and people: sprites cached per text and theme, placed per frame.
//

function sprite(m: MapState, key: string, width: number, height: number, draw: (c: CanvasRenderingContext2D) => void) {
  let s = m.sprites.get(key)
  if (!s) {
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(width * m.ratio)
    canvas.height = Math.ceil(height * m.ratio)
    const c = canvas.getContext('2d')!
    c.scale(m.ratio, m.ratio)
    draw(c)
    s = { canvas, width, height, used: 0 }
    m.sprites.set(key, s)
  }
  s.used = m.frameCount
  return s
}

const measurer = document.createElement('canvas').getContext('2d')!

function labelFont(t: MapTheme, label: Label) {
  const italic = (t.italic && label.kind !== 'poi') || label.kind === 'water' || label.kind === 'park' ? 'italic ' : ''
  const weight = label.kind === 'place' ? (t.caps ? 700 : 600) : label.kind === 'road' ? 500 : 500
  return `${italic}${weight} ${label.size}px ${t.font}`
}

function labelText(t: MapTheme, label: Label) {
  return t.caps || (label.kind === 'place' && label.size <= 13) ? label.text.toUpperCase() : label.text
}

function labelSprite(m: MapState, label: Label) {
  const t = m.theme
  const text = labelText(t, label)
  const font = labelFont(t, label)
  const key = `L${label.kind}${label.size}|${text}`
  const cached = m.sprites.get(key)
  if (cached) {
    cached.used = m.frameCount
    return cached
  }

  measurer.font = font
  const spacing = label.kind === 'place' && label.size <= 13 ? 1.5 : t.caps ? 0.8 : 0
  const width = measurer.measureText(text).width + spacing * text.length + 6
  const height = label.size + 8
  const fill = label.kind === 'place' ? t.placeColor : label.kind === 'water' ? t.waterLabel : t.labelColor

  return sprite(m, key, width, height, (c) => {
    c.font = font
    c.textBaseline = 'middle'
    c.textAlign = 'center'
    if ('letterSpacing' in c) (c as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${spacing}px`
    c.lineJoin = 'round'
    c.strokeStyle = t.labelHalo
    c.lineWidth = t.blip === 'square' ? 3.5 : 3
    c.strokeText(text, width / 2, height / 2)
    if (t.glow) {
      c.shadowColor = t.glow
      c.shadowBlur = 6
    }
    c.fillStyle = fill
    c.fillText(text, width / 2, height / 2)
  })
}

// One letter with its halo, for names that bend along a road.
function glyphSprite(m: MapState, t: MapTheme, font: string, size: number, color: string, ch: string) {
  const width = advance(font, ch) + 6
  const height = size + 8
  return sprite(m, `G${font}|${color}|${ch}`, width, height, (c) => {
    c.font = font
    c.textBaseline = 'middle'
    c.textAlign = 'center'
    c.lineJoin = 'round'
    c.strokeStyle = t.labelHalo
    c.lineWidth = t.blip === 'square' ? 3.5 : 3
    c.strokeText(ch, width / 2, height / 2)
    if (t.glow) {
      c.shadowColor = t.glow
      c.shadowBlur = 6
    }
    c.fillStyle = color
    c.fillText(ch, width / 2, height / 2)
  })
}

const advances = new Map<string, number>()

function advance(font: string, ch: string) {
  const key = `${font}|${ch}`
  let width = advances.get(key)
  if (width === undefined) {
    measurer.font = font
    width = measurer.measureText(ch).width
    advances.set(key, width)
  }
  return width
}

// Where each letter of a name goes along its line: centred where the line
// passes closest to the label's own spot (sx, sy), reading left to right.
// Null when there's no room or the line bends too sharply to read.
function alongPath(m: MapState, line: Line, sx: number, sy: number, widths: number[], total: number) {
  const size = worldSize(m)
  const ring = line.ring
  let pts: number[] = []
  for (let i = 0; i < ring.length; i += 2) {
    pts.push(((line.baseX + ring[i]) / line.scale - m.x) * size + m.width / 2, ((line.baseY + ring[i + 1]) / line.scale - m.y) * size + m.height / 2)
  }
  if (pts[pts.length - 2] < pts[0]) {
    const reversed: number[] = []
    for (let i = pts.length - 2; i >= 0; i -= 2) reversed.push(pts[i], pts[i + 1])
    pts = reversed
  }

  // Distance along the line, and where along it the label's spot sits.
  const along = [0]
  let spot = 0
  let nearest = Infinity
  for (let i = 2; i < pts.length; i += 2) {
    const ax = pts[i - 2]
    const ay = pts[i - 1]
    const vx = pts[i] - ax
    const vy = pts[i + 1] - ay
    const segment = Math.hypot(vx, vy)
    const t = clamp(((sx - ax) * vx + (sy - ay) * vy) / (segment * segment || 1), 0, 1)
    const d = Math.hypot(sx - (ax + vx * t), sy - (ay + vy * t))
    if (d < nearest) {
      nearest = d
      spot = along[along.length - 1] + segment * t
    }
    along.push(along[along.length - 1] + segment)
  }
  const length = along[along.length - 1]
  if (length < total + 24) return null

  const out: { x: number; y: number; angle: number }[] = []
  let d = clamp(spot, total / 2 + 12, length - total / 2 - 12) - total / 2
  let seg = 0
  let last: number | null = null
  for (const w of widths) {
    const mid = d + w / 2
    while (seg < along.length - 2 && along[seg + 1] < mid) seg++
    const x0 = pts[seg * 2]
    const y0 = pts[seg * 2 + 1]
    const x1 = pts[seg * 2 + 2]
    const y1 = pts[seg * 2 + 3]
    const t = (mid - along[seg]) / (along[seg + 1] - along[seg] || 1)
    const angle = Math.atan2(y1 - y0, x1 - x0)
    if (last !== null) {
      let turn = Math.abs(angle - last)
      if (turn > Math.PI) turn = 2 * Math.PI - turn
      if (turn > 0.5) return null
    }
    last = angle
    out.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, angle })
    d += w
  }
  return out
}

// A blip: the badge a map puts on a place. The shape depends on the theme.
function drawBadge(c: CanvasRenderingContext2D, t: MapTheme, cx: number, cy: number, r: number, color: string, icon: IconName, emphasis: boolean) {
  switch (t.blip) {
    case 'square': {
      c.fillStyle = '#111'
      c.fillRect(cx - r - 1.5, cy - r - 1.5, 2 * r + 3, 2 * r + 3)
      c.fillStyle = color
      c.fillRect(cx - r, cy - r, 2 * r, 2 * r)
      c.fillStyle = 'rgba(255,255,255,0.25)'
      c.fillRect(cx - r, cy - r, 2 * r, r * 0.6)
      drawIcon(c, icon, cx, cy, r * 1.35, '#fff')
      break
    }
    case 'round': {
      c.beginPath()
      c.arc(cx, cy, r + 1.5, 0, Math.PI * 2)
      c.fillStyle = '#fff'
      c.fill()
      c.beginPath()
      c.arc(cx, cy, r, 0, Math.PI * 2)
      c.fillStyle = color
      c.fill()
      drawIcon(c, icon, cx, cy, r * 1.25, '#fff')
      break
    }
    case 'stamp': {
      c.beginPath()
      c.arc(cx, cy, r, 0, Math.PI * 2)
      c.fillStyle = emphasis ? '#e9d8b0' : 'rgba(233,216,176,0.85)'
      c.fill()
      c.strokeStyle = t.blipInk
      c.lineWidth = 1.4
      c.stroke()
      c.beginPath()
      c.arc(cx, cy, r - 2.5, 0, Math.PI * 2)
      c.lineWidth = 0.6
      c.stroke()
      drawIcon(c, icon, cx, cy, r * 1.15, emphasis ? '#8f2b1c' : t.blipInk)
      break
    }
    case 'ring': {
      c.beginPath()
      c.arc(cx, cy, r + 4, 0, Math.PI * 2)
      c.fillStyle = t.blipInk
      c.globalAlpha *= 0.18
      c.fill()
      c.globalAlpha /= 0.18
      c.beginPath()
      c.arc(cx, cy, r, 0, Math.PI * 2)
      c.fillStyle = t.land
      c.fill()
      c.strokeStyle = t.blipInk
      c.lineWidth = 1.5
      c.stroke()
      drawIcon(c, icon, cx, cy, r * 1.2, t.blipInk)
      break
    }
    default: {
      c.beginPath()
      c.arc(cx, cy, r, 0, Math.PI * 2)
      c.fillStyle = color
      c.fill()
      c.strokeStyle = 'rgba(255,255,255,0.9)'
      c.lineWidth = 1.5
      c.stroke()
      drawIcon(c, icon, cx, cy, r * 1.2, '#fff')
    }
  }
}

function poiSprite(m: MapState, icon: IconName, color: string) {
  const t = m.theme
  const r = t.blip === 'square' ? 7 : 8
  const size = r * 2 + 12
  return sprite(m, `P${icon}`, size, size, (c) => {
    c.globalAlpha = t.poiAlpha
    drawBadge(c, t, size / 2, size / 2, r, t.blip === 'pin' ? color : t.blip === 'ring' ? '#000' : color, icon, false)
  })
}

// The pin for a post: a teardrop in plain themes, a big blip in game themes.
function drawPin(c: CanvasRenderingContext2D, t: MapTheme, marker: Marker, sx: number, sy: number, hover: boolean, time: number, age: number) {
  const selected = (marker.flags & MARK_SELECTED) !== 0
  const resolved = (marker.flags & MARK_RESOLVED) !== 0
  const color = resolved ? '#8c8c8c' : marker.color
  let grow = selected ? 1.25 : hover ? 1.12 : 1

  // A new pin falls in from above and settles with a little bounce.
  let drop = 0
  if (age < 600) {
    const k = age / 600
    drop = -60 * (1 - k) * (1 - k)
    grow *= 1 + 0.25 * Math.sin(k * Math.PI) * (1 - k)
    c.save()
    c.globalAlpha = Math.min(1, k * 2) * 0.3
    c.beginPath()
    c.ellipse(sx, sy, 10 * k, 4 * k, 0, 0, Math.PI * 2)
    c.fillStyle = '#000'
    c.fill()
    c.restore()
  }

  c.save()
  c.translate(sx, sy + drop)
  c.scale(grow, grow)
  if (resolved) c.globalAlpha = 0.7

  let badgeX: number
  let badgeY: number

  if (t.blip === 'pin') {
    // Teardrop with its point on the spot.
    c.shadowColor = 'rgba(0,0,0,0.3)'
    c.shadowBlur = 6
    c.shadowOffsetY = 2
    c.beginPath()
    c.moveTo(0, 0)
    c.bezierCurveTo(-4, -8, -14, -12, -14, -22)
    c.arc(0, -22, 14, Math.PI, 0)
    c.bezierCurveTo(14, -12, 4, -8, 0, 0)
    c.fillStyle = color
    c.fill()
    c.shadowColor = 'transparent'
    if (marker.flags & MARK_MINE) {
      // Your own pins get a white rim.
      c.strokeStyle = '#fff'
      c.lineWidth = 2.5
      c.stroke()
    }
    c.beginPath()
    c.arc(0, -22, 10.5, 0, Math.PI * 2)
    c.fillStyle = '#fff'
    c.fill()
    drawIcon(c, marker.icon, 0, -22, 13, color)
    badgeX = 11
    badgeY = -33
  } else {
    // Game blips sit centred on the spot, bigger than the map's own.
    if (t.blip === 'ring') {
      const pulse = (time % 1600) / 1600
      c.strokeStyle = t.blipInk
      c.globalAlpha = (1 - pulse) * 0.8
      c.beginPath()
      c.arc(0, 0, 12 + pulse * 14, 0, Math.PI * 2)
      c.stroke()
      c.globalAlpha = resolved ? 0.7 : 1
    }
    drawBadge(c, t, 0, 0, 12, color, marker.icon, true)
    if (marker.flags & MARK_MINE && t.blip !== 'ring') {
      c.strokeStyle = t.blip === 'stamp' ? '#8f2b1c' : '#ffd84a'
      c.lineWidth = 2
      if (t.blip === 'square') c.strokeRect(-16, -16, 32, 32)
      else {
        c.beginPath()
        c.arc(0, 0, 16, 0, Math.PI * 2)
        c.stroke()
      }
    }
    badgeX = 12
    badgeY = -12
  }

  if (selected) {
    c.strokeStyle = t.blip === 'pin' ? color : t.blipInk
    c.lineWidth = 2
    c.globalAlpha = 0.6
    c.beginPath()
    if (t.blip === 'pin') c.ellipse(0, 0, 10, 4, 0, 0, Math.PI * 2)
    else c.arc(0, 0, 20, 0, Math.PI * 2)
    c.stroke()
    c.globalAlpha = 1
  }

  // Little badges: thread count, saved star, unread dot.
  if (marker.count > 1) {
    c.beginPath()
    c.arc(badgeX, badgeY, 8, 0, Math.PI * 2)
    c.fillStyle = '#1d1f24'
    c.fill()
    c.strokeStyle = '#fff'
    c.lineWidth = 1.5
    c.stroke()
    c.fillStyle = '#fff'
    c.font = `700 10px ${sans}`
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(marker.count > 9 ? '9+' : String(marker.count), badgeX, badgeY + 0.5)
  }
  if (marker.flags & MARK_SAVED) {
    drawIcon(c, 'star', -badgeX, badgeY, 14, '#f5b50a')
  }
  if (marker.flags & MARK_LIVE) {
    // A ripple under the pin: something is on right now.
    const ripple = (time % 1800) / 1800
    c.save()
    c.scale(1 / grow, 1 / grow)
    c.globalAlpha = (1 - ripple) * 0.7
    c.strokeStyle = t.blip === 'stamp' ? '#8f2b1c' : t.blip === 'ring' ? t.blipInk : '#22c55e'
    c.lineWidth = 2.5
    c.beginPath()
    c.ellipse(0, 0, 8 + ripple * 26, 3 + ripple * 10, 0, 0, Math.PI * 2)
    c.stroke()
    c.restore()
  }
  if (marker.flags & MARK_NEW) {
    const pulse = 0.5 + 0.5 * Math.sin(time / 180)
    c.beginPath()
    c.arc(badgeX - (marker.count > 1 ? 14 : 0), badgeY, 4.5 + pulse, 0, Math.PI * 2)
    c.fillStyle = '#ef3b3b'
    c.fill()
    c.strokeStyle = '#fff'
    c.lineWidth = 1.5
    c.stroke()
  }

  c.restore()
}

// Several pins too close to tell apart at this zoom: one badge with how many threads.
function drawCluster(c: CanvasRenderingContext2D, t: MapTheme, marker: Marker, sx: number, sy: number, hover: boolean) {
  const r = Math.min(24, 13 + Math.sqrt(marker.count) * 3) * (hover ? 1.1 : 1)
  const fill = t.blip === 'stamp' ? '#e9d8b0' : t.blip === 'ring' ? t.land : t.blip === 'square' ? '#111' : '#1d1f24'
  const ink = t.blip === 'stamp' || t.blip === 'ring' ? t.blipInk : '#fff'

  c.save()
  c.shadowColor = t.blip === 'ring' ? 'transparent' : 'rgba(0,0,0,0.35)'
  c.shadowBlur = t.blip === 'ring' ? 0 : 8
  c.beginPath()
  if (t.blip === 'square') c.rect(sx - r, sy - r, 2 * r, 2 * r)
  else c.arc(sx, sy, r, 0, Math.PI * 2)
  c.fillStyle = fill
  c.fill()
  c.shadowColor = 'transparent'
  c.lineWidth = 3
  c.strokeStyle = t.blip === 'stamp' || t.blip === 'ring' ? t.blipInk : marker.color
  c.stroke()
  c.fillStyle = ink
  c.font = `800 ${r > 18 ? 15 : 13}px ${t.blip === 'stamp' ? t.font : sans}`
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillText(String(marker.count), sx, sy + 1)
  if (marker.flags & MARK_NEW) {
    c.beginPath()
    c.arc(sx + r * 0.72, sy - r * 0.72, 5, 0, Math.PI * 2)
    c.fillStyle = '#ef3b3b'
    c.fill()
    c.strokeStyle = '#fff'
    c.lineWidth = 1.5
    c.stroke()
  }
  c.restore()
}

// Greedy screen-space clustering: pins closer than a thumb's width merge, the
// selected pin always stays itself. Zoomed in, places are already far apart.
function cluster(m: MapState) {
  const out: Marker[] = []
  const radius = m.zoom < 14.5 ? 40 : 0
  const groups: { marker: Marker; sx: number; sy: number; members: Marker[] }[] = []

  for (const marker of m.markers) {
    if (marker.kind !== 'pin' || radius === 0 || marker.flags & MARK_SELECTED) {
      out.push(marker)
      continue
    }
    const p = project(m, marker.x, marker.y)
    const group = groups.find((g) => (g.sx - p.x) ** 2 + (g.sy - p.y) ** 2 < radius * radius)
    if (group) group.members.push(marker)
    else groups.push({ marker, sx: p.x, sy: p.y, members: [marker] })
  }

  for (const g of groups) {
    if (g.members.length === 1) {
      out.push(g.marker)
      continue
    }
    let x = 0
    let y = 0
    let count = 0
    let flags = 0
    for (const member of g.members) {
      x += member.x
      y += member.y
      count += member.count
      flags |= member.flags & MARK_NEW
    }
    out.push({ ...g.marker, id: `cluster:${g.marker.id}`, kind: 'cluster', x: x / g.members.length, y: y / g.members.length, count, flags })
  }
  return out
}

// A person's photo, loaded once; null until it has arrived.
function photo(m: MapState, url: string) {
  let img = m.images.get(url)
  if (!img) {
    img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => requestFrame(m)
    img.src = url
    m.images.set(url, img)
  }
  return img.complete && img.naturalWidth > 0 ? img : null
}

function drawPerson(c: CanvasRenderingContext2D, t: MapTheme, marker: Marker, sx: number, sy: number, hover: boolean, img: HTMLImageElement | null) {
  const r = hover ? 17 : 15
  c.save()
  if (marker.flags & MARK_STALE) c.globalAlpha = 0.5
  c.shadowColor = 'rgba(0,0,0,0.35)'
  c.shadowBlur = 6
  c.beginPath()
  if (t.blip === 'square') c.rect(sx - r, sy - r, 2 * r, 2 * r)
  else c.arc(sx, sy, r, 0, Math.PI * 2)
  c.fillStyle = t.blip === 'ring' ? t.land : '#fff'
  c.fill()
  c.shadowColor = 'transparent'
  c.beginPath()
  if (t.blip === 'square') c.rect(sx - r + 2.5, sy - r + 2.5, 2 * r - 5, 2 * r - 5)
  else c.arc(sx, sy, r - 2.5, 0, Math.PI * 2)
  c.fillStyle = t.blip === 'ring' ? t.buildingLine ?? t.land : marker.color
  c.fill()
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  if (img) {
    c.save()
    c.clip()
    c.filter = t.photo // photos take on the map's look: sepia ink, green phosphor
    c.drawImage(img, sx - r + 2.5, sy - r + 2.5, 2 * r - 5, 2 * r - 5)
    c.restore()
  } else {
    c.fillStyle = t.blip === 'ring' ? t.blipInk : '#fff'
    c.font = `700 ${Math.round(r * 0.75)}px ${sans}`
    c.fillText(marker.text, sx, sy + 0.5)
  }

  // Name tag under the avatar.
  c.font = `600 11px ${t.font}`
  const width = c.measureText(marker.name).width + 10
  c.fillStyle = t.blip === 'ring' ? 'rgba(3,11,6,0.9)' : 'rgba(20,22,26,0.82)'
  c.beginPath()
  c.roundRect(sx - width / 2, sy + r + 3, width, 16, 8)
  c.fill()
  c.fillStyle = t.blip === 'ring' ? t.blipInk : '#fff'
  c.fillText(marker.name, sx, sy + r + 11.5)

  if (marker.flags & MARK_ONLINE) {
    c.beginPath()
    c.arc(sx + r * 0.72, sy - r * 0.72, 4.5, 0, Math.PI * 2)
    c.fillStyle = '#22c55e'
    c.fill()
    c.strokeStyle = '#fff'
    c.lineWidth = 2
    c.stroke()
  }

  // Unread messages from them: a count, top left, asking to be tapped.
  if (marker.count > 0) {
    const bx = sx - r * 0.8
    const by = sy - r * 0.8
    c.beginPath()
    c.arc(bx, by, 8, 0, Math.PI * 2)
    c.fillStyle = '#ef3b3b'
    c.fill()
    c.strokeStyle = '#fff'
    c.lineWidth = 1.5
    c.stroke()
    c.fillStyle = '#fff'
    c.font = `700 10px ${sans}`
    c.fillText(marker.count > 9 ? '9+' : String(marker.count), bx, by + 0.5)
  }
  c.restore()
}

function drawMe(c: CanvasRenderingContext2D, t: MapTheme, marker: Marker, sx: number, sy: number, metersPerPixel: number, time: number) {
  const accuracy = marker.accuracy / metersPerPixel
  if (accuracy > 12) {
    c.beginPath()
    c.arc(sx, sy, accuracy, 0, Math.PI * 2)
    c.fillStyle = t.me
    c.globalAlpha = 0.12
    c.fill()
    c.globalAlpha = 0.35
    c.strokeStyle = t.me
    c.lineWidth = 1
    c.stroke()
    c.globalAlpha = 1
  }

  const pulse = (time % 2000) / 2000
  c.beginPath()
  c.arc(sx, sy, 8 + pulse * 18, 0, Math.PI * 2)
  c.fillStyle = t.me
  c.globalAlpha = (1 - pulse) * 0.35
  c.fill()
  c.globalAlpha = 1

  if (t.blip === 'pin') {
    // Blue dot, with a heading cone when we know it.
    if (marker.heading !== null) {
      c.save()
      c.translate(sx, sy)
      c.rotate((marker.heading * Math.PI) / 180)
      const cone = c.createRadialGradient(0, 0, 0, 0, 0, 34)
      cone.addColorStop(0, t.me)
      cone.addColorStop(1, 'transparent')
      c.fillStyle = cone
      c.globalAlpha = 0.4
      c.beginPath()
      c.moveTo(0, 0)
      c.arc(0, 0, 34, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5)
      c.fill()
      c.restore()
    }
    c.shadowColor = 'rgba(0,0,0,0.3)'
    c.shadowBlur = 4
    c.beginPath()
    c.arc(sx, sy, 8, 0, Math.PI * 2)
    c.fillStyle = '#fff'
    c.fill()
    c.shadowColor = 'transparent'
    c.beginPath()
    c.arc(sx, sy, 5.5, 0, Math.PI * 2)
    c.fillStyle = t.me
    c.fill()
  } else {
    // Game themes: the player arrow.
    c.save()
    c.translate(sx, sy)
    c.rotate(((marker.heading ?? 0) * Math.PI) / 180)
    c.translate(0, 2)
    const outline = t.blip === 'stamp' ? '#e9d8b0' : '#000'
    drawIcon(c, 'arrow', 0, 0, 28, outline)
    drawIcon(c, 'arrow', 0, 0, 21, t.me)
    c.restore()
  }
}

function drawDraft(c: CanvasRenderingContext2D, t: MapTheme, sx: number, sy: number, time: number) {
  const bob = Math.sin(time / 250) * 2
  c.save()
  c.beginPath()
  c.ellipse(sx, sy, 7, 3, 0, 0, Math.PI * 2)
  c.fillStyle = 'rgba(0,0,0,0.25)'
  c.fill()
  c.translate(sx, sy - 6 + bob)
  c.beginPath()
  c.moveTo(0, 6)
  c.lineTo(0, -8)
  c.strokeStyle = t.blip === 'ring' ? t.blipInk : '#1d1f24'
  c.lineWidth = 2
  c.stroke()
  c.beginPath()
  c.arc(0, -16, 9, 0, Math.PI * 2)
  c.fillStyle = t.blip === 'ring' ? t.blipInk : '#ef3b3b'
  c.fill()
  c.strokeStyle = '#fff'
  c.lineWidth = 2
  c.stroke()
  c.restore()
}

//
// Walking directions: the line the game styles call a GPS route. There's no
// routing service; the roads in the most detailed tiles between the two ends
// are joined into a graph, and A* walks it.
//

// Roads a person can walk along. Motorways aren't, and neither are railways.
const WALKABLE = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'track', 'path', 'pedestrian', 'bridleway', 'busway'])

// Tiles are about 2 km across; past 4 by 4 of them it's not a walk.
const MAX_ROUTE_TILES = 16

export type Route = {
  fromX: number // world
  fromY: number
  toX: number
  toY: number
  state: 'waiting' | 'ready' | 'far' | 'none' // none: the roads we have don't join up, or didn't load
  points: number[] // world x, y pairs, from you to the destination
  meters: number
}

const metersPerWorld = (y: number) => 40075016.686 * Math.cos((yToLat(y) * Math.PI) / 180)

// Called on every render with where you are and where you're going. Walking
// along the line just eats the part behind you; straying off it, or the other
// end moving (a friend walking), works the way out again.
export function setRoute(m: MapState, from: { lng: number; lat: number } | null, to: { lng: number; lat: number } | null) {
  if (!from || !to) {
    if (m.route) {
      m.route = null
      m.baseDirty = true
      requestFrame(m)
    }
    return
  }
  const fromX = lngToX(from.lng)
  const fromY = latToY(from.lat)
  const toX = lngToX(to.lng)
  const toY = latToY(to.lat)
  const metre = 1 / metersPerWorld(fromY)
  const old = m.route
  const sameEnd = !!old && Math.hypot(old.toX - toX, old.toY - toY) < 20 * metre
  // A few metres is GPS jitter; with no way found, only a real move is worth another try.
  if (sameEnd && Math.hypot(old.fromX - fromX, old.fromY - fromY) < (old.state === 'ready' ? 3 : 20) * metre) return

  if (sameEnd && old.state === 'ready' && old.points.length) {
    // The closest point on the line to where you are now.
    let best = Infinity
    let at = 0
    let px = 0
    let py = 0
    for (let i = 2; i < old.points.length; i += 2) {
      const ax = old.points[i - 2]
      const ay = old.points[i - 1]
      const dx = old.points[i] - ax
      const dy = old.points[i + 1] - ay
      const t = clamp(((fromX - ax) * dx + (fromY - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1)
      const d = Math.hypot(ax + t * dx - fromX, ay + t * dy - fromY)
      if (d < best) {
        best = d
        at = i
        px = ax + t * dx
        py = ay + t * dy
      }
    }
    if (best < 25 * metre) {
      old.points = [fromX, fromY, px, py, ...old.points.slice(at)]
      old.fromX = fromX
      old.fromY = fromY
      measureRoute(old)
      m.baseDirty = true
      requestFrame(m)
      m.onRoute()
      return
    }
  }

  // The old line stays up until the new one is ready.
  m.route = { fromX, fromY, toX, toY, state: 'waiting', points: sameEnd ? old.points : [], meters: sameEnd ? old.meters : 0 }
  requestFrame(m)
}

function measureRoute(r: Route) {
  let length = 0
  for (let i = 2; i < r.points.length; i += 2) length += Math.hypot(r.points[i] - r.points[i - 2], r.points[i + 1] - r.points[i - 1])
  r.meters = length * metersPerWorld(r.fromY)
}

// Asks for the tiles the route needs; once they're all here, finds it.
function stepRoute(m: MapState) {
  const r = m.route!
  const pad = Math.max(Math.abs(r.toX - r.fromX), Math.abs(r.toY - r.fromY)) * 0.3 + 300 / metersPerWorld(r.fromY)
  const box = [Math.min(r.fromX, r.toX) - pad, Math.min(r.fromY, r.toY) - pad, Math.max(r.fromX, r.toX) + pad, Math.max(r.fromY, r.toY) + pad]
  const n = 2 ** SOURCE_MAX_ZOOM
  const tx0 = Math.floor(box[0] * n)
  const ty0 = Math.floor(box[1] * n)
  const tx1 = Math.floor(box[2] * n)
  const ty1 = Math.floor(box[3] * n)

  if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > MAX_ROUTE_TILES) {
    r.state = 'far'
    r.points = []
    m.baseDirty = true
    m.onRoute()
    return
  }

  const tiles: SourceTile[] = []
  let waiting = false
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const entry = requestSource(m, SOURCE_MAX_ZOOM, tx, ty)
      if (!entry || entry.state === 'loading') waiting = true
      else if (entry.tile) tiles.push(entry.tile)
    }
  }
  if (waiting) return

  const points = tiles.length ? findRoute(tiles, r, box) : null
  r.state = points ? 'ready' : 'none'
  r.points = points ?? []
  measureRoute(r)
  m.baseDirty = true
  m.onRoute()
}

// Everything here is in "grid" units: tile units of the source zoom, counted
// from the world's corner, so the same spot is the same number in every tile.
function findRoute(tiles: SourceTile[], r: Route, box: number[]): number[] | null {
  const GRID = 4096
  const scale = 2 ** SOURCE_MAX_ZOOM * GRID
  const [bx0, by0, bx1, by1] = box.map((v) => v * scale)

  // Segments of walkable lines: [ax, ay, bx, by, onGround]. Each tile's lines
  // run a little past its edge, so only the part inside its own square is kept.
  const segs: number[] = []
  for (const tile of tiles) {
    const k = GRID / tile.extent
    const ox = tile.x * GRID
    const oy = tile.y * GRID
    if (ox > bx1 || oy > by1 || ox + GRID < bx0 || oy + GRID < by0) continue
    for (const f of tile.layers.transportation ?? []) {
      if (f.type !== 2 || !WALKABLE.has(String(f.props.class))) continue
      if (ox + f.maxX * k < bx0 || oy + f.maxY * k < by0 || ox + f.minX * k > bx1 || oy + f.minY * k > by1) continue
      const ground = f.props.brunnel === 'bridge' || f.props.brunnel === 'tunnel' ? 0 : 1
      for (const ring of f.rings) {
        for (let i = 2; i < ring.length; i += 2) {
          const ax = ring[i - 2] * k
          const ay = ring[i - 1] * k
          const dx = ring[i] * k - ax
          const dy = ring[i + 1] * k - ay
          // Liang-Barsky against the tile's square.
          let t0 = 0
          let t1 = 1
          const p = [-dx, dx, -dy, dy]
          const q = [ax, GRID - ax, ay, GRID - ay]
          for (let e = 0; e < 4 && t0 <= t1; e++) {
            if (p[e] === 0) {
              if (q[e] < 0) t1 = -1
            } else if (p[e] < 0) t0 = Math.max(t0, q[e] / p[e])
            else t1 = Math.min(t1, q[e] / p[e])
          }
          if (t0 >= t1) continue
          segs.push(ox + ax + t0 * dx, oy + ay + t0 * dy, ox + ax + t1 * dx, oy + ay + t1 * dy, ground)
        }
      }
    }
  }
  const count = segs.length / 5
  if (!count) return null

  // Where lines meet. The tiles drop vertices that sit on a straight line, junctions
  // included, so crossings and T-junctions are found by intersecting segments, a
  // grid cell at a time. A bridge or tunnel meets only what joins its ends.
  const CELL = 64
  const TOLERANCE = 1.5 // grid units; about a metre
  const cells = new Map<number, number[]>()
  const cellKey = (cx: number, cy: number) => cx * 1048576 + cy
  for (let i = 0; i < count; i++) {
    const s = i * 5
    const cx0 = Math.floor(Math.min(segs[s], segs[s + 2]) / CELL)
    const cx1 = Math.floor(Math.max(segs[s], segs[s + 2]) / CELL)
    const cy0 = Math.floor(Math.min(segs[s + 1], segs[s + 3]) / CELL)
    const cy1 = Math.floor(Math.max(segs[s + 1], segs[s + 3]) / CELL)
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = cellKey(cx, cy)
        const list = cells.get(key)
        if (list) list.push(i)
        else cells.set(key, [i])
      }
    }
  }
  const cuts: number[][] = Array.from({ length: count }, () => [0, 1])
  for (const [key, list] of cells) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const s = list[a] * 5
        const u = list[b] * 5
        // A pair shares several cells; only the one holding the corner of their overlap tests it.
        const cornerX = Math.max(Math.min(segs[s], segs[s + 2]), Math.min(segs[u], segs[u + 2]))
        const cornerY = Math.max(Math.min(segs[s + 1], segs[s + 3]), Math.min(segs[u + 1], segs[u + 3]))
        if (cellKey(Math.floor(cornerX / CELL), Math.floor(cornerY / CELL)) !== key) continue
        const rx = segs[s + 2] - segs[s]
        const ry = segs[s + 3] - segs[s + 1]
        const qx = segs[u + 2] - segs[u]
        const qy = segs[u + 3] - segs[u + 1]
        const cross = rx * qy - ry * qx
        const lengthS = Math.hypot(rx, ry)
        const lengthU = Math.hypot(qx, qy)
        if (Math.abs(cross) < 1e-9 || lengthS === 0 || lengthU === 0) continue
        const wx = segs[u] - segs[s]
        const wy = segs[u + 1] - segs[s + 1]
        const t = (wx * qy - wy * qx) / cross
        const v = (wx * ry - wy * rx) / cross
        const es = TOLERANCE / lengthS
        const eu = TOLERANCE / lengthU
        if (t < -es || t > 1 + es || v < -eu || v > 1 + eu) continue
        const through = t > es && t < 1 - es && v > eu && v < 1 - eu
        if (through && !(segs[s + 4] && segs[u + 4])) continue
        cuts[list[a]].push(clamp(t, 0, 1))
        cuts[list[b]].push(clamp(v, 0, 1))
      }
    }
  }

  // Nodes: points closer than the tolerance are one node.
  const nodeX: number[] = []
  const nodeY: number[] = []
  const edges: number[][] = [] // per node: neighbour, length, neighbour, length...
  const nodeAt = new Map<number, number>()
  const node = (x: number, y: number) => {
    const gx = Math.round(x / 2)
    const gy = Math.round(y / 2)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const id = nodeAt.get(cellKey(gx + dx, gy + dy))
        if (id !== undefined && Math.abs(nodeX[id] - x) <= TOLERANCE && Math.abs(nodeY[id] - y) <= TOLERANCE) return id
      }
    }
    nodeX.push(x)
    nodeY.push(y)
    edges.push([])
    nodeAt.set(cellKey(gx, gy), nodeX.length - 1)
    return nodeX.length - 1
  }
  const join = (a: number, b: number) => {
    if (a === b) return
    const d = Math.hypot(nodeX[a] - nodeX[b], nodeY[a] - nodeY[b])
    edges[a].push(b, d)
    edges[b].push(a, d)
  }
  for (let i = 0; i < count; i++) {
    const s = i * 5
    const ts = cuts[i].sort((a, b) => a - b)
    let previous = node(segs[s], segs[s + 1])
    for (let j = 1; j < ts.length; j++) {
      if (ts[j] === ts[j - 1]) continue
      const next = node(segs[s] + ts[j] * (segs[s + 2] - segs[s]), segs[s + 1] + ts[j] * (segs[s + 3] - segs[s + 1]))
      join(previous, next)
      previous = next
    }
  }

  // The biggest connected piece is the street network; the rest are scraps,
  // like a footpath inside a car park that the tiles cut off from everything.
  const piece = new Int32Array(nodeX.length).fill(-1)
  const sizes: number[] = []
  for (let i = 0; i < nodeX.length; i++) {
    if (piece[i] >= 0) continue
    const stack = [i]
    piece[i] = sizes.length
    let size = 0
    while (stack.length) {
      const a = stack.pop()!
      size++
      for (let e = 0; e < edges[a].length; e += 2) {
        const b = edges[a][e]
        if (piece[b] < 0) {
          piece[b] = sizes.length
          stack.push(b)
        }
      }
    }
    sizes.push(size)
  }
  let main = 0
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[main]) main = i

  // Each end steps onto the nearest bit of road, as a new node in the middle of it.
  const board = (x: number, y: number) => {
    let best = Infinity
    let bestA = -1
    let bestB = -1
    let bestT = 0
    for (let a = 0; a < nodeX.length; a++) {
      if (piece[a] !== main) continue
      for (let e = 0; e < edges[a].length; e += 2) {
        const b = edges[a][e]
        if (b < a) continue
        const dx = nodeX[b] - nodeX[a]
        const dy = nodeY[b] - nodeY[a]
        const t = clamp(((x - nodeX[a]) * dx + (y - nodeY[a]) * dy) / (dx * dx + dy * dy || 1), 0, 1)
        const d = Math.hypot(nodeX[a] + t * dx - x, nodeY[a] + t * dy - y)
        if (d < best) {
          best = d
          bestA = a
          bestB = b
          bestT = t
        }
      }
    }
    if (bestA < 0) return -1
    const id = nodeX.length
    nodeX.push(nodeX[bestA] + bestT * (nodeX[bestB] - nodeX[bestA]))
    nodeY.push(nodeY[bestA] + bestT * (nodeY[bestB] - nodeY[bestA]))
    edges.push([])
    join(id, bestA)
    join(id, bestB)
    return id
  }
  const start = board(r.fromX * scale, r.fromY * scale)
  const goal = board(r.toX * scale, r.toY * scale)
  if (start < 0 || goal < 0) return null
  // Both ends on the same stretch of road: they can walk straight to each other.
  if (edges[start][0] === edges[goal][0] && edges[start][2] === edges[goal][2]) join(start, goal)

  // A*, with a binary heap of (estimate, node).
  const total = nodeX.length
  const cost = new Float64Array(total).fill(Infinity)
  const cameFrom = new Int32Array(total).fill(-1)
  const done = new Uint8Array(total)
  const heapF: number[] = []
  const heapN: number[] = []
  const push = (f: number, id: number) => {
    let i = heapF.length
    heapF.push(f)
    heapN.push(id)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (heapF[parent] <= f) break
      heapF[i] = heapF[parent]
      heapN[i] = heapN[parent]
      i = parent
    }
    heapF[i] = f
    heapN[i] = id
  }
  const pop = () => {
    const top = heapN[0]
    const f = heapF.pop()!
    const id = heapN.pop()!
    if (heapF.length) {
      let i = 0
      for (;;) {
        let child = 2 * i + 1
        if (child >= heapF.length) break
        if (child + 1 < heapF.length && heapF[child + 1] < heapF[child]) child++
        if (heapF[child] >= f) break
        heapF[i] = heapF[child]
        heapN[i] = heapN[child]
        i = child
      }
      heapF[i] = f
      heapN[i] = id
    }
    return top
  }
  const estimate = (id: number) => Math.hypot(nodeX[id] - nodeX[goal], nodeY[id] - nodeY[goal])
  cost[start] = 0
  push(estimate(start), start)
  while (heapF.length) {
    const a = pop()
    if (a === goal) break
    if (done[a]) continue
    done[a] = 1
    for (let e = 0; e < edges[a].length; e += 2) {
      const b = edges[a][e]
      const c = cost[a] + edges[a][e + 1]
      if (c < cost[b]) {
        cost[b] = c
        cameFrom[b] = a
        push(c + estimate(b), b)
      }
    }
  }
  if (cost[goal] === Infinity) return null

  const points = [r.toX, r.toY]
  for (let id = goal; id >= 0; id = cameFrom[id]) points.push(nodeX[id] / scale, nodeY[id] / scale)
  points.push(r.fromX, r.fromY)
  // Back to front: from you to there.
  const forward: number[] = []
  for (let i = points.length - 2; i >= 0; i -= 2) forward.push(points[i], points[i + 1])
  return forward
}

// The route as a thick line in the style's colour over a halo, so it reads on any
// ground. The glowing styles glow it, the inked ones dash it.
function strokeRoute(c: CanvasRenderingContext2D, t: MapTheme, points: number[], ox: number, oy: number, scale: number, width: number) {
  c.beginPath()
  for (let i = 0; i < points.length; i += 2) c.lineTo(ox + points[i] * scale, oy + points[i + 1] * scale)
  c.lineJoin = 'round'
  c.lineCap = 'round'
  if (t.glow) {
    c.globalAlpha = 0.25
    c.strokeStyle = t.route
    c.lineWidth = width * 3
    c.stroke()
    c.globalAlpha = 1
  }
  c.strokeStyle = t.labelHalo
  c.lineWidth = width + 3
  c.stroke()
  if (t.routeDash) c.setLineDash([width * 1.5, width * 1.2])
  c.strokeStyle = t.route
  c.lineWidth = width
  c.stroke()
  c.setLineDash([])
}

//
// The frame.
//

type Box = { x0: number; y0: number; x1: number; y1: number }

function hits(placed: Box[], b: Box) {
  for (const p of placed) if (b.x0 < p.x1 && b.x1 > p.x0 && b.y0 < p.y1 && b.y1 > p.y0) return true
  return false
}

// What a frame covers: the whole zoom level its tiles come from, scaled to the
// fractional zoom, and the range of those tiles on screen.
type View = { z: number; size: number; tileSize: number; left: number; top: number; tx0: number; ty0: number; tx1: number; ty1: number }

function viewOf(m: MapState): View {
  const z = clamp(Math.round(m.zoom), 0, MAX_ZOOM)
  const count = 2 ** z
  const size = worldSize(m)
  const tileSize = TILE * 2 ** (m.zoom - z)
  const left = m.x * size - m.width / 2
  const top = m.y * size - m.height / 2
  return {
    z, size, tileSize, left, top,
    tx0: Math.max(0, Math.floor(left / tileSize)),
    ty0: Math.max(0, Math.floor(top / tileSize)),
    tx1: Math.min(count - 1, Math.floor((left + m.width) / tileSize)),
    ty1: Math.min(count - 1, Math.floor((top + m.height) / tileSize)),
  }
}

function frame(m: MapState, time: number) {
  m.frameRequested = false
  if (m.destroyed || m.width === 0) return
  m.frameCount++

  const dt = Math.min(time - (m.lastTime || time), 50)
  let keepGoing = stepCamera(m, time)
  const view = viewOf(m)
  const c = m.ctx

  // The base is only good for the exact camera it was taken at: drags and pinches
  // move the camera directly, without going through the flights above.
  const camera = `${m.x}|${m.y}|${m.zoom}`
  if (camera !== m.baseCamera) m.baseDirty = true
  if (m.route?.state === 'waiting') stepRoute(m)

  if (m.baseDirty) {
    c.setTransform(m.ratio, 0, 0, m.ratio, 0, 0)
    c.fillStyle = m.theme.land
    c.fillRect(0, 0, m.width, m.height)

    let unsettled = drawTiles(m, view)
    if (m.route?.points.length) {
      const scale = worldSize(m)
      strokeRoute(c, m.theme, m.route.points, m.width / 2 - m.x * scale, m.height / 2 - m.y * scale, scale, 5)
    }

    // Markers claim their space first so labels never cover them.
    m.visible = cluster(m)
    const placed: Box[] = []
    for (const marker of m.visible) {
      const p = project(m, marker.x, marker.y)
      const lift = marker.kind === 'pin' && m.theme.blip === 'pin' ? 22 : 0
      placed.push({ x0: p.x - 16, y0: p.y - 16 - lift, x1: p.x + 16, y1: p.y + 16 - lift + (marker.kind === 'person' ? 20 : 0) })
    }

    if (drawLabels(m, view, placed, dt)) unsettled = true

    // Once nothing is moving, loading or fading, keep this picture.
    if (unsettled || keepGoing) keepGoing = true
    else {
      const b = m.base.getContext('2d')!
      b.setTransform(1, 0, 0, 1, 0, 0)
      b.drawImage(m.canvas, 0, 0)
      m.baseDirty = false
      m.baseCamera = camera
    }
  } else {
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.drawImage(m.base, 0, 0)
    c.setTransform(m.ratio, 0, 0, m.ratio, 0, 0)
  }

  const animated = drawMarkers(m, view, time)
  const sweeping = m.radar ? drawRadar(m, view, time) : false
  if (drawFade(m, time)) keepGoing = true

  m.onFrame()

  if (keepGoing) requestFrame(m)
  else if (animated || sweeping) {
    // Pulses and sweeps don't need 60 fps; let the battery breathe.
    setTimeout(() => requestFrame(m), 33)
  }
}

// The tiles, nearest the middle first, painting new ones within a few
// milliseconds. Returns true while some are still missing or fading in.
function drawTiles(m: MapState, v: View) {
  const c = m.ctx
  const wanted: { x: number; y: number; d: number }[] = []
  for (let ty = v.ty0; ty <= v.ty1; ty++) {
    for (let tx = v.tx0; tx <= v.tx1; tx++) {
      const dx = (tx + 0.5) * v.tileSize - (v.left + m.width / 2)
      const dy = (ty + 0.5) * v.tileSize - (v.top + m.height / 2)
      wanted.push({ x: tx, y: ty, d: dx * dx + dy * dy })
    }
  }
  wanted.sort((a, b) => a.d - b.d)

  const budgetEnd = performance.now() + 7
  let unfinished = false
  let blank = 0 // tiles with nothing at all to show yet
  let broken = 0 // ...of which the download failed

  for (const w of wanted) {
    const sx = w.x * v.tileSize - v.left
    const sy = w.y * v.tileSize - v.top
    const raster = tileRaster(m, v.z, w.x, w.y, performance.now() < budgetEnd)
    const fading = raster ? Math.min(1, (performance.now() - raster.born) / 180) : 0

    if (fading < 1) {
      // Stand-in: the nearest ancestor we already painted, cropped and scaled up.
      // A fresh tile fades in over it rather than popping. A tile whose download
      // failed doesn't keep frames coming: its retry asks for one when it's time.
      const shift = v.z - sourceFor(v.z)
      const failed = !raster && m.sources.get(`${sourceFor(v.z)}/${w.x >> shift}/${w.y >> shift}`)?.state === 'error'
      if (!failed) unfinished = true
      let stoodIn = false
      for (let up = 1; up <= 6 && v.z - up >= 0; up++) {
        const px = w.x >> up
        const py = w.y >> up
        const parent = m.rasters.get(`${v.z - up}/${px}/${py}`)
        if (!parent) continue
        parent.used = m.frameCount
        const part = parent.canvas.width / 2 ** up
        c.drawImage(parent.canvas, (w.x - (px << up)) * part, (w.y - (py << up)) * part, part, part, sx, sy, v.tileSize + 0.5, v.tileSize + 0.5)
        stoodIn = true
        break
      }
      if (!raster && !stoodIn) {
        blank++
        if (failed) broken++
      }
    }

    if (raster) {
      // Pad by a hair so seams between scaled tiles don't show.
      c.globalAlpha = fading
      c.drawImage(raster.canvas, sx, sy, v.tileSize + 0.5, v.tileSize + 0.5)
      c.globalAlpha = 1
    }
  }

  // Keep a screenful or two of tiles around (each is 1 MB at 2x, so not too many
  // on huge screens), and every source tile that's still useful.
  evict(m.rasters, Math.min(160, Math.max(48, wanted.length * 3)))
  evict(m.sources, m.route?.state === 'waiting' ? 32 + MAX_ROUTE_TILES : 32)

  // On a slow connection, say so rather than showing an empty map.
  if (blank > 0) {
    const text = broken === blank ? "Can't reach the map right now. Trying again…" : 'Loading map…'
    c.font = `600 12px ${sans}`
    const w = c.measureText(text).width + 24
    c.fillStyle = 'rgba(20, 22, 26, 0.75)'
    c.beginPath()
    c.roundRect(m.width / 2 - w / 2, m.height / 2 - 14, w, 28, 14)
    c.fill()
    c.fillStyle = '#fff'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(text, m.width / 2, m.height / 2 + 0.5)
  }
  return unfinished
}

// Labels and place blips from the source tiles under the view, placed greedily
// by rank wherever they don't collide. Returns true while some are fading in.
function drawLabels(m: MapState, v: View, placed: Box[], dt: number) {
  const t = m.theme
  const c = m.ctx
  const sz = sourceFor(v.z)
  const shift = v.z - sz
  const labels: Label[] = []
  for (let ty = v.ty0 >> shift; ty <= v.ty1 >> shift; ty++) {
    for (let tx = v.tx0 >> shift; tx <= v.tx1 >> shift; tx++) {
      const entry = m.sources.get(`${sz}/${tx}/${ty}`)
      if (entry?.tile) for (const label of entry.tile.labels) labels.push(label)
    }
  }
  labels.sort((a, b) => a.rank - b.rank)

  // The crime-sprawl maps are covered in blips from further out; ink and plain maps keep them for close up.
  const poiEarly = t.blip === 'square' || t.blip === 'round' ? 2 : t.blip === 'ring' ? 1 : 0
  const showPoi = v.z >= 15 - poiEarly
  const named = new Map<string, { x: number; y: number }[]>() // where each road or river name went
  let drawn = 0
  let fading = false

  // A label placed this frame keeps fading in from where it was last frame; one
  // that dropped out starts again from nothing next time it gets room.
  const alphaBefore = m.labelAlpha
  const alphaNow = new Map<Label, number>()
  const fadeIn = (label: Label) => {
    const a = Math.min(1, (alphaBefore.get(label) ?? 0) + dt / 220)
    alphaNow.set(label, a)
    if (a < 1) fading = true
    c.globalAlpha = a
  }

  for (const label of labels) {
    if (drawn > 140) break
    if (m.zoom < label.minZoom - (label.kind === 'poi' ? poiEarly : 0) || m.zoom > label.maxZoom) continue
    if (label.kind === 'poi' && !showPoi) continue
    const sx = (label.x - m.x) * v.size + m.width / 2
    const sy = (label.y - m.y) * v.size + m.height / 2
    if (sx < -60 || sy < -30 || sx > m.width + 60 || sy > m.height + 30) continue

    if (label.kind === 'poi') {
      const s = poiSprite(m, label.icon!, label.color!)
      const box = { x0: sx - 10, y0: sy - 10, x1: sx + 10, y1: sy + 10 }
      if (hits(placed, box)) continue
      placed.push(box)
      fadeIn(label)
      c.drawImage(s.canvas, sx - s.width / 2, sy - s.height / 2, s.width, s.height)
      drawn++

      // Names next to blips once there's room.
      if (label.text && m.zoom >= 17.5) {
        const ns = labelSprite(m, { ...label, kind: 'park', size: 10.5 })
        const nameBox = { x0: sx + 10, y0: sy - ns.height / 2, x1: sx + 10 + ns.width, y1: sy + ns.height / 2 }
        if (!hits(placed, nameBox)) {
          placed.push(nameBox)
          c.drawImage(ns.canvas, sx + 9, sy - ns.height / 2, ns.width, ns.height)
        }
      }
      c.globalAlpha = 1
      continue
    }

    const s = labelSprite(m, label)
    let box: Box

    if (label.kind === 'road' || label.line) {
      // Roads, and rivers that follow their own line: one name per stretch.
      const seen = named.get(label.text)
      const apart = label.kind === 'water' ? 480 : 220 // a river's name needn't repeat as often as a street's
      if (seen?.some((p) => Math.hypot(p.x - sx, p.y - sy) < apart)) continue

      if (label.length * v.size >= s.width + 12) {
        const cos = Math.abs(Math.cos(label.angle))
        const sin = Math.abs(Math.sin(label.angle))
        const hw = (s.width * cos + s.height * sin) / 2
        const hh = (s.width * sin + s.height * cos) / 2
        box = { x0: sx - hw, y0: sy - hh, x1: sx + hw, y1: sy + hh }
        if (hits(placed, box)) continue
        c.save()
        fadeIn(label)
        c.translate(sx, sy)
        c.rotate(label.angle)
        c.drawImage(s.canvas, -s.width / 2, -s.height / 2, s.width, s.height)
        c.restore()
      } else {
        // No straight stretch long enough: bend the name along the line instead.
        if (!label.line || label.pathLength * v.size < s.width + 24) continue
        const bent = drawBentName(m, label, sx, sy, placed, fadeIn)
        if (!bent) continue
        box = bent
      }
      if (seen) seen.push({ x: sx, y: sy })
      else named.set(label.text, [{ x: sx, y: sy }])
    } else {
      // Water names come both from the water's area and from its line; one is enough nearby.
      const seen = label.kind === 'water' ? named.get(label.text) : undefined
      if (seen?.some((p) => Math.hypot(p.x - sx, p.y - sy) < 480)) continue
      box = { x0: sx - s.width / 2, y0: sy - s.height / 2, x1: sx + s.width / 2, y1: sy + s.height / 2 }
      if (hits(placed, box)) continue
      fadeIn(label)
      c.drawImage(s.canvas, box.x0, box.y0, s.width, s.height)
      if (label.kind === 'water') {
        if (seen) seen.push({ x: sx, y: sy })
        else named.set(label.text, [{ x: sx, y: sy }])
      }
    }

    placed.push(box)
    c.globalAlpha = 1
    drawn++
  }

  m.labelAlpha = alphaNow
  evict(m.sprites, 600)
  return fading
}

// A name laid letter by letter along its road or river. Returns the space it
// took, or null if it didn't fit or the line bends too sharply to read.
function drawBentName(m: MapState, label: Label, sx: number, sy: number, placed: Box[], fadeIn: (label: Label) => void): Box | null {
  const t = m.theme
  const c = m.ctx
  const font = labelFont(t, label)
  const text = [...labelText(t, label)]
  const spacing = t.caps ? 0.8 : 0
  const widths = text.map((ch) => advance(font, ch) + spacing)
  const glyphs = alongPath(m, label.line!, sx, sy, widths, widths.reduce((a, b) => a + b, 0))
  if (!glyphs) return null

  const half = label.size / 2 + 3
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  for (const g of glyphs) {
    box.x0 = Math.min(box.x0, g.x - half)
    box.y0 = Math.min(box.y0, g.y - half)
    box.x1 = Math.max(box.x1, g.x + half)
    box.y1 = Math.max(box.y1, g.y + half)
  }
  // Off screen, or on top of something: not here.
  if (box.x1 < 0 || box.y1 < 0 || box.x0 > m.width || box.y0 > m.height || hits(placed, box)) return null

  fadeIn(label)
  const color = label.kind === 'water' ? t.waterLabel : t.labelColor
  const r = m.ratio
  for (let i = 0; i < glyphs.length; i++) {
    if (text[i] === ' ') continue
    const g = glyphs[i]
    const gs = glyphSprite(m, t, font, label.size, color, text[i])
    const cos = Math.cos(g.angle)
    const sin = Math.sin(g.angle)
    c.setTransform(r * cos, r * sin, -r * sin, r * cos, r * g.x, r * g.y)
    c.drawImage(gs.canvas, -gs.width / 2, -gs.height / 2, gs.width, gs.height)
  }
  c.setTransform(r, 0, 0, r, 0, 0)
  return box
}

// People under pins, me on top, the selected one above all. Returns true if
// anything drawn pulses, so frames should keep coming (slowly).
function drawMarkers(m: MapState, v: View, time: number) {
  const t = m.theme
  const c = m.ctx
  const metersPerPixel = (40075016.686 * Math.cos((yToLat(m.y) * Math.PI) / 180)) / v.size
  let animated = false
  let dropping = false
  const ordered = [...m.visible].sort((a, b) => order(a) - order(b) || a.y - b.y)

  for (const marker of ordered) {
    const p = project(m, marker.x, marker.y)
    if (p.x < -60 || p.y < -60 || p.x > m.width + 60 || p.y > m.height + 60) continue
    const hover = m.hovered?.id === marker.id || m.highlight === marker.id
    if (marker.kind === 'pin') {
      const born = m.born.get(marker.id) ?? 0
      // The frame's timestamp can be a hair older than the moment the pin was born.
      const age = born ? Math.max(0, time - born) : Infinity
      drawPin(c, t, marker, p.x, p.y, hover, time, age)
      if (age < 600) dropping = true
      if (marker.flags & (MARK_NEW | MARK_LIVE) || t.blip === 'ring') animated = true
    } else if (marker.kind === 'cluster') {
      drawCluster(c, t, marker, p.x, p.y, hover)
    } else if (marker.kind === 'person') {
      drawPerson(c, t, marker, p.x, p.y, hover, marker.image ? photo(m, marker.image) : null)
    } else if (marker.kind === 'me') {
      drawMe(c, t, marker, p.x, p.y, metersPerPixel, time)
      animated = true
    } else {
      drawDraft(c, t, p.x, p.y, time)
      animated = true
    }
  }
  // A drop needs every frame to look right; pulses can make do with fewer.
  if (dropping) requestFrame(m)
  return animated
}

// The corner radar of the game styles: the streets around you, a little further
// out than the map, your arrow in the middle, north at the top. Pins and friends
// in range are dots; those out of range wait on the rim, in their direction.
function drawRadar(m: MapState, v: View, time: number) {
  const t = m.theme
  const c = m.ctx
  const { x: cx, y: cy, r } = m.radar!
  const me = m.markers.find((marker) => marker.kind === 'me')
  const wx = me ? me.x : m.x
  const wy = me ? me.y : m.y
  const zoom = clamp(m.zoom - 1.5, 12, 17)
  const size = TILE * 2 ** zoom
  const tileSize = TILE * 2 ** (zoom - v.z)

  // Most radars are round; the modern sprawl's is a wide rounded rectangle.
  const square = t.blip === 'round'
  const hw = square ? r * RADAR_WIDE : r // half width and height
  const hh = square ? r * 0.9 : r
  const outline = (grow: number) => {
    c.beginPath()
    if (square) c.roundRect(cx - hw - grow, cy - hh - grow, 2 * (hw + grow), 2 * (hh + grow), 10 + grow)
    else c.arc(cx, cy, r + grow, 0, Math.PI * 2)
  }

  c.save()
  outline(0)
  c.fillStyle = t.land
  c.fill()
  c.clip()

  // The tiles of the main map's level, drawn smaller, around the radar's centre.
  const left = wx * TILE * 2 ** v.z * (tileSize / TILE) - hw
  const top = wy * TILE * 2 ** v.z * (tileSize / TILE) - hh
  const count = 2 ** v.z
  for (let ty = Math.floor(top / tileSize); ty <= Math.floor((top + 2 * hh) / tileSize); ty++) {
    for (let tx = Math.floor(left / tileSize); tx <= Math.floor((left + 2 * hw) / tileSize); tx++) {
      if (tx < 0 || ty < 0 || tx >= count || ty >= count) continue
      const raster = tileRaster(m, v.z, tx, ty, true)
      if (raster) c.drawImage(raster.canvas, cx - hw + tx * tileSize - left, cy - hh + ty * tileSize - top, tileSize + 0.5, tileSize + 0.5)
    }
  }

  // A wash of the style's colour, so the radar reads as its own thing.
  c.fillStyle = t.blip === 'stamp' ? 'rgba(120, 90, 50, 0.18)' : t.blip === 'square' ? 'rgba(0, 0, 0, 0.18)' : 'rgba(0, 0, 0, 0.3)'
  c.fillRect(cx - hw, cy - hh, 2 * hw, 2 * hh)
  if (m.route?.points.length) strokeRoute(c, t, m.route.points, cx - wx * size, cy - wy * size, size, 3)
  c.restore()

  // Blips: inside, a dot where it is; outside, a smaller one on the rim.
  // Where the route ends is a waypoint, and always shows.
  const waypoint = m.route?.points.length ? { x: m.route.toX, y: m.route.toY, kind: 'waypoint', flags: 0, color: t.route } : null
  for (const marker of waypoint ? [...m.visible, waypoint] : m.visible) {
    if (marker.kind !== 'pin' && marker.kind !== 'person' && marker.kind !== 'cluster' && marker !== waypoint) continue
    let dx = (marker.x - wx) * size
    let dy = (marker.y - wy) * size
    const d = Math.hypot(dx, dy)
    const inside = square ? Math.abs(dx) < hw - 6 && Math.abs(dy) < hh - 6 : d < r - 6
    if (!inside) {
      if (marker.kind === 'pin' && !(marker.flags & (MARK_LIVE | MARK_NEW | MARK_SELECTED))) continue // only what matters goes on the rim
      const k = square ? Math.min((hw - 5) / Math.abs(dx || 1), (hh - 5) / Math.abs(dy || 1)) : (r - 5) / d
      dx *= k
      dy *= k
    }
    const size2 = marker === waypoint ? 5.5 : inside ? 4.5 : 3.5
    c.beginPath()
    if (t.blip === 'square') c.rect(cx + dx - size2, cy + dy - size2, 2 * size2, 2 * size2)
    else c.arc(cx + dx, cy + dy, size2, 0, Math.PI * 2)
    c.fillStyle = marker.kind === 'person' ? '#4c9bff' : t.blip === 'stamp' || marker === waypoint ? t.route : marker.color
    c.fill()
    c.lineWidth = 1.2
    c.strokeStyle = t.blip === 'stamp' ? '#3f2e1e' : '#000'
    c.stroke()
  }

  // You, in the middle.
  c.save()
  c.translate(cx, cy)
  if (me) {
    c.rotate(((me.heading ?? 0) * Math.PI) / 180)
    drawIcon(c, 'arrow', 0, 1, 20, t.blip === 'stamp' ? '#e9d8b0' : '#000')
    drawIcon(c, 'arrow', 0, 1, 15, t.blip === 'stamp' ? '#8f2b1c' : '#fff')
  } else {
    c.strokeStyle = t.blipInk
    c.lineWidth = 1.5
    c.beginPath()
    c.moveTo(-6, 0)
    c.lineTo(6, 0)
    c.moveTo(0, -6)
    c.lineTo(0, 6)
    c.stroke()
  }
  c.restore()

  // The rim, in each style's way, with north marked.
  c.save()
  outline(0)
  if (t.blip === 'stamp') {
    c.strokeStyle = '#3f2e1e'
    c.lineWidth = 2
    c.stroke()
    outline(4)
    c.lineWidth = 0.8
    c.stroke()
  } else if (t.blip === 'ring') {
    c.strokeStyle = t.blipInk
    c.globalAlpha = 0.2
    c.lineWidth = 8
    c.stroke()
    c.globalAlpha = 1
    c.lineWidth = 2
    c.stroke()
    // The sweep.
    const angle = (time / 1000) % (Math.PI * 2)
    c.beginPath()
    c.moveTo(cx, cy)
    c.arc(cx, cy, r, angle - 0.6, angle)
    c.closePath()
    c.globalAlpha = 0.18
    c.fillStyle = t.blipInk
    c.fill()
    c.globalAlpha = 1
  } else {
    c.strokeStyle = t.blip === 'square' ? '#000' : 'rgba(0, 0, 0, 0.8)'
    c.lineWidth = t.blip === 'square' ? 4 : 3
    c.stroke()
  }
  c.restore()

  c.beginPath()
  c.arc(cx, cy - hh, 8, 0, Math.PI * 2)
  c.fillStyle = t.blip === 'stamp' ? '#e9d8b0' : t.blip === 'ring' ? t.land : '#000'
  c.fill()
  c.fillStyle = t.blip === 'stamp' ? '#8f2b1c' : t.blip === 'ring' ? t.blipInk : '#fff'
  c.font = `800 10px ${t.blip === 'stamp' ? t.font : sans}`
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillText('N', cx, cy - hh + 0.5)

  return t.blip === 'ring' // the sweep turns
}

// After a style switch, the old picture fades out over the new one.
function drawFade(m: MapState, time: number) {
  if (!m.fade) return false
  const t = (time - m.fade.start) / 500
  if (t >= 1) {
    m.fade = null
    return false
  }
  const c = m.ctx
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.globalAlpha = 1 - t * t
  c.drawImage(m.fade.canvas, 0, 0)
  c.globalAlpha = 1
  c.setTransform(m.ratio, 0, 0, m.ratio, 0, 0)
  return true
}

function order(marker: Marker) {
  if (marker.flags & MARK_SELECTED) return 5
  switch (marker.kind) {
    case 'person': return 1
    case 'pin': case 'cluster': return 2
    case 'me': return 3
    case 'draft': return 4
  }
}
