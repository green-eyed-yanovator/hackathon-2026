import { useEffect, useState, type ReactNode } from 'react'

import {
  conversationsOf,
  describeNotification,
  useNames,
  type InboxApi,
} from './inbox'
import { supabase } from './lib/supabase'
import Chat, { ConversationList } from './Messages'
import type { NotificationRow, Post, Profile, Reply } from './types'
import {
  ago,
  avatar,
  inputStyle,
  labelStyle,
  linkButtonStyle,
  noticeStyle,
  primaryButtonStyle,
  rightPanelStyle,
  secondaryButtonStyle,
} from './ui'

// Present only on the signed-in user's own profile.
export type OwnMenu = {
  email: string
  inbox: InboxApi
  chatWith: string | null
  onChat: (otherId: string | null) => void
  onOpenNotification: (notification: NotificationRow) => void
  onOpenProfile: (id: string) => void
  onChangePassword: () => void
  onSignOut: () => void
}

type Props = {
  profileId: string
  // Already-known profile, so the panel renders without a loading state.
  seed: Profile | null
  own: OwnMenu | null
  // Everything below is already in memory for the map; lists are derived from it.
  posts: Post[]
  replies: Reply[]
  savedIds: string[]
  onOpenPost: (post: Post) => void
  onSaved: (profile: Profile) => void
  onMessage: (() => void) | null
  onClose: () => void
}

type FeedRow = {
  key: string
  time: string
  icon: ReactNode
  text: ReactNode
  meta: string | null
  onClick: () => void
}

