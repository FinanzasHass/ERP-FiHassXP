begin;
-- Additive foundation only. No grants and no changes to Treasury execution.
insert into public.permissions(module,resource,action,code,description,requires_company,scope,is_sensitive)
select 'gastos_colaboradores',r,a,r||'.'||a,r||': '||a,true,
 case when a='view_own' then 'own' when a='view_company' then 'company' else 'none' end,
 a in ('approve','close','reopen','match','manage')
from (values
 ('employee','view manage'),('expense_policy','view manage'),('expense_category','view manage'),
 ('travel_expense','view_own view_company create create_for_employee submit approve observe reject cancel'),
 ('employee_advance','view approve schedule cancel'),
 ('expense_report','view_own view_company create submit review approve observe reject close reopen'),
 ('declaration','create view approve'),('employee_return','view register match'),
 ('employee_reimbursement','view create approve')
) v(r,actions) cross join lateral unnest(string_to_array(actions,' ')) a
on conflict(code) do update set active=true,is_sensitive=public.permissions.is_sensitive or excluded.is_sensitive;

create table public.employees (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 profile_id uuid references public.profiles(id),
 full_name text not null check(length(trim(full_name)) between 1 and 200),
 document_type text not null check(length(trim(document_type)) between 1 and 30),
 document_number text not null check(length(trim(document_number)) between 1 and 30),
 area_id uuid not null references public.areas(id),
 position_id uuid references public.positions(id),
 active boolean not null default true,
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(company_id,id),unique(company_id,profile_id),
 foreign key(profile_id,company_id) references public.user_companies(user_id,company_id)
);
create unique index employee_document_company_identity on public.employees(company_id,upper(trim(document_type)),upper(trim(document_number)));
create table public.expense_categories (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 code text not null check(code ~ '^[a-z][a-z0-9_]{1,49}$'),
 name text not null check(length(trim(name)) between 1 and 150),
 active boolean not null default true,
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),unique(company_id,id),unique(company_id,code)
);
create table public.employee_expense_policies (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 version integer not null check(version>0),
 currency_id uuid not null references public.currencies(id),
 allow_declarations boolean not null default false,
 declaration_max_amount numeric(18,2) check(declaration_max_amount>0 and declaration_max_amount<'Infinity'::numeric),
 declaration_requires_approval boolean not null default true,
 allow_partial_acceptance boolean not null default false,
 require_distinct_reviewer boolean not null default true,
 render_due_days integer check(render_due_days between 0 and 3650),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 unique(company_id,id),unique(company_id,currency_id,version)
);
create table public.expense_policy_categories (
 id uuid primary key default gen_random_uuid(),company_id uuid not null,
 policy_id uuid not null,category_id uuid not null,
 unique(company_id,id),unique(policy_id,category_id),
 foreign key(company_id,policy_id) references public.employee_expense_policies(company_id,id),
 foreign key(company_id,category_id) references public.expense_categories(company_id,id)
);

create function private.employee_foundation_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception using errcode='23514',message='Employee history cannot be deleted';end if;
 if tg_op='UPDATE' then
  if tg_table_name in ('employee_expense_policies','expense_policy_categories') then
   raise exception using errcode='23514',message='Create a new policy version';
  end if;
  if new.company_id<>old.company_id or new.id<>old.id then
   raise exception using errcode='23514',message='Company identity immutable';end if;
  if tg_table_name='employees' then
   if (old.profile_id is not null and new.profile_id is distinct from old.profile_id) or new.document_type<>old.document_type or new.document_number<>old.document_number then
    raise exception using errcode='23514',message='Employee identity immutable';end if;
  end if;
  if tg_table_name='expense_categories' then
   if new.code<>old.code then raise exception using errcode='23514',message='Category code immutable';end if;
  end if;
 end if;
 return new;
end $$;

do $$ declare t text;p text;begin
 for t,p in select * from (values ('employees','employee.view'),('expense_categories','expense_category.view'),
 ('employee_expense_policies','expense_policy.view'),('expense_policy_categories','expense_policy.view'))v(t,p) loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy expense_foundation_read on public.%I for select to authenticated using(private.has_permission(%L,company_id))',t,p);
  execute format('create trigger expense_foundation_guard before update or delete on public.%I for each row execute function private.employee_foundation_guard()',t);
  execute format('create trigger audit_finance after insert or update or delete on public.%I for each row execute function private.audit_finance()',t);
 end loop;
end $$;
create policy employee_own_read on public.employees for select to authenticated
 using(profile_id=auth.uid() and active and private.has_company_access(company_id) and
 (private.has_permission('travel_expense.view_own',company_id) or private.has_permission('expense_report.view_own',company_id)));

