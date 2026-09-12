begin;
create function private.expense_history(rid uuid,event text,note text,previous jsonb default null,detail jsonb default null) returns void
language sql security definer set search_path='' as $$
 insert into public.expense_report_history(company_id,report_id,actor_id,action,version,previous_state,new_state,reason,old_values,new_values)
 select company_id,id,auth.uid(),event,version,previous->>'status',status,note,previous,coalesce(detail,to_jsonb(r)) from public.expense_reports r where id=rid;
$$;
create function private.expense_editable(rid uuid) returns public.expense_reports language plpgsql security definer set search_path='' as $$
declare r public.expense_reports;owner uuid;begin
 select * into r from public.expense_reports where id=rid for update;
 if not found then raise exception using errcode='42501',message='Expense report unavailable';end if;
 perform private.finance_require('expense_report.create',r.company_id);
 select profile_id into owner from public.employees where id=r.employee_id and active;
 if not found then raise exception using errcode='23514',message='Active employee required';end if;
 if owner is distinct from auth.uid() then perform private.finance_require('expense_report.create_for_employee',r.company_id);end if;
 if r.status not in ('draft','observed') then raise exception using errcode='23514',message='Expense report immutable';end if;
 return r;
end $$;
create function private.expense_totals(rid uuid) returns void language sql security definer set search_path='' as $$
 update public.expense_reports r set total_reported=x.reported,total_accepted=x.accepted,total_rejected=x.rejected,updated_at=now()
 from (select coalesce(sum(reported_amount),0) reported,coalesce(sum(accepted_amount),0) accepted,coalesce(sum(rejected_amount),0) rejected from public.expense_report_items where report_id=rid) x where r.id=rid;
