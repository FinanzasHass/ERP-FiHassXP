begin;
alter table public.employee_reimbursements drop constraint employee_reimbursements_report_id_key;
alter table public.expense_settlements add column advance_applied_amount numeric(18,2) not null default 0 check(advance_applied_amount>=0 and advance_applied_amount<=advance_paid);
create function private.expense_balances(sid uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('advance_paid',s.advance_paid,'accepted_expenses',s.accepted_expenses,'return_due',s.employee_return_due,'reimbursement_due',s.employee_reimbursement_due,
 'return_outstanding',s.employee_return_due-coalesce((select sum(amount) from public.employee_returns where settlement_id=s.id and status='reconciled'),0),
 'reimbursement_outstanding',s.employee_reimbursement_due-coalesce((select sum(p.allocated_paid_amount) from public.employee_reimbursements e join public.payables p on p.employee_reimbursement_id=e.id where e.settlement_id=s.id),0))
 from public.expense_settlements s where s.id=sid;
$$;
create function private.expense_make_settlement(rid uuid) returns public.expense_settlements language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare r public.expense_reports;s public.expense_settlements;a public.employee_advances;e public.employee_reimbursements;i public.expense_report_items;paid numeric:=0;begin
 select * into r from public.expense_reports where id=rid for update;
 select * into s from public.expense_settlements where report_id=rid and status='valid';if found then return s;end if;
 if r.employee_advance_id is not null then
  select * into a from public.employee_advances where id=r.employee_advance_id;
  if a.paid_amount<>a.approved_amount then raise exception using errcode='23514',message='Advance must be fully delivered before settlement';end if;
  paid:=a.paid_amount;
 end if;
 if r.total_accepted>paid then
  perform private.finance_require('employee_reimbursement.create',r.company_id);
  perform private.finance_require('employee_reimbursement.approve',r.company_id);
 end if;
 insert into public.expense_settlements(company_id,report_id,version,advance_paid,accepted_expenses,employee_return_due,employee_reimbursement_due,created_by)
 values(r.company_id,r.id,r.version,paid,r.total_accepted,greatest(paid-r.total_accepted,0),greatest(r.total_accepted-paid,0),auth.uid()) returning * into s;
 if s.employee_reimbursement_due>0 then
  insert into public.employee_reimbursements(company_id,employee_id,report_id,settlement_id,currency_id,approved_amount,approved_by)
  values(r.company_id,r.employee_id,r.id,s.id,r.currency_id,s.employee_reimbursement_due,auth.uid()) returning * into e;
  select * into i from public.expense_report_items where report_id=r.id and status='accepted' order by id limit 1;
  insert into public.payables(company_id,employee_id,origin_type,origin_id,currency_id,original_amount,outstanding_amount,issue_date,due_date,payment_term_snapshot,due_date_basis_date,requires_acceptance,status,cost_center_id,project_id,subproject_id,dimension_snapshot,created_by)
  values(r.company_id,r.employee_id,'employee_reimbursement',e.id,r.currency_id,e.approved_amount,e.approved_amount,current_date,current_date,jsonb_build_object('basis','approved_expense_report','report_id',r.id),current_date,false,'approved',i.cost_center_id,i.project_id,i.subproject_id,i.dimension_snapshot,auth.uid());
 end if;return s;
end $$;
create function public.expense_report_transition(target_id uuid,action text,reason text default null) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare r public.expense_reports;p public.employee_expense_policies;s public.expense_settlements;previous jsonb;b jsonb;owner uuid;begin
 perform private.treasury_lock();select * into r from public.expense_reports where id=target_id for update;
 if not found then raise exception using errcode='42501',message='Expense report unavailable';end if;
 if action is null or action not in ('submit','approve','observe','reject','close','reopen') then raise exception using errcode='22023',message='Invalid expense action';end if;
 perform private.finance_require('expense_report.'||action,r.company_id);
 select profile_id into owner from public.employees where id=r.employee_id and active;
 if not found then raise exception using errcode='23514',message='Active employee required';end if;
 select * into p from public.employee_expense_policies where id=r.policy_id;previous:=to_jsonb(r);
 if action='submit' then
  if owner is distinct from auth.uid() then perform private.finance_require('expense_report.create_for_employee',r.company_id);end if;
  if r.status not in ('draft','observed') or not exists(select 1 from public.expense_report_items where report_id=r.id) then raise exception using errcode='23514',message='Nonempty editable report required';end if;
  if exists(select 1 from public.expense_report_items where report_id=r.id and status='observed') then raise exception using errcode='23514',message='Resolve observed items before submit';end if;
  update public.expense_reports set status='submitted',submitted_by=auth.uid(),submitted_at=now(),version=version+case when r.status='observed' then 1 else 0 end where id=r.id;
 elsif action in ('approve','observe','reject') then
  if auth.uid() in (owner,r.created_by,r.submitted_by) then raise exception using errcode='42501',message='Expense approver segregation';end if;
  if action='approve' and r.status in ('approved','settlement_pending','settled') then
   return to_jsonb(r);
  end if;
  if r.status not in ('submitted','under_review') then raise exception using errcode='23514',message='Invalid expense transition';end if;
  if action='approve' then
   if exists(select 1 from public.expense_report_items i where report_id=r.id and (status in ('pending','observed') or (status='accepted' and not private.expense_support_valid(i,p)))) then raise exception using errcode='23514',message='Reviewed supported items required';end if;
   if p.require_distinct_reviewer and exists(select 1 from public.expense_report_items where report_id=r.id and reviewed_by=auth.uid()) then raise exception using errcode='42501',message='Reviewer and approver must differ';end if;
   update public.expense_reports set status='approved',approved_by=auth.uid() where id=r.id;
   s:=private.expense_make_settlement(r.id);
   update public.expense_reports set status='settlement_pending' where id=r.id;
  else
   if reason is null or length(trim(reason)) not between 1 and 2000 then raise exception using errcode='22023',message='Reason required';end if;
   update public.expense_reports set status=case when action='observe' then 'observed' else 'cancelled' end where id=r.id;
  end if;
 elsif action='close' then
  if r.status='settled' then return to_jsonb(r);end if;
  if r.status<>'settlement_pending' then raise exception using errcode='23514',message='Approved settlement required';end if;
  select * into s from public.expense_settlements where report_id=r.id and status='valid';b:=private.expense_balances(s.id);
  if s.id is null or (b->>'return_outstanding')::numeric<>0 or (b->>'reimbursement_outstanding')::numeric<>0 then raise exception using errcode='23514',message='Outstanding employee settlement';end if;
  if exists(select 1 from public.expense_report_items i where report_id=r.id and (status in ('pending','observed') or (status='accepted' and not private.expense_support_valid(i,p)))) then raise exception using errcode='23514',message='Documentary policy incomplete';end if;
  if r.employee_advance_id is not null and not exists(select 1 from public.employee_advances where id=r.employee_advance_id and paid_amount=s.advance_paid and paid_amount=approved_amount) then raise exception using errcode='23514',message='Advance changed since settlement';end if;
  update public.expense_reports set status='settled' where id=r.id;
  update public.expense_settlements set advance_applied_amount=advance_paid where id=s.id;
  if r.employee_advance_id is not null then update public.employee_advances set outstanding_to_render=0,status='settled' where id=r.employee_advance_id;end if;
 elsif action='reopen' then
  if not p.allow_reopen or r.status not in ('settled','settlement_pending') then raise exception using errcode='23514',message='Policy does not allow reopening';end if;
  if reason is null or length(trim(reason)) not between 1 and 2000 then raise exception using errcode='22023',message='Reopening reason required';end if;
  select * into s from public.expense_settlements where report_id=r.id and status='valid';
  if exists(select 1 from public.employee_returns where settlement_id=s.id and status not in ('cancelled','reversed')) or
   exists(select 1 from public.employee_reimbursements e join public.payables p0 on p0.employee_reimbursement_id=e.id where e.settlement_id=s.id and
    (p0.allocated_paid_amount>0 or exists(select 1 from public.payment_order_items oi join public.payment_orders o on o.id=oi.payment_order_id where oi.payable_id=p0.id and o.status<>'cancelled'))) then raise exception using errcode='23514',message='Reverse financial effects before reopening';end if;
  update public.payables set status='cancelled' where employee_reimbursement_id in(select id from public.employee_reimbursements where settlement_id=s.id);
  update public.employee_reimbursements set status='cancelled' where settlement_id=s.id;
  update public.expense_settlements set status='superseded',advance_applied_amount=0 where id=s.id;
  update public.expense_reports set status='observed',approved_by=null,version=version+1 where id=r.id;
  if r.employee_advance_id is not null then update public.employee_advances set outstanding_to_render=paid_amount,status=case when paid_amount=approved_amount then 'paid' when paid_amount>0 then 'partially_paid' else 'approved' end where id=r.employee_advance_id;end if;
 end if;
 update public.expense_reports set updated_at=now() where id=r.id returning * into r;
 perform private.expense_history(r.id,action,reason,previous);return to_jsonb(r);
end $$;
create function public.expense_settlement_detail(target_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.expense_settlements;begin
 if not private.expense_visible(target_id) then raise exception using errcode='42501',message='Expense settlement unavailable';end if;
 select * into s from public.expense_settlements where report_id=target_id and status='valid';
 return case when s.id is null then null else to_jsonb(s)||private.expense_balances(s.id) end;
end $$;
create function public.employee_return_register(settlement_id uuid,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare s public.expense_settlements;r public.expense_reports;e public.employee_returns;n numeric;reserved numeric;begin
 perform private.treasury_lock();select * into s from public.expense_settlements where id=settlement_id and status='valid' for update;
 if not found then raise exception using errcode='42501',message='Settlement unavailable';end if;
 select * into r from public.expense_reports where id=s.report_id;perform private.finance_require('employee_return.register',r.company_id);
 if jsonb_typeof(payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(payload) k where k not in ('amount','return_date','payment_method_id','reference','idempotency_key')) then raise exception using errcode='22023',message='Invalid return fields';end if;
 n:=private.expense_money(payload->'amount');
 select * into e from public.employee_returns where company_id=r.company_id and idempotency_key=(payload->>'idempotency_key')::uuid;
 if found then
  if e.settlement_id<>s.id or e.amount<>n or e.return_date<>(payload->>'return_date')::date or e.payment_method_id<>(payload->>'payment_method_id')::uuid or e.reference is distinct from payload->>'reference' then raise exception using errcode='23514',message='Idempotency payload mismatch';end if;return to_jsonb(e);
 end if;
 select coalesce(sum(amount),0) into reserved from public.employee_returns where employee_returns.settlement_id=s.id and status not in ('cancelled','reversed');
 if r.status<>'settlement_pending' or n<=0 or n>s.employee_return_due-reserved then raise exception using errcode='23514',message='Return exceeds unreserved balance';end if;
 if not exists(select 1 from public.payment_methods where id=(payload->>'payment_method_id')::uuid and company_id=r.company_id and active) then raise exception using errcode='23514',message='Active company payment method required';end if;
 insert into public.employee_returns(company_id,employee_id,settlement_id,currency_id,amount,return_date,payment_method_id,reference,idempotency_key,created_by)
 values(r.company_id,r.employee_id,s.id,r.currency_id,n,(payload->>'return_date')::date,(payload->>'payment_method_id')::uuid,payload->>'reference',(payload->>'idempotency_key')::uuid,auth.uid()) returning * into e;
 perform private.expense_history(r.id,'return.register',null,null,to_jsonb(e));return to_jsonb(e);
end $$;

-- A settled advance cannot silently change the basis of a validated settlement.
create function private.guard_advance_payment_reverse() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status='executed' and new.status='reversed' and exists(select 1 from public.payment_allocations pa join public.payables p on p.id=pa.payable_id join public.expense_reports r on r.employee_advance_id=p.employee_advance_id join public.expense_settlements s on s.report_id=r.id and s.status='valid' where pa.payment_id=old.id) then raise exception using errcode='23514',message='Reopen expense settlement before reversing advance';end if;
 return new;
end $$;
create trigger guard_advance_payment_reverse before update of status on public.payments for each row execute function private.guard_advance_payment_reverse();

alter function private.treasury_refresh(uuid) rename to treasury_refresh_before_expense_settlement;
create function private.treasury_refresh(c uuid) returns void language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare r record;b jsonb;begin
 perform private.treasury_refresh_before_expense_settlement(c);
 update public.employee_returns e set status=case when x.reconciled=e.amount then 'reconciled' when x.matched>0 then 'matched' else 'registered' end
 from (select e0.id,coalesce(sum(m.amount) filter(where m.status<>'cancelled'),0) matched,coalesce(sum(m.amount) filter(where m.status='reconciled'),0) reconciled from public.employee_returns e0 left join public.bank_reconciliation_matches m on m.employee_return_id=e0.id where e0.company_id=c group by e0.id) x
 where e.id=x.id and e.status not in ('cancelled','reversed');
 update public.employee_reimbursements e set paid_amount=p.allocated_paid_amount,status=case when p.status='cancelled' then 'cancelled' when p.allocated_paid_amount=e.approved_amount then 'paid' when p.allocated_paid_amount>0 then 'partially_paid' else 'approved' end from public.payables p where p.employee_reimbursement_id=e.id and e.company_id=c;
 for r in select er.id,s.id sid from public.expense_reports er join public.expense_settlements s on s.report_id=er.id and s.status='valid' where er.company_id=c and er.status='settled' loop
  b:=private.expense_balances(r.sid);
  if (b->>'return_outstanding')::numeric>0 or (b->>'reimbursement_outstanding')::numeric>0 then
   update public.expense_reports set status='settlement_pending',updated_at=now() where id=r.id;
   update public.expense_settlements set advance_applied_amount=0 where id=r.sid;
   perform private.expense_history(r.id,'treasury.balance_reopened','Treasury reversal restored outstanding balance');
  end if;
 end loop;
 update public.employee_advances a set outstanding_to_render=a.paid_amount-coalesce((select sum(s.advance_applied_amount) from public.expense_reports r join public.expense_settlements s on s.report_id=r.id and s.status='valid' where r.employee_advance_id=a.id),0),
 status=case when exists(select 1 from public.expense_reports r where r.employee_advance_id=a.id and r.status='settled') then 'settled' when a.status='settled' then case when a.paid_amount=a.approved_amount then 'paid' when a.paid_amount>0 then 'partially_paid' else 'approved' end else a.status end where a.company_id=c;
end $$;
revoke all on function private.expense_balances(uuid),private.expense_make_settlement(uuid),private.guard_advance_payment_reverse(),private.treasury_refresh(uuid),private.treasury_refresh_before_expense_settlement(uuid) from public,anon,authenticated,service_role;
revoke all on function public.expense_report_transition(uuid,text,text),public.expense_settlement_detail(uuid),public.employee_return_register(uuid,jsonb) from public,anon,service_role;
grant execute on function public.expense_report_transition(uuid,text,text),public.expense_settlement_detail(uuid),public.employee_return_register(uuid,jsonb) to authenticated;
commit;
