begin;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table public.areas (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 150),
  code text not null check (code ~ '^[A-Za-z0-9_-]{2,50}$'),
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index areas_code_key on public.areas (lower(code));

create table public.positions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 150),
  area_id uuid references public.areas(id) on delete restrict,
  description text,
  hierarchy_level integer check (hierarchy_level >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index positions_area_idx on public.positions(area_id);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  email text not null check (length(email) <= 254 and email like '%@%'),
  username text not null check (username ~ '^[A-Za-z0-9_.-]{3,50}$'),
  full_name text not null check (length(trim(full_name)) between 1 and 200),
  area_id uuid references public.areas(id) on delete restrict,
  position_id uuid references public.positions(id) on delete restrict,
  manager_id uuid references public.profiles(id) on delete restrict,
  status text not null default 'inactive' check (status in ('active','inactive','blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete restrict,
  updated_by uuid references public.profiles(id) on delete restrict,
  check (manager_id is distinct from id)
);
create unique index profiles_email_key on public.profiles(lower(email));
create unique index profiles_username_key on public.profiles(lower(username));
create index profiles_area_idx on public.profiles(area_id);
create index profiles_position_idx on public.profiles(position_id);
create index profiles_manager_idx on public.profiles(manager_id);
create index profiles_created_by_idx on public.profiles(created_by);
create index profiles_updated_by_idx on public.profiles(updated_by);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 150),
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,49}$'),
  description text,
  active boolean not null default true,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(code)
);
create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  module text not null check (length(trim(module)) > 0),
  resource text not null check (resource ~ '^[a-z][a-z0-9_]*$'),
  action text not null check (action ~ '^[a-z][a-z0-9_]*$'),
  code text not null unique,
  description text not null,
  active boolean not null default true,
  check (code = resource || '.' || action)
);
create index permissions_module_idx on public.permissions(module);
create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete restrict,
  permission_id uuid not null references public.permissions(id) on delete restrict,
  granted boolean not null default true,
  created_at timestamptz not null default now(),
  primary key(role_id,permission_id)
);
create index role_permissions_permission_idx on public.role_permissions(permission_id);
create table public.user_roles (
  user_id uuid not null references public.profiles(id) on delete restrict,
  role_id uuid not null references public.roles(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key(user_id,role_id)
);
create index user_roles_role_idx on public.user_roles(role_id);
create table public.user_permission_overrides (
  user_id uuid not null references public.profiles(id) on delete restrict,
  permission_id uuid not null references public.permissions(id) on delete restrict,
  effect text not null check (effect in ('allow','deny')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(user_id,permission_id)
);
create index overrides_permission_idx on public.user_permission_overrides(permission_id);
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete restrict,
  action text not null,
  entity_type text not null,
  entity_id text,
  old_values jsonb,
  new_values jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);
create index audit_logs_time_idx on public.audit_logs(created_at desc,id);
create index audit_logs_actor_idx on public.audit_logs(user_id,created_at desc);
create index audit_logs_entity_idx on public.audit_logs(entity_type,entity_id,created_at desc);

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create function private.is_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = auth.uid() and status = 'active');
$$;

