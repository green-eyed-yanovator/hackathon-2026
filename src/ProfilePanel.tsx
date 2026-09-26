import { useEffect, useState } from 'react'

import type { InboxApi } from './inbox'
import { supabase } from './lib/supabase'
import Messages from './Messages'
import Notifications from './Notifications'
import Pins, { PostList } from './Pins'
import type { MenuTab, NotificationRow, Post, Profile } from './types'
import {
  inputStyle,
  labelStyle,
  noticeStyle,
  primaryButtonStyle,
  rightPanelStyle,
  secondaryButtonStyle,
} from './ui'

// Tabs shown only on the signed-in user's own profile.
export type OwnMenu = {
  tab: MenuTab
  onTabChange: (tab: MenuTab) => void
  inbox: InboxApi
  savedIds: string[]
  messageWith: string | null
  onMessageWith: (otherId: string | null) => void
  onOpenNotification: (notification: NotificationRow) => void
  onOpenProfile: (id: string) => void
}

type Props = {
  profileId: string
  // Only set when this is the signed-in user's own profile.
  ownEmail: string | null
  menu: OwnMenu | null
  // Every post is already loaded for the map, so lists are filtered locally.
  posts: Post[]
  onOpenPost: (post: Post) => void
  onSaved: (profile: Profile) => void
  onChangePassword: () => void
  // Set when a signed-in user views someone else's profile.
  onMessage: (() => void) | null
  onClose: () => void
}

