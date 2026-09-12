begin;
create table public.travel_expense_requests (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 request_number text not null,employee_id uuid not null,area_id uuid not null references public.areas(id),
 cost_center_id uuid not null,project_id uuid,subproject_id uuid,
 destination text not null check(length(trim(destination)) between 1 and 200),
 purpose text not null check(length(trim(purpose)) between 1 and 2000),
 start_date date not null,end_date date not null check(end_date>=start_date),
 currency_id uuid not null references public.currencies(id),
 estimated_amount numeric(18,2) not null check(estimated_amount>0 and estimated_amount<1000000000000),
 requested_advance_amount numeric(18,2) not null check(requested_advance_amount>=0 and requested_advance_amount<=estimated_amount),
 status text not null default 'draft' check(status in ('draft','submitted','under_review','approved','observed','rejected','advance_pending','advance_paid','in_progress','expense_report_pending','under_validation','settlement_pending','closed','cancelled')),
 version integer not null default 1 check(version>0),policy_id uuid,dimension_snapshot jsonb not null,
 created_by uuid not null references public.profiles(id),submitted_by uuid references public.profiles(id),
 approved_by uuid references public.profiles(id),approved_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(company_id,id),unique(company_id,request_number),
 foreign key(company_id,employee_id) references public.employees(company_id,id),
 foreign key(company_id,policy_id) references public.employee_expense_policies(company_id,id),
 foreign key(company_id,cost_center_id) references public.cost_centers(company_id,id),
 foreign key(company_id,project_id) references public.projects(company_id,id),
 foreign key(company_id,subproject_id) references public.subprojects(company_id,id),
 check(approved_by is null or (approved_by<>created_by and approved_by<>submitted_by))
);
create table public.travel_expense_request_items (
 id uuid primary key default gen_random_uuid(),company_id uuid not null,request_id uuid not null,
 category_id uuid not null,description text not null check(length(trim(description)) between 1 and 1000),
 estimated_amount numeric(18,2) not null check(estimated_amount>0 and estimated_amount<1000000000000),
 cost_center_id uuid not null,project_id uuid,subproject_id uuid,dimension_snapshot jsonb not null,
 unique(company_id,id),foreign key(company_id,request_id) references public.travel_expense_requests(company_id,id),
 foreign key(company_id,category_id) references public.expense_categories(company_id,id),
 foreign key(company_id,cost_center_id) references public.cost_centers(company_id,id),
 foreign key(company_id,project_id) references public.projects(company_id,id),
 foreign key(company_id,subproject_id) references public.subprojects(company_id,id)
);
create table public.travel_expense_history (
 id uuid primary key default gen_random_uuid(),company_id uuid not null,request_id uuid not null,
 actor_id uuid not null references public.profiles(id),action text not null,
 previous_state text,new_state text not null,request_version integer not null,
 comment text,previous_values jsonb,new_values jsonb not null,created_at timestamptz not null default now(),
 foreign key(company_id,request_id) references public.travel_expense_requests(company_id,id)
);
create function private.travel_visible(rid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.travel_expense_requests r join public.employees e on e.id=r.employee_id and e.company_id=r.company_id
 where r.id=rid and private.has_company_access(r.company_id) and
 (private.has_permission('travel_expense.view_company',r.company_id) or
 (e.profile_id=auth.uid() and e.active and private.has_permission('travel_expense.view_own',r.company_id))));
