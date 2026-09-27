-- "Typing…" goes over a private realtime channel named typing:<one id>:<other id>;
-- only those two people may listen or send on it.

create policy "the two people in a chat hear its typing" on realtime.messages
  for select to authenticated
  using (
    realtime.topic() like 'typing:%'
    and (select auth.uid())::text in (split_part(realtime.topic(), ':', 2), split_part(realtime.topic(), ':', 3))
  );

create policy "the two people in a chat send its typing" on realtime.messages
  for insert to authenticated
  with check (
    realtime.topic() like 'typing:%'
    and (select auth.uid())::text in (split_part(realtime.topic(), ':', 2), split_part(realtime.topic(), ':', 3))
  );
