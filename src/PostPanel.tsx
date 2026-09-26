import { useState } from 'react'

import { useNames } from './inbox'
import InlineEdit from './InlineEdit'
import { supabase } from './lib/supabase'
import type { Post, Reply, Revision } from './types'
import { ago, avatar, linkButtonStyle, rightPanelStyle } from './ui'

type Props = {
  post: Post
  // This pin's replies, oldest first.
  replies: Reply[]
  userId: string | null
  saved: boolean
  interestedIds: string[]
  onClose: () => void
  onOpenProfile: (id: string) => void
  onMessage: (id: string) => void
  onToggleSave: () => void
  onToggleInterest: () => void
  onCopyLink: () => void
  onSignUp: () => void
  // Resolves true once the reply is saved.
  onReply: (text: string) => Promise<boolean>
  // After the author edits or resolves the pin.
  onChanged: (post: Post) => void
  onDeleted: (postId: string) => void
}

// "You", "You and Sam", "You, Sam and 3 others" ... are interested.
function describeInterested(names: string[]) {
  const verb = names.length === 1 && names[0] !== 'You' ? 'is' : 'are'

  if (names.length <= 2) return `${names.join(' and ')} ${verb} interested`

  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} ${names.length === 3 ? 'other' : 'others'} are interested`
}

export default function PostPanel({
  post,
  replies,
  userId,
  saved,
  interestedIds,
  onClose,
  onOpenProfile,
  onMessage,
  onToggleSave,
  onToggleInterest,
  onCopyLink,
  onSignUp,
  onReply,
  onChanged,
  onDeleted,
}: Props) {
  const [replyText, setReplyText] = useState('')
  // null until the history is first opened.
  const [revisions, setRevisions] = useState<Revision[] | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')

  const mine = userId !== null && post.author_id === userId
  const interested = userId !== null && interestedIds.includes(userId)
  const names = useNames(interestedIds)

  async function update(patch: Partial<Pick<Post, 'title' | 'description' | 'resolved_at'>>) {
    const { data, error } = await supabase
      .from('posts')
      .update(patch)
      .eq('id', post.id)
      .select()
      .single()

    if (error) {
      setError(error.message)
      return false
    }

    setError('')
    // An edit adds a revision; refetch next time the history is opened.
    setRevisions(null)
    setShowHistory(false)
    onChanged(data)
    return true
  }

  async function toggleHistory() {
    if (showHistory) {
      setShowHistory(false)
      return
    }

    setShowHistory(true)

    if (revisions === null) {
      const { data } = await supabase
        .from('post_revisions')
        .select('id, title, description, replaced_at')
        .eq('post_id', post.id)
        .order('replaced_at', { ascending: false })

      setRevisions(data ?? [])
    }
  }

  async function remove() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      setTimeout(() => setConfirmDelete(false), 4000)
      return
    }

    const { error } = await supabase.from('posts').delete().eq('id', post.id)

    if (error) {
      setError(error.message)
      return
    }

    onDeleted(post.id)
  }

  async function sendReply() {
    if (replyText.trim() && (await onReply(replyText.trim()))) {
      setReplyText('')
    }
  }

  return (
    <aside className="menu" style={rightPanelStyle}>
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

      {post.author_id ? (
        <button
          className="row"
          onClick={() => onOpenProfile(post.author_id!)}
          style={{ width: 'auto', padding: '4px 10px 4px 4px', marginBottom: '12px' }}
        >
          {avatar(post.author_id, post.author_name, 36)}
          <div className="row-main">
            <div style={{ fontWeight: 600 }}>{post.author_name}</div>
            <div className="row-meta">Posted {ago(post.created_at)}</div>
          </div>
        </button>
      ) : (
        <div className="row-meta" style={{ marginBottom: '12px' }}>
          Posted {ago(post.created_at)}
        </div>
      )}

      {post.resolved_at && (
        <div className="resolved-banner">
          <span>✓ Resolved {ago(post.resolved_at)}</span>
          {mine && (
            <button onClick={() => update({ resolved_at: null })} style={{ ...linkButtonStyle, color: '#166534', fontSize: '13px' }}>
              Reopen
            </button>
          )}
        </div>
      )}

      <InlineEdit
        value={post.title}
        editable={mine}
        prompt=""
        required
        maxLength={120}
        onSave={(value) => update({ title: value ?? '' })}
      >
        <h2 style={{ margin: '0 0 8px', fontSize: '24px', color: '#111' }}>{post.title}</h2>
      </InlineEdit>

      <InlineEdit
        value={post.description}
        editable={mine}
        prompt="✏️ Add some details"
        maxLength={2000}
        multiline
        onSave={(value) => update({ description: value ?? '' })}
      >
        <p style={{ margin: '0 0 8px', fontSize: '16px', lineHeight: 1.5, color: '#444', whiteSpace: 'pre-wrap' }}>
          {post.description}
        </p>
      </InlineEdit>

      {post.edited_at && (
        <div className="row-meta" style={{ marginBottom: '8px' }}>
          Edited {ago(post.edited_at)} ·{' '}
          <button onClick={toggleHistory} style={{ ...linkButtonStyle, fontSize: '12px', color: '#777' }}>
            {showHistory ? 'Hide history' : 'History'}
          </button>
        </div>
      )}

      {showHistory && (
        <div className="history">
          {revisions === null ? (
            <div className="row-meta">Loading...</div>
          ) : (
            revisions.map((revision) => (
              <div key={revision.id} className="history-item">
                <div className="row-meta" style={{ marginTop: 0 }}>
                  Before {ago(revision.replaced_at)}
                </div>
                <div style={{ fontWeight: 600, color: '#555' }}>{revision.title}</div>
                <div style={{ color: '#666', whiteSpace: 'pre-wrap' }}>{revision.description}</div>
              </div>
            ))
          )}
        </div>
      )}

      {error && <p className="empty" role="alert">{error}</p>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
        <button
          className={interested ? 'pill on-blue' : 'pill'}
          aria-pressed={interested}
          onClick={onToggleInterest}
          title={userId ? undefined : 'Sign up to show interest'}
        >
          👍 Interested{interestedIds.length > 0 && ` · ${interestedIds.length}`}
        </button>

        {userId && (
          <button className={saved ? 'pill on-gold' : 'pill'} aria-pressed={saved} onClick={onToggleSave}>
            {saved ? '★ Saved' : '☆ Save'}
          </button>
        )}

        {userId && post.author_id && !mine && (
          <button className="pill" onClick={() => onMessage(post.author_id!)}>
            ✉️ Message
          </button>
        )}

        <button className="pill" onClick={onCopyLink} title="Copy a link to this pin">
          🔗 Copy link
        </button>
      </div>

      {mine && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          {!post.resolved_at && (
            <button
              className="pill"
              onClick={() => update({ resolved_at: new Date().toISOString() })}
              title="Found it, done, sorted: takes the pin off the map but keeps it in history"
            >
              ✓ Mark resolved
            </button>
          )}
          <button className={confirmDelete ? 'pill danger' : 'pill'} onClick={remove}>
            {confirmDelete ? 'Click again to delete' : '🗑 Delete'}
          </button>
        </div>
      )}

      {interestedIds.length > 0 && (
        <div className="row-meta" style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ display: 'flex' }}>
            {interestedIds.slice(0, 4).map((id, index) => (
              <span key={id} style={{ marginLeft: index ? '-8px' : 0, borderRadius: '50%', boxShadow: '0 0 0 2px white' }}>
                {avatar(id, names[id] ?? null, 22)}
              </span>
            ))}
          </span>
          <span>
            {describeInterested(interestedIds.map((id) => (id === userId ? 'You' : (names[id] ?? '…'))))}
          </span>
        </div>
      )}

      <div className="section-title">
        <span>
          {replies.length === 0
            ? 'Replies'
            : `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
        </span>
      </div>

      {replies.length === 0 ? (
        <p className="empty">No replies yet. Be the first.</p>
      ) : (
        replies.map((reply) => (
          <div key={reply.id} style={{ display: 'flex', gap: '10px', padding: '8px 0' }}>
            {avatar(reply.author_id, reply.author_name, 30)}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="row-meta" style={{ marginTop: 0 }}>
                {reply.author_id ? (
                  <button
                    onClick={() => onOpenProfile(reply.author_id!)}
                    style={{ ...linkButtonStyle, fontSize: '13px', fontWeight: 600, color: '#222', textDecoration: 'none' }}
                  >
                    {reply.author_name}
                  </button>
                ) : (
                  <strong>Anonymous</strong>
                )}
                {' · '}
                {ago(reply.created_at)}
              </div>
              <div
                style={{
                  marginTop: '2px',
                  fontSize: '14px',
                  lineHeight: 1.45,
                  color: '#333',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                }}
              >
                {reply.content}
              </div>
            </div>
          </div>
        ))
      )}

      <div
        style={{
          position: 'sticky',
          bottom: '-24px',
          margin: '16px -24px -24px',
          padding: '12px 24px 24px',
          background: 'white',
          borderTop: '1px solid #eee',
        }}
      >
        {userId ? (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
            <textarea
              value={replyText}
              onChange={(event) => setReplyText(event.target.value)}
              placeholder="Write a reply..."
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  sendReply()
                }
              }}
              title="Ctrl+Enter to send"
              rows={2}
              style={{
                flex: 1,
                boxSizing: 'border-box',
                padding: '10px 14px',
                border: '1px solid #ddd',
                borderRadius: '16px',
                fontSize: '14px',
                fontFamily: 'inherit',
                resize: 'none',
              }}
            />
            <button
              onClick={sendReply}
              disabled={!replyText.trim()}
              style={{
                padding: '10px 16px',
                border: 'none',
                borderRadius: '20px',
                background: replyText.trim() ? '#111' : '#ccc',
                color: 'white',
                fontWeight: 600,
                cursor: replyText.trim() ? 'pointer' : 'not-allowed',
              }}
            >
              Reply
            </button>
          </div>
        ) : (
          <button
            onClick={onSignUp}
            style={{
              width: '100%',
              border: '1px solid #ccc',
              background: 'white',
              color: '#222',
              padding: '12px',
              borderRadius: '10px',
              fontSize: '15px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Sign up to reply
          </button>
        )}
      </div>
    </aside>
  )
}
