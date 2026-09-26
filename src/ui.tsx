import type { CSSProperties } from 'react'

// Styles shared by the auth and profile panels.

export const rightPanelStyle: CSSProperties = {
  position: 'absolute',
  top: '16px',
  right: '16px',
  bottom: '16px',
  width: '360px',
  zIndex: 20,
  background: 'white',
  borderRadius: '20px',
  padding: '24px',
  boxSizing: 'border-box',
  boxShadow: '0 8px 30px rgba(0, 0, 0, 0.25)',
  fontFamily: 'Arial, sans-serif',
  overflowY: 'auto',
}

export const labelStyle: CSSProperties = {
  display: 'block',
  marginBottom: '6px',
  fontWeight: 600,
  color: '#333',
}

export const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '12px',
  marginBottom: '16px',
  border: '1px solid #ccc',
  borderRadius: '10px',
  fontSize: '16px',
}

export function primaryButtonStyle(enabled: boolean): CSSProperties {
  return {
    flex: 1,
    border: 'none',
    background: enabled ? '#000' : '#ccc',
    color: 'white',
    padding: '12px',
    borderRadius: '10px',
    fontSize: '16px',
    fontWeight: 600,
    cursor: enabled ? 'pointer' : 'not-allowed',
  }
}

export const secondaryButtonStyle: CSSProperties = {
  flex: 1,
  border: '1px solid #ccc',
  background: 'white',
  color: '#333',
  padding: '12px',
  borderRadius: '10px',
  fontSize: '16px',
  cursor: 'pointer',
}

export const linkButtonStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  padding: 0,
  color: '#555',
  fontSize: '14px',
  cursor: 'pointer',
  textDecoration: 'underline',
}

export const noticeStyle: CSSProperties = {
  margin: '0 0 16px',
  padding: '10px 12px',
  background: '#f3f4f6',
  borderRadius: '8px',
  fontSize: '14px',
  color: '#333',
}

// "now", "5m", "3h", "2d", then a short date.
export function ago(iso: string) {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)

  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`
  if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / (60 * 24))}d`

  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

// Initials on a colour picked from the user id, so a person looks the same everywhere.
export function avatar(id: string | null, name: string | null, size = 32) {
  let hash = 0
  for (const char of id ?? '') hash = (hash * 31 + char.charCodeAt(0)) >>> 0

  const initials = (name ?? '?')
    .split(/\s+/)
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <span
      aria-hidden
      style={{
        display: 'inline-grid',
        placeItems: 'center',
        flex: 'none',
        width: size,
        height: size,
        borderRadius: '50%',
        background: id ? `hsl(${hash % 360} 55% 45%)` : '#9ca3af',
        color: 'white',
        fontSize: size * 0.4,
        fontWeight: 700,
      }}
    >
      {initials}
    </span>
  )
}
