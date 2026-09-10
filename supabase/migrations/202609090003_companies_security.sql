-- Incremental revision: preserve migrations already applied in other environments.
begin;

alter table public.user_roles
  add column assigned_by uuid references public.profiles(id) on delete restrict,
  add column assigned_at timestamptz not null default now();
update public.user_roles set assigned_at = created_at;
create index user_roles_assigned_by_idx on public.user_roles(assigned_by);
alter table public.user_permission_overrides
  add column assigned_by uuid references public.profiles(id) on delete restrict,
  add column assigned_at timestamptz not null default now(),
  add column reason text check (reason is null or length(trim(reason)) between 1 and 2000);
update public.user_permission_overrides set assigned_at = created_at;
-- Existing composite PK already enforces UNIQUE(user_id,permission_id).
create index overrides_assigned_by_idx on public.user_permission_overrides(assigned_by);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null check (length(trim(legal_name)) between 1 and 200),
  code text not null check (code ~ '^[A-Za-z0-9_-]{2,50}$'),
  tax_id text not null check (length(trim(tax_id)) between 1 and 30),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(country_code,tax_id)
);
create unique index companies_code_key on public.companies(lower(code));
create table public.user_companies (
  user_id uuid not null references public.profiles(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  assigned_by uuid references public.profiles(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  primary key(user_id,company_id)
);
create index user_companies_company_idx on public.user_companies(company_id);
create index user_companies_assigned_by_idx on public.user_companies(assigned_by);

-- Scope describes a resource predicate; it is not a grant by itself.
alter table public.permissions add column scope text not null default 'none'
  check (scope in ('none','own','area','company','all_authorized'));
update public.permissions set scope = case
  when action like '%\_own' escape '\' then 'own'
  when action like '%\_all' escape '\' then 'all_authorized'
  else 'none' end;

create or replace function private.has_permission(permission_code text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_active() and exists (
    select 1 from public.permissions p
    where p.code = permission_code and p.active
      and not exists (select 1 from public.user_permission_overrides o
        where o.user_id = auth.uid() and o.permission_id = p.id and o.effect = 'deny')
      and (exists (select 1 from public.user_permission_overrides o
        where o.user_id = auth.uid() and o.permission_id = p.id and o.effect = 'allow')
        or exists (select 1 from public.user_roles ur
          join public.roles r on r.id = ur.role_id and r.active
          join public.role_permissions rp on rp.role_id = r.id
          where ur.user_id = auth.uid() and rp.permission_id = p.id))
  );
$$;
-- False entries were absence of grant, not denials. Remove before dropping column.
delete from public.role_permissions where not granted;
alter table public.role_permissions drop column granted;

create function private.has_company_access(target_company uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_active() and exists (
    select 1 from public.user_companies uc
    join public.companies c on c.id = uc.company_id and c.active
    where uc.user_id = auth.uid() and uc.company_id = target_company
  );
$$;
create function public.has_company_access(target_company uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select private.has_company_access(target_company);
$$;

alter table public.audit_logs add column category text not null default 'system'
  check (category in ('authentication','security','administration','finance','system'));
alter table public.audit_logs add column company_id uuid references public.companies(id) on delete restrict;
create index audit_logs_category_idx on public.audit_logs(category,created_at desc);
create index audit_logs_company_idx on public.audit_logs(company_id,created_at desc);
update public.audit_logs set category = case
  when entity_type in ('roles','user_roles','role_permissions','user_permission_overrides') then 'security'
  when entity_type = 'permissions' then 'system'
  else 'administration' end;

create or replace function private.audit_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  before_row jsonb; after_row jsonb; row_data jsonb;
  event_action text; event_category text;
begin
  if tg_op <> 'INSERT' then before_row := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then after_row := to_jsonb(new); end if;
  row_data := coalesce(after_row,before_row);
  event_action := lower(tg_op);
  event_category := case
    when tg_table_name in ('roles','user_roles','role_permissions','user_permission_overrides','user_companies') then 'security'
    when tg_table_name = 'permissions' then 'system' else 'administration' end;
  if tg_table_name = 'profiles' and tg_op = 'UPDATE'
    and before_row->>'status' = 'active' and after_row->>'status' <> 'active' then
    event_action := 'disable';
  elsif tg_table_name in ('user_roles','user_companies') then
    event_action := case when tg_table_name='user_roles' then 'role.' else 'company.' end ||
      case when tg_op='INSERT' then 'assign' when tg_op='DELETE' then 'remove' else 'change' end;
  elsif tg_table_name in ('role_permissions','user_permission_overrides','permissions') then
    event_action := 'permission.' || lower(tg_op);
  end if;
  insert into public.audit_logs(user_id,action,category,entity_type,entity_id,old_values,new_values,company_id)
  values(auth.uid(),event_action,event_category,tg_table_name,
    coalesce(row_data->>'id',concat_ws(':',row_data->>'user_id',row_data->>'role_id',row_data->>'permission_id',row_data->>'company_id')),
    before_row,after_row,
    case when tg_table_name='companies' then (row_data->>'id')::uuid
      when tg_table_name='user_companies' then (row_data->>'company_id')::uuid end);
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
create trigger touch_updated_at before update on public.companies
for each row execute function private.touch_updated_at();
create trigger audit_change after insert or update or delete on public.companies
for each row execute function private.audit_change();
create trigger audit_change after insert or update or delete on public.user_companies
for each row execute function private.audit_change();

-- Catalog keys have become an application contract. Retire codes, never recycle.
create function private.protect_permission_contract() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' then raise exception 'Permission catalog entries must be retired, not deleted'; end if;
  if (new.id,new.code,new.resource,new.action,new.scope) is distinct from
     (old.id,old.code,old.resource,old.action,old.scope) then
    raise exception 'Permission contract is immutable';
  end if;
  return new;
end;
$$;
create trigger protect_permission_contract before update or delete on public.permissions
for each row execute function private.protect_permission_contract();

-- Serialize hierarchy writes before row changes. READ COMMITTED is required so
-- the check after waiting observes preceding commits; reject stale-snapshot modes.
create function private.lock_hierarchy() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Hierarchy changes require READ COMMITTED';
  end if;
  perform pg_advisory_xact_lock(609090003);
  return null;
end;
$$;
create function private.hierarchy_has_cycle() returns boolean
language sql volatile security definer set search_path = '' as $$
  with recursive chain as (
    select id,manager_id,array[id] as path,false as cycle from public.profiles
    union all
    select p.id,p.manager_id,c.path || p.id,p.id = any(c.path)
    from chain c join public.profiles p on p.id=c.manager_id where not c.cycle
  ) select exists(select 1 from chain where cycle);
$$;
do $$ begin
  if private.hierarchy_has_cycle() then raise exception 'Existing manager cycle: repair before migration'; end if;
end $$;
create function private.check_hierarchy() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.hierarchy_has_cycle() then raise exception 'Manager hierarchy cycle'; end if;
  return null;
end;
$$;
create trigger lock_hierarchy before insert or update of manager_id on public.profiles
for each statement execute function private.lock_hierarchy();
create trigger check_hierarchy after insert or update of manager_id on public.profiles
for each statement execute function private.check_hierarchy();

alter table public.companies enable row level security;
alter table public.user_companies enable row level security;
revoke all on public.companies,public.user_companies from public,anon,authenticated,service_role;
grant select on public.companies,public.user_companies to authenticated;
create policy companies_read on public.companies for select to authenticated
using ((select private.has_permission('company.view')) or private.has_company_access(id));
create policy user_companies_read on public.user_companies for select to authenticated
using ((user_id=(select auth.uid()) and (select private.is_active())) or (select private.has_permission('company.assign')));

drop policy permissions_read on public.permissions;
create policy permissions_read on public.permissions for select to authenticated
using ((select private.has_permission('role.view')) or (select private.has_permission('permission.assign')));
drop policy role_permissions_read on public.role_permissions;
create policy role_permissions_read on public.role_permissions for select to authenticated
using ((select private.has_permission('role.view')) or (select private.has_permission('permission.assign')));
drop policy overrides_read on public.user_permission_overrides;
create policy overrides_read on public.user_permission_overrides for select to authenticated
using ((user_id=(select auth.uid()) and (select private.is_active())) or (select private.has_permission('permission.assign')));
drop policy audit_read on public.audit_logs;
create policy audit_read on public.audit_logs for select to authenticated
using ((category <> 'finance' and (select private.has_permission('audit.view')))
  or (category='finance' and (select private.has_permission('audit.finance_view')) and private.has_company_access(company_id)));

revoke all on function private.has_company_access(uuid),private.protect_permission_contract(),
  private.lock_hierarchy(),private.hierarchy_has_cycle(),private.check_hierarchy()
  from public,anon,authenticated,service_role;
grant execute on function private.has_company_access(uuid) to authenticated;
revoke all on function public.has_company_access(uuid) from public,anon,service_role;
grant execute on function public.has_company_access(uuid) to authenticated;

commit;