create function public.employee_foundation_save(kind text,target_id uuid,target_company uuid,payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare tbl text;allowed text[];previous jsonb;d jsonb;result jsonb;category uuid;revision integer;
begin
 perform private.lock_security();
 if kind='employee' then tbl:='employees';allowed:=array['profile_id','full_name','document_type','document_number','area_id','position_id','active'];
 elsif kind='category' then tbl:='expense_categories';allowed:=array['code','name','active'];
 elsif kind='policy' then tbl:='employee_expense_policies';allowed:=array['currency_id','allow_declarations','declaration_max_amount','declaration_requires_approval','allow_partial_acceptance','require_distinct_reviewer','render_due_days','category_ids','allow_reopen','allow_cancel_unpaid_travel','allow_payment_evidence','allow_other_support'];
 else raise exception using errcode='22023',message='Unknown employee configuration';end if;
 perform private.finance_require(case kind when 'employee' then 'employee.manage' when 'category' then 'expense_category.manage' else 'expense_policy.manage' end,target_company);
 if jsonb_typeof(payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(payload) k where not(k=any(allowed))) then
  raise exception using errcode='22023',message='Invalid configuration fields';end if;
 if target_id is not null then
  if kind='policy' then raise exception using errcode='23514',message='Create a new policy version';end if;
  execute format('select to_jsonb(t) from public.%I t where id=$1 and company_id=$2 for update',tbl) into previous using target_id,target_company;
  if previous is null then raise exception using errcode='42501',message='Configuration unavailable';end if;
 end if;
 d:=coalesce(previous,'{}')||payload;
 if kind='employee' then
  if d->>'profile_id' is not null and (target_id is null or previous->>'profile_id' is distinct from d->>'profile_id') and not exists(select 1 from public.user_companies uc where uc.user_id=(d->>'profile_id')::uuid and uc.company_id=target_company and uc.active) then
   raise exception using errcode='23514',message='Linked profile company membership required';end if;
  if target_id is null and payload->>'full_name' is null and d->>'profile_id' is not null then
   payload:=payload||jsonb_build_object('full_name',(select full_name from public.profiles where id=(d->>'profile_id')::uuid));
  end if;
  if not exists(select 1 from public.areas where id=(d->>'area_id')::uuid and active) then raise exception using errcode='23514',message='Active area required';end if;
  if d->>'position_id' is not null and not exists(select 1 from public.positions where id=(d->>'position_id')::uuid and active and (area_id is null or area_id=(d->>'area_id')::uuid)) then raise exception using errcode='23514',message='Position area mismatch';end if;
 end if;
 if kind='policy' then
  if not exists(select 1 from public.currencies where id=(d->>'currency_id')::uuid and active) then raise exception using errcode='23514',message='Active currency required';end if;
  if payload ? 'declaration_max_amount' and payload->'declaration_max_amount'<>'null'::jsonb and
   (jsonb_typeof(payload->'declaration_max_amount')<>'number' or (payload->>'declaration_max_amount')::numeric<>round((payload->>'declaration_max_amount')::numeric,2)) then
   raise exception using errcode='22023',message='Invalid declaration limit';end if;
  if jsonb_typeof(coalesce(payload->'category_ids','[]')) is distinct from 'array' or jsonb_array_length(coalesce(payload->'category_ids','[]'))>100 then
   raise exception using errcode='22023',message='Invalid declaration categories';end if;
  if coalesce((payload->>'allow_declarations')::boolean,false) and jsonb_array_length(coalesce(payload->'category_ids','[]'))=0 then
   raise exception using errcode='23514',message='Declaration categories required';end if;
  for category in select value::uuid from jsonb_array_elements_text(coalesce(payload->'category_ids','[]')) loop
   if not exists(select 1 from public.expense_categories where id=category and company_id=target_company and active) then
    raise exception using errcode='23514',message='Category company mismatch';end if;
  end loop;
  select coalesce(max(version),0)+1 into revision from public.employee_expense_policies where company_id=target_company and currency_id=(d->>'currency_id')::uuid;
  d:=(payload-'category_ids')||jsonb_build_object('version',revision);
 else d:=payload||jsonb_build_object('updated_at',now());end if;
 if target_id is null then d:=d||jsonb_build_object('company_id',target_company,'created_by',auth.uid());end if;
 result:=private.treasury_write(tbl,target_id,target_company,d);
 if kind='policy' then
  insert into public.expense_policy_categories(company_id,policy_id,category_id)
  select target_company,(result->>'id')::uuid,value::uuid from jsonb_array_elements_text(coalesce(payload->'category_ids','[]'));
 end if;
 return result;
end $$;
revoke all on function private.employee_foundation_guard() from public,anon,authenticated,service_role;
revoke all on function public.employee_foundation_save(text,uuid,uuid,jsonb) from public,anon,service_role;
grant execute on function public.employee_foundation_save(text,uuid,uuid,jsonb) to authenticated;
commit;
