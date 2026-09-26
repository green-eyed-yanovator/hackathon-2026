import { useEffect, useRef, useState } from 'react'

import { supabase } from './lib/supabase'
import type { Message } from './types'
import { linkButtonStyle, noticeStyle, primaryButtonStyle } from './ui'

type Props = {
  userId: string
  messages: Message[]
  // The open conversation, or null for the list of conversations.
  withUser: string | null
  onSelect: (otherId: string | null) => void
  onSend: (recipientId: string, body: string) => Promise<string | null>
  onRead: (otherId: string) => void
  onOpenProfile: (id: string) => void
}

export default function Messages({
  userId,
  messages,
  withUser,
  onSelect,
  onSend,
  onRead,
  onOpenProfile,
}: Props) {
  const [names, setNames] = useState<Record<string, string>>({})
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  const otherOf = (message: Message) =>
    message.sender_id === userId ? message.recipient_id : message.sender_id

  // Latest message first, one row per neighbour.
  const conversations = new Map<string, { last: Message; unread: number }>()
  for (const message of messages) {
    const other = otherOf(message)
    const unread = message.recipient_id === userId && !message.read_at ? 1 : 0
    conversations.set(other, {
      last: message,
      unread: (conversations.get(other)?.unread ?? 0) + unread,
    })
  }
  const conversationList = [...conversations.entries()].reverse()

  const thread = withUser ? messages.filter((message) => otherOf(message) === withUser) : []
  const unreadInThread = withUser ? (conversations.get(withUser)?.unread ?? 0) : 0

  // Load display names for everyone we're talking to.
  const missingKey = [...new Set([...conversations.keys(), ...(withUser ? [withUser] : [])])]
    .filter((id) => !(id in names))
    .join(',')

  useEffect(() => {
    if (!missingKey) {
      return
    }

    supabase
      .from('profiles')
      .select('id, display_name')
      .in('id', missingKey.split(','))
      .then(({ data }) => {
        setNames((current) => ({
          ...current,
          ...Object.fromEntries((data ?? []).map((profile) => [profile.id, profile.display_name])),
        }))
      })
  }, [missingKey])

  useEffect(() => {
    if (withUser && unreadInThread > 0) {
      onRead(withUser)
    }
  }, [withUser, unreadInThread, onRead])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [thread.length])

  async function handleSend() {
    if (!withUser || !text.trim()) {
      return
    }

    const sendError = await onSend(withUser, text.trim())

    if (sendError) {
      setError(sendError)
      return
    }

    setText('')
    setError('')
  }

  if (!withUser) {
    return conversationList.length === 0 ? (
      <p style={{ margin: 0, color: '#777', fontSize: '14px' }}>
        No messages yet. Open a neighbour's profile and tap Message to start a conversation.
      </p>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {conversationList.map(([other, { last, unread }]) => (
          <button
            key={other}
            onClick={() => onSelect(other)}
            style={{
              textAlign: 'left',
              border: 'none',
              padding: '12px',
              background: unread ? '#eff6ff' : '#f3f4f6',
              borderRadius: '10px',
              cursor: 'pointer',
              color: '#333',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
              <span>{names[other] ?? '…'}</span>
              {unread > 0 && <span style={{ color: '#2563eb' }}>{unread} new</span>}
            </div>
            <div
              style={{
                marginTop: '4px',
                fontSize: '13px',
                color: '#666',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {last.sender_id === userId ? 'You: ' : ''}
              {last.body}
            </div>
          </button>
        ))}
      </div>
    )
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
        <button onClick={() => onSelect(null)} style={linkButtonStyle}>
          ← All messages
        </button>
        <button
          onClick={() => onOpenProfile(withUser)}
          style={{ ...linkButtonStyle, fontWeight: 600, color: '#222' }}
        >
          {names[withUser] ?? '…'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
        {thread.length === 0 && (
          <p style={{ margin: 0, color: '#777', fontSize: '14px' }}>Say hello 👋</p>
        )}
        {thread.map((message) => {
          const mine = message.sender_id === userId

          return (
            <div
              key={message.id}
              style={{
                alignSelf: mine ? 'flex-end' : 'flex-start',
                maxWidth: '80%',
                padding: '10px 12px',
                borderRadius: '14px',
                background: mine ? '#000' : '#f3f4f6',
                color: mine ? 'white' : '#222',
                fontSize: '14px',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
              }}
            >
              {message.body}
            </div>
          )
        })}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          handleSend()
        }}
      >
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              handleSend()
            }
          }}
          placeholder="Write a message..."
          rows={2}
          maxLength={2000}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '12px',
            border: '1px solid #ccc',
            borderRadius: '10px',
            fontSize: '14px',
            resize: 'vertical',
            marginBottom: '10px',
          }}
        />
        {error && (
          <p role="alert" style={noticeStyle}>
            {error}
          </p>
        )}
        <div style={{ display: 'flex' }}>
          <button type="submit" disabled={!text.trim()} style={primaryButtonStyle(text.trim() !== '')}>
            Send
          </button>
        </div>
      </form>
    </>
  )
}