$$;
create function public.expense_report_create(target_company uuid,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare e public.employees;t public.travel_expense_requests;a public.employee_advances;r public.expense_reports;policy uuid;begin
 perform private.treasury_lock();perform private.finance_require('expense_report.create',target_company);
 if jsonb_typeof(payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(payload) k where k not in ('employee_id','travel_expense_request_id','employee_advance_id','currency_id')) then raise exception using errcode='22023',message='Invalid expense report fields';end if;
 select * into e from public.employees where id=(payload->>'employee_id')::uuid and company_id=target_company and active;
 if not found then raise exception using errcode='23514',message='Active employee required';end if;
 if e.profile_id is distinct from auth.uid() then perform private.finance_require('expense_report.create_for_employee',target_company);end if;
 if not exists(select 1 from public.currencies where id=(payload->>'currency_id')::uuid and active) then raise exception using errcode='23514',message='Active currency required';end if;
 if payload->>'travel_expense_request_id' is not null then
  select * into t from public.travel_expense_requests where id=(payload->>'travel_expense_request_id')::uuid and company_id=target_company and employee_id=e.id and currency_id=(payload->>'currency_id')::uuid and status in ('approved','advance_pending','advance_paid','in_progress','expense_report_pending');
  if not found then raise exception using errcode='23514',message='Approved compatible travel required';end if;
  select * into a from public.employee_advances where travel_request_id=t.id;
  if payload->>'employee_advance_id' is not null and a.id is distinct from (payload->>'employee_advance_id')::uuid then raise exception using errcode='23514',message='Advance travel mismatch';end if;
  policy:=t.policy_id;
 elsif payload->>'employee_advance_id' is not null then
  raise exception using errcode='23514',message='Travel context required for advance';
 else select id into policy from public.employee_expense_policies where company_id=target_company and currency_id=(payload->>'currency_id')::uuid order by version desc limit 1;end if;
 if policy is null then raise exception using errcode='23514',message='Expense policy required';end if;
 insert into public.expense_reports(company_id,employee_id,report_number,travel_expense_request_id,employee_advance_id,currency_id,policy_id,created_by)
 values(target_company,e.id,private.next_document_number(target_company,'REN'),t.id,a.id,(payload->>'currency_id')::uuid,policy,auth.uid()) returning * into r;
 perform private.expense_history(r.id,'create',null);return to_jsonb(r);
end $$;
create function public.expense_item_save(report_id uuid,target_id uuid,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare r public.expense_reports;i public.expense_report_items;previous jsonb;snapshot jsonb;category public.expense_categories;begin
 perform private.treasury_lock();r:=private.expense_editable(report_id);
 if jsonb_typeof(payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(payload) k where k not in ('expense_date','category_id','description','reported_amount','support_type','cost_center_id','project_id','subproject_id')) then raise exception using errcode='22023',message='Invalid expense item fields';end if;
 if target_id is not null then
  select * into i from public.expense_report_items where id=target_id and expense_report_items.report_id=r.id for update;
  if not found then raise exception using errcode='42501',message='Expense item unavailable';end if;
  if i.status='accepted' or i.tax_document_id is not null or exists(select 1 from public.expense_declarations where item_id=i.id) then raise exception using errcode='23514',message='Supported or accepted item immutable';end if;
  previous:=to_jsonb(i);
 end if;
 select * into category from public.expense_categories where id=(payload->>'category_id')::uuid and company_id=r.company_id and active;
 if not found then raise exception using errcode='23514',message='Category company mismatch';end if;
 snapshot:=private.capture_dimensions(r.company_id,(payload->>'cost_center_id')::uuid,(payload->>'project_id')::uuid,(payload->>'subproject_id')::uuid)||jsonb_build_object('expense_category',to_jsonb(category),'employee',(select jsonb_build_object('id',e.id,'full_name',e.full_name,'area_id',e.area_id,'area_name',a.name) from public.employees e join public.areas a on a.id=e.area_id where e.id=r.employee_id));
 if target_id is null then
  insert into public.expense_report_items(company_id,report_id,expense_date,category_id,description,currency_id,reported_amount,support_type,cost_center_id,project_id,subproject_id,dimension_snapshot)
  values(r.company_id,r.id,(payload->>'expense_date')::date,category.id,payload->>'description',r.currency_id,private.expense_money(payload->'reported_amount'),payload->>'support_type',(payload->>'cost_center_id')::uuid,(payload->>'project_id')::uuid,(payload->>'subproject_id')::uuid,snapshot) returning * into i;
 else update public.expense_report_items set expense_date=(payload->>'expense_date')::date,category_id=category.id,description=payload->>'description',reported_amount=private.expense_money(payload->'reported_amount'),support_type=payload->>'support_type',cost_center_id=(payload->>'cost_center_id')::uuid,project_id=(payload->>'project_id')::uuid,subproject_id=(payload->>'subproject_id')::uuid,dimension_snapshot=snapshot,status='pending',accepted_amount=0,rejected_amount=0,reviewed_by=null,reviewed_at=null,decision_reason=null where id=i.id returning * into i;end if;
 perform private.expense_totals(r.id);perform private.expense_history(r.id,'item.save',null,previous,to_jsonb(i));return to_jsonb(i);
end $$;
create function public.expense_declaration_create(item_id uuid,declared_on date,reason text) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare i public.expense_report_items;r public.expense_reports;p public.employee_expense_policies;d public.expense_declarations;begin
 perform private.treasury_lock();select * into i from public.expense_report_items where id=item_id;
 if not found then raise exception using errcode='42501',message='Expense item unavailable';end if;r:=private.expense_editable(i.report_id);
 perform private.finance_require('declaration.create',r.company_id);select * into p from public.employee_expense_policies where id=r.policy_id;
 if i.support_type<>'declaration' or not p.allow_declarations or not exists(select 1 from public.expense_policy_categories where policy_id=p.id and category_id=i.category_id) or (p.declaration_max_amount is not null and i.reported_amount>p.declaration_max_amount) then raise exception using errcode='23514',message='Declaration prohibited by policy';end if;
 if reason is null or length(trim(reason)) not between 1 and 4000 then raise exception using errcode='22023',message='Declaration reason required';end if;
 insert into public.expense_declarations(company_id,item_id,declared_on,reason,amount,original_values,created_by)
 values(r.company_id,i.id,declared_on,reason,i.reported_amount,jsonb_build_object('item',to_jsonb(i),'employee_id',r.employee_id,'policy_id',r.policy_id,'reason',reason,'declared_on',declared_on),auth.uid()) returning * into d;
 perform private.expense_history(r.id,'declaration.create',reason,null,to_jsonb(d));return to_jsonb(d);
end $$;
create function public.expense_declaration_decide(target_id uuid,approve boolean,reason text) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare d public.expense_declarations;r public.expense_reports;previous jsonb;begin
 perform private.treasury_lock();select * into d from public.expense_declarations where id=target_id for update;
 if not found then raise exception using errcode='42501',message='Declaration unavailable';end if;
 select r0.* into r from public.expense_reports r0 join public.expense_report_items i on i.report_id=r0.id where i.id=d.item_id;
 perform private.finance_require('declaration.approve',r.company_id);
 if auth.uid() in (d.created_by,r.created_by,r.submitted_by) or exists(select 1 from public.employees where id=r.employee_id and profile_id=auth.uid()) then raise exception using errcode='42501',message='Declaration approval segregation';end if;
 if d.status<>'pending' or approve is null or r.status not in ('draft','submitted','under_review','observed') then raise exception using errcode='23514',message='Declaration immutable';end if;
 if reason is null or length(trim(reason)) not between 1 and 2000 then raise exception using errcode='22023',message='Decision reason required';end if;
 previous:=to_jsonb(d);update public.expense_declarations set status=case when approve then 'approved' else 'rejected' end,approved_by=auth.uid(),approved_at=now(),decision_reason=reason where id=d.id returning * into d;
 perform private.expense_history(r.id,'declaration.decide',reason,previous,to_jsonb(d));return to_jsonb(d);
end $$;
create function private.expense_support_valid(i public.expense_report_items,p public.employee_expense_policies) returns boolean language sql stable security definer set search_path='' as $$
 select case i.support_type
 when 'declaration' then p.allow_declarations and (p.declaration_max_amount is null or i.reported_amount<=p.declaration_max_amount)
  and exists(select 1 from public.expense_policy_categories where policy_id=p.id and category_id=i.category_id)
  and exists(select 1 from public.expense_declarations d where d.item_id=i.id and d.amount=i.reported_amount and (d.status='approved' or (not p.declaration_requires_approval and d.status='pending')))
 when 'tax_document' then exists(select 1 from public.tax_documents d where d.id=i.tax_document_id and d.company_id=i.company_id and d.currency_id=i.currency_id and d.status='reviewed' and i.reported_amount<=d.total_amount)
  and exists(select 1 from public.attachments a where a.entity_type in ('expense_receipt','tax_support') and a.entity_id=i.id and a.company_id=i.company_id and a.status='ready')
 when 'payment_evidence' then p.allow_payment_evidence and exists(select 1 from public.attachments a where a.entity_type='employee_payment_evidence' and a.entity_id=i.id and a.company_id=i.company_id and a.status='ready')
 when 'other_authorized' then p.allow_other_support and exists(select 1 from public.attachments a where a.entity_type='expense_receipt' and a.entity_id=i.id and a.company_id=i.company_id and a.status='ready') else false end;
$$;
create function public.expense_item_review(target_id uuid,decision text,accepted_amount jsonb,reason text) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare i public.expense_report_items;r public.expense_reports;p public.employee_expense_policies;n numeric;previous jsonb;begin
 perform private.treasury_lock();select * into i from public.expense_report_items where id=target_id for update;
 if not found then raise exception using errcode='42501',message='Expense item unavailable';end if;
 select * into r from public.expense_reports where id=i.report_id;perform private.finance_require('expense_report.review',r.company_id);
 if auth.uid() in (r.created_by,r.submitted_by) or exists(select 1 from public.employees where id=r.employee_id and profile_id=auth.uid()) then raise exception using errcode='42501',message='Expense reviewer segregation';end if;
 if r.status not in ('submitted','under_review') or decision is null or decision not in ('accepted','observed','rejected') then raise exception using errcode='23514',message='Invalid item review';end if;
 select * into p from public.employee_expense_policies where id=r.policy_id;n:=private.expense_money(accepted_amount);
 if n>i.reported_amount or (decision<>'accepted' and n<>0) or (decision='accepted' and (n=0 or (n<i.reported_amount and not p.allow_partial_acceptance))) then raise exception using errcode='23514',message='Invalid acceptance amount or policy';end if;
 if reason is null or length(trim(reason)) not between 1 and 2000 then raise exception using errcode='22023',message='Review reason required';end if;
 if decision='accepted' and not private.expense_support_valid(i,p) then raise exception using errcode='23514',message='Documentary policy incomplete';end if;
 previous:=to_jsonb(i);
 update public.expense_report_items set status=decision,accepted_amount=n,rejected_amount=case when decision='observed' then 0 else reported_amount-n end,
 reviewed_by=auth.uid(),reviewed_at=now(),decision_reason=reason,
 dimension_snapshot=case when decision='accepted' then private.capture_dimensions(r.company_id,i.cost_center_id,i.project_id,i.subproject_id)||jsonb_build_object('expense_category',(select to_jsonb(c) from public.expense_categories c where id=i.category_id),'employee',(select jsonb_build_object('id',e.id,'full_name',e.full_name,'area_id',e.area_id,'area_name',a.name) from public.employees e join public.areas a on a.id=e.area_id where e.id=r.employee_id)) else dimension_snapshot end where id=i.id returning * into i;
 update public.expense_reports set status='under_review' where id=r.id;
 perform private.expense_totals(r.id);perform private.expense_history(r.id,'item.review',reason,previous,to_jsonb(i));return to_jsonb(i);
end $$;

revoke all on function private.expense_history(uuid,text,text,jsonb,jsonb),private.expense_editable(uuid),private.expense_totals(uuid),private.expense_support_valid(public.expense_report_items,public.employee_expense_policies) from public,anon,authenticated,service_role;
revoke all on function public.expense_report_create(uuid,jsonb),public.expense_item_save(uuid,uuid,jsonb),public.expense_declaration_create(uuid,date,text),public.expense_declaration_decide(uuid,boolean,text),public.expense_item_review(uuid,text,jsonb,text) from public,anon,service_role;
grant execute on function public.expense_report_create(uuid,jsonb),public.expense_item_save(uuid,uuid,jsonb),public.expense_declaration_create(uuid,date,text),public.expense_declaration_decide(uuid,boolean,text),public.expense_item_review(uuid,text,jsonb,text) to authenticated;
commit;
