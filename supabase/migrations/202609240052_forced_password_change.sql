begin;

alter table public.profiles
  add column must_change_password boolean not null default false;

-- This operation records only the security state. Password material remains
-- exclusively in Supabase Auth and never enters PostgreSQL or audit JSON.
create function public.admin_require_temporary_password(target_user uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.lock_security();
  perform private.require_permission('user.edit');
  perform private.assert_other(target_user);
  if not exists(select 1 from public.profiles where id=target_user) then
    raise exception using errcode='P0002',message='Profile not found';
  end if;
  update public.profiles
     set must_change_password=true,updated_by=auth.uid()
   where id=target_user;
  -- Revoke every existing session before the Auth Admin password mutation.
  delete from auth.sessions where user_id=target_user;
  insert into public.audit_logs(user_id,action,category,entity_type,entity_id,new_values)
  values(auth.uid(),'user.temporary_password.required','security','profiles',target_user::text,
    jsonb_build_object('must_change_password',true,'sessions_revoked',true));
end $$;

create function public.complete_forced_password_change() returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.lock_security();
  if auth.uid() is null or not exists(
    select 1 from public.profiles where id=auth.uid() and status='active'
  ) then raise exception using errcode='42501',message='Active profile required'; end if;
  update public.profiles
     set must_change_password=false,updated_by=auth.uid()
   where id=auth.uid() and must_change_password;
  if found then
    insert into public.audit_logs(user_id,action,category,entity_type,entity_id,new_values)
    values(auth.uid(),'user.password.changed','security','profiles',auth.uid()::text,
      jsonb_build_object('must_change_password',false));
  end if;
end $$;

revoke all on function public.admin_require_temporary_password(uuid) from public,anon,service_role;
revoke all on function public.complete_forced_password_change() from public,anon,service_role;
grant execute on function public.admin_require_temporary_password(uuid) to authenticated;
grant execute on function public.complete_forced_password_change() to authenticated;

commit;
