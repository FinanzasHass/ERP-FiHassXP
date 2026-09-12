begin;
create function public.expense_options(target_company uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_company_access(target_company) or not exists(select 1 from public.permissions p where p.resource in ('travel_expense','expense_report','employee_advance','employee_return','employee_reimbursement','employee') and private.has_permission(p.code,target_company)) then raise exception using errcode='42501',message='Expense access required';end if;
 return jsonb_build_object(
 'employees',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',full_name,'profile_id',profile_id)),'[]') from public.employees where company_id=target_company and active and (profile_id=auth.uid() or private.has_permission('expense_report.view_company',target_company) or private.has_permission('travel_expense.view_company',target_company) or private.has_permission('expense_report.create_for_employee',target_company) or private.has_permission('travel_expense.create_for_employee',target_company))),
 'currencies',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',code)),'[]') from public.currencies where active),
 'categories',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') from public.expense_categories where company_id=target_company and active),
 'cost_centers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',code||' · '||name)),'[]') from public.cost_centers where company_id=target_company and active),
 'projects',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',code||' · '||name)),'[]') from public.projects where company_id=target_company and status='active'),
 'subprojects',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',code||' · '||name,'project_id',project_id)),'[]') from public.subprojects where company_id=target_company and status='active'),
 'travels',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',request_number,'employee_id',employee_id,'currency_id',currency_id)),'[]') from public.travel_expense_requests where company_id=target_company and status='approved' and private.travel_visible(id)),
 'suppliers',case when private.has_permission('tax_document.create',target_company) then (select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.legal_name)),'[]') from public.suppliers s join public.supplier_companies sc on sc.supplier_id=s.id where sc.company_id=target_company and sc.status='active') else '[]'::jsonb end,
 'methods',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') from public.payment_methods where company_id=target_company and active));
end $$;
create function public.expense_dashboard(target_company uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'reports',(select coalesce(jsonb_agg(x),'[]') from (select status,currency_id,count(*) quantity,sum(total_reported) reported,sum(total_accepted) accepted,sum(total_rejected) rejected from public.expense_reports where company_id=target_company group by status,currency_id)x),
 'advances',(select coalesce(jsonb_agg(x),'[]') from (select status,currency_id,sum(paid_amount) delivered,sum(outstanding_to_render) outstanding from public.employee_advances where company_id=target_company group by status,currency_id)x),
 'settlements',(select coalesce(jsonb_agg(x),'[]') from (select s.report_id,r.report_number,r.currency_id,s.advance_paid,s.accepted_expenses,s.employee_return_due,s.employee_reimbursement_due,r.status from public.expense_settlements s join public.expense_reports r on r.id=s.report_id where s.company_id=target_company and s.status='valid')x),
 'expenses',(select coalesce(jsonb_agg(x),'[]') from (select i.currency_id,i.cost_center_id,i.project_id,i.subproject_id,i.category_id,r.employee_id,date_trunc('month',i.expense_date)::date period,sum(i.accepted_amount) accepted from public.expense_report_items i join public.expense_reports r on r.id=i.report_id where i.company_id=target_company and i.status='accepted' and r.status in ('approved','settlement_pending','settled') group by i.currency_id,i.cost_center_id,i.project_id,i.subproject_id,i.category_id,r.employee_id,date_trunc('month',i.expense_date))x));
$$;
create function public.travel_cancel_unpaid(target_id uuid,reason text) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare r public.travel_expense_requests;previous jsonb;begin
 perform private.treasury_lock();select * into r from public.travel_expense_requests where id=target_id for update;
 if not found then raise exception using errcode='42501',message='Travel unavailable';end if;
 perform private.finance_require('travel_expense.cancel',r.company_id);perform private.finance_require('employee_advance.cancel',r.company_id);
 if reason is null or length(trim(reason)) not between 1 and 2000 then raise exception using errcode='22023',message='Cancellation reason required';end if;
 if r.status='cancelled' then return to_jsonb(r);end if;
 if r.status<>'approved' or not exists(select 1 from public.employee_expense_policies where id=r.policy_id and allow_cancel_unpaid_travel) then raise exception using errcode='23514',message='Policy does not allow unpaid cancellation';end if;
 if exists(select 1 from public.employee_advances where travel_request_id=r.id and paid_amount>0) or exists(select 1 from public.expense_reports where travel_expense_request_id=r.id and status<>'cancelled') or exists(select 1 from public.employee_advances a join public.payables p on p.employee_advance_id=a.id join public.payment_order_items oi on oi.payable_id=p.id join public.payment_orders o on o.id=oi.payment_order_id where a.travel_request_id=r.id and o.status<>'cancelled') then raise exception using errcode='23514',message='Financial effects prevent travel cancellation';end if;
 previous:=to_jsonb(r);
 update public.payables set status='cancelled' where employee_advance_id in (select id from public.employee_advances where travel_request_id=r.id);
 update public.employee_advances set status='cancelled' where travel_request_id=r.id;
 update public.travel_expense_requests set status='cancelled',updated_at=now() where id=r.id returning * into r;
 insert into public.travel_expense_history(company_id,request_id,actor_id,action,previous_state,new_state,request_version,comment,previous_values,new_values)
 values(r.company_id,r.id,auth.uid(),'cancel_unpaid','approved','cancelled',r.version,reason,previous,to_jsonb(r));return to_jsonb(r);
end $$;
revoke all on function public.expense_options(uuid),public.expense_dashboard(uuid),public.travel_cancel_unpaid(uuid,text) from public,anon,service_role;
grant execute on function public.expense_options(uuid),public.expense_dashboard(uuid),public.travel_cancel_unpaid(uuid,text) to authenticated;
commit;
