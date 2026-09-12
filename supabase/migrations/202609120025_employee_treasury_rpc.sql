begin;

create function private.payable_beneficiary_matches(p public.payables,kind text,bid uuid) returns boolean language sql immutable set search_path='' as $$
 select case kind when 'supplier' then p.supplier_id is not distinct from bid and p.employee_id is null when 'employee' then p.employee_id is not distinct from bid and p.supplier_id is null else false end and bid is not null;
$$;
create function private.beneficiary_active(kind text,bid uuid,c uuid) returns boolean language sql stable security definer set search_path='' as $$
 select case kind when 'supplier' then exists(select 1 from public.supplier_companies where company_id=c and supplier_id=bid and status='active') when 'employee' then exists(select 1 from public.employees where company_id=c and id=bid and active) else false end;
$$;
create function private.beneficiary_account_active(kind text,aid uuid,bid uuid,c uuid,cur uuid) returns boolean language sql stable security definer set search_path='' as $$
 select case kind when 'supplier' then exists(select 1 from public.supplier_bank_accounts where id=aid and company_id=c and supplier_id=bid and currency_id=cur and status='active') when 'employee' then exists(select 1 from public.employee_bank_accounts where id=aid and company_id=c and employee_id=bid and currency_id=cur and status='active') else false end;
$$;

create or replace function private.treasury_order_check(oid uuid,reserve boolean) returns void language plpgsql security definer set search_path='' as $$
#variable_conflict use_column

declare o public.payment_orders;i record;p public.payables;other_amount numeric;begin
 select * into o from public.payment_orders where id=oid;
 if not private.beneficiary_active(o.beneficiary_type,o.beneficiary_id,o.company_id) then raise exception using errcode='23514',message='Active beneficiary required';end if;
 if not exists(select 1 from public.payment_methods where id=o.payment_method_id and company_id=o.company_id and active) then raise exception using errcode='23514',message='Active payment method required';end if;
 if not exists(select 1 from public.payment_order_items where payment_order_id=oid) then raise exception using errcode='23514',message='Items required';end if;
 for i in select * from public.payment_order_items where payment_order_id=oid loop
 select * into p from public.payables where id=i.payable_id for update;
 if p.company_id<>o.company_id or p.currency_id<>o.currency_id or not private.payable_beneficiary_matches(p,o.beneficiary_type,o.beneficiary_id) or p.status<>'approved' then raise exception using errcode='23514',message='Incompatible approved obligation';end if;
 select coalesce(sum(greatest(0,x.amount_to_pay-coalesce((select sum(a.allocated_amount) from public.payment_allocations a join public.payments pay on pay.id=a.payment_id where a.payable_id=p.id and pay.payment_order_id=x.payment_order_id and pay.status='executed'),0))),0) into other_amount from public.payment_order_items x join public.payment_orders po on po.id=x.payment_order_id where x.payable_id=p.id and x.payment_order_id<>oid and po.status in ('submitted','under_review','approved','scheduled','partially_paid');
 if i.amount_to_pay>p.outstanding_amount-(case when reserve then other_amount else 0 end) then raise exception using errcode='23514',message='Amount exceeds unreserved outstanding';end if;
 end loop;end $$;

