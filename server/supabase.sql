-- What Supabase's own services put in a database, for supabase/migrations to
-- build on when the backend runs without Docker (server/offline.mjs): its roles,
-- auth's users and the functions that read who's asking, storage's buckets and
-- objects, realtime's topic, and the extensions schema. Just the parts the
-- migrations and the app use, shaped like Supabase's.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema extensions;
create extension pgcrypto with schema extensions;
grant usage on schema public, extensions to anon, authenticated, service_role;
-- Supabase's defaults (see the note in the README about table-wide UPDATE).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  instance_id uuid,
  id uuid primary key default gen_random_uuid(),
  aud text,
  role text,
  email text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  invited_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb default '{}',
  raw_user_meta_data jsonb default '{}',
  is_anonymous boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  confirmation_token text default '',
  recovery_token text default '',
  email_change_token_new text default '',
  email_change text default ''
);

create table auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  provider_id text not null,
  provider text not null,
  identity_data jsonb not null,
  last_sign_in_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Sessions and the codes sent by "email", which offline land in the mailbox page.
create table auth.refresh_tokens (
  token text primary key,
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz default now()
);
create table auth.codes (
  email text not null,
  code text not null,
  kind text not null,
  created_at timestamptz default now()
);
create table auth.mail (
  id bigserial primary key,
  to_email text not null,
  subject text not null,
  body text not null,
  sent_at timestamptz default now()
);

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;
grant execute on all functions in schema auth to anon, authenticated, service_role;

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets,
  name text,
  owner uuid default auth.uid(),
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;

create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
create function storage.filename(name text) returns text language sql immutable as $$
  select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)]
$$;
grant execute on all functions in schema storage to anon, authenticated, service_role;

create schema realtime;
grant usage on schema realtime to anon, authenticated, service_role;

-- Private channels are allowed by policies on this table, as in Supabase.
create table realtime.messages (
  id bigserial primary key,
  topic text,
  extension text,
  event text,
  payload jsonb,
  private boolean default false,
  inserted_at timestamptz default now()
);
alter table realtime.messages enable row level security;
grant all on realtime.messages to anon, authenticated, service_role;
grant usage on all sequences in schema realtime to anon, authenticated, service_role;
create function realtime.topic() returns text language sql stable as $$ select nullif(current_setting('realtime.topic', true), '') $$;
grant execute on all functions in schema realtime to anon, authenticated, service_role;

create publication supabase_realtime;

-- What changed in the tables the app listens to, for the server to pass on:
-- every row written to one of them, in order. Filled by triggers the server
-- puts on the published tables; emptied as it sends them.
create table realtime.changes (
  id bigserial primary key,
  "schema" text not null,
  "table" text not null,
  type text not null,
  record jsonb,
  old_record jsonb,
  at timestamptz default now()
);

create function realtime.capture() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into realtime.changes ("schema", "table", type, record, old_record)
  values (tg_table_schema, tg_table_name, tg_op,
    case when tg_op <> 'DELETE' then to_jsonb(new) end,
    case when tg_op <> 'INSERT' then to_jsonb(old) end);
  return null;
end;
$$;

create schema supabase_migrations;
create table supabase_migrations.schema_migrations (version text primary key, applied_at timestamptz default now());
