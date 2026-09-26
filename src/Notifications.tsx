import type { NotificationRow } from './types'
import { linkButtonStyle } from './ui'

function describe(notification: NotificationRow) {
  const title = `“${notification.post_title ?? 'a pin'}”`

  switch (notification.kind) {
    case 'reply':
      return `replied to your pin ${title}`
    case 'saved_reply':
      return `replied to ${title}, a pin you saved`
    case 'save':
      return `saved your pin ${title}`
  }
}

export default function Notifications({
  notifications,
  onOpen,
  onMarkAllRead,
}: {
  notifications: NotificationRow[]
  onOpen: (notification: NotificationRow) => void
  onMarkAllRead: () => void
}) {
  if (notifications.length === 0) {
    return (
      <p style={{ margin: 0, color: '#777', fontSize: '14px' }}>
        Nothing yet. You'll hear about replies to your pins, replies to pins you saved, and
        neighbours saving your pins.
      </p>
    )
  }

  return (
    <>
      {notifications.some((notification) => !notification.read_at) && (
        <button onClick={onMarkAllRead} style={{ ...linkButtonStyle, marginBottom: '12px' }}>
          Mark all as read
        </button>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {[...notifications].reverse().map((notification) => (
          <button
            key={notification.id}
            onClick={() => onOpen(notification)}
            style={{
              textAlign: 'left',
              border: 'none',
              borderLeft: notification.read_at ? '4px solid transparent' : '4px solid #2563eb',
              padding: '12px',
              background: notification.read_at ? '#f3f4f6' : '#eff6ff',
              borderRadius: '10px',
              cursor: 'pointer',
              color: '#333',
              fontSize: '14px',
              lineHeight: 1.4,
            }}
          >
            <strong>{notification.actor_name ?? 'Someone'}</strong> {describe(notification)}
            {notification.preview && (
              <div style={{ marginTop: '4px', color: '#555' }}>“{notification.preview}”</div>
            )}
            <div style={{ marginTop: '4px', fontSize: '12px', color: '#888' }}>
              {new Date(notification.created_at).toLocaleString()}
            </div>
          </button>
        ))}
      </div>
    </>
  )
}
