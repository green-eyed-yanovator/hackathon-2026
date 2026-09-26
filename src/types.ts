export type Post = {
  id: string
  title: string
  description: string
  latitude: number
  longitude: number
  created_at: string
  author_id: string | null
  author_name: string | null
  edited_at: string | null
  resolved_at: string | null
}

export type Reply = {
  id: string
  post_id: string
  content: string
  created_at: string
  author_id: string | null
  author_name: string | null
}

export type Profile = {
  id: string
  display_name: string
  neighbourhood: string | null
  bio: string | null
  created_at: string
}

export type AuthMode =
  | 'signup'
  | 'login'
  | 'code-login'
  | 'reset'
  | 'new-password'

export type NotificationRow = {
  id: string
  kind: 'reply' | 'saved_reply' | 'thread_reply' | 'save' | 'interest' | 'resolved'
  actor_id: string | null
  actor_name: string | null
  post_id: string | null
  post_title: string | null
  preview: string | null
  created_at: string
  read_at: string | null
}

export type Message = {
  id: string
  sender_id: string
  recipient_id: string
  body: string
  created_at: string
  read_at: string | null
}

export type Interest = {
  user_id: string
  post_id: string
  created_at: string
}

export type Saved = {
  post_id: string
  created_at: string
}

export type Revision = {
  id: string
  title: string
  description: string
  replaced_at: string
}

// What the map is narrowed to, set from the legend or a profile's stats.
export type MapFilter =
  | { kind: 'mine' | 'saved' | 'replied' | 'others' | 'new' | 'past' }
  | { kind: 'author'; authorId: string; name: string }
