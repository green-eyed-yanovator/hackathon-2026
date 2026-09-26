import { useEffect, useRef, useState } from 'react'

import { conversationsOf } from './inbox'
import type { Message } from './types'
import { ago, avatar, noticeStyle } from './ui'

export function ConversationList({
  userId,
  messages,
  names,
  onOpen,
}: {
  userId: string
  messages: Message[]
  names: Record<string, string>
  onOpen: (otherId: string) => void
}) {
  const conversations = conversationsOf(userId, messages)

  if (conversations.length === 0) {
    return <p className="empty">No messages yet. Tap Message on a neighbour's profile to say hi.</p>
  }

  return conversations.map(({ other, last, unread }) => (
    <button
      key={other}
      className={unread ? 'row unread' : 'row'}
      onClick={() => onOpen(other)}
    >
      {avatar(other, names[other] ?? null)}
      <div className="row-main">
        <div className="row-title" style={{ fontWeight: unread ? 700 : 500 }}>
          {names[other] ?? '…'}
        </div>
        <div className="row-meta row-title">
          {last.sender_id === userId ? 'You: ' : ''}
          {last.body}
        </div>
      </div>
      <span className="row-time">{ago(last.created_at)}</span>
      {unread > 0 && <span className="dot" />}
    </button>
  ))
}

type ChatProps = {
  userId: string
  otherId: string
  name: string | null
  messages: Message[]
  onBack: () => void
  onSend: (recipientId: string, body: string) => Promise<string | null>
  onRead: (otherId: string) => void
  onOpenProfile: (id: string) => void
}

export default function Chat({
  userId,
  otherId,
  name,
  messages,
  onBack,
  onSend,
  onRead,
  onOpenProfile,
}: ChatProps) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  const thread = messages.filter(
    (message) => message.sender_id === otherId || message.recipient_id === otherId,
  )
  const unread = thread.some((message) => message.sender_id === otherId && !message.read_at)

  useEffect(() => {
    if (unread) {
      onRead(otherId)
    }
  }, [unread, otherId, onRead])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [thread.length])

  async function send() {
    if (!text.trim()) {
      return
    }

    const sendError = await onSend(otherId, text.trim())

    if (sendError) {
      setError(sendError)
      return
    }

    setText('')
    setError('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
        <button onClick={onBack} className="row" style={{ width: 'auto', padding: '6px 10px' }}>
          ←
        </button>
        <button onClick={() => onOpenProfile(otherId)} className="row" style={{ padding: '6px' }}>
          {avatar(otherId, name, 36)}
          <div className="row-main">
            <div style={{ fontWeight: 700 }}>{name ?? '…'}</div>
            <div className="row-meta">View profile</div>
          </div>
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {thread.length === 0 && <p className="empty">Say hello 👋</p>}
        {thread.map((message, index) => {
          const mine = message.sender_id === userId
          const next = thread[index + 1]
          // Show the time once per run of messages from the same person.
          const lastOfRun = !next || next.sender_id !== message.sender_id

          return (
            <div
              key={message.id}
              style={{
                alignSelf: mine ? 'flex-end' : 'flex-start',
                maxWidth: '80%',
                textAlign: mine ? 'right' : 'left',
              }}
            >
              <div
                style={{
                  display: 'inline-block',
                  padding: '9px 13px',
                  borderRadius: mine ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  background: mine ? '#111' : '#f1f3f5',
                  color: mine ? 'white' : '#222',
                  fontSize: '14px',
                  lineHeight: 1.4,
                  textAlign: 'left',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                }}
              >
                {message.body}
              </div>
              {lastOfRun && (
                <div className="row-meta" style={{ margin: '2px 4px 6px' }}>
                  {ago(message.created_at)}
                  {mine && message.read_at && ' · Seen'}
                </div>
              )}
            </div>
          )
        })}
        <div ref={endRef} />
      </div>

      {error && (
        <p role="alert" style={noticeStyle}>
          {error}
        </p>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
        style={{
          position: 'sticky',
          bottom: '-24px',
          display: 'flex',
          gap: '8px',
          alignItems: 'flex-end',
          margin: '12px -24px -24px',
          padding: '12px 24px 24px',
          background: 'white',
          borderTop: '1px solid #eee',
        }}
      >
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
          placeholder="Write a message..."
          rows={1}
          maxLength={2000}
          style={{
            flex: 1,
            boxSizing: 'border-box',
            padding: '10px 14px',
            border: '1px solid #ddd',
            borderRadius: '20px',
            fontSize: '14px',
            fontFamily: 'inherit',
            resize: 'none',
          }}
        />
        <button
          type="submit"
          disabled={!text.trim()}
          style={{
            padding: '10px 16px',
            border: 'none',
            borderRadius: '20px',
            background: text.trim() ? '#111' : '#ccc',
            color: 'white',
            fontWeight: 600,
            cursor: text.trim() ? 'pointer' : 'not-allowed',
          }}
        >
          Send
        </button>
      </form>
    </div>
  )
}
