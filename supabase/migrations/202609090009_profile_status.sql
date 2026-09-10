begin;
create function public.admin_set_profile_status(target_user uuid,new_status text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.profiles;
begin
  perform private.lock_security(); perform private.require_permission('user.disable'); perform private.assert_other(target_user);
  if new_status is null or new_status not in ('active','inactive','blocked') then
    raise exception using errcode='22023',message='Invalid status'; end if;
  update public.profiles set status=new_status,updated_by=auth.uid() where id=target_user returning * into p;
  if not found then raise exception using errcode='P0002',message='Profile not found'; end if;
  perform private.assert_admin_remains(); return to_jsonb(p);
end $$;
revoke all on function public.admin_set_profile_status(uuid,text) from public,anon,service_role;
grant execute on function public.admin_set_profile_status(uuid,text) to authenticated;
commit;
