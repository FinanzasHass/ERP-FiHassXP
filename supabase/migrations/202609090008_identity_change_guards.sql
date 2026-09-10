begin;
create table private.email_changes (
  user_id uuid primary key references public.profiles(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  new_email text not null,
  created_at timestamptz not null default now()
);
alter table private.email_changes enable row level security;
revoke all on private.email_changes from public,anon,authenticated,service_role;
create function public.prepare_email_change(target_user uuid,new_email text) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.lock_security(); perform private.require_permission('user.edit'); perform private.assert_other(target_user);
  if not exists(select 1 from public.profiles where id=target_user) then raise exception using errcode='P0002',message='Profile not found'; end if;
  if new_email is null or length(new_email)>254 or new_email not like '%@%' then raise exception using errcode='22023',message='Invalid email'; end if;
  if exists(select 1 from public.profiles where id<>target_user and lower(email)=lower(new_email)) then
    raise exception using errcode='23505',message='Email in use'; end if;
  insert into private.email_changes(user_id,actor_id,new_email) values(target_user,auth.uid(),lower(new_email))
  on conflict(user_id) do update set actor_id=excluded.actor_id,new_email=excluded.new_email,created_at=now();
end $$;
create or replace function private.sync_auth_email() returns trigger
language plpgsql security definer set search_path='' as $$
declare change private.email_changes;
begin
  if new.email is distinct from old.email and exists(select 1 from public.profiles where id=new.id) then
    perform pg_advisory_xact_lock(609090005);
    select * into change from private.email_changes where user_id=new.id and lower(new_email)=lower(new.email)
      and created_at>now()-interval '10 minutes' for update;
    if not found or not private.resolve_permission(change.actor_id,'user.edit',null) then
      raise exception using errcode='42501',message='Authorized email change required'; end if;
    update public.profiles set email=new.email,updated_by=change.actor_id where id=new.id;
    insert into public.audit_logs(user_id,action,category,entity_type,entity_id,old_values,new_values)
      values(change.actor_id,'user.email.updated','administration','profiles',new.id::text,
        jsonb_build_object('email',old.email),jsonb_build_object('email',new.email));
    delete from private.email_changes where user_id=new.id;
  end if;
  return new;
end $$;
revoke all on function public.prepare_email_change(uuid,text) from public,anon,service_role;
grant execute on function public.prepare_email_change(uuid,text) to authenticated;

-- Reading inactive profiles is denied by RLS; this narrow own-session boolean lets
-- the HTTP layer also reject revoked sessions without disclosing Auth tables.
create function public.session_is_active() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.sessions
    where user_id=auth.uid() and id=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid);
$$;
revoke all on function public.session_is_active() from public,anon,service_role;
grant execute on function public.session_is_active() to authenticated;
create or replace function private.is_active() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles where id=auth.uid() and status='active')
    and public.session_is_active();
$$;
create or replace function private.has_permission(permission_code text,company_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select public.session_is_active() and private.resolve_permission(auth.uid(),permission_code,company_id);
$$;
commit;
