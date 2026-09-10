begin;
-- Durable idempotency: deterministic Auth UUID, no passwords/tokens in payload.
create table private.user_provisioning (
  request_id uuid primary key,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  user_id uuid not null unique default gen_random_uuid(),
  payload jsonb not null,
  status text not null default 'pending' check(status in ('pending','complete')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
revoke all on private.user_provisioning from public,anon,authenticated,service_role;
alter table private.user_provisioning enable row level security;

create function private.validate_provision_payload(payload jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.validate_keys(payload,array['email','username','full_name','area_id','position_id','manager_id','status']);
  if payload->>'email' is null or length(payload->>'email')>254 or payload->>'email' not like '%@%'
    or payload->>'username' is null or payload->>'username' !~ '^[A-Za-z0-9_.-]{3,50}$'
    or payload->>'full_name' is null or length(trim(payload->>'full_name')) not between 1 and 200
    or coalesce(payload->>'status','inactive') not in ('active','inactive','blocked') then
    raise exception using errcode='22023',message='Invalid profile'; end if;
  perform private.validate_organization((payload->>'area_id')::uuid,(payload->>'position_id')::uuid,(payload->>'manager_id')::uuid);
end $$;
create function public.begin_user_provisioning(idempotency_key uuid,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job private.user_provisioning;
begin
  perform private.lock_security(); perform private.require_permission('user.create');
  perform private.validate_provision_payload(payload);
  select * into job from private.user_provisioning where request_id=idempotency_key;
  if found then
    if job.actor_id<>auth.uid() or job.payload<>payload then raise exception using errcode='23505',message='Idempotency key conflict'; end if;
  else
    if exists(select 1 from public.profiles where lower(email)=lower(payload->>'email') or lower(username)=lower(payload->>'username'))
      or exists(select 1 from private.user_provisioning where lower(user_provisioning.payload->>'email')=lower(begin_user_provisioning.payload->>'email')
        or lower(user_provisioning.payload->>'username')=lower(begin_user_provisioning.payload->>'username')) then
      raise exception using errcode='23505',message='Identity already exists or provisioning pending'; end if;
    insert into private.user_provisioning(request_id,actor_id,payload) values(idempotency_key,auth.uid(),payload) returning * into job;
    insert into public.audit_logs(user_id,action,category,entity_type,entity_id)
      values(auth.uid(),'user.provision.begin','administration','user_provisioning',idempotency_key::text);
  end if;
  return jsonb_build_object('request_id',job.request_id,'user_id',job.user_id,'status',job.status);
end $$;
create function public.finish_user_provisioning(idempotency_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job private.user_provisioning; p public.profiles; identity_email text;
begin
  perform private.lock_security(); perform private.require_permission('user.create');
  select * into job from private.user_provisioning where request_id=idempotency_key and actor_id=auth.uid();
  if not found then raise exception using errcode='P0002',message='Provisioning not found'; end if;
  if job.status='complete' then select * into p from public.profiles where id=job.user_id; return to_jsonb(p); end if;
  perform private.validate_provision_payload(job.payload);
  select email into identity_email from auth.users where id=job.user_id;
  if identity_email is null or lower(identity_email)<>lower(job.payload->>'email') then
    raise exception using errcode='23514',message='Auth identity mismatch'; end if;
  insert into public.profiles(id,email,username,full_name,area_id,position_id,manager_id,status,created_by,updated_by)
  values(job.user_id,identity_email,job.payload->>'username',job.payload->>'full_name',
    (job.payload->>'area_id')::uuid,(job.payload->>'position_id')::uuid,(job.payload->>'manager_id')::uuid,
    coalesce(job.payload->>'status','inactive'),auth.uid(),auth.uid()) returning * into p;
  update private.user_provisioning set status='complete',completed_at=now() where request_id=idempotency_key;
  return to_jsonb(p);
end $$;

-- Auth is authoritative for email. Never trust a profile email payload.
create function private.sync_auth_email() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email=new.email where id=new.id;
  end if;
  return new;
end $$;
create trigger sync_auth_email after update of email on auth.users
for each row execute function private.sync_auth_email();

alter table public.audit_logs add column auth_session_id uuid;
create unique index audit_login_session_key on public.audit_logs(auth_session_id)
where action='login.success';
-- Narrow server-only RPC. NO anon/authenticated execute, no arbitrary result/category.
-- Actual Auth session must exist and match the verified actor. Never stores JWT.
create function public.record_authentication_success(verified_user uuid,verified_session uuid,remote_ip inet)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from auth.sessions where id=verified_session and user_id=verified_user)
    or not exists(select 1 from public.profiles where id=verified_user and status='active') then
    raise exception using errcode='42501',message='Verified active session required'; end if;
  insert into public.audit_logs(user_id,action,category,entity_type,entity_id,auth_session_id,ip_address)
  values(verified_user,'login.success','authentication','auth_session',verified_session::text,verified_session,remote_ip)
  on conflict(auth_session_id) where action='login.success' do nothing;
end $$;
revoke all on function private.validate_provision_payload(jsonb),private.sync_auth_email() from public,anon,authenticated,service_role;
revoke all on function public.begin_user_provisioning(uuid,jsonb),public.finish_user_provisioning(uuid) from public,anon,service_role;
grant execute on function public.begin_user_provisioning(uuid,jsonb),public.finish_user_provisioning(uuid) to authenticated;
revoke all on function public.record_authentication_success(uuid,uuid,inet) from public,anon,authenticated;
grant execute on function public.record_authentication_success(uuid,uuid,inet) to service_role;
commit;
