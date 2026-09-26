-- "@Maya Chen" in a reply tells Maya, unless she'd hear about the reply anyway.

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('reply', 'saved_reply', 'thread_reply', 'save', 'interest', 'resolved',
    'friend_request', 'friend_accept', 'friend_post', 'mention'));

create function public.notify_mentions() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  post public.posts;
begin
  select * into post from public.posts where id = new.post_id;

  perform public.notify(person.id, 'mention', new.author_id, post, new.content)
  from public.profiles person
  where position(lower('@' || person.display_name) in lower(new.content)) > 0
    and person.id is distinct from post.author_id -- the author already hears about every reply
    and not exists (select 1 from public.replies r where r.post_id = post.id and r.author_id = person.id and r.id <> new.id)
    and not exists (select 1 from public.saved_posts s where s.post_id = post.id and s.user_id = person.id);

  return new;
end;
$$;

create trigger notify_mentions
  after insert on public.replies
  for each row execute function public.notify_mentions();
