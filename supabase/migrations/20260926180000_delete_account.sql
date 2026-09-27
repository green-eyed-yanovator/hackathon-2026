-- Deleting your own account. Everything you made goes with it (the foreign
-- keys cascade from auth.users); nobody can delete anyone else.

create function public.delete_my_account() returns void
language sql security definer set search_path = ''
as $$
  delete from auth.users where id = (select auth.uid())
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
