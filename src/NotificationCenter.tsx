import { useState } from 'react'

import { conversationsOf, describeNotification, useNames, type InboxApi } from './inbox'
import type { NotificationRow } from './types'
import { ago, avatar, groupByDay, linkButtonStyle, rightPanelStyle } from './ui'

export type DesktopAlerts = {
  permission: NotificationPermission | 'unsupported'
  enabled: boolean
  onToggle: () => void
}

type Props = {
  userId: string
  inbox: InboxApi
  desktop: DesktopAlerts
  onOpenNotification: (notification: NotificationRow) => void
  onChat: (otherId: string) => void
  onHoverPost: (postId: string | null) => void
  onClose: () => void
}

const kinds: [NotificationRow['kind'], string][] = [
  ['reply', 'Replies to my pins'],
  ['saved_reply', 'Replies on pins I saved'],
  ['thread_reply', "Replies in threads I've joined"],
  ['interest', "Someone's interested in my pin"],
  ['save', 'Someone saves my pin'],
  ['resolved', 'A pin I follow gets resolved'],
]

export default function NotificationCenter({
  userId,
  inbox,
  desktop,
  onOpenNotification,
  onChat,
  onHoverPost,
  onClose,
}: Props) {
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)

  const unreadConversations = conversationsOf(userId, inbox.messages).filter((conversation) => conversation.unread > 0)
  const names = useNames(unreadConversations.map((conversation) => conversation.other))

  const newestFirst = [...inbox.notifications].reverse()
  const shown = unreadOnly ? newestFirst.filter((notification) => !notification.read_at) : newestFirst

  async function loadOlder() {
    setLoadingOlder(true)
    await inbox.loadOlder()
    setLoadingOlder(false)
  }

  function toggleKind(kind: string) {
    inbox.setMutedKinds(
      inbox.mutedKinds.includes(kind)
        ? inbox.mutedKinds.filter((muted) => muted !== kind)
        : [...inbox.mutedKinds, kind],
    )
  }

  return (
    <aside className="menu" style={rightPanelStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
        <h2 style={{ flex: 1, margin: 0, fontSize: '22px', color: '#111' }}>
          {showSettings ? 'Notification settings' : 'Notifications'}
        </h2>
        <button
          className="icon-button"
          aria-label={showSettings ? 'Back to notifications' : 'Notification settings'}
          aria-pressed={showSettings}
          onClick={() => setShowSettings(!showSettings)}
        >
          {showSettings ? '←' : '⚙'}
        </button>
        <button className="icon-button" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>

      {showSettings ? (
        <>
          <div className="section-title" style={{ marginTop: 0 }}>
            <span>Notify me about</span>
          </div>
          {kinds.map(([kind, label]) => (
            <label key={kind} className="toggle-row">
              <span>{label}</span>
              <input
                type="checkbox"
                checked={!inbox.mutedKinds.includes(kind)}
                onChange={() => toggleKind(kind)}
              />
            </label>
          ))}
          <p className="row-meta">Messages from neighbours always come through.</p>

          <div className="section-title">
            <span>Desktop alerts</span>
          </div>
          <label className="toggle-row">
            <span>
              Pop up when something new arrives while AroundHere is in the background
              {desktop.permission === 'denied' && (
                <span className="row-meta" style={{ display: 'block' }}>
                  Blocked in your browser settings for this site.
                </span>
              )}
              {desktop.permission === 'unsupported' && (
                <span className="row-meta" style={{ display: 'block' }}>
                  Your browser doesn't support them.
                </span>
              )}
            </span>
            <input
              type="checkbox"
              checked={desktop.enabled && desktop.permission === 'granted'}
              disabled={desktop.permission === 'denied' || desktop.permission === 'unsupported'}
              onChange={desktop.onToggle}
            />
          </label>
        </>
      ) : (
        <>
          <div className="segmented" role="tablist">
            <button role="tab" aria-selected={!unreadOnly} onClick={() => setUnreadOnly(false)}>
              All
            </button>
            <button role="tab" aria-selected={unreadOnly} onClick={() => setUnreadOnly(true)}>
              Unread{inbox.unreadNotifications > 0 && ` · ${inbox.unreadNotifications}`}
            </button>
            {inbox.unreadNotifications > 0 && (
              <button
                onClick={() => inbox.markNotificationsRead(inbox.notifications.map((notification) => notification.id))}
                style={{ ...linkButtonStyle, marginLeft: 'auto', fontSize: '12px' }}
              >
                Mark all read
              </button>
            )}
          </div>

          {unreadConversations.length > 0 && (
            <>
              <div className="section-title">
                <span>Messages</span>
              </div>
              {unreadConversations.map((conversation) => (
                <button key={conversation.other} className="row unread" onClick={() => onChat(conversation.other)}>
                  {avatar(conversation.other, names[conversation.other] ?? null)}
                  <div className="row-main">
                    <div>
                      <strong>{names[conversation.other] ?? '…'}</strong> sent you{' '}
                      {conversation.unread === 1 ? 'a message' : `${conversation.unread} messages`}
                    </div>
                    <div className="row-meta row-title">“{conversation.last.body}”</div>
                  </div>
                  <span className="row-time">{ago(conversation.last.created_at)}</span>
                </button>
              ))}
            </>
          )}

          {shown.length === 0 ? (
            <p className="empty" style={{ marginTop: '16px' }}>
              {unreadOnly ? "You're all caught up ✓" : 'Nothing yet. Activity on your pins shows up here.'}
            </p>
          ) : (
            groupByDay(shown, (notification) => notification.created_at).map((group) => (
              <div key={group.label}>
                <div className="section-title">
                  <span>{group.label}</span>
                </div>
                {group.items.map((notification) => {
                  const { icon, text } = describeNotification(notification)

                  return (
                    <button
                      key={notification.id}
                      className={notification.read_at ? 'row' : 'row unread'}
                      onClick={() => onOpenNotification(notification)}
                      onMouseEnter={() => onHoverPost(notification.post_id)}
                      onMouseLeave={() => onHoverPost(null)}
                    >
                      <span className="row-icon">{icon}</span>
                      <div className="row-main">
                        <div style={{ lineHeight: 1.35 }}>
                          <strong>{notification.actor_name ?? 'Someone'}</strong> {text}
                        </div>
                        {notification.preview && (
                          <div className="row-meta row-title">“{notification.preview}”</div>
                        )}
                      </div>
                      <span className="row-time">{ago(notification.created_at)}</span>
                      {!notification.read_at && <span className="dot" />}
                    </button>
                  )
                })}
              </div>
            ))
          )}

          {!unreadOnly && inbox.hasOlder && (
            <button className="load-older" onClick={loadOlder} disabled={loadingOlder}>
              {loadingOlder ? 'Loading...' : 'Load older'}
            </button>
          )}
        </>
      )}
    </aside>
  )
}
