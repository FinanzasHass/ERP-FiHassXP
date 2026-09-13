begin;
alter table public.bank_reconciliation_matches add column collection_id uuid,
 add foreign key(company_id,collection_id) references public.collections(company_id,id),
 drop constraint reconciliation_single_target,
 add constraint reconciliation_single_target check((payment_id is not null)::integer+(employee_return_id is not null)::integer+(collection_id is not null)::integer=1);
create function private.collection_is_actor(target_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.collections where id=target_id and auth.uid() in(created_by,identified_by))
 or exists(select 1 from public.collection_allocations where collection_id=target_id and created_by=auth.uid())
 or exists(select 1 from public.receivable_history where entity_type='collection' and entity_id=target_id and action='identify' and actor_id=auth.uid());
$$;
revoke all on function private.collection_is_actor(uuid) from public,anon,authenticated,service_role;
create function public.collection_match(target_id uuid,period_id uuid,transaction_id uuid,amount jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare c public.collections;t public.bank_transactions;p public.bank_reconciliation_periods;m public.bank_reconciliation_matches;n numeric;begin
 perform private.treasury_lock();select * into c from public.collections where id=target_id;
 if not found then raise exception using errcode='42501',message='Collection unavailable';end if;perform private.finance_require('bank_reconciliation.match',c.company_id);perform private.finance_require('collection.view',c.company_id);
 if private.collection_is_actor(c.id) then raise exception using errcode='42501',message='Collection reconciliation segregation';end if;
 select * into t from public.bank_transactions where id=transaction_id and company_id=c.company_id;select * into p from public.bank_reconciliation_periods where id=period_id and company_id=c.company_id;
 if c.status<>'active' or t.id is null or p.id is null or p.status<>'open' or t.bank_account_id<>p.bank_account_id or t.transaction_date not between p.start_date and p.end_date or t.currency_id<>c.currency_id or t.evidence_state<>'confirmed' or t.transaction_type<>'credit' or t.status='excluded' or t.amount<>c.amount or (c.bank_transaction_id is not null and c.bank_transaction_id<>t.id) then raise exception using errcode='23514',message='Incompatible collection reconciliation';end if;
 if exists(select 1 from public.collections where bank_transaction_id=t.id and id<>c.id and status='active') or exists(select 1 from public.bank_reconciliation_matches where bank_transaction_id=t.id and collection_id is distinct from c.id and status<>'cancelled') then raise exception using errcode='23514',message='Credit reserved for different financial origin';end if;
 n:=private.expense_money(amount);
 if n<=0 or n>c.amount-coalesce((select sum(amount)from public.bank_reconciliation_matches where collection_id=c.id and status<>'cancelled'),0) or n>t.amount-coalesce((select sum(amount)from public.bank_reconciliation_matches where bank_transaction_id=t.id and status<>'cancelled'),0)then raise exception using errcode='23514',message='Match exceeds remainder';end if;
 if c.bank_transaction_id is null then update public.collections set bank_transaction_id=t.id where id=c.id;end if;
 insert into public.bank_reconciliation_matches(company_id,period_id,bank_transaction_id,collection_id,amount,matched_by)values(c.company_id,p.id,t.id,c.id,n,auth.uid())returning * into m;
 perform private.cxc_history(c.company_id,'collection',c.id,'bank.match',null,null,to_jsonb(m));perform private.treasury_refresh(c.company_id);return to_jsonb(m);
end $$;
alter function public.employee_return_match(uuid,uuid,uuid,jsonb) rename to employee_return_match_before_collection;
create function public.employee_return_match(return_id uuid,period_id uuid,transaction_id uuid,amount jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare c uuid;begin
 perform private.treasury_lock();select company_id into c from public.employee_returns where id=return_id;perform private.finance_require('employee_return.match',c);
 if exists(select 1 from public.collections where bank_transaction_id=transaction_id and status='active')then raise exception using errcode='23514',message='Credit reserved for customer collection';end if;
 return public.employee_return_match_before_collection(return_id,period_id,transaction_id,amount);
end $$;
alter function public.treasury_action(text,uuid,text,jsonb) rename to treasury_action_before_collection;
create function public.treasury_action(kind text,target_id uuid,action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare m public.bank_reconciliation_matches;c public.collections;company uuid;previous jsonb;begin
 perform private.treasury_lock();
 if kind='bank_transaction' and action='exclude' then
  select company_id into company from public.bank_transactions where id=target_id;perform private.finance_require('bank_reconciliation.reconcile',company);
  if exists(select 1 from public.collections where bank_transaction_id=target_id and status='active')then raise exception using errcode='23514',message='Reverse active collection before excluding its bank evidence';end if;
 end if;
 if kind='reconciliation_match' then
 select * into m from public.bank_reconciliation_matches where id=target_id;
 if m.collection_id is not null then
  if action is null or action not in ('reconcile','unmatch') then raise exception using errcode='22023',message='Invalid collection reconciliation action';end if;
  if payload is distinct from '{}'::jsonb then perform private.validate_keys(payload,array['reason']);end if;perform private.finance_require(case when action='reconcile' then 'bank_reconciliation.reconcile' else 'bank_reconciliation.match' end,m.company_id);perform private.finance_require('collection.view',m.company_id);
  select * into c from public.collections where id=m.collection_id;
  if private.collection_is_actor(c.id)then raise exception using errcode='42501',message='Collection reconciliation segregation';end if;
  if not exists(select 1 from public.bank_reconciliation_periods where id=m.period_id and status='open')then raise exception using errcode='23514',message='Closed reconciliation immutable';end if;
  previous:=to_jsonb(m);
  if action='reconcile' and m.status='matched' and c.status='active' then update public.bank_reconciliation_matches set status='reconciled',reconciled_by=auth.uid(),reconciled_at=now()where id=m.id returning * into m;
  elsif action='unmatch' and m.status in ('matched','reconciled')then
   if coalesce(length(trim(payload->>'reason')),0)not between 1 and 2000 then raise exception using errcode='22023',message='Unmatch reason required';end if;
   update public.bank_reconciliation_matches set status='cancelled',reason=payload->>'reason'where id=m.id returning * into m;
  else raise exception using errcode='23514',message='Invalid reconciliation transition';end if;
  perform private.cxc_history(c.company_id,'collection',c.id,'bank.'||action,payload->>'reason',previous,to_jsonb(m));perform private.treasury_refresh(c.company_id);return to_jsonb(m);
 end if;
 elsif kind='reconciliation_period' and action='close' then
 select company_id into company from public.bank_reconciliation_periods where id=target_id;perform private.finance_require('bank_reconciliation.close',company);
 if exists(select 1 from public.bank_reconciliation_matches m0 join public.collections c0 on c0.id=m0.collection_id where m0.period_id=target_id and m0.status<>'cancelled' and private.collection_is_actor(c0.id))then raise exception using errcode='42501',message='Collection actor cannot close bank reconciliation';end if;
 end if;
 return public.treasury_action_before_collection(kind,target_id,action,payload);
end $$;

alter function private.attachment_access(text,uuid,uuid,boolean)rename to attachment_access_before_collection;
create function private.attachment_access(kind text,rid uuid,c uuid,writing boolean)returns boolean language plpgsql stable security definer set search_path='' as $$
declare e public.collections;begin
 if kind not in('collection_support','issued_document')then return private.attachment_access_before_collection(kind,rid,c,writing);end if;
 if not private.has_company_access(c)then return false;end if;
 if kind='collection_support' then
 select * into e from public.collections where id=rid and company_id=c;if not found then return false;end if;
 return case when writing then e.status='active' and private.has_permission('collection.create',c) and e.created_by=auth.uid() else private.collection_read(c)end;
 end if;
 return exists(select 1 from public.issued_document_references where id=rid and company_id=c)and case when writing then private.has_permission('receivable.create',c)else private.receivable_read(c)end;
end $$;
alter table public.attachments drop constraint attachments_entity_type_check;
alter table public.attachments add constraint attachments_entity_type_check check(entity_type in('request','purchase_order','service_acceptance','tax_document','payable','supplier_bank_change','payment','expense_receipt','tax_support','declaration_support','employee_payment_evidence','employee_return_evidence','employee_reimbursement_support','expense_representation','collection_support','issued_document'));
drop policy attachment_read on public.attachments;
create policy attachment_read on public.attachments for select to authenticated using(private.attachment_access(entity_type,entity_id,company_id,false));
revoke all on function private.attachment_access(text,uuid,uuid,boolean),private.attachment_access_before_collection(text,uuid,uuid,boolean),public.employee_return_match_before_collection(uuid,uuid,uuid,jsonb),public.treasury_action_before_collection(text,uuid,text,jsonb)from public,anon,authenticated,service_role;
grant execute on function private.attachment_access(text,uuid,uuid,boolean)to authenticated;
revoke all on function public.collection_match(uuid,uuid,uuid,jsonb),public.employee_return_match(uuid,uuid,uuid,jsonb),public.treasury_action(text,uuid,text,jsonb)from public,anon,service_role;
grant execute on function public.collection_match(uuid,uuid,uuid,jsonb),public.employee_return_match(uuid,uuid,uuid,jsonb),public.treasury_action(text,uuid,text,jsonb)to authenticated;
commit;
