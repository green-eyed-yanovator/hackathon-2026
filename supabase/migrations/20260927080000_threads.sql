-- Replies to replies, the way Reddit nests them: on pins, and on what people
-- say about a block. Whoever is answered hears about it. A comment taken back
-- while others have answered it stays as an empty "deleted" line, so the thread
-- under it isn't lost; it goes once the last answer under it does.

alter table public.replies
  add column parent_id uuid references public.replies (id) on delete cascade,
  add column deleted_at timestamptz;
create index replies_parent_idx on public.replies (parent_id);
grant insert (parent_id) on public.replies to authenticated;

alter table public.block_words
  add column parent_id uuid references public.block_words (id) on delete cascade,
  add column deleted_at timestamptz,
  add constraint block_words_names_stand_alone check (not (is_name and parent_id is not null));
create index block_words_parent_idx on public.block_words (parent_id);
grant insert (parent_id) on public.block_words to authenticated;

-- An answer belongs to the same pin (or block) as what it answers, and nobody
-- answers a line that's been taken back, or a name.
create function private.answer_in_place() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  ok boolean;
begin
  if new.parent_id is null then
    return new;
  end if;
  if tg_table_name = 'replies' then
    select r.post_id = new.post_id and r.deleted_at is null into ok from public.replies r where r.id = new.parent_id;
  else
    select w.block_id = new.block_id and w.deleted_at is null and not w.is_name into ok from public.block_words w where w.id = new.parent_id;
  end if;
  if ok is not true then
    raise exception 'That can''t be answered here' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger answer_in_place before insert on public.replies
  for each row execute function private.answer_in_place();
create trigger answer_in_place before insert on public.block_words
  for each row execute function private.answer_in_place();

-- Taking back a comment that has answers empties it instead. Not when it goes
-- because its pin or block did (then everything goes).
create function private.keep_answered() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name = 'replies' then
    if exists (select 1 from public.replies where parent_id = old.id)
       and exists (select 1 from public.posts where id = old.post_id) then
      update public.replies set content = '', author_id = null, author_name = null, deleted_at = now() where id = old.id;
      delete from public.reply_likes where reply_id = old.id;
      return null;
    end if;
  elsif exists (select 1 from public.block_words where parent_id = old.id)
        and exists (select 1 from public.city_blocks where id = old.block_id) then
    update public.block_words set body = '', author_id = null, deleted_at = now() where id = old.id;
    return null;
  end if;
  return old;
end;
$$;
create trigger keep_answered before delete on public.replies
  for each row execute function private.keep_answered();
create trigger keep_answered before delete on public.block_words
  for each row execute function private.keep_answered();

-- An emptied comment whose last answer went, goes too.
create function private.drop_empty_parent() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.parent_id is null then
    return null;
  end if;
  if tg_table_name = 'replies' then
    delete from public.replies r where r.id = old.parent_id and r.deleted_at is not null
      and not exists (select 1 from public.replies c where c.parent_id = r.id);
  else
    delete from public.block_words w where w.id = old.parent_id and w.deleted_at is not null
      and not exists (select 1 from public.block_words c where c.parent_id = w.id);
  end if;
  return null;
end;
$$;
create trigger drop_empty_parent after delete on public.replies
  for each row execute function private.drop_empty_parent();
create trigger drop_empty_parent after delete on public.block_words
  for each row execute function private.drop_empty_parent();

-- The emptied line keeps nobody's name: the check on names and length makes
-- room for it.
alter table public.block_words drop constraint block_words_body_check;
alter table public.block_words add constraint block_words_body_check
  check (deleted_at is not null or char_length(btrim(body)) between 1 and 200);

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('reply', 'saved_reply', 'thread_reply', 'save', 'interest', 'resolved',
    'friend_request', 'friend_accept', 'friend_post', 'mention', 'turf', 'comment_reply', 'word_reply'));

-- Replies: whoever was answered hears it as that, and not twice.
create or replace function public.notify_reply() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  post public.posts;
  answered uuid;
begin
  select * into post from public.posts where id = new.post_id;
  select author_id into answered from public.replies where id = new.parent_id;

  perform private.notify(answered, 'comment_reply', new.author_id, post, new.content);

  if post.author_id is distinct from answered then
    perform private.notify(post.author_id, 'reply', new.author_id, post, new.content);
  end if;

  perform private.notify(saved.user_id, 'saved_reply', new.author_id, post, new.content)
  from public.saved_posts saved
  where saved.post_id = post.id and saved.user_id is distinct from post.author_id and saved.user_id is distinct from answered;

  perform private.notify(thread.author_id, 'thread_reply', new.author_id, post, new.content)
  from (select distinct author_id from public.replies where post_id = post.id and id <> new.id) thread
  where thread.author_id is distinct from post.author_id
    and thread.author_id is distinct from answered
    and not exists (
      select 1 from public.saved_posts saved
      where saved.post_id = post.id and saved.user_id = thread.author_id
    );

  return new;
end;
$$;

-- Lines on a block: the one answered hears it.
create function private.notify_word_reply() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  answered uuid;
begin
  select author_id into answered from public.block_words where id = new.parent_id;
  insert into public.notifications (user_id, kind, actor_id, actor_name, block_id, post_title, preview)
  select answered, 'word_reply', new.author_id, (select display_name from public.profiles where id = new.author_id),
    new.block_id, private.block_name(new.block_id), left(new.body, 140)
  where answered is not null
    and answered is distinct from new.author_id
    and not private.has_blocked(answered, new.author_id)
    and not exists (
      select 1 from public.notification_settings settings
      where settings.user_id = answered and 'word_reply' = any (settings.muted_kinds)
    );
  return new;
end;
$$;
create trigger notify_word_reply after insert on public.block_words
  for each row when (new.parent_id is not null) execute function private.notify_word_reply();
