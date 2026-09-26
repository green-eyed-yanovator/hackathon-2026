import type { Post } from './types'
import { ago, flairIcon, rightPanelStyle } from './ui'

// "Threads here": every post at one place, newest first.
export default function PlacePanel({
  posts,
  replyCounts,
  onOpenPost,
  onHoverPost,
  onClose,
}: {
  posts: Post[]
  replyCounts: Record<string, number>
  onOpenPost: (post: Post) => void
  onHoverPost: (postId: string | null) => void
  onClose: () => void
}) {
  return (
    <aside className="menu" style={rightPanelStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: '22px', color: '#111' }}>Threads here</h2>
          <div className="row-meta">
            {posts.length} {posts.length === 1 ? 'thread' : 'threads'} at this spot
          </div>
        </div>
        <button className="icon-button" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>

      {posts.map((post) => {
        const replies = replyCounts[post.id] ?? 0

        return (
          <button
            key={post.id}
            className="row"
            onClick={() => onOpenPost(post)}
            onMouseEnter={() => onHoverPost(post.id)}
            onMouseLeave={() => onHoverPost(null)}
          >
            <span className="row-icon">{flairIcon(post.flair)}</span>
            <div className="row-main">
              <div className="row-title" style={{ fontWeight: 600 }}>{post.title}</div>
              <div className="row-meta row-title">
                {post.author_name ?? 'Anonymous'} · {ago(post.created_at)} ·{' '}
                {replies === 0 ? 'No replies' : `${replies} ${replies === 1 ? 'reply' : 'replies'}`}
                {post.resolved_at && ' · ✓ Resolved'}
              </div>
            </div>
          </button>
        )
      })}
    </aside>
  )
}
