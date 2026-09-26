import { useState, type RefObject } from 'react'

import type { Post } from './types'
import { ago, flairIcon } from './ui'

type Props = {
  query: string
  onQuery: (query: string) => void
  // Already filtered by the query (and any map filter), in map order.
  results: Post[]
  onOpen: (post: Post) => void
  inputRef: RefObject<HTMLInputElement | null>
}

// Filters the map as you type. Arrow keys pick a result, Enter opens it, Esc clears.
export default function SearchBox({ query, onQuery, results, onOpen, inputRef }: Props) {
  const [focused, setFocused] = useState(false)
  const [highlight, setHighlight] = useState(0)

  const shown = results.slice(0, 6)
  const open = focused && query.trim() !== ''
  const active = Math.min(highlight, shown.length - 1)

  function choose(post: Post) {
    onOpen(post)
    inputRef.current?.blur()
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => {
          onQuery(event.target.value)
          setHighlight(0)
        }}
        onFocus={() => setFocused(true)}
        // Let a click on a result land before the list disappears.
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setHighlight((index) => Math.min(index + 1, shown.length - 1))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setHighlight((index) => Math.max(index - 1, 0))
          } else if (event.key === 'Enter' && shown[active]) {
            choose(shown[active])
          } else if (event.key === 'Escape') {
            event.stopPropagation()
            onQuery('')
            inputRef.current?.blur()
          }
        }}
        placeholder="Search pins"
        aria-label="Search pins"
        className="search"
      />
      {!focused && !query && <kbd className="search-key">/</kbd>}

      {open && (
        <div className="search-results">
          {shown.length === 0 ? (
            <div className="row-meta" style={{ padding: '10px 12px' }}>
              No pins match “{query.trim()}”
            </div>
          ) : (
            shown.map((post, index) => (
              <button
                key={post.id}
                className={index === active ? 'row unread' : 'row'}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(post)}
              >
                <span className="row-icon">{flairIcon(post.flair)}</span>
                <div className="row-main">
                  <div className="row-title" style={{ fontWeight: 600 }}>{post.title}</div>
                  <div className="row-meta row-title">
                    {post.author_name ?? 'Anonymous'} · {ago(post.created_at)}
                  </div>
                </div>
              </button>
            ))
          )}
          {results.length > shown.length && (
            <div className="row-meta" style={{ padding: '6px 12px 8px' }}>
              +{results.length - shown.length} more on the map
            </div>
          )}
        </div>
      )}
    </div>
  )
}
