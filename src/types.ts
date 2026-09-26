export type Post = {
  id: string
  title: string
  description: string
  latitude: number
  longitude: number
  created_at: string
  author_id: string | null
  author_name: string | null
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
