-- Lore: what a place remembers. A kind of pin of its own, with the year it
-- happened, so the map can be looked at as it was.

alter table public.posts drop constraint posts_flair_check;
alter table public.posts add constraint posts_flair_check
  check (flair in ('general', 'food', 'music', 'sports', 'event', 'lost', 'lore'));

alter table public.posts add column year smallint check (year between 1000 and 2100);
grant insert (year), update (year) on public.posts to authenticated;