$$;
do $$ declare t text;begin
 foreach t in array array['travel_expense_requests','travel_expense_request_items','travel_expense_history'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy travel_read on public.%I for select to authenticated using(private.travel_visible(%I))',t,case when t='travel_expense_requests' then 'id' else 'request_id' end);
  execute format('create trigger audit_finance after insert or update or delete on public.%I for each row execute function private.audit_finance()',t);
 end loop;
end $$;
create function private.expense_money(value jsonb) returns numeric language plpgsql immutable set search_path='' as $$
declare n numeric;begin
 if jsonb_typeof(value) is distinct from 'number' then raise exception using errcode='22023',message='Decimal amount required';end if;
 n:=(value#>>'{}')::numeric;
 if n<0 or n>=1000000000000 or n<>round(n,2) then raise exception using errcode='22023',message='Invalid monetary precision or range';end if;
 return n;
end $$;
create function public.travel_expense_save(target_id uuid,target_company uuid,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare r public.travel_expense_requests;e public.employees;previous jsonb;old_items jsonb;
 item jsonb;items jsonb;total numeric:=0;advance numeric;snapshot jsonb;policy uuid;result jsonb;
begin
 perform private.lock_security();perform private.finance_require('travel_expense.create',target_company);
 if jsonb_typeof(payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(payload) k where k not in
 ('employee_id','cost_center_id','project_id','subproject_id','destination','purpose','start_date','end_date','currency_id','requested_advance_amount','items')) then raise exception using errcode='22023',message='Invalid travel fields';end if;
 select * into e from public.employees where id=(payload->>'employee_id')::uuid and company_id=target_company and active;
 if not found then raise exception using errcode='42501',message='Active employee required';end if;
 if e.profile_id is distinct from auth.uid() then perform private.finance_require('travel_expense.create_for_employee',target_company);end if;
 if target_id is not null then
  select * into r from public.travel_expense_requests where id=target_id and company_id=target_company for update;
  if not found or r.employee_id<>e.id then raise exception using errcode='42501',message='Travel unavailable';end if;
  if r.status not in ('draft','observed') then raise exception using errcode='23514',message='Approved or submitted travel immutable';end if;
  previous:=to_jsonb(r);
  select coalesce(jsonb_agg(to_jsonb(i)),'[]') into old_items from public.travel_expense_request_items i where request_id=r.id;
 end if;
 if not exists(select 1 from public.currencies where id=(payload->>'currency_id')::uuid and active) then raise exception using errcode='23514',message='Active currency required';end if;
 items:=payload->'items';
 if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) not between 1 and 100 then raise exception using errcode='22023',message='Travel items required';end if;
 for item in select * from jsonb_array_elements(items) loop
  if jsonb_typeof(item) is distinct from 'object' or exists(select 1 from jsonb_object_keys(item) k where k not in ('category_id','description','estimated_amount','cost_center_id','project_id','subproject_id')) then raise exception using errcode='22023',message='Invalid travel item';end if;
  if not exists(select 1 from public.expense_categories where id=(item->>'category_id')::uuid and company_id=target_company and active) then raise exception using errcode='23514',message='Category company mismatch';end if;
  if private.expense_money(item->'estimated_amount')<=0 then raise exception using errcode='23514',message='Positive item amount required';end if;
  total:=total+private.expense_money(item->'estimated_amount');
 end loop;
 advance:=private.expense_money(payload->'requested_advance_amount');
 if advance>total then raise exception using errcode='23514',message='Advance exceeds estimate';end if;
 snapshot:=private.capture_dimensions(target_company,(payload->>'cost_center_id')::uuid,(payload->>'project_id')::uuid,(payload->>'subproject_id')::uuid);
 if target_id is null then
  insert into public.travel_expense_requests(company_id,request_number,employee_id,area_id,cost_center_id,project_id,subproject_id,destination,purpose,start_date,end_date,currency_id,estimated_amount,requested_advance_amount,dimension_snapshot,created_by)
  values(target_company,private.next_document_number(target_company,'VIA'),e.id,e.area_id,(payload->>'cost_center_id')::uuid,(payload->>'project_id')::uuid,(payload->>'subproject_id')::uuid,payload->>'destination',payload->>'purpose',(payload->>'start_date')::date,(payload->>'end_date')::date,(payload->>'currency_id')::uuid,total,advance,snapshot,auth.uid()) returning * into r;
 else
  update public.travel_expense_requests set area_id=e.area_id,cost_center_id=(payload->>'cost_center_id')::uuid,project_id=(payload->>'project_id')::uuid,subproject_id=(payload->>'subproject_id')::uuid,destination=payload->>'destination',purpose=payload->>'purpose',start_date=(payload->>'start_date')::date,end_date=(payload->>'end_date')::date,currency_id=(payload->>'currency_id')::uuid,estimated_amount=total,requested_advance_amount=advance,dimension_snapshot=snapshot,version=version+1,policy_id=null,updated_at=now() where id=r.id returning * into r;
  -- Only editable versions are replaced; complete prior items survive in history.
  delete from public.travel_expense_request_items where request_id=r.id;
 end if;
 for item in select * from jsonb_array_elements(items) loop
  snapshot:=private.capture_dimensions(target_company,(item->>'cost_center_id')::uuid,(item->>'project_id')::uuid,(item->>'subproject_id')::uuid);
  insert into public.travel_expense_request_items(company_id,request_id,category_id,description,estimated_amount,cost_center_id,project_id,subproject_id,dimension_snapshot)
  values(target_company,r.id,(item->>'category_id')::uuid,item->>'description',private.expense_money(item->'estimated_amount'),(item->>'cost_center_id')::uuid,(item->>'project_id')::uuid,(item->>'subproject_id')::uuid,snapshot);
 end loop;
 select to_jsonb(r)||jsonb_build_object('items',jsonb_agg(to_jsonb(i))) into result from public.travel_expense_request_items i where request_id=r.id;
 insert into public.travel_expense_history(company_id,request_id,actor_id,action,previous_state,new_state,request_version,previous_values,new_values)
 values(target_company,r.id,auth.uid(),case when target_id is null then 'create' else 'edit' end,previous->>'status',r.status,r.version,case when previous is null then null else previous||jsonb_build_object('items',old_items) end,result);
 return result;
end $$;
create function public.travel_expense_transition(target_id uuid,action text,comment text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare r public.travel_expense_requests;e public.employees;previous jsonb;next_state text;policy uuid;
begin
 perform private.lock_security();select * into r from public.travel_expense_requests where id=target_id for update;
 if not found then raise exception using errcode='42501',message='Travel unavailable';end if;
 if action is null or action not in ('submit','approve','observe','reject','cancel') then raise exception using errcode='22023',message='Invalid travel action';end if;
 perform private.finance_require('travel_expense.'||action,r.company_id);
 select * into e from public.employees where id=r.employee_id;
 if not e.active then raise exception using errcode='23514',message='Active employee required';end if;
 previous:=to_jsonb(r);
 if action='approve' and r.status='approved' then
  if auth.uid() in (e.profile_id,r.created_by,r.submitted_by) then raise exception using errcode='42501',message='Travel self approval forbidden';end if;
  return to_jsonb(r);
 end if;
 if action='submit' then
  if e.profile_id is distinct from auth.uid() then perform private.finance_require('travel_expense.create_for_employee',r.company_id);end if;
  if r.status not in ('draft','observed') then raise exception using errcode='23514',message='Invalid travel transition';end if;
  select id into policy from public.employee_expense_policies where company_id=r.company_id and currency_id=r.currency_id order by version desc limit 1;
  if policy is null then raise exception using errcode='23514',message='Expense policy required';end if;
  if r.estimated_amount<>(select coalesce(sum(estimated_amount),0) from public.travel_expense_request_items where request_id=r.id) then raise exception using errcode='23514',message='Travel item total mismatch';end if;
  next_state:='submitted';
 elsif action='cancel' then
  if e.profile_id is distinct from auth.uid() then perform private.finance_require('travel_expense.create_for_employee',r.company_id);end if;
  if r.status not in ('draft','observed','submitted') then raise exception using errcode='23514',message='Invalid cancellation';end if;
  next_state:='cancelled';
 else
  if auth.uid() in (e.profile_id,r.created_by,r.submitted_by) then raise exception using errcode='42501',message='Travel self approval forbidden';end if;
  if r.status not in ('submitted','under_review') then raise exception using errcode='23514',message='Invalid travel transition';end if;
  next_state:=case action when 'approve' then 'approved' when 'observe' then 'observed' else 'rejected' end;
 end if;
 if action in ('observe','reject','cancel') and (comment is null or length(trim(comment)) not between 1 and 2000) then raise exception using errcode='22023',message='Transition reason required';end if;
 if comment is not null and length(comment)>2000 then raise exception using errcode='22023',message='Comment too long';end if;
 update public.travel_expense_requests set status=next_state,updated_at=now(),
  policy_id=case when action='submit' then policy else policy_id end,
  submitted_by=case when action='submit' then auth.uid() else submitted_by end,
  approved_by=case when action='approve' then auth.uid() else approved_by end,
  approved_at=case when action='approve' then now() else approved_at end
 where id=r.id returning * into r;
 insert into public.travel_expense_history(company_id,request_id,actor_id,action,previous_state,new_state,request_version,comment,previous_values,new_values)
 values(r.company_id,r.id,auth.uid(),action,previous->>'status',r.status,r.version,comment,previous,to_jsonb(r));
 return to_jsonb(r);
end $$;
revoke all on function private.expense_money(jsonb),private.travel_visible(uuid) from public,anon,authenticated,service_role;
grant execute on function private.travel_visible(uuid) to authenticated;
revoke all on function public.travel_expense_save(uuid,uuid,jsonb),public.travel_expense_transition(uuid,text,text) from public,anon,service_role;
grant execute on function public.travel_expense_save(uuid,uuid,jsonb),public.travel_expense_transition(uuid,text,text) to authenticated;
commit;
