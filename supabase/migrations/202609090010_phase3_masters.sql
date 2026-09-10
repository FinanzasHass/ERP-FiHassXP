begin;
alter table public.permissions add column is_sensitive boolean not null default false;
update public.permissions set is_sensitive=true where code in ('payment.execute','payment.approve','supplier.bank_change_approve','journal.post','journal.reverse','accounting_period.reopen','bank_reconciliation.close');
insert into public.permissions(module,resource,action,code,description,requires_company)
select 'maestros',r,a,r||'.'||a,r||': '||a,r not in ('currency','exchange_rate')
from unnest(array['cost_center','project','subproject','currency','exchange_rate']) r
cross join unnest(array['view','create','edit','disable']) a
on conflict(code) do nothing;
-- No new grants: an administrator configures a role for the intended operators.
create table public.cost_center_categories (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 code text not null check(code ~ '^[A-Za-z0-9_.-]{1,50}$'), name text not null check(length(trim(name)) between 1 and 150),
 description text check(length(description)<=2000), active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(company_id,code), unique(company_id,id)
);
create table public.cost_centers (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 code text not null check(code ~ '^[A-Za-z0-9_.-]{1,50}$'), name text not null check(length(trim(name)) between 1 and 150),
 description text check(length(description)<=2000), category_id uuid, parent_id uuid,
 level integer not null default 0 check(level>=0), active boolean not null default true,
 valid_from date not null default current_date, valid_to date, first_used_at timestamptz,
 created_by uuid references public.profiles(id), updated_by uuid references public.profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(company_id,code), unique(company_id,id), check(valid_to is null or valid_to>=valid_from),
 foreign key(company_id,parent_id) references public.cost_centers(company_id,id),
 foreign key(company_id,category_id) references public.cost_center_categories(company_id,id)
);
create table public.projects (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 code text not null check(code ~ '^[A-Za-z0-9_.-]{1,50}$'), name text not null check(length(trim(name)) between 1 and 150),
 description text check(length(description)<=2000), status text not null default 'active' check(status in ('active','inactive','completed','cancelled')),
 start_date date, end_date date, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(company_id,code), unique(company_id,id), check(end_date is null or start_date is null or end_date>=start_date)
);
create table public.subprojects (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), project_id uuid not null,
 code text not null check(code ~ '^[A-Za-z0-9_.-]{1,50}$'), name text not null check(length(trim(name)) between 1 and 150),
 description text check(length(description)<=2000), status text not null default 'active' check(status in ('active','inactive','completed','cancelled')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(project_id,code), foreign key(company_id,project_id) references public.projects(company_id,id)
);
create table public.currencies (
 id uuid primary key default gen_random_uuid(), code text not null unique check(code ~ '^[A-Z]{3}$'),
 name text not null check(length(trim(name)) between 1 and 150), symbol text not null check(length(symbol) between 1 and 10),
 decimal_places integer not null check(decimal_places between 0 and 6), active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
insert into public.currencies(code,name,symbol,decimal_places) values ('PEN','Sol','S/',2),('USD','Dólar estadounidense','$',2);
create table public.exchange_rates (
 id uuid primary key default gen_random_uuid(), company_id uuid references public.companies(id), date date not null,
 currency_from uuid not null references public.currencies(id), currency_to uuid not null references public.currencies(id),
 buy_rate numeric(24,12) not null check(buy_rate>0), sell_rate numeric(24,12) not null check(sell_rate>0),
 accounting_rate numeric(24,12) check(accounting_rate>0), source text not null check(length(trim(source)) between 1 and 150),
 created_at timestamptz not null default now(), check(currency_from<>currency_to),
 unique nulls not distinct(company_id,date,currency_from,currency_to,source)
);
create function private.guard_cost_center() returns trigger language plpgsql security definer set search_path='' as $$
declare parent_level integer;
begin
 perform pg_advisory_xact_lock(609090005);
 if tg_op='DELETE' then raise exception using errcode='23514',message='Deactivate instead of deleting'; end if;
 if tg_op='UPDATE' then
   if new.company_id<>old.company_id or (old.first_used_at is not null and (new.code<>old.code or new.parent_id is distinct from old.parent_id or new.first_used_at is distinct from old.first_used_at)) then
     raise exception using errcode='23514',message='Used center identity and hierarchy protected'; end if;
 end if;
 if new.parent_id is not null then
   if exists(with recursive ancestors as (
     select id,parent_id from public.cost_centers where id=new.parent_id and company_id=new.company_id
     union select c.id,c.parent_id from public.cost_centers c join ancestors a on c.id=a.parent_id
   ) select 1 from ancestors where id=new.id) then raise exception using errcode='23514',message='Cost center cycle'; end if;
   select level into parent_level from public.cost_centers where id=new.parent_id and company_id=new.company_id and (active or not new.active);
   if not found then raise exception using errcode='23514',message='Active parent in same company required'; end if;
   new.level:=parent_level+1;
 else new.level:=0; end if;
 if new.category_id is not null and not exists(select 1 from public.cost_center_categories where id=new.category_id and company_id=new.company_id and (active or not new.active)) then
   raise exception using errcode='23514',message='Active category required'; end if;
 if not new.active and exists(select 1 from public.cost_centers where parent_id=new.id and active) then
   raise exception using errcode='23514',message='Deactivate children first'; end if;
 new.updated_by:=auth.uid(); if tg_op='INSERT' then new.created_by:=auth.uid(); end if;
 return new;
end $$;
create trigger guard_cost_center before insert or update or delete on public.cost_centers for each row execute function private.guard_cost_center();
create function private.refresh_center_levels() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.level<>old.level then update public.cost_centers set level=new.level+1 where parent_id=new.id; end if;
 return new;
end $$;
create trigger refresh_center_levels after update on public.cost_centers for each row execute function private.refresh_center_levels();

create function public.master_save(kind text, target_id uuid, target_company uuid, payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tbl text; perm text; allowed text[]; previous jsonb; merged jsonb; result jsonb; cols text; vals text; updates text; k text;
begin
 perform private.lock_security();
 case kind
 when 'cost_center' then tbl:='cost_centers'; allowed:=array['code','name','description','category_id','parent_id','active','valid_from','valid_to'];
 when 'cost_center_category' then tbl:='cost_center_categories'; allowed:=array['code','name','description','active'];
 when 'project' then tbl:='projects'; allowed:=array['code','name','description','status','start_date','end_date'];
 when 'subproject' then tbl:='subprojects'; allowed:=array['code','name','description','status','project_id'];
 when 'currency' then tbl:='currencies'; allowed:=array['code','name','symbol','decimal_places','active'];
 else raise exception using errcode='22023',message='Unknown master'; end case;
 perm:=case when kind='cost_center_category' then 'cost_center' else kind end;
 perform private.validate_keys(payload,allowed);
 if kind='currency' and target_company is not null then raise exception using errcode='22023',message='Currency catalog is global'; end if;
 if kind<>'currency' and target_company is null then raise exception using errcode='42501',message='Company required'; end if;
 if not private.has_permission(perm||case when target_id is null then '.create' else '.edit' end,target_company) then raise exception using errcode='42501',message='Access denied'; end if;
 if target_id is not null then
   execute format('select to_jsonb(t) from public.%I t where id=$1',tbl) into previous using target_id;
   if previous is null then raise exception using errcode='P0002',message='Master not found'; end if;
   if kind<>'currency' and (previous->>'company_id')::uuid is distinct from target_company then raise exception using errcode='42501',message='Company mismatch'; end if;
   if (payload ? 'active' and payload->'active' is distinct from previous->'active') or (payload ? 'status' and payload->'status' is distinct from previous->'status') then
     if not private.has_permission(perm||'.disable',target_company) then raise exception using errcode='42501',message='Status permission required'; end if;
   end if;
   if kind in ('project','subproject','currency') and payload ? 'code' and payload->>'code'<>previous->>'code' then raise exception using errcode='23514',message='Code immutable'; end if;
 end if;
 merged:=coalesce(previous,'{}')||payload;
 if kind='subproject' and not exists(select 1 from public.projects where id=(merged->>'project_id')::uuid and company_id=target_company and (status='active' or merged->>'status'<>'active')) then raise exception using errcode='23514',message='Active project in same company required'; end if;
 if kind='project' and target_id is not null and merged->>'status'<>'active' and exists(select 1 from public.subprojects where project_id=target_id and status='active') then raise exception using errcode='23514',message='Deactivate subprojects first'; end if;
 if kind='cost_center_category' and target_id is not null and merged->>'active'='false' and exists(select 1 from public.cost_centers where category_id=target_id and active) then raise exception using errcode='23514',message='Category in use'; end if;
 -- Only the fixed allowlist reaches SQL identifiers. Cast through the table's own composite type.
 for k in select jsonb_object_keys(payload) loop
   cols:=concat_ws(',',cols,format('%I',k)); vals:=concat_ws(',',vals,format('v.%I',k)); updates:=concat_ws(',',updates,format('%I=v.%I',k,k));
 end loop;
 if target_id is null then
   if kind<>'currency' then cols:=cols||',company_id'; vals:=vals||',$2'; end if;
   execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I,$1) v returning to_jsonb(%I.*)',tbl,cols,vals,tbl,tbl) into result using payload,target_company;
 else
   execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I,$1) v where t.id=$2 returning to_jsonb(t.*)',tbl,updates,tbl) into result using payload,target_id;
 end if;
 return result;
