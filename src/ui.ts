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
