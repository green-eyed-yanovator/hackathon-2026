import { useEffect, useState } from 'react'

import { supabase } from './lib/supabase'
import type { Post } from './types'

export function PostList({
  posts,
  empty,
  onOpenPost,
}: {
  posts: Post[]
  empty: string
  onOpenPost: (post: Post) => void
}) {
  if (posts.length === 0) {
    return <p style={{ margin: '0 0 16px', color: '#777', fontSize: '14px' }}>{empty}</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
      {posts.map((post) => (
        <button
          key={post.id}
          onClick={() => onOpenPost(post)}
          style={{
            textAlign: 'left',
            border: 'none',
            padding: '12px',
            background: '#f3f4f6',
            borderRadius: '10px',
            cursor: 'pointer',
          }}
        >
          <div style={{ fontSize: '15px', fontWeight: 600, color: '#222' }}>{post.title}</div>
          <div style={{ fontSize: '12px', color: '#777', marginTop: '2px' }}>
            {new Date(post.created_at).toLocaleDateString()}
            {post.author_name && ` · ${post.author_name}`}
          </div>
        </button>
      ))}
    </div>
  )
}

const headingStyle = { margin: '0 0 10px', fontSize: '16px', color: '#111' }

// Everything on the map the user has touched: created, saved, replied to.
export default function Pins({
  userId,
  posts,
  savedIds,
  onOpenPost,
}: {
  userId: string
  posts: Post[]
  savedIds: string[]
  onOpenPost: (post: Post) => void
}) {
  const [repliedIds, setRepliedIds] = useState<string[] | null>(null)

  useEffect(() => {
    let ignore = false

    supabase
      .from('replies')
      .select('post_id')
      .eq('author_id', userId)
      .then(({ data, error }) => {
        if (ignore) {
          return
        }

        if (error) {
          console.error('Failed to load replied pins:', error)
          return
        }

        setRepliedIds(data.map((reply) => reply.post_id))
      })

    return () => {
      ignore = true
    }
  }, [userId])

  const created = posts.filter((post) => post.author_id === userId)
  const saved = posts.filter((post) => savedIds.includes(post.id))
  const replied = posts.filter(
    (post) => post.author_id !== userId && repliedIds?.includes(post.id),
  )

  return (
    <>
      <h3 style={headingStyle}>Created ({created.length})</h3>
      <PostList posts={created} empty="You haven't posted anything yet." onOpenPost={onOpenPost} />

      <h3 style={headingStyle}>Saved ({saved.length})</h3>
      <PostList posts={saved} empty="Tap ☆ Save on a pin to keep track of it." onOpenPost={onOpenPost} />

      <h3 style={headingStyle}>Replied to ({replied.length})</h3>
      <PostList
        posts={replied}
        empty={repliedIds ? "You haven't replied to anyone's pin yet." : 'Loading...'}
        onOpenPost={onOpenPost}
      />
    </>
  )
}
