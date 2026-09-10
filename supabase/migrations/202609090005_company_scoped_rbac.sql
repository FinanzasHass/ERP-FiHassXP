begin;
alter table public.user_companies add column active boolean not null default true;
alter table public.user_roles drop constraint user_roles_pkey;
alter table public.user_roles add column id uuid not null default gen_random_uuid() primary key,
  add column company_id uuid references public.companies(id) on delete restrict,
  add constraint user_roles_scope_key unique nulls not distinct(user_id,role_id,company_id),
  add constraint user_roles_membership_fk foreign key(user_id,company_id)
    references public.user_companies(user_id,company_id) on delete restrict;
create index user_roles_company_idx on public.user_roles(company_id,user_id);
alter table public.user_permission_overrides drop constraint user_permission_overrides_pkey;
alter table public.user_permission_overrides add column id uuid not null default gen_random_uuid() primary key,
  add column company_id uuid references public.companies(id) on delete restrict,
  add constraint overrides_scope_key unique nulls not distinct(user_id,permission_id,company_id),
  add constraint overrides_membership_fk foreign key(user_id,company_id)
    references public.user_companies(user_id,company_id) on delete restrict;
create index overrides_company_idx on public.user_permission_overrides(company_id,user_id);

alter table public.permissions add column requires_company boolean not null default true;
update public.permissions set requires_company=false
where module='administracion' or resource in ('dashboard','area');
-- Never guess which companies legacy financial assignments were meant for.
do $$ begin
  if exists(select 1 from public.user_roles ur join public.role_permissions rp on rp.role_id=ur.role_id
      join public.permissions p on p.id=rp.permission_id where p.requires_company)
    or exists(select 1 from public.user_permission_overrides o join public.permissions p on p.id=o.permission_id
      where p.requires_company and o.effect='allow') then
    raise exception 'Legacy financial assignments require an explicit company migration before 005';
  end if;
end $$;
create or replace function private.protect_permission_contract() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'Permission catalog entries must be retired, not deleted'; end if;
  if (new.id,new.code,new.resource,new.action,new.scope,new.requires_company) is distinct from
     (old.id,old.code,old.resource,old.action,old.scope,old.requires_company) then
    raise exception 'Permission contract is immutable';
  end if;
  return new;
end $$;

-- Internal evaluator is NEVER executable by API roles. A caller cannot choose identity.
create function private.resolve_permission(actor uuid, permission_code text, target_company uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles where id=actor and status='active')
  and (target_company is null or exists (
    select 1 from public.user_companies uc join public.companies c on c.id=uc.company_id
    where uc.user_id=actor and uc.company_id=target_company and uc.active and c.active))
  and exists (
    select 1 from public.permissions p where p.code=permission_code and p.active
      and (not p.requires_company or target_company is not null)
      and not exists(select 1 from public.user_permission_overrides o
        where o.user_id=actor and o.permission_id=p.id and o.effect='deny'
          and (o.company_id is null or o.company_id=target_company))
      and (exists(select 1 from public.user_permission_overrides o
        where o.user_id=actor and o.permission_id=p.id and o.effect='allow'
          and (o.company_id is null or o.company_id=target_company))
        or exists(select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id and r.active
          join public.role_permissions rp on rp.role_id=r.id
          where ur.user_id=actor and rp.permission_id=p.id
            and (ur.company_id is null or ur.company_id=target_company)))
  );
$$;
create function private.has_permission(permission_code text, company_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.resolve_permission(auth.uid(),permission_code,company_id);
$$;
create or replace function private.has_permission(permission_code text)
returns boolean language sql stable security definer set search_path='' as $$
  select private.has_permission(permission_code,null);
$$;
create function public.has_permission(permission_code text, company_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select private.has_permission(permission_code,company_id);
$$;
create or replace function private.has_company_access(target_company uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.is_active() and exists(select 1 from public.user_companies uc
    join public.companies c on c.id=uc.company_id and c.active
    where uc.user_id=auth.uid() and uc.company_id=target_company and uc.active);
$$;

create function private.require_permission(code text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not private.has_permission(code) then raise exception using errcode='42501', message='Access denied'; end if;
end $$;
create function private.lock_security() returns void
language plpgsql security definer set search_path='' as $$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode='40001',message='READ COMMITTED required';
  end if;
  perform pg_advisory_xact_lock(609090005);
  if not private.is_active() then raise exception using errcode='42501',message='Active profile required'; end if;
end $$;
create function private.assert_other(target_user uuid) returns void
language plpgsql set search_path='' as $$
begin
  if target_user=auth.uid() then raise exception using errcode='42501',message='Self security changes forbidden'; end if;
end $$;
create function private.assert_admin_remains() returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id
    where r.code='system_administrator' and ur.company_id is null
      and private.resolve_permission(ur.user_id,'user.edit',null)
      and private.resolve_permission(ur.user_id,'user.disable',null)
      and private.resolve_permission(ur.user_id,'role.assign',null)
      and private.resolve_permission(ur.user_id,'permission.assign',null)) then
    raise exception using errcode='23514',message='At least one effective system administrator required';
  end if;
end $$;
create function private.assert_membership(target_user uuid,target_company uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if target_company is not null and not exists(select 1 from public.user_companies uc
    join public.companies c on c.id=uc.company_id and c.active
    where uc.user_id=target_user and uc.company_id=target_company and uc.active) then
    raise exception using errcode='23514',message='Active company membership required';
  end if;
end $$;
create function private.validate_assignment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_membership(new.user_id,new.company_id);
  return new;
end $$;
create trigger validate_assignment before insert or update on public.user_roles
for each row execute function private.validate_assignment();
create trigger validate_assignment before insert or update on public.user_permission_overrides
for each row execute function private.validate_assignment();

-- Metadata catalog only; no mutation of system designation, even through direct RPC.
create or replace function private.protect_system_role() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then
    if old.is_system then raise exception 'System role cannot be deleted'; end if;
    return old;
  end if;
  if new.is_system is distinct from old.is_system or (old.is_system and (not new.active or new.code<>old.code)) then
    raise exception using errcode='42501',message='System role designation and code protected';
  end if;
  return new;
end $$;

create function public.effective_permissions(company_id uuid default null)
returns table(code text, scope text, requires_company boolean)
language sql stable security definer set search_path='' as $$
  select p.code,p.scope,p.requires_company from public.permissions p
  where private.has_permission(p.code,company_id) order by p.code;
$$;
drop policy audit_read on public.audit_logs;
create policy audit_read on public.audit_logs for select to authenticated using (
  (category<>'finance' and (select private.has_permission('audit.view')))
  or (category='finance' and private.has_permission('audit.finance_view',company_id)));

revoke all on function private.resolve_permission(uuid,text,uuid),private.has_permission(text,uuid),
  private.require_permission(text),private.lock_security(),private.assert_other(uuid),
  private.assert_admin_remains(),private.assert_membership(uuid,uuid),private.validate_assignment()
  from public,anon,authenticated,service_role;
grant execute on function private.has_permission(text,uuid) to authenticated;
revoke all on function public.has_permission(text,uuid),public.effective_permissions(uuid) from public,anon,service_role;
grant execute on function public.has_permission(text,uuid),public.effective_permissions(uuid) to authenticated;
commit;