export default function ProfilePanel({
  profileId,
  ownEmail,
  menu,
  posts,
  onOpenPost,
  onSaved,
  onChangePassword,
  onMessage,
  onClose,
}: Props) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [replyCount, setReplyCount] = useState(0)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [neighbourhood, setNeighbourhood] = useState('')
  const [bio, setBio] = useState('')
  const [message, setMessage] = useState('')

  const isOwn = ownEmail !== null
  const authoredPosts = posts.filter((post) => post.author_id === profileId)

  useEffect(() => {
    let ignore = false

    Promise.all([
      supabase.from('profiles').select('*').eq('id', profileId).single(),
      supabase
        .from('replies')
        .select('id', { count: 'exact', head: true })
        .eq('author_id', profileId),
    ]).then(([profileResult, repliesResult]) => {
      if (ignore) {
        return
      }

      if (profileResult.error) {
        console.error('Failed to load profile:', profileResult.error)
        setMessage('Could not load this profile.')
        return
      }

      setProfile(profileResult.data)
      setReplyCount(repliesResult.count ?? 0)
    })

    return () => {
      ignore = true
    }
  }, [profileId])

  function startEditing() {
    if (!profile) {
      return
    }

    setName(profile.display_name)
    setNeighbourhood(profile.neighbourhood ?? '')
    setBio(profile.bio ?? '')
    setMessage('')
    setEditing(true)
  }

  async function handleSave() {
    const { data, error } = await supabase
      .from('profiles')
      .update({
        display_name: name.trim(),
        neighbourhood: neighbourhood.trim() || null,
        bio: bio.trim() || null,
      })
      .eq('id', profileId)
      .select()
      .single()

    if (error) {
      setMessage(error.message)
      return
    }

    setProfile(data)
    setEditing(false)
    onSaved(data)
  }

  return (
    <aside style={rightPanelStyle}>
      <button
        onClick={onClose}
        style={{
          border: 'none',
          background: 'transparent',
          fontSize: '24px',
          cursor: 'pointer',
          padding: 0,
          marginBottom: '20px',
        }}
      >
        ×
      </button>

      {menu && (
        <nav
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '4px',
            marginBottom: '20px',
            borderBottom: '1px solid #eee',
          }}
        >
          {(
            [
              ['profile', 'Profile', 0],
              ['pins', 'Pins', 0],
              ['notifications', 'Notifications', menu.inbox.unreadNotifications],
              ['messages', 'Messages', menu.inbox.unreadMessages],
            ] as const
          ).map(([tab, label, unread]) => (
            <button
              key={tab}
              onClick={() => menu.onTabChange(tab)}
              style={{
                padding: '8px 6px',
                border: 'none',
                borderBottom: menu.tab === tab ? '2px solid #000' : '2px solid transparent',
                background: 'transparent',
                fontSize: '13px',
                fontWeight: menu.tab === tab ? 700 : 500,
                color: menu.tab === tab ? '#111' : '#666',
                cursor: 'pointer',
              }}
            >
              {label}
              {unread > 0 && (
                <span
                  style={{
                    marginLeft: '4px',
                    padding: '1px 6px',
                    borderRadius: '999px',
                    background: '#dc2626',
                    color: 'white',
                    fontSize: '11px',
                  }}
                >
                  {unread}
                </span>
              )}
            </button>
          ))}
        </nav>
      )}

      {menu?.tab === 'pins' ? (
        <Pins
          userId={profileId}
          posts={posts}
          savedIds={menu.savedIds}
          onOpenPost={onOpenPost}
        />
      ) : menu?.tab === 'notifications' ? (
        <Notifications
          notifications={menu.inbox.notifications}
          onOpen={menu.onOpenNotification}
          onMarkAllRead={() =>
            menu.inbox.markNotificationsRead(
              menu.inbox.notifications.map((notification) => notification.id),
            )
          }
        />
      ) : menu?.tab === 'messages' ? (
        <Messages
          userId={profileId}
          messages={menu.inbox.messages}
          withUser={menu.messageWith}
          onSelect={menu.onMessageWith}
          onSend={menu.inbox.sendMessage}
          onRead={menu.inbox.markConversationRead}
          onOpenProfile={menu.onOpenProfile}
        />
      ) : !profile ? (
        <p style={{ color: '#777' }}>{message || 'Loading...'}</p>
      ) : editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            handleSave()
          }}
        >
          <h2 style={{ margin: '0 0 24px', fontSize: '24px', color: '#111' }}>
            Edit profile
          </h2>

          <label style={labelStyle}>Name</label>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={50}
            style={inputStyle}
          />

          <label style={labelStyle}>Neighbourhood</label>
          <input
            value={neighbourhood}
            onChange={(event) => setNeighbourhood(event.target.value)}
            placeholder="e.g. Kent Town"
            maxLength={80}
            style={inputStyle}
          />

          <label style={labelStyle}>About you</label>
          <textarea
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            placeholder="What should neighbours know about you?"
            rows={4}
            maxLength={500}
            style={{ ...inputStyle, resize: 'vertical' }}
          />

          {message && (
            <p role="alert" style={noticeStyle}>
              {message}
            </p>
          )}

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              onClick={() => setEditing(false)}
              style={secondaryButtonStyle}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              style={primaryButtonStyle(name.trim() !== '')}
            >
              Save
            </button>
          </div>
        </form>
      ) : (
        <>
          <h2 style={{ margin: '0 0 8px', fontSize: '26px', color: '#111' }}>
            {profile.display_name}
          </h2>

          {profile.neighbourhood && (
            <p style={{ margin: '0 0 8px', fontSize: '15px', color: '#444' }}>
              📍 {profile.neighbourhood}
            </p>
          )}

          <p style={{ margin: '0 0 16px', fontSize: '14px', color: '#777' }}>
            Neighbour since{' '}
            {new Date(profile.created_at).toLocaleDateString(undefined, {
              month: 'long',
              year: 'numeric',
            })}
          </p>

          {profile.bio && (
            <p
              style={{
                margin: '0 0 16px',
                fontSize: '16px',
                lineHeight: 1.5,
                color: '#333',
                whiteSpace: 'pre-wrap',
              }}
            >
              {profile.bio}
            </p>
          )}

          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
            {[
              [authoredPosts.length, authoredPosts.length === 1 ? 'post' : 'posts'],
              [replyCount, replyCount === 1 ? 'reply' : 'replies'],
            ].map(([count, label]) => (
              <div
                key={label}
                style={{
                  flex: 1,
                  padding: '12px',
                  background: '#f3f4f6',
                  borderRadius: '10px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '22px', fontWeight: 700, color: '#111' }}>
                  {count}
                </div>
                <div style={{ fontSize: '13px', color: '#666' }}>{label}</div>
              </div>
            ))}
          </div>

          {isOwn && (
            <>
              <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#777' }}>
                Signed in as {ownEmail} (only you can see this)
              </p>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '24px' }}>
                <button onClick={startEditing} style={secondaryButtonStyle}>
                  Edit profile
                </button>
                <button onClick={onChangePassword} style={secondaryButtonStyle}>
                  Change password
                </button>
              </div>
            </>
          )}

          {onMessage && (
            <div style={{ display: 'flex', marginBottom: '24px' }}>
              <button onClick={onMessage} style={primaryButtonStyle(true)}>
                Message {profile.display_name}
              </button>
            </div>
          )}

          <h3 style={{ margin: '0 0 12px', fontSize: '18px', color: '#111' }}>
            Posts
          </h3>

          <PostList posts={authoredPosts} empty="No posts yet." onOpenPost={onOpenPost} />
        </>
      )}
    </aside>
  )
}
