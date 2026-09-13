begin;
create function public.collection_register(target_company uuid,payload jsonb,operation_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.bank_transactions;c public.collections;result jsonb;n numeric;currency uuid;on_date date;reference text;begin
 perform private.treasury_lock();perform private.finance_require(case when payload->>'bank_transaction_id' is null then 'collection.create' else 'collection.identify' end,target_company);
 perform private.validate_keys(payload,array['bank_transaction_id','currency_id','collection_date','amount','payment_method_id','reference']);
 result:=private.cxc_retry(target_company,operation_key,'collection',payload);if result is not null then return result;end if;
 if payload->>'bank_transaction_id' is not null then
  select * into t from public.bank_transactions where id=(payload->>'bank_transaction_id')::uuid and company_id=target_company;
  if not found or t.transaction_type<>'credit' or t.evidence_state<>'confirmed' or t.status='excluded' then raise exception using errcode='23514',message='Confirmed company credit required';end if;
  if exists(select 1 from public.bank_reconciliation_matches where bank_transaction_id=t.id and status<>'cancelled') then raise exception using errcode='23514',message='Credit already reserved for reconciliation';end if;
  n:=t.amount;currency:=t.currency_id;on_date:=t.transaction_date;reference:=coalesce(t.bank_reference,'');
  if payload ? 'amount' or payload ? 'currency_id' or payload ? 'collection_date' then raise exception using errcode='22023',message='Bank amounts and currency derive from persisted transaction';end if;
 else
  n:=private.expense_money(payload->'amount');currency:=(payload->>'currency_id')::uuid;on_date:=(payload->>'collection_date')::date;reference:=coalesce(payload->>'reference','');
  if not exists(select 1 from public.payment_methods where id=(payload->>'payment_method_id')::uuid and company_id=target_company and active) or not exists(select 1 from public.currencies where id=currency and active) then raise exception using errcode='23514',message='Active method and currency required';end if;
 end if;
 insert into public.collections(company_id,currency_id,collection_number,collection_date,amount,payment_method_id,bank_transaction_id,reference,created_by)
 values(target_company,currency,private.next_document_number(target_company,'COB'),on_date,n,(payload->>'payment_method_id')::uuid,t.id,reference,auth.uid())returning * into c;
 result:=to_jsonb(c);perform private.cxc_history(target_company,'collection',c.id,'register',null,null,result);perform private.cxc_remember(target_company,operation_key,'collection',payload,result);return result;
end $$;
create function public.collection_identify(target_id uuid,customer_id uuid,reason text,operation_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare c public.collections;previous jsonb;p jsonb;result jsonb;begin
 perform private.treasury_lock();select * into c from public.collections where id=target_id;
 if not found then raise exception using errcode='42501',message='Collection unavailable';end if;perform private.finance_require('collection.identify',c.company_id);
 p:=jsonb_build_object('id',target_id,'customer_id',customer_id,'reason',reason);result:=private.cxc_retry(c.company_id,operation_key,'identify',p);if result is not null then return result;end if;
 perform private.cxc_customer(c.company_id,customer_id,c.currency_id);
 if c.status<>'active' or coalesce(length(trim(reason)),0) not between 1 and 2000 then raise exception using errcode='23514',message='Identification requires active collection and reason';end if;
 if c.customer_id=customer_id then result:=to_jsonb(c);perform private.cxc_remember(c.company_id,operation_key,'identify',p,result);return result;end if;
 if c.customer_id is distinct from customer_id and (exists(select 1 from public.collection_allocations where collection_id=c.id) or exists(select 1 from public.bank_reconciliation_matches where collection_id=c.id and status<>'cancelled')) then raise exception using errcode='23514',message='Resolve financial effects before changing identification';end if;
 previous:=to_jsonb(c);update public.collections set customer_id=collection_identify.customer_id,identified_by=auth.uid(),identified_at=now() where id=c.id returning * into c;
 result:=to_jsonb(c);perform private.cxc_history(c.company_id,'collection',c.id,'identify',reason,previous,result);perform private.cxc_remember(c.company_id,operation_key,'identify',p,result);return result;
end $$;
create function public.collection_apply(target_id uuid,payload jsonb,operation_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.collections;r public.receivables;a public.collection_allocations;item jsonb;n numeric;available numeric;outstanding numeric;result jsonb:='[]';retry jsonb;p jsonb;begin
 perform private.treasury_lock();select * into c from public.collections where id=target_id;
 if not found then raise exception using errcode='42501',message='Collection unavailable';end if;perform private.finance_require('collection.apply',c.company_id);
 perform private.validate_keys(payload,array['allocations']);p:=payload||jsonb_build_object('collection_id',target_id);retry:=private.cxc_retry(c.company_id,operation_key,'apply',p);if retry is not null then return retry;end if;
 if c.status<>'active' or c.customer_id is null then raise exception using errcode='23514',message='Identified active collection required';end if;
 perform private.cxc_customer(c.company_id,c.customer_id,c.currency_id);
 if c.bank_transaction_id is null and not exists(select 1 from public.attachments where company_id=c.company_id and entity_type='collection_support' and entity_id=c.id and status='ready') then raise exception using errcode='23514',message='Encrypted evidence required for non-bank collection';end if;
 if jsonb_typeof(payload->'allocations') is distinct from 'array' or jsonb_array_length(payload->'allocations') not between 1 and 100 then raise exception using errcode='22023',message='Allocations required';end if;
 select c.amount-coalesce(sum(amount),0) into available from public.collection_allocations where collection_id=c.id and status='valid';
 for item in select value from jsonb_array_elements(payload->'allocations')loop
  perform private.validate_keys(item,array['receivable_id','amount']);n:=private.expense_money(item->'amount');
  select * into r from public.receivables where id=(item->>'receivable_id')::uuid;
  if not found or r.status<>'active' or r.company_id<>c.company_id or r.customer_id<>c.customer_id or r.currency_id<>c.currency_id then raise exception using errcode='23514',message='Allocation company customer or currency mismatch';end if;
  select r.original_amount-coalesce(sum(amount),0) into outstanding from public.collection_allocations where receivable_id=r.id and status='valid';
  if n<=0 or n>available or n>outstanding then raise exception using errcode='23514',message='Allocation exceeds available collection or receivable';end if;
  insert into public.collection_allocations(company_id,collection_id,receivable_id,amount,created_by)values(c.company_id,c.id,r.id,n,auth.uid())returning * into a;available:=available-n;result:=result||jsonb_build_array(to_jsonb(a));
  perform private.cxc_history(c.company_id,'receivable',r.id,'collection.apply',null,null,to_jsonb(a));
 end loop;
 perform private.cxc_history(c.company_id,'collection',c.id,'apply',null,null,jsonb_build_object('allocations',result,'unapplied_amount',available));
 perform private.cxc_remember(c.company_id,operation_key,'apply',p,result);return result;
end $$;
create function public.collection_reverse(target_id uuid,reason text,operation_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.collections;previous jsonb;p jsonb;result jsonb;a public.collection_allocations;begin
 perform private.treasury_lock();select * into c from public.collections where id=target_id;
 if not found then raise exception using errcode='42501',message='Collection unavailable';end if;perform private.finance_require('collection.reverse',c.company_id);
 p:=jsonb_build_object('id',target_id,'reason',reason);result:=private.cxc_retry(c.company_id,operation_key,'reverse',p);if result is not null then return result;end if;
 if c.status<>'active' or coalesce(length(trim(reason)),0) not between 1 and 2000 then raise exception using errcode='23514',message='Active collection and reason required';end if;
 if exists(select 1 from public.bank_reconciliation_matches where collection_id=c.id and status<>'cancelled') then raise exception using errcode='23514',message='Reopen reconciliation and unmatch first';end if;
 previous:=to_jsonb(c);
 for a in update public.collection_allocations set status='reversed',reversed_by=auth.uid(),reversed_at=now(),reason=collection_reverse.reason where collection_id=c.id and status='valid' returning * loop
  perform private.cxc_history(c.company_id,'receivable',a.receivable_id,'collection.reverse',reason,null,to_jsonb(a));
 end loop;
 update public.collections set status='reversed',reversed_by=auth.uid(),reversed_at=now(),reason=collection_reverse.reason where id=c.id returning * into c;
 result:=to_jsonb(c);perform private.cxc_history(c.company_id,'collection',c.id,'reverse',reason,previous,result);perform private.cxc_remember(c.company_id,operation_key,'reverse',p,result);return result;
end $$;
create function public.collection_unapply(target_id uuid,reason text,operation_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.collection_allocations;c public.collections;p jsonb;previous jsonb;result jsonb;begin
 perform private.treasury_lock();select * into a from public.collection_allocations where id=target_id;
 if not found then raise exception using errcode='42501',message='Allocation unavailable';end if;perform private.finance_require('collection.reverse',a.company_id);
 p:=jsonb_build_object('id',target_id,'reason',reason);result:=private.cxc_retry(a.company_id,operation_key,'unapply',p);if result is not null then return result;end if;
 select * into c from public.collections where id=a.collection_id;
 if a.status<>'valid' or c.status<>'active' or coalesce(length(trim(reason)),0) not between 1 and 2000 then raise exception using errcode='23514',message='Valid allocation and reason required';end if;
 if exists(select 1 from public.bank_reconciliation_matches m join public.bank_reconciliation_periods p0 on p0.id=m.period_id where m.collection_id=c.id and m.status<>'cancelled' and p0.status='closed')then raise exception using errcode='23514',message='Closed reconciliation requires reopening';end if;
 previous:=to_jsonb(a);update public.collection_allocations set status='reversed',reversed_by=auth.uid(),reversed_at=now(),reason=collection_unapply.reason where id=a.id returning * into a;
 result:=to_jsonb(a);perform private.cxc_history(a.company_id,'collection',c.id,'unapply',reason,previous,result);perform private.cxc_history(a.company_id,'receivable',a.receivable_id,'unapply',reason,previous,result);perform private.cxc_remember(a.company_id,operation_key,'unapply',p,result);return result;
end $$;
create function public.receivable_change(target_id uuid,action text,payload jsonb,reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.receivables;previous jsonb;n numeric;paid numeric;begin
 perform private.treasury_lock();select * into r from public.receivables where id=target_id;
 if not found then raise exception using errcode='42501',message='Receivable unavailable';end if;
 if action is null or action not in ('adjust','cancel') then raise exception using errcode='22023',message='Invalid receivable action';end if;
 perform private.finance_require('receivable.'||action,r.company_id);if payload is distinct from '{}'::jsonb then perform private.validate_keys(payload,array['due_date','original_amount','description']);end if;
 if r.status<>'active' or coalesce(length(trim(reason)),0) not between 1 and 2000 then raise exception using errcode='23514',message='Active receivable and reason required';end if;
 select coalesce(sum(amount),0) into paid from public.collection_allocations where receivable_id=r.id and status='valid';previous:=to_jsonb(r);
 if action='cancel' then
  if paid>0 or r.installment_id is not null then raise exception using errcode='23514',message='Unapply collection or modify full schedule first';end if;
  update public.receivables set status='cancelled',updated_at=now()where id=r.id returning * into r;
 else
  if r.installment_id is not null then raise exception using errcode='23514',message='Use controlled full schedule replacement';end if;
  n:=case when payload ? 'original_amount' then private.expense_money(payload->'original_amount') else r.original_amount end;
  if n<=0 or n<paid then raise exception using errcode='23514',message='Adjusted amount below collected';end if;
  update public.receivables set original_amount=n,due_date=coalesce((payload->>'due_date')::date,r.due_date),description=coalesce(payload->>'description',r.description),updated_at=now()where id=r.id returning * into r;
 end if;
 perform private.cxc_history(r.company_id,'receivable',r.id,action,reason,previous,to_jsonb(r));return to_jsonb(r);
end $$;

revoke all on function public.collection_register(uuid,jsonb,uuid),public.collection_identify(uuid,uuid,text,uuid),public.collection_apply(uuid,jsonb,uuid),public.collection_reverse(uuid,text,uuid),public.collection_unapply(uuid,text,uuid),public.receivable_change(uuid,text,jsonb,text) from public,anon,service_role;
grant execute on function public.collection_register(uuid,jsonb,uuid),public.collection_identify(uuid,uuid,text,uuid),public.collection_apply(uuid,jsonb,uuid),public.collection_reverse(uuid,text,uuid),public.collection_unapply(uuid,text,uuid),public.receivable_change(uuid,text,jsonb,text) to authenticated;
commit;
