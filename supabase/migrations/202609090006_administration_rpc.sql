begin;
alter table public.audit_logs add column reason text;

create function public.admin_set_user_role(target_user uuid,target_role uuid,target_company uuid,assign boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.lock_security(); perform private.require_permission('role.assign');
  perform private.assert_other(target_user);
  if assign is null then raise exception using errcode='22023',message='Assignment state required'; end if;
  if assign then
    perform private.assert_membership(target_user,target_company);
    if not exists(select 1 from public.roles where id=target_role and active) then
      raise exception using errcode='23514',message='Active role required'; end if;
    if target_company is not null and exists(select 1 from public.roles where id=target_role and is_system) then
      raise exception using errcode='23514',message='System role must be global'; end if;
    insert into public.user_roles(user_id,role_id,company_id,assigned_by,assigned_at)
    values(target_user,target_role,target_company,auth.uid(),now()) on conflict on constraint user_roles_scope_key do nothing;
  else
    delete from public.user_roles where user_id=target_user and role_id=target_role and company_id is not distinct from target_company;
  end if;
  perform private.assert_admin_remains();
end $$;

create function public.admin_set_role_permissions(target_role uuid,permission_ids uuid[])
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.lock_security(); perform private.require_permission('permission.assign');
  if permission_ids is null or cardinality(permission_ids)>500 then raise exception using errcode='22023',message='Invalid permissions'; end if;
  if not exists(select 1 from public.roles where id=target_role) then raise exception using errcode='P0002',message='Role not found'; end if;
  if exists(select 1 from public.user_roles where user_id=auth.uid() and role_id=target_role) then
    raise exception using errcode='42501',message='Cannot change own role grants'; end if;
  if exists(select 1 from unnest(permission_ids) x where x is null or not exists(select 1 from public.permissions where id=x and active)) then
    raise exception using errcode='23514',message='Existing active permissions required'; end if;
  if exists(select 1 from public.roles where id=target_role and is_system) and exists(
    select 1 from public.permissions where id=any(permission_ids) and requires_company) then
    raise exception using errcode='23514',message='System role cannot receive financial permissions'; end if;
  delete from public.role_permissions where role_id=target_role and not(permission_id=any(permission_ids));
  insert into public.role_permissions(role_id,permission_id)
    select target_role,x from (select distinct unnest(permission_ids) x) q on conflict do nothing;
  perform private.assert_admin_remains();
end $$;

create function public.admin_set_override(target_user uuid,target_permission uuid,target_company uuid,new_effect text,change_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.lock_security(); perform private.require_permission('permission.assign'); perform private.assert_other(target_user);
  if new_effect is null or new_effect not in ('allow','deny','inherit') or change_reason is null
    or length(trim(change_reason)) not between 1 and 2000 then raise exception using errcode='22023',message='Effect and reason required'; end if;
  if new_effect<>'inherit' then
    perform private.assert_membership(target_user,target_company);
    if not exists(select 1 from public.permissions where id=target_permission and active) then
      raise exception using errcode='23514',message='Existing active permission required'; end if;
  end if;
  perform set_config('app.audit_reason',change_reason,true);
  if new_effect='inherit' then
    delete from public.user_permission_overrides where user_id=target_user and permission_id=target_permission
      and company_id is not distinct from target_company;
  else
    insert into public.user_permission_overrides(user_id,permission_id,company_id,effect,reason,assigned_by,assigned_at)
    values(target_user,target_permission,target_company,new_effect,change_reason,auth.uid(),now())
    on conflict on constraint overrides_scope_key do update set effect=excluded.effect,reason=excluded.reason,
      assigned_by=excluded.assigned_by,assigned_at=excluded.assigned_at;
  end if;
  perform private.assert_admin_remains();
end $$;

create function public.admin_set_membership(target_user uuid,target_company uuid,is_active boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.lock_security(); perform private.require_permission('company.assign'); perform private.assert_other(target_user);
  if is_active is null then raise exception using errcode='22023',message='Membership state required'; end if;
  if is_active and not exists(select 1 from public.companies where id=target_company and active) then
    raise exception using errcode='23514',message='Active company required'; end if;
  insert into public.user_companies(user_id,company_id,active,assigned_by,assigned_at)
  values(target_user,target_company,is_active,auth.uid(),now())
  on conflict(user_id,company_id) do update set active=excluded.active,assigned_by=excluded.assigned_by,assigned_at=excluded.assigned_at;
end $$;

create function private.validate_organization(target_area uuid,target_position uuid,target_manager uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if target_area is not null and not exists(select 1 from public.areas where id=target_area and active) then
    raise exception using errcode='23514',message='Active area required'; end if;
  if target_position is not null and not exists(select 1 from public.positions where id=target_position and active
    and (area_id is null or area_id=target_area)) then raise exception using errcode='23514',message='Position/area mismatch'; end if;
  if target_manager is not null and not exists(select 1 from public.profiles where id=target_manager and status='active') then
    raise exception using errcode='23514',message='Active manager required'; end if;
end $$;
create function private.validate_keys(payload jsonb,allowed text[]) returns void
language plpgsql set search_path='' as $$
begin
  if jsonb_typeof(payload) is distinct from 'object' or payload='{}'::jsonb then
    raise exception using errcode='22023',message='Nonempty object required'; end if;
  if exists(select 1 from jsonb_object_keys(payload) k where not(k=any(allowed))) then
    raise exception using errcode='22023',message='Unknown field'; end if;
end $$;

create function public.admin_update_profile(target_user uuid,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.profiles;
begin
  perform private.lock_security(); perform private.require_permission('user.edit');
  perform private.validate_keys(payload,array['full_name','username','area_id','position_id','manager_id','status']);
  if payload ? 'status' then perform private.require_permission('user.disable'); perform private.assert_other(target_user); end if;
  if payload ?| array['area_id','position_id','manager_id'] then perform private.assert_other(target_user); end if;
  select * into p from public.profiles where id=target_user;
  if not found then raise exception using errcode='P0002',message='Profile not found'; end if;
  p:=jsonb_populate_record(p,payload);
  perform private.validate_organization(p.area_id,p.position_id,p.manager_id);
  update public.profiles set full_name=p.full_name,username=p.username,area_id=p.area_id,
    position_id=p.position_id,manager_id=p.manager_id,status=p.status,updated_by=auth.uid()
    where id=target_user returning * into p;
  perform private.assert_admin_remains();
  return to_jsonb(p);
end $$;

create function public.admin_save_entity(entity_kind text,entity_id uuid,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; a public.areas; p public.positions; c public.companies; r public.roles;
begin
  perform private.lock_security();
  if entity_kind is null or entity_kind not in ('area','position','company','role') then
    raise exception using errcode='22023',message='Unknown entity'; end if;
  perform private.require_permission(entity_kind || case when entity_id is null then '.create' else '.edit' end);
  if entity_id is not null and payload ? 'active' then
    if entity_kind='role' then
      perform private.require_permission('permission.assign');
      if exists(select 1 from public.user_roles where user_id=auth.uid() and role_id=entity_id) then
        raise exception using errcode='42501',message='Cannot change own role status'; end if;
    else perform private.require_permission(entity_kind || '.disable'); end if;
  end if;
  case entity_kind
    when 'area' then
      perform private.validate_keys(payload,array['name','code','description','active']);
      if entity_id is null then
        insert into public.areas(name,code,description,active) values(payload->>'name',payload->>'code',payload->>'description',coalesce((payload->>'active')::boolean,true)) returning * into a;
      else
        select * into a from public.areas where id=entity_id;
        if not found then raise exception using errcode='P0002',message='Area not found'; end if;
        a:=jsonb_populate_record(a,payload);
        update public.areas set name=a.name,code=a.code,description=a.description,active=a.active where id=entity_id returning * into a;
      end if; result:=to_jsonb(a);
    when 'position' then
      perform private.validate_keys(payload,array['name','area_id','description','hierarchy_level','active']);
      if entity_id is not null then
        select * into p from public.positions where id=entity_id;
        if not found then raise exception using errcode='P0002',message='Position not found'; end if;
      end if;
      p:=jsonb_populate_record(p,payload);
      if p.area_id is not null and not exists(select 1 from public.areas where id=p.area_id and active) then
        raise exception using errcode='23514',message='Active area required'; end if;
      if entity_id is null then
        insert into public.positions(name,area_id,description,hierarchy_level,active)
        values(p.name,p.area_id,p.description,p.hierarchy_level,coalesce(p.active,true)) returning * into p;
      else
        if exists(select 1 from public.profiles where position_id=entity_id and p.area_id is not null and area_id is distinct from p.area_id) then
          raise exception using errcode='23514',message='Position area conflicts with assigned profiles'; end if;
        update public.positions set name=p.name,area_id=p.area_id,description=p.description,hierarchy_level=p.hierarchy_level,active=p.active where id=entity_id returning * into p;
      end if; result:=to_jsonb(p);
    when 'company' then
      perform private.validate_keys(payload,array['legal_name','code','tax_id','country_code','active']);
      if entity_id is null then
        insert into public.companies(legal_name,code,tax_id,country_code,active)
        values(payload->>'legal_name',payload->>'code',payload->>'tax_id',payload->>'country_code',coalesce((payload->>'active')::boolean,true)) returning * into c;
      else
        select * into c from public.companies where id=entity_id;
        if not found then raise exception using errcode='P0002',message='Company not found'; end if;
        c:=jsonb_populate_record(c,payload);
        update public.companies set legal_name=c.legal_name,code=c.code,tax_id=c.tax_id,country_code=c.country_code,active=c.active where id=entity_id returning * into c;
      end if; result:=to_jsonb(c);
    when 'role' then
      perform private.validate_keys(payload,array['name','code','description','active']);
      if entity_id is null then
        insert into public.roles(name,code,description,active,is_system)
        values(payload->>'name',payload->>'code',payload->>'description',coalesce((payload->>'active')::boolean,true),false) returning * into r;
      else
        select * into r from public.roles where id=entity_id;
        if not found then raise exception using errcode='P0002',message='Role not found'; end if;
        r:=jsonb_populate_record(r,payload);
        update public.roles set name=r.name,code=r.code,description=r.description,active=r.active where id=entity_id returning * into r;
      end if; result:=to_jsonb(r);
  end case;
  perform private.assert_admin_remains();
  return result;
end $$;

-- Fixed schema settings only, never secrets or arbitrary configuration keys.
create table public.system_settings (
  id boolean primary key default true check(id),
  system_name text not null check(length(trim(system_name)) between 1 and 100),
  timezone text not null,
  updated_at timestamptz not null default now()
);
insert into public.system_settings(system_name,timezone) values('Mini ERP Financiero','America/Lima');
alter table public.system_settings enable row level security;
revoke all on public.system_settings from public,anon,authenticated,service_role;
grant select on public.system_settings to authenticated;
create policy settings_read on public.system_settings for select to authenticated using((select private.has_permission('settings.manage')));
create trigger touch_updated_at before update on public.system_settings for each row execute function private.touch_updated_at();
create trigger audit_change after update on public.system_settings for each row execute function private.audit_change();
create function public.admin_update_settings(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.system_settings;
begin
  perform private.lock_security(); perform private.require_permission('settings.manage');
  perform private.validate_keys(payload,array['system_name','timezone']);
  select * into s from public.system_settings;
  s:=jsonb_populate_record(s,payload);
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=s.timezone) then raise exception using errcode='22023',message='Invalid timezone'; end if;
  update public.system_settings set system_name=s.system_name,timezone=s.timezone returning * into s;
  return to_jsonb(s);
end $$;

create or replace function private.audit_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare before_row jsonb; after_row jsonb; row_data jsonb; event_action text; event_category text;
begin
  if tg_op<>'INSERT' then before_row:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then after_row:=to_jsonb(new); end if;
  row_data:=coalesce(after_row,before_row); event_action:=lower(tg_op);
  event_category:=case when tg_table_name in ('roles','user_roles','role_permissions','user_permission_overrides','user_companies') then 'security'
    when tg_table_name in ('permissions','system_settings') then 'system' else 'administration' end;
  if tg_table_name='profiles' and tg_op='UPDATE' and before_row->>'status'='active' and after_row->>'status'<>'active' then event_action:='disable';
  elsif tg_table_name in ('user_roles','user_companies') then
    event_action:=case when tg_table_name='user_roles' then 'role.' else 'company.' end ||
      case when tg_op='INSERT' then 'assign' when tg_op='DELETE' or after_row->>'active'='false' then 'remove' else 'change' end;
  elsif tg_table_name in ('role_permissions','user_permission_overrides','permissions') then event_action:='permission.' || lower(tg_op); end if;
  insert into public.audit_logs(user_id,action,category,entity_type,entity_id,old_values,new_values,company_id,reason)
  values(auth.uid(),event_action,event_category,tg_table_name,
    coalesce(row_data->>'id',concat_ws(':',row_data->>'user_id',row_data->>'role_id',row_data->>'permission_id',row_data->>'company_id')),
    before_row,after_row,case when tg_table_name='companies' then (row_data->>'id')::uuid else (row_data->>'company_id')::uuid end,
    case when tg_table_name='user_permission_overrides' then nullif(current_setting('app.audit_reason',true),'') end);
  if tg_op='DELETE' then return old; end if; return new;
end $$;

revoke all on function private.validate_organization(uuid,uuid,uuid),private.validate_keys(jsonb,text[]) from public,anon,authenticated,service_role;
revoke all on function public.admin_set_user_role(uuid,uuid,uuid,boolean),public.admin_set_role_permissions(uuid,uuid[]),
  public.admin_set_override(uuid,uuid,uuid,text,text),public.admin_set_membership(uuid,uuid,boolean),
  public.admin_update_profile(uuid,jsonb),public.admin_save_entity(text,uuid,jsonb),public.admin_update_settings(jsonb)
  from public,anon,service_role;
grant execute on function public.admin_set_user_role(uuid,uuid,uuid,boolean),public.admin_set_role_permissions(uuid,uuid[]),
  public.admin_set_override(uuid,uuid,uuid,text,text),public.admin_set_membership(uuid,uuid,boolean),
  public.admin_update_profile(uuid,jsonb),public.admin_save_entity(text,uuid,jsonb),public.admin_update_settings(jsonb)
  to authenticated;
commit;
