import { useState, type ReactNode } from 'react'

import type { Interest, Post, Reply, Saved } from './types'
import { ago, groupByDay, newestFirst } from './ui'

type Props = {
  profileId: string
  posts: Post[]
  replies: Reply[]
  interests: Interest[]
  // Saves are private, so only passed for your own profile.
  saved: Saved[] | null
  onOpenPost: (post: Post) => void
  onHoverPost: (postId: string | null) => void
}

type Item = {
  key: string
  time: string
  icon: string
  text: ReactNode
  meta?: string
  post: Post
}

// Everything a neighbour has done on the map, newest first, built from data
// that's already loaded.
export default function Activity({ profileId, posts, replies, interests, saved, onOpenPost, onHoverPost }: Props) {
  const [limit, setLimit] = useState(8)

  const byId = new Map(posts.map((post) => [post.id, post]))
  const title = (post: Post) => <strong>{post.title}</strong>
  const items: Item[] = []

  for (const post of posts) {
    if (post.author_id !== profileId) continue

    items.push({ key: `post-${post.id}`, time: post.created_at, icon: '📍', text: <>Posted {title(post)}</>, post })
    if (post.edited_at) {
      items.push({ key: `edit-${post.id}`, time: post.edited_at, icon: '✏️', text: <>Edited {title(post)}</>, post })
    }
    if (post.resolved_at) {
      items.push({ key: `resolved-${post.id}`, time: post.resolved_at, icon: '✅', text: <>Resolved {title(post)}</>, post })
    }
  }

  for (const reply of replies) {
    const post = byId.get(reply.post_id)
    if (reply.author_id === profileId && post) {
      items.push({ key: `reply-${reply.id}`, time: reply.created_at, icon: '💬', text: <>Replied to {title(post)}</>, meta: reply.content, post })
    }
  }

  for (const interest of interests) {
    const post = byId.get(interest.post_id)
    if (interest.user_id === profileId && post) {
      items.push({ key: `interest-${post.id}`, time: interest.created_at, icon: '👍', text: <>Interested in {title(post)}</>, post })
    }
  }

  for (const save of saved ?? []) {
    const post = byId.get(save.post_id)
    if (post) {
      items.push({ key: `saved-${post.id}`, time: save.created_at, icon: '⭐', text: <>Saved {title(post)}</>, post })
    }
  }

  items.sort((a, b) => newestFirst(a.time, b.time))

  if (items.length === 0) {
    return <p className="empty">Nothing yet.</p>
  }

  return (
    <>
      {groupByDay(items.slice(0, limit), (item) => item.time).map((group) => (
        <div key={group.label}>
          <div className="activity-day">{group.label}</div>
          {group.items.map((item) => (
            <button
              key={item.key}
              className="row"
              onClick={() => onOpenPost(item.post)}
              onMouseEnter={() => onHoverPost(item.post.id)}
              onMouseLeave={() => onHoverPost(null)}
            >
              <span className="row-icon">{item.icon}</span>
              <div className="row-main">
                <div className="row-title">{item.text}</div>
                {item.meta && <div className="row-meta row-title">“{item.meta}”</div>}
              </div>
              <span className="row-time">{ago(item.time)}</span>
            </button>
          ))}
        </div>
      ))}
      {items.length > limit && (
        <button className="load-older" onClick={() => setLimit(limit + 15)}>
          Show more ({items.length - limit})
        </button>
      )}
    </>
  )
}
