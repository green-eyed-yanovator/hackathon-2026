import { useEffect, useState, type ReactNode } from 'react'

import {
  conversationsOf,
  describeNotification,
  useNames,
  type InboxApi,
} from './inbox'
import Activity from './Activity'
import InlineEdit from './InlineEdit'
import { supabase } from './lib/supabase'
import Chat, { ConversationList } from './Messages'
import type { Interest, MapFilter, NotificationRow, Post, Profile, Reply, Saved } from './types'
import { ago, avatar, flairIcon, linkButtonStyle, newestFirst, primaryButtonStyle, rightPanelStyle } from './ui'

// Present only on the signed-in user's own profile.
export type OwnMenu = {
  email: string
  inbox: InboxApi
  chatWith: string | null
  onChat: (otherId: string | null) => void
  onOpenNotification: (notification: NotificationRow) => void
  onOpenProfile: (id: string) => void
  onSeeAllNotifications: () => void
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
  interests: Interest[]
  // The viewer's own saved pins.
  saved: Saved[]
  onOpenPost: (post: Post) => void
  // Hovering a row lights up its pin on the map.
  onHoverPost: (postId: string | null) => void
  onFilter: (filter: MapFilter) => void
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
  postId: string | null
  onClick: () => void
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

export default function ProfilePanel({
  profileId,
  seed,
  own,
  posts,
  replies,
  interests,
  saved,
  onOpenPost,
  onHoverPost,
  onFilter,
  onSaved,
  onMessage,
  onClose,
}: Props) {
  const [profile, setProfile] = useState<Profile | null>(seed)
  const savedIds = saved.map((save) => save.post_id)
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

  // Reply and interest counts per pin, from data already loaded for the map.
  const repliesByPost = new Map<string, Reply[]>()
  for (const reply of replies) {
    repliesByPost.set(reply.post_id, [...(repliesByPost.get(reply.post_id) ?? []), reply])
  }
  const interestCount: Record<string, number> = {}
  for (const interest of interests) {
    interestCount[interest.post_id] = (interestCount[interest.post_id] ?? 0) + 1
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
    .sort((a, b) => newestFirst(lastActivity(a), lastActivity(b)))

  async function saveField(patch: Partial<Pick<Profile, 'display_name' | 'neighbourhood' | 'bio'>>) {
    const { data, error } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', profileId)
      .select()
      .single()

    if (error) {
      setError(error.message)
      return false
    }

    setError('')
    setProfile(data)
    onSaved(data)
    return true
  }

  // Rows that point at a pin light it up on the map while hovered.
  const hoverProps = (postId: string | null) => ({
    onMouseEnter: () => onHoverPost(postId),
    onMouseLeave: () => onHoverPost(null),
  })

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

    // Each stat narrows the map to exactly those pins.
    const stats: [string, MapFilter][] = own
      ? [
          [plural(authoredCount, 'pin', 'pins'), { kind: 'mine' }],
          [plural(repliedIds.size, 'replied to', 'replied to'), { kind: 'replied' }],
          [plural(savedIds.length, 'saved', 'saved'), { kind: 'saved' }],
        ]
      : [
          [
            plural(authoredCount, 'pin', 'pins'),
            { kind: 'author', authorId: profileId, name: profile.display_name },
          ],
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
                postId: notification.post_id,
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
              postId: null,
              onClick: () => own.onChat(conversation.other),
            })),
        ].sort((a, b) => newestFirst(a.time, b.time))
      : []

    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {avatar(profile.id, profile.display_name, 56)}
          <div style={{ flex: 1, minWidth: 0 }}>
            <InlineEdit
              value={profile.display_name}
              editable={!!own}
              prompt=""
              required
              maxLength={50}
              onSave={(value) => saveField({ display_name: value ?? '' })}
            >
              <h2 style={{ margin: 0, fontSize: '22px', color: '#111' }}>{profile.display_name}</h2>
            </InlineEdit>
            <div className="row-meta">
              Neighbour since{' '}
              {new Date(profile.created_at).toLocaleDateString(undefined, {
                month: 'short',
                year: 'numeric',
              })}
            </div>
          </div>
        </div>

        <InlineEdit
          value={profile.neighbourhood}
          editable={!!own}
          prompt="📍 Add your neighbourhood"
          placeholder="e.g. Kent Town"
          maxLength={80}
          onSave={(value) => saveField({ neighbourhood: value })}
        >
          <div style={{ marginTop: '12px', fontSize: '15px', color: '#333' }}>
            📍 {profile.neighbourhood}
          </div>
        </InlineEdit>

        <InlineEdit
          value={profile.bio}
          editable={!!own}
          prompt="✏️ Add a bio so neighbours know who you are"
          placeholder="What should neighbours know about you? Hobbies, how long you've lived here, what you can help with..."
          maxLength={500}
          multiline
          onSave={(value) => saveField({ bio: value })}
        >
          <p style={{ margin: '12px 0 0', lineHeight: 1.5, color: '#333', whiteSpace: 'pre-wrap' }}>
            {profile.bio}
          </p>
        </InlineEdit>

        {error && <p className="empty" role="alert">{error}</p>}

        <div style={{ display: 'flex', gap: '8px', margin: '16px 0' }}>
          {stats.map(([label, filter]) => {
            const [count, ...words] = label.split(' ')

            return (
              <button
                key={label}
                className="stat"
                title="Show these on the map"
                onClick={() => onFilter(filter)}
              >
                <div style={{ fontSize: '20px', fontWeight: 700, color: '#111' }}>{count}</div>
                <div style={{ fontSize: '12px', color: '#777' }}>{words.join(' ')}</div>
              </button>
            )
          })}
        </div>

        {onMessage && (
          <div style={{ display: 'flex' }}>
            <button onClick={onMessage} style={primaryButtonStyle(true)}>
              Message {profile.display_name}
            </button>
          </div>
        )}

        {own && (
          <>
            <div className="section-title">
              <span>New for you{feed.length > 0 && ` · ${feed.length}`}</span>
              <button
                onClick={own.onSeeAllNotifications}
                style={{ ...linkButtonStyle, fontSize: '12px', textTransform: 'none', letterSpacing: 0 }}
              >
                See all notifications →
              </button>
            </div>

            {feed.length === 0 ? (
              <p className="empty">You're all caught up ✓</p>
            ) : (
              feed.map((row) => (
                <button key={row.key} className="row unread" onClick={row.onClick} {...hoverProps(row.postId)}>
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
            const interested = interestCount[post.id] ?? 0

            return (
              <button key={post.id} className="row" onClick={() => onOpenPost(post)} {...hoverProps(post.id)}>
                <span className="row-icon">{flairIcon(post.flair)}</span>
                <div className="row-main">
                  <div className="row-title" style={{ fontWeight: 600 }}>{post.title}</div>
                  <div className="row-meta">
                    {own && post.author_id === profileId && <span className="chip mine">Yours</span>}
                    {own && savedIds.includes(post.id) && <span className="chip saved">Saved</span>}
                    {own && post.author_id !== profileId && repliedIds.has(post.id) && (
                      <span className="chip replied">Replied</span>
                    )}
                    {post.resolved_at && <span className="chip resolved">Resolved</span>}
                    {count === 0 ? 'No replies' : plural(count, 'reply', 'replies')}
                    {interested > 0 && ` · 👍 ${interested}`}
                  </div>
                </div>
                <span className="row-time">{ago(lastActivity(post))}</span>
              </button>
            )
          })
        )}

        <div className="section-title">
          <span>Activity</span>
        </div>
        <Activity
          profileId={profileId}
          posts={posts}
          replies={replies}
          interests={interests}
          saved={own ? saved : null}
          onOpenPost={onOpenPost}
          onHoverPost={onHoverPost}
        />

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