create function private.has_permission(permission_code text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_active() and exists (
    select 1 from public.permissions p
    where p.code = permission_code and p.active
      and not exists (
        select 1 from public.user_permission_overrides o
        where o.user_id = auth.uid() and o.permission_id = p.id and o.effect = 'deny'
      )
      and (
        exists (select 1 from public.user_permission_overrides o
          where o.user_id = auth.uid() and o.permission_id = p.id and o.effect = 'allow')
        or exists (
          select 1 from public.user_roles ur
          join public.roles r on r.id = ur.role_id and r.active
          join public.role_permissions rp on rp.role_id = r.id and rp.granted
          where ur.user_id = auth.uid() and rp.permission_id = p.id
        )
      )
  );
$$;

-- Only the current JWT identity is resolved. No caller-supplied user ID.
create function public.has_permission(permission_code text) returns boolean
language sql stable security invoker set search_path = '' as $$
  select private.has_permission(permission_code);
$$;

create function private.audit_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  before_row jsonb;
  after_row jsonb;
  row_data jsonb;
  event_action text;
begin
  if tg_op <> 'INSERT' then before_row := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then after_row := to_jsonb(new); end if;
  row_data := coalesce(after_row,before_row);
  event_action := lower(tg_op);
  if tg_table_name = 'profiles' and tg_op = 'UPDATE'
     and before_row->>'status' = 'active' and after_row->>'status' <> 'active'
    then event_action := 'disable';
  elsif tg_table_name = 'user_roles' then
    event_action := case when tg_op = 'INSERT' then 'role.assign' when tg_op = 'DELETE' then 'role.remove' else 'role.change' end;
  elsif tg_table_name in ('role_permissions','user_permission_overrides','permissions') then
    event_action := 'permission.' || lower(tg_op);
  end if;
  insert into public.audit_logs(user_id,action,entity_type,entity_id,old_values,new_values)
  values(auth.uid(),event_action,tg_table_name,
    coalesce(row_data->>'id',concat_ws(':',row_data->>'user_id',row_data->>'role_id',row_data->>'permission_id')),
    before_row,after_row);
  -- IP/UA intentionally null until a trusted server context exists; never trust client headers here.
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create function private.protect_system_role() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.is_system and (tg_op = 'DELETE') then
    raise exception 'System role cannot be deleted';
  end if;
  if old.is_system and (not new.is_system or not new.active or new.code <> old.code) then
    raise exception 'System role identity and active status are protected';
  end if;
  return new;
end;
$$;
create trigger protect_system_role before update or delete on public.roles
for each row execute function private.protect_system_role();

do $$
declare table_name text;
begin
  foreach table_name in array array['areas','positions','profiles','roles','user_permission_overrides'] loop
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function private.touch_updated_at()',table_name);
  end loop;
  foreach table_name in array array['areas','positions','profiles','roles','permissions','role_permissions','user_roles','user_permission_overrides'] loop
    execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function private.audit_change()',table_name);
  end loop;
  foreach table_name in array array['areas','positions','profiles','roles','permissions','role_permissions','user_roles','user_permission_overrides','audit_logs'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role',table_name);
    execute format('grant select on public.%I to authenticated',table_name);
  end loop;
end;
$$;

revoke all on all functions in schema private from public, anon, authenticated, service_role;
grant execute on function private.is_active() to authenticated;
grant execute on function private.has_permission(text) to authenticated;
revoke all on function public.has_permission(text) from public, anon, service_role;
grant execute on function public.has_permission(text) to authenticated;

create policy profiles_read on public.profiles for select to authenticated
using ((id = (select auth.uid()) and (select private.is_active())) or (select private.has_permission('user.view')));
create policy areas_read on public.areas for select to authenticated
using ((select private.has_permission('area.view')) or (select private.has_permission('user.view')));
create policy positions_read on public.positions for select to authenticated
using ((select private.has_permission('position.view')) or (select private.has_permission('user.view')));
create policy roles_read on public.roles for select to authenticated
using ((select private.has_permission('role.view')) or (select private.has_permission('role.assign')));
create policy permissions_read on public.permissions for select to authenticated
using ((select private.has_permission('role.view')) or (select private.has_permission('permission.manage')));
create policy role_permissions_read on public.role_permissions for select to authenticated
using ((select private.has_permission('role.view')) or (select private.has_permission('permission.manage')));
create policy user_roles_read on public.user_roles for select to authenticated
using ((user_id = (select auth.uid()) and (select private.is_active())) or (select private.has_permission('user.view')));
create policy overrides_read on public.user_permission_overrides for select to authenticated
using ((user_id = (select auth.uid()) and (select private.is_active())) or (select private.has_permission('permission.manage')));
create policy audit_read on public.audit_logs for select to authenticated
using ((select private.has_permission('audit.view')));

commit;
