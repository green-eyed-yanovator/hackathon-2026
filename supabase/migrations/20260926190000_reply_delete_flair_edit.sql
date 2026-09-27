-- People can take back their own replies, and change what kind of pin theirs is.

create policy "authors delete their replies" on public.replies
  for delete to authenticated using (author_id = (select auth.uid()));
grant delete on public.replies to authenticated;

grant update (flair) on public.posts to authenticated;