end $$;

create function public.my_workspace() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('companies',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'code',c.code,'legal_name',c.legal_name) order by c.legal_name)
 from public.companies c join public.user_companies uc on uc.company_id=c.id where uc.user_id=auth.uid() and uc.active and c.active),'[]'::jsonb),
 'area',(select name from public.areas where id=p.area_id),'position',(select name from public.positions where id=p.position_id))
 from public.profiles p where p.id=auth.uid() and private.is_active();
$$;
-- This narrow lookup is exclusively used by the server login flow; never exposed to anonymous callers.
create function public.resolve_login_username(login_name text) returns text language sql stable security definer set search_path='' as $$
 select email from public.profiles where lower(username)=lower(login_name) limit 1;
$$;
revoke all on function public.resolve_login_username(text) from public,anon,authenticated;
grant execute on function public.resolve_login_username(text) to service_role;

do $$ declare t text; p text; begin
 foreach t in array array['cost_center_categories','cost_centers','projects','subprojects','currencies','exchange_rates'] loop
   p:=case t when 'cost_center_categories' then 'cost_center' when 'cost_centers' then 'cost_center' when 'projects' then 'project' when 'subprojects' then 'subproject' when 'currencies' then 'currency' else 'exchange_rate' end;
   execute format('alter table public.%I enable row level security',t);
   execute format('revoke all on public.%I from anon,authenticated,service_role',t);
   execute format('grant select on public.%I to authenticated',t);
   execute format('create policy master_read on public.%I for select to authenticated using (private.has_permission(%L,%s))',t,p||'.view',case when t='currencies' then 'null' else 'company_id' end);
   if t<>'exchange_rates' then execute format('create trigger touch_updated_at before update on public.%I for each row execute function private.touch_updated_at()',t); end if;
   execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function private.audit_change()',t);
 end loop;
end $$;
revoke all on function private.guard_cost_center(),private.refresh_center_levels() from public,anon,authenticated,service_role;
revoke all on function public.master_save(text,uuid,uuid,jsonb),public.my_workspace() from public,anon,service_role;
grant execute on function public.master_save(text,uuid,uuid,jsonb),public.my_workspace() to authenticated;
commit;
