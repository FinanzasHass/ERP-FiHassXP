-- Execute as database owner after creating the identity in Supabase Auth.
-- Replace only the three placeholders. No passwords belong in SQL.
-- Atomic and intentionally restricted to an uninitialized administrator role.
begin;
do $$
declare
  initial_id uuid := 'REPLACE_WITH_AUTH_USER_UUID';
  initial_username text := 'REPLACE_WITH_USERNAME';
  initial_name text := 'REPLACE_WITH_FULL_NAME';
  initial_email text;
  admin_role uuid;
begin
  perform pg_advisory_xact_lock(609090001);
  select id into strict admin_role from public.roles where code = 'system_administrator';
  if exists (select 1 from public.user_roles where role_id = admin_role) then
    raise exception 'Bootstrap already completed; use the administrative recovery procedure';
  end if;
  select email into strict initial_email from auth.users where id = initial_id;
  if initial_email is null then raise exception 'An email identity is required'; end if;
  insert into public.profiles(id,email,username,full_name,status)
  values(initial_id,initial_email,initial_username,initial_name,'active')
  on conflict(id) do update set email = excluded.email, username = excluded.username,
    full_name = excluded.full_name,status = 'active';
  insert into public.user_roles(user_id,role_id) values(initial_id,admin_role);
end;
$$;
commit;
