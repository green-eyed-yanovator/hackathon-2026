import { useEffect, useState } from 'react'

import { supabase } from './lib/supabase'
import type { Message, NotificationRow } from './types'

type Inbox = {
  owner: string | null
  notifications: NotificationRow[]
  messages: Message[]
}

const empty: Inbox = { owner: null, notifications: [], messages: [] }

function addOnce<T extends { id: string }>(rows: T[], row: T) {
  return rows.some((existing) => existing.id === row.id) ? rows : [...rows, row]
}

// The signed-in user's notifications and messages, kept live over realtime.
// RLS makes both tables return only the caller's own rows.
export function useInbox(userId: string | null) {
  const [inbox, setInbox] = useState<Inbox>(empty)

  useEffect(() => {
    if (!userId) {
      return
    }

    let ignore = false

    Promise.all([
      supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: true })
        .limit(100),
      supabase
        .from('messages')
        .select('*')
        .order('created_at', { ascending: true })
        .limit(500),
    ]).then(([notifications, messages]) => {
      if (ignore) {
        return
      }

      if (notifications.error || messages.error) {
        console.error('Failed to load inbox:', notifications.error ?? messages.error)
        return
      }

      setInbox({ owner: userId, notifications: notifications.data, messages: messages.data })
    })

    const channel = supabase
      .channel(`inbox-${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) =>
          setInbox((current) => ({
            ...current,
            notifications: addOnce(current.notifications, payload.new as NotificationRow),
          })),
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) =>
          setInbox((current) => ({
            ...current,
            messages: addOnce(current.messages, payload.new as Message),
          })),
      )
      .subscribe()

    return () => {
      ignore = true
      supabase.removeChannel(channel)
    }
  }, [userId])

  const current = inbox.owner === userId ? inbox : empty
  const now = () => new Date().toISOString()

  async function markNotificationsRead(ids: string[]) {
    const unread = current.notifications
      .filter((notification) => ids.includes(notification.id) && !notification.read_at)
      .map((notification) => notification.id)

    if (unread.length === 0) {
      return
    }

    const readAt = now()

    setInbox((state) => ({
      ...state,
      notifications: state.notifications.map((notification) =>
        unread.includes(notification.id) ? { ...notification, read_at: readAt } : notification,
      ),
    }))

    await supabase.from('notifications').update({ read_at: readAt }).in('id', unread)
  }

  async function markConversationRead(otherId: string) {
    const unread = current.messages.some(
      (message) => message.sender_id === otherId && message.recipient_id === userId && !message.read_at,
    )

    if (!unread) {
      return
    }

    const readAt = now()

    setInbox((state) => ({
      ...state,
      messages: state.messages.map((message) =>
        message.sender_id === otherId && !message.read_at ? { ...message, read_at: readAt } : message,
      ),
    }))

    await supabase
      .from('messages')
      .update({ read_at: readAt })
      .eq('sender_id', otherId)
      .eq('recipient_id', userId!)
      .is('read_at', null)
  }

  async function sendMessage(recipientId: string, body: string) {
    const { data, error } = await supabase
      .from('messages')
      .insert({ recipient_id: recipientId, body })
      .select()
      .single()

    if (error) {
      return error.message
    }

    setInbox((state) => ({ ...state, messages: addOnce(state.messages, data) }))
    return null
  }

  const unreadNotifications = current.notifications.filter((notification) => !notification.read_at).length
  const unreadMessages = current.messages.filter(
    (message) => message.recipient_id === userId && !message.read_at,
  ).length

  return {
    notifications: current.notifications,
    messages: current.messages,
    unreadNotifications,
    unreadMessages,
    markNotificationsRead,
    markConversationRead,
    sendMessage,
  }
}

export type InboxApi = ReturnType<typeof useInbox>
