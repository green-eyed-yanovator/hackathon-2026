-- Realtime sends DELETE events to every subscriber, whatever the row security,
-- with the row's key: for presence and locations that key is a person. So those
-- rows are never deleted any more, only updated (updates respect row security).
-- Leaving sets seen_at far in the past; stopping sharing clears the position.

alter table public.locations add column shared boolean not null default true;
grant insert (shared), update (shared) on public.locations to authenticated;
