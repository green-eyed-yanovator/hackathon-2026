import { useEffect, useEffectEvent, useState } from 'react'

import { supabase } from './lib/supabase'
import type { Message, NotificationRow } from './types'
import { newestFirst } from './ui'

type Inbox = {
  owner: string | null
  notifications: NotificationRow[]
  messages: Message[]
  // True when the last page came back full, so older notifications may exist.
  hasOlder: boolean
  mutedKinds: string[]
}

const empty: Inbox = { owner: null, notifications: [], messages: [], hasOlder: false, mutedKinds: [] }

const PAGE = 50

// Something new arrived for the signed-in user, e.g. to raise a desktop alert.
export type Incoming =
  | { type: 'notification'; notification: NotificationRow }
  | { type: 'message'; message: Message }

// Adds a realtime row once, keeping the list oldest-first even when rows
// arrive late or out of order.
function addOnce<T extends { id: string; created_at: string }>(rows: T[], row: T) {
  if (rows.some((existing) => existing.id === row.id)) {
    return rows
  }

  return [...rows, row].sort((a, b) => newestFirst(b.created_at, a.created_at))
}

// The signed-in user's notifications and messages, kept live over realtime.
// RLS makes both tables return only the caller's own rows.
export function useInbox(userId: string | null, onIncoming?: (incoming: Incoming) => void) {
  const [inbox, setInbox] = useState<Inbox>(empty)
  const announce = useEffectEvent((incoming: Incoming) => onIncoming?.(incoming))

  useEffect(() => {
    if (!userId) {
      return
    }

    let ignore = false

    // Newest first so the limit keeps the most recent, then oldest-first for display.
    Promise.all([
      supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(PAGE),
      supabase
        .from('messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500),
      supabase.from('notification_settings').select('muted_kinds').maybeSingle(),
    ]).then(([notifications, messages, settings]) => {
      if (ignore) {
        return
      }

      if (notifications.error || messages.error) {
        console.error('Failed to load inbox:', notifications.error ?? messages.error)
        return
      }

      setInbox({
        owner: userId,
        notifications: notifications.data.reverse(),
        messages: messages.data.reverse(),
        hasOlder: notifications.data.length === PAGE,
        mutedKinds: settings.data?.muted_kinds ?? [],
      })
    })

    const channel = supabase
      .channel(`inbox-${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          const notification = payload.new as NotificationRow
          setInbox((current) => ({
            ...current,
            notifications: addOnce(current.notifications, notification),
          }))
          announce({ type: 'notification', notification })
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const message = payload.new as Message
          setInbox((current) => ({
            ...current,
            messages: addOnce(current.messages, message),
          }))
          if (message.sender_id !== userId) {
            announce({ type: 'message', message })
          }
        },
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

  async function loadOlder() {
    const oldest = current.notifications[0]

    if (!oldest) {
      return
    }

    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .lt('created_at', oldest.created_at)
      .order('created_at', { ascending: false })
      .limit(PAGE)

    if (error) {
      console.error('Failed to load older notifications:', error)
      return
    }

    setInbox((state) => ({
      ...state,
      notifications: [...data.reverse(), ...state.notifications],
      hasOlder: data.length === PAGE,
    }))
  }

  async function setMutedKinds(mutedKinds: string[]) {
    setInbox((state) => ({ ...state, mutedKinds }))

    const { error } = await supabase
      .from('notification_settings')
      .upsert({ muted_kinds: mutedKinds }, { onConflict: 'user_id' })

    if (error) {
      console.error('Failed to save notification settings:', error)
    }
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
    hasOlder: current.hasOlder,
    mutedKinds: current.mutedKinds,
    loadOlder,
    setMutedKinds,
    unreadNotifications,
    unreadMessages,
    markNotificationsRead,
    markConversationRead,
    sendMessage,
  }
}

export type InboxApi = ReturnType<typeof useInbox>

// One entry per neighbour you've messaged, latest conversation first.
export function conversationsOf(userId: string, messages: Message[]) {
  const byOther = new Map<string, { other: string; last: Message; unread: number }>()

  for (const message of messages) {
    const other = message.sender_id === userId ? message.recipient_id : message.sender_id
    const unread = message.recipient_id === userId && !message.read_at ? 1 : 0

    byOther.set(other, { other, last: message, unread: (byOther.get(other)?.unread ?? 0) + unread })
  }

  return [...byOther.values()].reverse()
}

export function describeNotification(notification: NotificationRow) {
  const title = `“${notification.post_title ?? 'a pin'}”`

  switch (notification.kind) {
    case 'reply':
      return { icon: '💬', text: `replied to your pin ${title}` }
    case 'saved_reply':
      return { icon: '🔔', text: `replied to ${title}, a pin you saved` }
    case 'thread_reply':
      return { icon: '💭', text: `also replied to ${title}` }
    case 'resolved':
      return { icon: '✅', text: `marked ${title} as resolved` }
    case 'save':
      return { icon: '⭐', text: `saved your pin ${title}` }
    case 'interest':
      return { icon: '👍', text: `is interested in your pin ${title}` }
  }
}

// Display names by user id, fetched on first use and shared for the session.
const nameCache: Record<string, string> = {}

export function useNames(ids: string[]) {
  const [names, setNames] = useState<Record<string, string>>(() => ({ ...nameCache }))

  const missing = [...new Set(ids)].filter((id) => !(id in names)).sort().join(',')

  useEffect(() => {
    if (!missing) {
      return
    }

    supabase
      .from('profiles')
      .select('id, display_name')
      .in('id', missing.split(','))
      .then(({ data }) => {
        for (const profile of data ?? []) nameCache[profile.id] = profile.display_name
        setNames({ ...nameCache })
      })
  }, [missing])

  return names
}