export default function ProfilePanel({
  profileId,
  seed,
  own,
  posts,
  replies,
  savedIds,
  onOpenPost,
  onSaved,
  onMessage,
  onClose,
}: Props) {
  const [profile, setProfile] = useState<Profile | null>(seed)
  const [draft, setDraft] = useState<Profile | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let ignore = false

    supabase
      .from('profiles')
      .select('*')
      .eq('id', profileId)
      .single()
      .then(({ data, error }) => {
        if (ignore) {
          return
        }

        if (error) {
          setError('Could not load this profile.')
          return
        }

        setProfile(data)
      })

    return () => {
      ignore = true
    }
  }, [profileId])

  const conversations = own ? conversationsOf(profileId, own.inbox.messages) : []
  const names = useNames([
    ...conversations.map((conversation) => conversation.other),
    ...(own?.chatWith ? [own.chatWith] : []),
  ])

  // Reply counts and latest activity per pin, from replies already loaded for the map.
  const repliesByPost = new Map<string, Reply[]>()
  for (const reply of replies) {
    repliesByPost.set(reply.post_id, [...(repliesByPost.get(reply.post_id) ?? []), reply])
  }
  const lastActivity = (post: Post) =>
    repliesByPost.get(post.id)?.at(-1)?.created_at ?? post.created_at

  const repliedIds = new Set(
    replies.filter((reply) => reply.author_id === profileId).map((reply) => reply.post_id),
  )
  const authoredCount = posts.filter((post) => post.author_id === profileId).length

  // Your own profile gathers every pin you're part of; other profiles show what they posted.
  const pins = posts
    .filter(
      (post) =>
        post.author_id === profileId ||
        (own && (savedIds.includes(post.id) || repliedIds.has(post.id))),
    )
    .sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)))

  async function save() {
    if (!draft) {
      return
    }

    const { data, error } = await supabase
      .from('profiles')
      .update({
        display_name: draft.display_name.trim(),
        neighbourhood: draft.neighbourhood?.trim() || null,
        bio: draft.bio?.trim() || null,
      })
      .eq('id', profileId)
      .select()
      .single()

    if (error) {
      setError(error.message)
      return
    }

    setProfile(data)
    setDraft(null)
    onSaved(data)
  }

  function renderContent() {
    if (own?.chatWith) {
      return (
        <Chat
          userId={profileId}
          otherId={own.chatWith}
          name={names[own.chatWith] ?? null}
          messages={own.inbox.messages}
          onBack={() => own.onChat(null)}
          onSend={own.inbox.sendMessage}
          onRead={own.inbox.markConversationRead}
          onOpenProfile={own.onOpenProfile}
        />
      )
    }

    if (!profile) {
      return <p className="empty">{error || 'Loading...'}</p>
    }

    if (draft) {
      return (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
        >
          <h2 style={{ margin: '0 0 24px', fontSize: '24px', color: '#111' }}>Edit profile</h2>

          <label style={labelStyle}>Name</label>
          <input
            value={draft.display_name}
            onChange={(event) => setDraft({ ...draft, display_name: event.target.value })}
            maxLength={50}
            style={inputStyle}
          />

          <label style={labelStyle}>Neighbourhood</label>
          <input
            value={draft.neighbourhood ?? ''}
            onChange={(event) => setDraft({ ...draft, neighbourhood: event.target.value })}
            placeholder="e.g. Kent Town"
            maxLength={80}
            style={inputStyle}
          />

          <label style={labelStyle}>About you</label>
          <textarea
            value={draft.bio ?? ''}
            onChange={(event) => setDraft({ ...draft, bio: event.target.value })}
            placeholder="What should neighbours know about you?"
            rows={4}
            maxLength={500}
            style={{ ...inputStyle, resize: 'vertical' }}
          />

          {error && (
            <p role="alert" style={noticeStyle}>
              {error}
            </p>
          )}

          <div style={{ display: 'flex', gap: '10px' }}>
            <button type="button" onClick={() => setDraft(null)} style={secondaryButtonStyle}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={!draft.display_name.trim()}
              style={primaryButtonStyle(draft.display_name.trim() !== '')}
            >
              Save
            </button>
          </div>
        </form>
      )
    }

    const stats: [number, string][] = [
      [authoredCount, authoredCount === 1 ? 'pin' : 'pins'],
      [repliedIds.size, 'replied to'],
      ...(own ? ([[savedIds.length, 'saved']] as [number, string][]) : []),
    ]

    // Unread notifications and unread conversations, newest first.
    const feed: FeedRow[] = own
      ? [
          ...own.inbox.notifications
            .filter((notification) => !notification.read_at)
            .map((notification) => {
              const { icon, text } = describeNotification(notification)

              return {
                key: notification.id,
                time: notification.created_at,
                icon: <span className="row-icon">{icon}</span>,
                text: (
                  <>
                    <strong>{notification.actor_name ?? 'Someone'}</strong> {text}
                  </>
                ),
                meta: notification.preview,
                onClick: () => own.onOpenNotification(notification),
              }
            }),
          ...conversations
            .filter((conversation) => conversation.unread > 0)
            .map((conversation) => ({
              key: conversation.other,
              time: conversation.last.created_at,
              icon: avatar(conversation.other, names[conversation.other] ?? null),
              text: (
                <>
                  <strong>{names[conversation.other] ?? '…'}</strong> sent you{' '}
                  {conversation.unread === 1 ? 'a message' : `${conversation.unread} messages`}
                </>
              ),
              meta: conversation.last.body,
              onClick: () => own.onChat(conversation.other),
            })),
        ].sort((a, b) => b.time.localeCompare(a.time))
      : []

    const earlier = own
      ? own.inbox.notifications.filter((notification) => notification.read_at).slice(-10).reverse()
      : []

    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {avatar(profile.id, profile.display_name, 56)}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: '22px', color: '#111' }}>{profile.display_name}</h2>
            <div className="row-meta">
              {profile.neighbourhood && `📍 ${profile.neighbourhood} · `}
              Neighbour since{' '}
              {new Date(profile.created_at).toLocaleDateString(undefined, {
                month: 'short',
                year: 'numeric',
              })}
            </div>
          </div>
        </div>

        {profile.bio && (
          <p style={{ margin: '14px 0 0', lineHeight: 1.5, color: '#333', whiteSpace: 'pre-wrap' }}>
            {profile.bio}
          </p>
        )}

        <div style={{ display: 'flex', gap: '8px', margin: '16px 0' }}>
          {stats.map(([count, label]) => (
            <div
              key={label}
              style={{
                flex: 1,
                padding: '10px 4px',
                borderRadius: '12px',
                background: '#f7f7f8',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#111' }}>{count}</div>
              <div style={{ fontSize: '12px', color: '#777' }}>{label}</div>
            </div>
          ))}
        </div>

        {own ? (
          <div style={{ display: 'flex' }}>
            <button onClick={() => setDraft(profile)} style={secondaryButtonStyle}>
              Edit profile
            </button>
          </div>
        ) : (
          onMessage && (
            <div style={{ display: 'flex' }}>
              <button onClick={onMessage} style={primaryButtonStyle(true)}>
                Message {profile.display_name}
              </button>
            </div>
          )
        )}

        {own && (
          <>
            <div className="section-title">
              <span>New for you{feed.length > 0 && ` · ${feed.length}`}</span>
              {own.inbox.unreadNotifications > 0 && (
                <button
                  onClick={() =>
                    own.inbox.markNotificationsRead(
                      own.inbox.notifications.map((notification) => notification.id),
                    )
                  }
                  style={{ ...linkButtonStyle, fontSize: '12px', textTransform: 'none', letterSpacing: 0 }}
                >
                  Mark all read
                </button>
              )}
            </div>

            {feed.length === 0 ? (
              <p className="empty">You're all caught up ✓</p>
            ) : (
              feed.map((row) => (
                <button key={row.key} className="row unread" onClick={row.onClick}>
                  {row.icon}
                  <div className="row-main">
                    <div style={{ lineHeight: 1.35 }}>{row.text}</div>
                    {row.meta && <div className="row-meta row-title">“{row.meta}”</div>}
                  </div>
                  <span className="row-time">{ago(row.time)}</span>
                </button>
              ))
            )}
          </>
        )}

        <div className="section-title">
          <span>{own ? 'Your pins' : 'Pins'}</span>
        </div>

        {pins.length === 0 ? (
          <p className="empty">
            {own ? 'Pins you post, save or reply to show up here.' : 'No pins yet.'}
          </p>
        ) : (
          pins.map((post) => {
            const count = repliesByPost.get(post.id)?.length ?? 0

            return (
              <button key={post.id} className="row" onClick={() => onOpenPost(post)}>
                <span className="row-icon">📍</span>
                <div className="row-main">
                  <div className="row-title" style={{ fontWeight: 600 }}>{post.title}</div>
                  <div className="row-meta">
                    {own && post.author_id === profileId && <span className="chip mine">Yours</span>}
                    {own && savedIds.includes(post.id) && <span className="chip saved">Saved</span>}
                    {own && post.author_id !== profileId && repliedIds.has(post.id) && (
                      <span className="chip replied">Replied</span>
                    )}
                    {count === 0 ? 'No replies' : count === 1 ? '1 reply' : `${count} replies`}
                  </div>
                </div>
                <span className="row-time">{ago(lastActivity(post))}</span>
              </button>
            )
          })
        )}

        {own && (
          <>
            <div className="section-title">
              <span>Messages</span>
            </div>
            <ConversationList
              userId={profileId}
              messages={own.inbox.messages}
              names={names}
              onOpen={own.onChat}
            />

            {earlier.length > 0 && (
              <details>
                <summary className="section-title">
                  <span>Earlier notifications ▾</span>
                </summary>
                {earlier.map((notification) => {
                  const { icon, text } = describeNotification(notification)

                  return (
                    <button
                      key={notification.id}
                      className="row"
                      onClick={() => own.onOpenNotification(notification)}
                    >
                      <span className="row-icon">{icon}</span>
                      <div className="row-main" style={{ color: '#555', lineHeight: 1.35 }}>
                        <strong>{notification.actor_name ?? 'Someone'}</strong> {text}
                      </div>
                      <span className="row-time">{ago(notification.created_at)}</span>
                    </button>
                  )
                })}
              </details>
            )}

            <div className="footer-links">
              <span className="row-meta" title={own.email}>
                {own.email}
              </span>
              <button onClick={own.onChangePassword} style={{ ...linkButtonStyle, fontSize: '13px' }}>
                Change password
              </button>
              <button onClick={own.onSignOut} style={{ ...linkButtonStyle, fontSize: '13px' }}>
                Log out
              </button>
            </div>
          </>
        )}
      </>
    )
  }

  return (
    <aside className="menu" style={rightPanelStyle}>
      {!own?.chatWith && (
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            float: 'right',
            border: 'none',
            background: 'transparent',
            fontSize: '24px',
            lineHeight: 1,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          ×
        </button>
      )}
      {renderContent()}
    </aside>
  )
}