create or replace function public.treasury_save_v5_core(kind text,target_id uuid,target_company uuid,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column

declare tbl text;perm text;allowed text[];previous jsonb;d jsonb;result jsonb;items jsonb;i jsonb;total numeric;o public.payment_orders;p public.payables;bank public.company_bank_accounts;tid uuid;k text;begin
 perform private.treasury_lock();
 case kind
 when 'bank' then tbl:='banks';perm:='bank';allowed:=array['code','name','country_code','active'];
 when 'bank_account' then tbl:='company_bank_accounts';perm:='bank';allowed:=array['bank_id','currency_id','account_number','cci','account_type','display_name','opening_balance','opening_date','active','valid_from','valid_to'];
 when 'payment_method' then tbl:='payment_methods';perm:='bank';allowed:=array['code','name','requires_beneficiary_account','active'];
 when 'payment_order' then tbl:='payment_orders';perm:='payment_order';allowed:=array['beneficiary_type','beneficiary_id','currency_id','bank_account_id','beneficiary_account_id','payment_method_id','requested_payment_date','description','items'];
 when 'payment' then tbl:='payments';perm:='payment';allowed:=array['payment_order_id','payment_date','operation_number','reference','allocations'];
 when 'payment_batch' then tbl:='payment_batches';perm:='payment_batch';allowed:=array['currency_id','description','individual_approval_required','order_ids'];
 when 'reconciliation_period' then tbl:='bank_reconciliation_periods';perm:='bank_reconciliation';allowed:=array['bank_account_id','start_date','end_date'];
 when 'bank_transaction' then tbl:='bank_transactions';perm:='bank_transaction';allowed:=array['bank_account_id','transaction_date','value_date','transaction_type','amount','bank_reference','description','counterparty','external_id'];
 else raise exception using errcode='22023',message='Unknown treasury entity';end case;
 perform private.finance_require(case when kind='payment' then 'payment.execute' when kind='reconciliation_period' then 'bank_reconciliation.match' when kind='bank_transaction' then 'bank_transaction.create_manual' else perm||case when target_id is null then '.create' else '.edit' end end,target_company);
 if payload is null or jsonb_typeof(payload)<>'object' or exists(select 1 from jsonb_object_keys(payload) x where not x=any(allowed)) then raise exception using errcode='22023',message='Unknown treasury fields';end if;
 if target_id is not null then
 execute format('select to_jsonb(t) from public.%I t where id=$1 and company_id=$2 for update',tbl) into previous using target_id,target_company;
 if previous is null then raise exception using errcode='42501',message='Entity access denied';end if;
 if kind in ('payment','payment_batch','reconciliation_period','bank_transaction') then raise exception using errcode='23514',message='Use controlled actions';end if;
 if kind='payment_order' and previous->>'status' not in ('draft','observed') then raise exception using errcode='23514',message='Approved order immutable';end if;
 if kind='bank_account' and exists(select 1 from jsonb_object_keys(payload) x where x not in ('display_name','active','valid_to')) then raise exception using errcode='23514',message='Bank account identity immutable; create replacement';end if;
 end if;
 if payload->>'active'='false' then perform private.finance_require('bank.disable',target_company);end if;
 d:=coalesce(previous,'{}')||payload;
 if d->>'currency_id' is not null and not exists(select 1 from public.currencies where id=(d->>'currency_id')::uuid and active) then raise exception using errcode='23514',message='Active currency required';end if;
 if kind='bank_account' then payload:=payload||jsonb_build_object('updated_by',auth.uid());end if;
 if kind in ('payment_order','payment','payment_batch') then
 items:=case kind when 'payment_order' then payload->'items' when 'payment' then payload->'allocations' else payload->'order_ids' end;
 if items is null and kind='payment_order' and target_id is not null then select jsonb_agg(jsonb_build_object('payable_id',payable_id,'amount_to_pay',amount_to_pay)) into items from public.payment_order_items where payment_order_id=target_id;end if;
 if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) not between 1 and 100 then raise exception using errcode='23514',message='One to one hundred items required';end if;
 payload:=payload-array['items','allocations','order_ids'];
 total:=0;
 if kind='payment_batch' then
 for i in select * from jsonb_array_elements(items) loop select * into o from public.payment_orders where id=(i#>>'{}')::uuid and company_id=target_company;
 if not found or o.currency_id<>(d->>'currency_id')::uuid or o.status in ('cancelled','rejected','paid','partially_paid') or exists(select 1 from public.payment_batch_items x join public.payment_batches b on b.id=x.batch_id where x.payment_order_id=o.id and b.status<>'cancelled') then raise exception using errcode='23514',message='Incompatible or already batched order';end if;total:=total+o.total_amount;end loop;
 else
 if kind='payment' then select * into o from public.payment_orders where id=(d->>'payment_order_id')::uuid and company_id=target_company;
 if not found or o.status not in ('approved','scheduled','partially_paid') or o.bank_account_id is null then raise exception using errcode='23514',message='Approved programmed order required';end if;
 if o.created_by=auth.uid() or o.approved_by=auth.uid() then raise exception using errcode='42501',message='Payment executor segregation';end if;
 perform private.treasury_bank_check(target_company,o.bank_account_id,o.currency_id,(d->>'payment_date')::date);
 payload:=payload||jsonb_build_object('bank_account_id',o.bank_account_id,'beneficiary_id',o.beneficiary_id,'beneficiary_type',o.beneficiary_type,'currency_id',o.currency_id,'payment_method_id',o.payment_method_id);
 end if;
 for i in select * from jsonb_array_elements(items) loop
 if exists(select 1 from jsonb_object_keys(i) x where x not in ('payable_id','amount_to_pay','allocated_amount')) then raise exception using errcode='22023',message='Invalid item fields';end if;
 select * into p from public.payables where id=(i->>'payable_id')::uuid for update;
 if not found or p.company_id<>target_company or p.status<>'approved' or p.currency_id<>coalesce(o.currency_id,(d->>'currency_id')::uuid) or not private.payable_beneficiary_matches(p,coalesce(o.beneficiary_type,d->>'beneficiary_type','supplier'),coalesce(o.beneficiary_id,(d->>'beneficiary_id')::uuid)) then raise exception using errcode='23514',message='Incompatible obligation';end if;
 if coalesce((i->>'amount_to_pay')::numeric,(i->>'allocated_amount')::numeric,0)<=0 or coalesce((i->>'amount_to_pay')::numeric,(i->>'allocated_amount')::numeric)>p.outstanding_amount then raise exception using errcode='23514',message='Amount exceeds outstanding';end if;
 if kind='payment' and not exists(select 1 from public.payment_order_items x where x.payment_order_id=o.id and x.payable_id=p.id and x.amount_to_pay>= (i->>'allocated_amount')::numeric+coalesce((select sum(a.allocated_amount) from public.payment_allocations a join public.payments pp on pp.id=a.payment_id where pp.payment_order_id=o.id and pp.status='executed' and a.payable_id=p.id),0)) then raise exception using errcode='23514',message='Allocation exceeds order';end if;
 total:=total+coalesce((i->>'amount_to_pay')::numeric,(i->>'allocated_amount')::numeric);end loop;
 end if;
 payload:=payload||jsonb_build_object(case when kind='payment' then 'amount' else 'total_amount' end,total);
 end if;
 if kind='reconciliation_period' then
 if exists(select 1 from public.bank_reconciliation_periods where company_id=target_company and bank_account_id=(d->>'bank_account_id')::uuid and start_date<=(d->>'end_date')::date and end_date>=(d->>'start_date')::date) then raise exception using errcode='23514',message='Overlapping reconciliation period';end if;
 end if;
 if kind in ('bank_transaction','reconciliation_period') then select * into bank from public.company_bank_accounts where id=(d->>'bank_account_id')::uuid and company_id=target_company;if not found then raise exception using errcode='42501',message='Bank company mismatch';end if;
 if kind='bank_transaction' then
 perform private.treasury_bank_check(target_company,bank.id,bank.currency_id,(d->>'transaction_date')::date);
 if exists(select 1 from public.bank_reconciliation_periods where bank_account_id=bank.id and status='closed' and (d->>'transaction_date')::date between start_date and end_date) then raise exception using errcode='23514',message='Closed reconciliation period';end if;
 payload:=payload||jsonb_build_object('currency_id',bank.currency_id,'source','manual','evidence_state','confirmed');end if;end if;
 if target_id is null then payload:=payload||jsonb_build_object('company_id',target_company);
 if kind not in ('bank','payment_method') then payload:=payload||jsonb_build_object('created_by',auth.uid());end if;
 if kind='payment_order' then payload:=payload||jsonb_build_object('payment_order_number',private.next_document_number(target_company,'OP'));end if;
 if kind='payment' then payload:=payload||jsonb_build_object('payment_number',private.next_document_number(target_company,'PAG'));end if;
 if kind='payment_batch' then payload:=payload||jsonb_build_object('batch_number',private.next_document_number(target_company,'LOTE'));end if;end if;
 result:=private.treasury_write(tbl,target_id,target_company,payload);tid:=(result->>'id')::uuid;
 if kind='payment_order' then
 delete from public.payment_order_items where payment_order_id=tid;
 insert into public.payment_order_items(company_id,payment_order_id,payable_id,amount_to_pay) select target_company,tid,x.payable_id,x.amount_to_pay from jsonb_to_recordset(items)x(payable_id uuid,amount_to_pay numeric);perform private.treasury_order_check(tid,false);
 elsif kind='payment' then insert into public.payment_allocations(company_id,payment_id,payable_id,allocated_amount) select target_company,tid,x.payable_id,x.allocated_amount from jsonb_to_recordset(items)x(payable_id uuid,allocated_amount numeric);
 elsif kind='payment_batch' then insert into public.payment_batch_items(company_id,batch_id,payment_order_id) select target_company,tid,(x#>>'{}')::uuid from jsonb_array_elements(items)x;end if;
 return result;end $$;

create or replace function public.treasury_action(kind text,target_id uuid,action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column

declare tbl text;d jsonb;c uuid;s text;next_s text;perm text;note text:=payload->>'reason';o public.payment_orders;pay public.payments;p public.payables;i record;b public.payment_batches;per public.bank_reconciliation_periods;m public.bank_reconciliation_matches;tr public.bank_transactions;used numeric;result jsonb;begin
 perform private.treasury_lock();
 if payload is null or jsonb_typeof(payload)<>'object' or exists(select 1 from jsonb_object_keys(payload)x where x not in ('reason','bank_account_id','scheduled_payment_date')) then raise exception using errcode='22023',message='Unknown action fields';end if;
 if action not in ('submit','review','approve','observe','reject','cancel','schedule','execute','reverse','reopen','reconcile','close','unmatch','exclude') then raise exception using errcode='22023',message='Unknown action';end if;
 tbl:=case kind when 'payment_order' then 'payment_orders' when 'payment' then 'payments' when 'payment_batch' then 'payment_batches' when 'reconciliation_period' then 'bank_reconciliation_periods' when 'reconciliation_match' then 'bank_reconciliation_matches' when 'bank_transaction' then 'bank_transactions' end;
 if tbl is null then raise exception using errcode='22023',message='Unknown workflow';end if;
 execute format('select to_jsonb(t) from public.%I t where id=$1 for update',tbl) into d using target_id;
 if d is null then raise exception using errcode='42501',message='Entity access denied';end if;c:=(d->>'company_id')::uuid;s:=d->>'status';
 perm:=case when kind='bank_transaction' then 'bank_reconciliation.reconcile' when kind='payment_order' and action='schedule' then 'payment.schedule' when kind='payment_order' and action='review' then 'payment_order.approve' when kind='payment_order' and action='reopen' then 'payment_order.edit' when kind='payment' and action='cancel' then 'payment.execute' when kind='reconciliation_period' then 'bank_reconciliation.'||action when kind='reconciliation_match' and action='unmatch' then 'bank_reconciliation.match' when kind='reconciliation_match' then 'bank_reconciliation.reconcile' else kind||'.'||action end;
 perform private.finance_require(perm,c);
 if action in ('observe','reject','cancel','reverse','reopen','unmatch','exclude') and coalesce(length(trim(note)),0)=0 then raise exception using errcode='23514',message='Reason required';end if;
 if kind='payment_order' then
 select * into o from public.payment_orders where id=target_id;
 if action='submit' and s in ('draft','observed') then perform private.treasury_order_check(o.id,true);next_s:='submitted';update public.payment_orders set submitted_by=auth.uid() where id=o.id;
 elsif action='review' and s='submitted' then next_s:='under_review';
 elsif action in ('approve','observe','reject') and s in ('submitted','under_review') then
 if o.created_by=auth.uid() then raise exception using errcode='42501',message='Order self approval prohibited';end if;
 next_s:=case action when 'approve' then 'approved' when 'observe' then 'observed' else 'rejected' end;
 if action='approve' then
 if exists(select 1 from public.payment_order_items i join public.payables p on p.id=i.payable_id join public.employee_advances a on a.id=p.employee_advance_id join public.employees e on e.id=a.employee_id where i.payment_order_id=o.id and (a.approved_by=auth.uid() or e.profile_id=auth.uid())) then raise exception using errcode='42501',message='Travel and financial approval segregation';end if;
 perform private.treasury_order_check(o.id,true);update public.payment_orders set approved_by=auth.uid(),approved_at=now() where id=o.id;end if;
 elsif action='schedule' and s in ('approved','scheduled') then
 perform private.treasury_bank_check(c,(payload->>'bank_account_id')::uuid,o.currency_id,(payload->>'scheduled_payment_date')::date);
 if payload->>'scheduled_payment_date' is null then raise exception using errcode='23514',message='Schedule date required';end if;
 update public.payment_orders set bank_account_id=(payload->>'bank_account_id')::uuid,scheduled_payment_date=(payload->>'scheduled_payment_date')::date where id=o.id;next_s:='scheduled';
 elsif action in ('cancel','reopen') and s not in ('paid','partially_paid','cancelled','rejected') then
 if exists(select 1 from public.payments where payment_order_id=o.id and status in ('draft','executed')) or exists(select 1 from public.payment_batch_items i join public.payment_batches b on b.id=i.batch_id where i.payment_order_id=o.id and b.status<>'cancelled') then raise exception using errcode='23514',message='Active downstream payment or batch';end if;
 next_s:=case action when 'cancel' then 'cancelled' else 'draft' end;
 update public.payment_orders set version=version+case when action='reopen' then 1 else 0 end,approved_by=case when action='reopen' then null else approved_by end,approved_at=case when action='reopen' then null else approved_at end,cancellation_reason=note,cancelled_by=case when action='cancel' then auth.uid() end,cancelled_at=case when action='cancel' then now() end where id=o.id;
 else raise exception using errcode='23514',message='Invalid order transition';end if;
 elsif kind='payment' then
 select * into pay from public.payments where id=target_id;select * into o from public.payment_orders where id=pay.payment_order_id;
 if action='execute' and s='draft' then
 if not private.beneficiary_active(pay.beneficiary_type,pay.beneficiary_id,c) then raise exception using errcode='23514',message='Active beneficiary required';end if;
 if exists(select 1 from public.payment_order_items i join public.payables p on p.id=i.payable_id join public.employee_advances a on a.id=p.employee_advance_id join public.travel_expense_requests r on r.id=a.travel_request_id join public.employees e on e.id=a.employee_id where i.payment_order_id=o.id and auth.uid() in (a.approved_by,r.created_by,r.submitted_by,e.profile_id)) then raise exception using errcode='42501',message='Employee payment executor segregation';end if;
 if o.status not in ('approved','scheduled','partially_paid') or o.approved_by is null or o.bank_account_id<>pay.bank_account_id then raise exception using errcode='23514',message='Approved order required';end if;
 if auth.uid() in (o.created_by,o.approved_by) then raise exception using errcode='42501',message='Payment executor segregation';end if;
 if exists(select 1 from public.payment_batch_items i join public.payment_batches b on b.id=i.batch_id where i.payment_order_id=o.id and b.status not in ('approved','processing','partially_completed','completed','cancelled')) then raise exception using errcode='23514',message='Batch approval required';end if;
 if exists(select 1 from public.payment_batch_items i join public.payment_batches b on b.id=i.batch_id where i.payment_order_id=o.id and b.status<>'cancelled' and b.approved_by=auth.uid()) then raise exception using errcode='42501',message='Batch approver cannot execute';end if;
 perform private.treasury_bank_check(c,pay.bank_account_id,pay.currency_id,pay.payment_date);
 if not exists(select 1 from public.payment_methods where id=pay.payment_method_id and active) then raise exception using errcode='23514',message='Inactive payment method';end if;
 if (select requires_beneficiary_account from public.payment_methods where id=pay.payment_method_id) and not private.beneficiary_account_active(pay.beneficiary_type,o.beneficiary_account_id,pay.beneficiary_id,c,pay.currency_id) then raise exception using errcode='23514',message='Approved active beneficiary account required';end if;
 if not exists(select 1 from public.attachments where entity_type='payment' and entity_id=pay.id and company_id=c and status='ready') then raise exception using errcode='23514',message='Voucher required';end if;
 if (select coalesce(sum(allocated_amount),0) from public.payment_allocations where payment_id=pay.id)<>pay.amount then raise exception using errcode='23514',message='Payment allocation total mismatch';end if;
 for i in select * from public.payment_allocations where payment_id=pay.id loop
 select * into p from public.payables where id=i.payable_id for update;
 if p.status<>'approved' or p.company_id<>c or not private.payable_beneficiary_matches(p,pay.beneficiary_type,pay.beneficiary_id) or p.currency_id<>pay.currency_id or i.allocated_amount>p.outstanding_amount then raise exception using errcode='23514',message='Allocation exceeds approved outstanding';end if;
 select coalesce(sum(a.allocated_amount),0) into used from public.payment_allocations a join public.payments pp on pp.id=a.payment_id where a.payable_id=p.id and pp.payment_order_id=o.id and pp.status='executed';
 if not exists(select 1 from public.payment_order_items where payment_order_id=o.id and payable_id=p.id and amount_to_pay>=used+i.allocated_amount) then raise exception using errcode='23514',message='Allocation exceeds order';end if;
 end loop;
 update public.payments set executed_by=auth.uid(),executed_at=now(),status='executed' where id=pay.id;
 insert into public.bank_transactions(company_id,bank_account_id,transaction_date,transaction_type,amount,currency_id,bank_reference,description,source,evidence_state,payment_id,created_by) values(c,pay.bank_account_id,pay.payment_date,'debit',pay.amount,pay.currency_id,pay.operation_number,'Salida esperada registrada en pago','payment','expected',pay.id,auth.uid());next_s:='executed';
 elsif action='reverse' and s='executed' then
 if exists(select 1 from public.bank_reconciliation_matches where payment_id=pay.id and status<>'cancelled') then raise exception using errcode='23514',message='Reopen and unmatch reconciliation before reversing';end if;
 update public.payments set reversed_by=auth.uid(),reversed_at=now(),reversal_reason=note,status='reversed' where id=pay.id;
 insert into public.bank_transactions(company_id,bank_account_id,transaction_date,transaction_type,amount,currency_id,bank_reference,description,source,evidence_state,payment_id,created_by) values(c,pay.bank_account_id,current_date,'credit',pay.amount,pay.currency_id,pay.operation_number,'Reverso esperado: '||note,'reversal','expected',pay.id,auth.uid());next_s:='reversed';
 elsif action='cancel' and s='draft' then next_s:='cancelled';update public.payments set reversal_reason=note where id=pay.id;
 else raise exception using errcode='23514',message='Invalid payment transition';end if;
 elsif kind='payment_batch' then
 select * into b from public.payment_batches where id=target_id;
 if action='submit' and s='draft' then next_s:='submitted';
 elsif action='approve' and s='submitted' then
 if b.created_by=auth.uid() then raise exception using errcode='42501',message='Batch self approval prohibited';end if;
 for i in select o.* from public.payment_orders o join public.payment_batch_items x on x.payment_order_id=o.id where x.batch_id=b.id loop
 if b.individual_approval_required then if i.status not in ('approved','scheduled') then raise exception using errcode='23514',message='Individual order approval required';end if;
 else perform private.finance_require('payment_order.approve',c);if i.status not in ('submitted','under_review') or i.created_by=auth.uid() then raise exception using errcode='42501',message='Substitute order approval segregation';end if;perform private.treasury_order_check(i.id,true);update public.payment_orders set status='approved',approved_by=auth.uid(),approved_at=now() where id=i.id;end if;end loop;
 update public.payment_batches set approved_by=auth.uid(),approved_at=now() where id=b.id;next_s:='approved';
 elsif action='cancel' and s not in ('completed','cancelled') and not exists(select 1 from public.payment_batch_items i join public.payments p on p.payment_order_id=i.payment_order_id where i.batch_id=b.id and p.status='executed') then next_s:='cancelled';
 else raise exception using errcode='23514',message='Invalid batch transition';end if;
 elsif kind='reconciliation_period' then
 select * into per from public.bank_reconciliation_periods where id=target_id;
 if action='close' and s='open' then
 if exists(select 1 from public.bank_transactions where bank_account_id=per.bank_account_id and evidence_state='confirmed' and transaction_date between per.start_date and per.end_date and status not in ('reconciled','excluded')) then raise exception using errcode='23514',message='Unreconciled bank transactions';end if;
 if exists(select 1 from public.payments p where p.bank_account_id=per.bank_account_id and p.payment_date between per.start_date and per.end_date and p.status='executed' and p.amount>coalesce((select sum(x.amount) from public.bank_reconciliation_matches x where x.payment_id=p.id and x.status='reconciled'),0)) then raise exception using errcode='23514',message='Payments pending reconciliation';end if;
 if exists(select 1 from public.bank_reconciliation_matches m join public.payments p on p.id=m.payment_id where m.period_id=per.id and m.status<>'cancelled' and (p.executed_by=auth.uid() or exists(select 1 from public.payment_orders x where x.id=p.payment_order_id and auth.uid() in (x.created_by,x.approved_by)))) then raise exception using errcode='42501',message='Executor cannot close reconciliation';end if;
 next_s:='closed';update public.bank_reconciliation_periods set closed_by=auth.uid(),closed_at=now() where id=per.id;
 elsif action='reopen' and s='closed' then next_s:='open';update public.bank_reconciliation_periods set reopened_by=auth.uid(),reopened_at=now(),reopen_reason=note where id=per.id;
 else raise exception using errcode='23514',message='Invalid reconciliation transition';end if;
 elsif kind='bank_transaction' then
 select * into tr from public.bank_transactions where id=target_id;
 if action<>'exclude' or tr.evidence_state<>'confirmed' or tr.status<>'unmatched' or exists(select 1 from public.bank_reconciliation_periods where bank_account_id=tr.bank_account_id and status='closed' and tr.transaction_date between start_date and end_date) then raise exception using errcode='23514',message='Movement cannot be excluded from matching';end if;
 next_s:='excluded';update public.bank_transactions set exclusion_reason=note where id=tr.id;
 elsif kind='reconciliation_match' then
 select * into m from public.bank_reconciliation_matches where id=target_id;select * into per from public.bank_reconciliation_periods where id=m.period_id;select * into pay from public.payments where id=m.payment_id;
 if per.status<>'open' then raise exception using errcode='23514',message='Closed reconciliation immutable';end if;
 if pay.executed_by=auth.uid() or exists(select 1 from public.payment_orders x where x.id=pay.payment_order_id and auth.uid() in (x.created_by,x.approved_by)) then raise exception using errcode='42501',message='Executor or order actor cannot reconcile';end if;
 if action='reconcile' and s='matched' and pay.status='executed' then next_s:='reconciled';update public.bank_reconciliation_matches set reconciled_by=auth.uid(),reconciled_at=now() where id=m.id;
 elsif action='unmatch' and s in ('matched','reconciled') then next_s:='cancelled';update public.bank_reconciliation_matches set reason=note where id=m.id;
 else raise exception using errcode='23514',message='Invalid matching transition';end if;end if;
 result:=private.treasury_write(tbl,target_id,c,jsonb_build_object('status',next_s));perform private.treasury_refresh(c);execute format('select to_jsonb(t) from public.%I t where id=$1',tbl) into result using target_id;return result;end $$;

create or replace function private.treasury_refresh(c uuid) returns void language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
 begin
 update public.payables p set allocated_paid_amount=x.paid,outstanding_amount=p.original_amount-x.paid from (select y.id,coalesce(sum(a.allocated_amount) filter(where pay.status='executed'),0) paid from public.payables y left join public.payment_allocations a on a.payable_id=y.id left join public.payments pay on pay.id=a.payment_id where y.company_id=c group by y.id) x where p.id=x.id and p.allocated_paid_amount<>x.paid;
 update public.payment_orders o set status=case when x.paid>=o.total_amount then 'paid' when x.paid>0 then 'partially_paid' when o.scheduled_payment_date is not null then 'scheduled' else 'approved' end from (select po.id,coalesce(sum(p.amount) filter(where p.status='executed'),0) paid from public.payment_orders po left join public.payments p on p.payment_order_id=po.id where po.company_id=c and po.status in ('approved','scheduled','partially_paid','paid') group by po.id) x where o.id=x.id;
 update public.payment_batches b set status=case when not exists(select 1 from public.payment_batch_items i join public.payment_orders o on o.id=i.payment_order_id where i.batch_id=b.id and o.status<>'paid') then 'completed' when exists(select 1 from public.payment_batch_items i join public.payment_orders o on o.id=i.payment_order_id where i.batch_id=b.id and o.status in ('paid','partially_paid')) then 'partially_completed' else 'approved' end where b.company_id=c and b.status in ('approved','processing','partially_completed','completed');
 update public.bank_transactions t set status=case when x.reconciled=t.amount then 'reconciled' when x.matched=t.amount then 'matched' when x.matched>0 then 'partially_matched' else 'unmatched' end from (select tr.id,coalesce(sum(m.amount) filter(where m.status<>'cancelled'),0) matched,coalesce(sum(m.amount) filter(where m.status='reconciled'),0) reconciled from public.bank_transactions tr left join public.bank_reconciliation_matches m on m.bank_transaction_id=tr.id where tr.company_id=c and tr.evidence_state='confirmed' and tr.status<>'excluded' group by tr.id) x where t.id=x.id;
 update public.employee_advances a set paid_amount=p.allocated_paid_amount,outstanding_to_render=p.allocated_paid_amount,
 status=case when p.status='cancelled' then 'cancelled' when p.allocated_paid_amount=a.approved_amount then 'paid' when p.allocated_paid_amount>0 then 'partially_paid' when exists(select 1 from public.payment_order_items i join public.payment_orders o on o.id=i.payment_order_id where i.payable_id=p.id and o.status='scheduled') then 'scheduled' else 'approved' end
 from public.payables p where p.employee_advance_id=a.id and a.company_id=c and (a.paid_amount<>p.allocated_paid_amount or a.status not in ('settled','partially_settled'));
 end $$;

create or replace function public.treasury_options(target_company uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
#variable_conflict use_column
 begin
 if not private.has_company_access(target_company) or not exists(select 1 from public.permissions p where p.active and p.resource in ('bank','payment_order','payment','payment_batch','bank_transaction','bank_reconciliation') and private.has_permission(p.code,target_company)) then raise exception using errcode='42501',message='Treasury access denied';end if;
 return jsonb_build_object('employees',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',full_name)),'[]') from public.employees where company_id=target_company and active),'employee_accounts',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',bank_name||' · ••••'||right(account_number,4),'employee_id',employee_id,'currency_id',currency_id)),'[]') from public.employee_bank_accounts where company_id=target_company and status='active'),'currencies',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',code)),'[]') from public.currencies where active),'banks',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') from public.banks where company_id=target_company and active),'bank_accounts',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',display_name||' · ••••'||right(account_number,4),'currency_id',currency_id)),'[]') from public.company_bank_accounts where company_id=target_company and active),'methods',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') from public.payment_methods where company_id=target_company and active),'suppliers',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.legal_name)),'[]') from public.suppliers s join public.supplier_companies sc on sc.supplier_id=s.id where sc.company_id=target_company and sc.status='active'),'supplier_accounts',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',bank_name||' · ••••'||right(account_number,4),'supplier_id',supplier_id,'currency_id',currency_id)),'[]') from public.supplier_bank_accounts where company_id=target_company and status='active'));end $$;

