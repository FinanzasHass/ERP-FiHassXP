begin;
alter table public.bank_reconciliation_matches alter column payment_id drop not null,
 add column employee_return_id uuid,
 add foreign key(company_id,employee_return_id) references public.employee_returns(company_id,id),
 add constraint reconciliation_single_target check((payment_id is not null)::integer+(employee_return_id is not null)::integer=1);
create function public.employee_return_match(return_id uuid,period_id uuid,transaction_id uuid,amount jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare e public.employee_returns;t public.bank_transactions;p public.bank_reconciliation_periods;m public.bank_reconciliation_matches;n numeric;begin
 perform private.treasury_lock();select * into e from public.employee_returns where id=return_id for update;
 if not found then raise exception using errcode='42501',message='Employee return unavailable';end if;
 perform private.finance_require('employee_return.match',e.company_id);perform private.finance_require('bank_reconciliation.match',e.company_id);
 if e.created_by=auth.uid() or exists(select 1 from public.employees where id=e.employee_id and profile_id=auth.uid()) then raise exception using errcode='42501',message='Return reconciliation segregation';end if;
 select * into t from public.bank_transactions where id=transaction_id and company_id=e.company_id;
 select * into p from public.bank_reconciliation_periods where id=period_id and company_id=e.company_id;
 if t.id is null or p.id is null or p.status<>'open' or t.bank_account_id<>p.bank_account_id or t.transaction_date not between p.start_date and p.end_date or t.currency_id<>e.currency_id or t.evidence_state<>'confirmed' or t.transaction_type<>'credit' or t.status='excluded' or e.status in ('cancelled','reversed','reconciled') then raise exception using errcode='23514',message='Incompatible employee return match';end if;
 if not exists(select 1 from public.attachments where entity_type='employee_return_evidence' and entity_id=e.id and company_id=e.company_id and status='ready') then raise exception using errcode='23514',message='Encrypted return evidence required';end if;
 n:=private.expense_money(amount);
 if n<=0 or n>e.amount-coalesce((select sum(m0.amount) from public.bank_reconciliation_matches m0 where employee_return_id=e.id and status<>'cancelled'),0) or n>t.amount-coalesce((select sum(m0.amount) from public.bank_reconciliation_matches m0 where bank_transaction_id=t.id and status<>'cancelled'),0) then raise exception using errcode='23514',message='Match exceeds remaining balance';end if;
 insert into public.bank_reconciliation_matches(company_id,period_id,bank_transaction_id,employee_return_id,amount,matched_by)
 values(e.company_id,p.id,t.id,e.id,n,auth.uid()) returning * into m;
 perform private.treasury_refresh(e.company_id);return to_jsonb(m);
end $$;
create function public.employee_return_candidates(return_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e public.employee_returns;begin
 select * into e from public.employee_returns where id=return_id;
 if not found then raise exception using errcode='42501',message='Return unavailable';end if;
 perform private.finance_require('employee_return.match',e.company_id);perform private.finance_require('bank_transaction.view',e.company_id);
 return (select coalesce(jsonb_agg(x),'[]') from (select t.id,t.transaction_date,t.amount,t.bank_reference,t.bank_account_id from public.bank_transactions t where company_id=e.company_id and currency_id=e.currency_id and transaction_type='credit' and evidence_state='confirmed' and status in ('unmatched','partially_matched') order by abs(transaction_date-e.return_date),id limit 100)x);
end $$;
create function public.employee_return_cancel(target_id uuid,reason text) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare e public.employee_returns;begin
 perform private.treasury_lock();select * into e from public.employee_returns where id=target_id for update;
 if not found then raise exception using errcode='42501',message='Return unavailable';end if;perform private.finance_require('employee_return.register',e.company_id);
 if reason is null or length(trim(reason)) not between 1 and 2000 then raise exception using errcode='22023',message='Cancellation reason required';end if;
 if exists(select 1 from public.bank_reconciliation_matches where employee_return_id=e.id and status<>'cancelled') then raise exception using errcode='23514',message='Unmatch return first';end if;
 if e.status='cancelled' then return to_jsonb(e);end if;
 update public.employee_returns set status='cancelled' where id=e.id returning * into e;
 perform private.expense_history((select report_id from public.expense_settlements where id=e.settlement_id),'return.cancel',reason,null,to_jsonb(e));
 perform private.treasury_refresh(e.company_id);return to_jsonb(e);
end $$;
alter function public.treasury_action(text,uuid,text,jsonb) rename to treasury_action_before_expense;
create function public.treasury_action(kind text,target_id uuid,action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare m public.bank_reconciliation_matches;e public.employee_returns;c uuid;oid uuid;begin
 perform private.treasury_lock();
 if kind='reconciliation_match' then
  select * into m from public.bank_reconciliation_matches where id=target_id;
  if m.employee_return_id is not null then
   if action is null or action not in ('reconcile','unmatch') or jsonb_typeof(payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(payload) k where k<>'reason') then raise exception using errcode='22023',message='Invalid return reconciliation action';end if;
   perform private.finance_require('employee_return.match',m.company_id);perform private.finance_require(case when action='reconcile' then 'bank_reconciliation.reconcile' else 'bank_reconciliation.match' end,m.company_id);
   select * into e from public.employee_returns where id=m.employee_return_id;
   if e.created_by=auth.uid() or exists(select 1 from public.employees where id=e.employee_id and profile_id=auth.uid()) then raise exception using errcode='42501',message='Return reconciliation segregation';end if;
   if not exists(select 1 from public.bank_reconciliation_periods where id=m.period_id and status='open') then raise exception using errcode='23514',message='Closed reconciliation immutable';end if;
   if action='reconcile' and m.status='matched' and e.status not in ('cancelled','reversed') then
    update public.bank_reconciliation_matches set status='reconciled',reconciled_by=auth.uid(),reconciled_at=now() where id=m.id returning * into m;
   elsif action='unmatch' and m.status in ('matched','reconciled') then
    if coalesce(length(trim(payload->>'reason')),0) not between 1 and 2000 then raise exception using errcode='22023',message='Unmatch reason required';end if;
    update public.bank_reconciliation_matches set status='cancelled',reason=payload->>'reason' where id=m.id returning * into m;
   else raise exception using errcode='23514',message='Invalid return reconciliation transition';end if;
   perform private.treasury_refresh(m.company_id);return to_jsonb(m);
  end if;
 elsif kind='reconciliation_period' and action='close' then
  select company_id into c from public.bank_reconciliation_periods where id=target_id;perform private.finance_require('bank_reconciliation.close',c);
  if exists(select 1 from public.bank_reconciliation_matches x join public.employee_returns r on r.id=x.employee_return_id join public.employees emp on emp.id=r.employee_id where x.period_id=target_id and x.status<>'cancelled' and auth.uid() in (r.created_by,emp.profile_id)) then raise exception using errcode='42501',message='Return actor cannot close reconciliation';end if;
 elsif (kind='payment_order' and action='approve') or (kind='payment' and action='execute') then
  if kind='payment_order' then select id,company_id into oid,c from public.payment_orders where id=target_id;
  else select payment_order_id,company_id into oid,c from public.payments where id=target_id;end if;
  perform private.finance_require(case when kind='payment_order' then 'payment_order.approve' else 'payment.execute' end,c);
  if exists(select 1 from public.payment_order_items oi join public.payables p on p.id=oi.payable_id join public.employee_reimbursements re on re.id=p.employee_reimbursement_id join public.expense_reports r on r.id=re.report_id join public.employees emp on emp.id=re.employee_id where oi.payment_order_id=oid and
   (auth.uid() in (re.approved_by,emp.profile_id) or (kind='payment' and auth.uid() in (r.created_by,r.submitted_by)))) then raise exception using errcode='42501',message='Reimbursement financial segregation';end if;
 end if;
 return public.treasury_action_before_expense(kind,target_id,action,payload);
end $$;
revoke all on function public.treasury_action_before_expense(text,uuid,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.treasury_action(text,uuid,text,jsonb),public.employee_return_match(uuid,uuid,uuid,jsonb),public.employee_return_candidates(uuid),public.employee_return_cancel(uuid,text) from public,anon,service_role;
grant execute on function public.treasury_action(text,uuid,text,jsonb),public.employee_return_match(uuid,uuid,uuid,jsonb),public.employee_return_candidates(uuid),public.employee_return_cancel(uuid,text) to authenticated;
commit;