create or replace function public.treasury_dashboard(target_company uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
#variable_conflict use_column
 begin
 perform private.finance_require('payment_order.view',target_company);
 return jsonb_build_object('currencies',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',code)),'[]') from public.currencies),'approved_payables',case when private.has_permission('payable.view',target_company) then (select coalesce(jsonb_agg(x),'[]') from (select due_date,currency_id,sum(outstanding_amount) amount from public.payables where company_id=target_company and status='approved' and outstanding_amount>0 group by due_date,currency_id)x) end,'schedule',(select coalesce(jsonb_agg(x),'[]') from (select o.id,o.payment_order_number,coalesce(s.legal_name,e.full_name) as beneficiary,o.requested_payment_date,o.scheduled_payment_date,o.currency_id,o.status,(select string_agg(distinct r.priority,', ') from public.payment_order_items i join public.payables p on p.id=i.payable_id join public.financial_requests r on r.id=p.request_id where i.payment_order_id=o.id) as priority,a.display_name as bank,o.total_amount-coalesce((select sum(p.amount) from public.payments p where p.payment_order_id=o.id and p.status='executed'),0) as outstanding_amount,(select min(p.due_date) from public.payment_order_items i join public.payables p on p.id=i.payable_id where i.payment_order_id=o.id) due_date from public.payment_orders o left join public.suppliers s on s.id=o.supplier_beneficiary_id left join public.employees e on e.id=o.employee_beneficiary_id and e.company_id=o.company_id left join public.company_bank_accounts a on a.id=o.bank_account_id where o.company_id=target_company and o.status in ('submitted','under_review','approved','scheduled','partially_paid') order by coalesce(o.scheduled_payment_date,o.requested_payment_date) limit 500)x),'payments_unreconciled',case when private.has_permission('payment.view',target_company) then (select count(*) from public.payments p where p.company_id=target_company and p.status='executed' and p.amount>coalesce((select sum(m.amount) from public.bank_reconciliation_matches m where m.payment_id=p.id and m.status='reconciled'),0)) end,'bank_unreconciled',case when private.has_permission('bank_transaction.view',target_company) then (select count(*) from public.bank_transactions where company_id=target_company and evidence_state='confirmed' and status not in ('reconciled','excluded')) end,'batches_pending',case when private.has_permission('payment_batch.view',target_company) then (select count(*) from public.payment_batches where company_id=target_company and status not in ('completed','cancelled')) end);end $$;

revoke all on function private.payable_beneficiary_matches(public.payables,text,uuid),private.beneficiary_active(text,uuid,uuid),private.beneficiary_account_active(text,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.treasury_save_v5_core(text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
commit;
