begin;
create view public.receivable_balances with(security_invoker=true) as
 select r.*,a.collected_amount,r.original_amount-a.collected_amount outstanding_amount,
 case when r.status='cancelled' then 'cancelled' when a.collected_amount=r.original_amount then 'collected' when r.due_date<current_date then 'overdue' when a.collected_amount>0 then 'partially_collected' else 'pending' end financial_status,
 case when r.status='active' and r.original_amount>a.collected_amount then greatest(current_date-r.due_date,0) else 0 end days_overdue
 from public.receivables r cross join lateral(select coalesce(sum(x.amount),0) collected_amount from public.collection_allocations x where x.receivable_id=r.id and x.status='valid')a;
create view public.collection_balances with(security_invoker=true) as
 select c.*,a.applied_amount,case when c.status='reversed' then 0 else c.amount-a.applied_amount end unapplied_amount,
 case when c.status='reversed' then 'reversed' when c.customer_id is null then 'unidentified' when a.applied_amount=c.amount then 'applied' when a.applied_amount>0 then 'partially_applied' else 'identified' end financial_status
 from public.collections c cross join lateral(select coalesce(sum(x.amount),0) applied_amount from public.collection_allocations x where x.collection_id=c.id and x.status='valid')a;
revoke all on public.receivable_balances,public.collection_balances from public,anon,authenticated,service_role;
grant select on public.receivable_balances,public.collection_balances to authenticated;

create function private.cxc_history(c uuid,kind text,rid uuid,act text,note text,previous jsonb,result jsonb) returns void language sql security definer set search_path='' as $$
 insert into public.receivable_history(company_id,entity_type,entity_id,action,actor_id,reason,old_values,new_values)values(c,kind,rid,act,auth.uid(),note,previous,result);
$$;
create function private.cxc_retry(c uuid,k uuid,op text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.receivable_operation_keys;begin
 if k is null then raise exception using errcode='22023',message='Idempotency key required';end if;
 select * into r from public.receivable_operation_keys where company_id=c and operation_key=k;
 if found then if r.operation<>op or r.payload<>p then raise exception using errcode='23514',message='Idempotency payload mismatch';end if;return r.result;end if;return null;
end $$;
create function private.cxc_remember(c uuid,k uuid,op text,p jsonb,r jsonb) returns void language sql security definer set search_path='' as $$
 insert into public.receivable_operation_keys(company_id,operation_key,operation,payload,result,created_by)values(c,k,op,p,r,auth.uid());
$$;
create function private.cxc_customer(c uuid,cid uuid,currency uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.customers where id=cid and company_id=c and status='active') or not exists(select 1 from public.currencies where id=currency and active) then raise exception using errcode='23514',message='Active customer and currency required';end if;
end $$;
create function public.customer_save(target_id uuid,target_company uuid,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare previous jsonb;result jsonb;begin
 perform private.treasury_lock();perform private.finance_require(case when target_id is null then 'customer.create' else 'customer.edit' end,target_company);
 perform private.validate_keys(payload,array['customer_type','document_type','document_number','legal_name','trade_name','email','phone','address']);
 if target_id is not null then select to_jsonb(c) into previous from public.customers c where id=target_id and company_id=target_company;
 if previous is null then raise exception using errcode='42501',message='Customer unavailable';end if;
 if exists(select 1 from public.receivables where customer_id=target_id) and ((payload ? 'document_type' and payload->>'document_type'<>previous->>'document_type') or (payload ? 'document_number' and payload->>'document_number'<>previous->>'document_number')) then raise exception using errcode='23514',message='Used customer identity immutable';end if;
 else payload:=payload||jsonb_build_object('company_id',target_company,'created_by',auth.uid());end if;
 result:=private.treasury_write('customers',target_id,target_company,payload||jsonb_build_object('updated_at',now()));
 perform private.cxc_history(target_company,'customer',(result->>'id')::uuid,'save',null,previous,result);return result;
end $$;
create function public.customer_disable(target_id uuid,reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.customers;previous jsonb;begin
 perform private.treasury_lock();select * into c from public.customers where id=target_id;
 if not found then raise exception using errcode='42501',message='Customer unavailable';end if;perform private.finance_require('customer.disable',c.company_id);
 if coalesce(length(trim(reason)),0) not between 1 and 2000 then raise exception using errcode='22023',message='Reason required';end if;
 previous:=to_jsonb(c);update public.customers set status='inactive',updated_at=now() where id=c.id returning * into c;
 perform private.cxc_history(c.company_id,'customer',c.id,'disable',reason,previous,to_jsonb(c));return to_jsonb(c);
end $$;
create function public.receivable_source_create(target_company uuid,payload jsonb,operation_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.receivable_sources;kind text:=payload->>'source_type';result jsonb;sub jsonb;begin
 perform private.treasury_lock();perform private.finance_require(case kind when 'membership' then 'membership.manage' when 'lot_sale' then 'lot_receivable.manage' else 'receivable.create' end,target_company);
 perform private.validate_keys(payload,array['customer_id','source_type','reference','description','currency_id','plan_name','start_date','end_date','periodic_amount','period_months','lot_identifier','agreed_price','down_payment']);
 result:=private.cxc_retry(target_company,operation_key,'source',payload);if result is not null then return result;end if;
 perform private.cxc_customer(target_company,(payload->>'customer_id')::uuid,(payload->>'currency_id')::uuid);
 if not exists(select 1 from public.receivable_source_types where code=kind and active) then raise exception using errcode='23514',message='Source type unavailable';end if;
 insert into public.receivable_sources(company_id,customer_id,source_type,reference,description,currency_id,created_by)values(target_company,(payload->>'customer_id')::uuid,kind,payload->>'reference',payload->>'description',(payload->>'currency_id')::uuid,auth.uid())returning * into s;
 if kind='membership' then insert into public.membership_accounts(company_id,source_id,plan_name,start_date,end_date,periodic_amount,period_months)values(target_company,s.id,payload->>'plan_name',(payload->>'start_date')::date,(payload->>'end_date')::date,private.expense_money(payload->'periodic_amount'),(payload->>'period_months')::integer);
 elsif kind='lot_sale' then insert into public.lot_finance_contracts(company_id,source_id,lot_identifier,agreed_price,down_payment)values(target_company,s.id,payload->>'lot_identifier',private.expense_money(payload->'agreed_price'),private.expense_money(payload->'down_payment'));end if;
 result:=to_jsonb(s);perform private.cxc_history(target_company,'source',s.id,'create',null,null,result);perform private.cxc_remember(target_company,operation_key,'source',payload,result);return result;
end $$;
create function public.receivable_create(target_company uuid,payload jsonb,operation_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.receivables;result jsonb;begin
 perform private.treasury_lock();perform private.finance_require('receivable.create',target_company);
 perform private.validate_keys(payload,array['customer_id','source_type','source_id','currency_id','issue_date','due_date','original_amount','description','document_id']);
 result:=private.cxc_retry(target_company,operation_key,'receivable',payload);if result is not null then return result;end if;
 perform private.cxc_customer(target_company,(payload->>'customer_id')::uuid,(payload->>'currency_id')::uuid);
 if payload->>'source_type' not in ('manual_authorized','other') then raise exception using errcode='23514',message='Use structured schedule generation';end if;
 if payload->>'document_id' is not null and not exists(select 1 from public.issued_document_references where id=(payload->>'document_id')::uuid and company_id=target_company and customer_id=(payload->>'customer_id')::uuid) then raise exception using errcode='23514',message='Issued document mismatch';end if;
 insert into public.receivables(company_id,customer_id,receivable_number,source_type,source_id,currency_id,issue_date,due_date,original_amount,description,document_id,created_by)
 values(target_company,(payload->>'customer_id')::uuid,private.next_document_number(target_company,'CXC'),payload->>'source_type',(payload->>'source_id')::uuid,(payload->>'currency_id')::uuid,(payload->>'issue_date')::date,(payload->>'due_date')::date,private.expense_money(payload->'original_amount'),payload->>'description',(payload->>'document_id')::uuid,auth.uid())returning * into r;
 result:=to_jsonb(r);perform private.cxc_history(target_company,'receivable',r.id,'create',null,null,result);perform private.cxc_remember(target_company,operation_key,'receivable',payload,result);return result;
end $$;
create function public.receivable_schedule_generate(source_id uuid,payload jsonb,operation_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare s public.receivable_sources;sch public.receivable_schedules;i public.receivable_installments;r public.receivables;m public.membership_accounts;l public.lot_finance_contracts;item jsonb;items jsonb;total numeric:=0;n integer:=0;result jsonb;previous jsonb;version integer:=1;key_payload jsonb;begin
 perform private.treasury_lock();select * into s from public.receivable_sources where id=source_id;
 if not found then raise exception using errcode='42501',message='Source unavailable';end if;
 perform private.finance_require(case when payload->>'replace_schedule_id' is null then 'receivable_schedule.create' else 'receivable_schedule.modify' end,s.company_id);
 perform private.finance_require(case s.source_type when 'membership' then 'membership.manage' when 'lot_sale' then 'lot_receivable.manage' else 'receivable.create' end,s.company_id);
 perform private.validate_keys(payload,array['period_reference','issue_date','installments','replace_schedule_id','reason']);key_payload:=payload||jsonb_build_object('source_id',source_id);
 result:=private.cxc_retry(s.company_id,operation_key,'schedule',key_payload);if result is not null then return result;end if;
 perform private.cxc_customer(s.company_id,s.customer_id,s.currency_id);if s.status<>'active' then raise exception using errcode='23514',message='Source inactive';end if;
 items:=payload->'installments';if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) not between 1 and 360 then raise exception using errcode='22023',message='Explicit schedule items required';end if;
 select * into m from public.membership_accounts where source_id=s.id;select * into l from public.lot_finance_contracts where source_id=s.id;
 for item in select value from jsonb_array_elements(items)loop
 perform private.validate_keys(item,array['due_date','amount']);total:=total+private.expense_money(item->'amount');
 if private.expense_money(item->'amount')<=0 then raise exception using errcode='23514',message='Positive installment required';end if;
 if m.id is not null and (private.expense_money(item->'amount')<>m.periodic_amount or (item->>'due_date')::date<m.start_date or (m.end_date is not null and (item->>'due_date')::date>m.end_date)) then raise exception using errcode='23514',message='Membership configured amount or dates mismatch';end if;
 if m.id is not null and not exists(select 1 from generate_series(0,12000) k where (m.start_date+make_interval(months=>k*m.period_months))::date=(item->>'due_date')::date)then raise exception using errcode='23514',message='Membership due date must follow configured cadence from start date';end if;
 end loop;
 if l.id is not null and (total<>l.agreed_price or (l.down_payment>0 and private.expense_money(items->0->'amount')<>l.down_payment)) then raise exception using errcode='23514',message='Lot schedule must equal agreed price and initial payment';end if;
 if payload->>'replace_schedule_id' is not null then
 select * into sch from public.receivable_schedules where id=(payload->>'replace_schedule_id')::uuid and source_id=s.id and status='active';
 if not found or sch.period_reference<>payload->>'period_reference' or coalesce(length(trim(payload->>'reason')),0) not between 1 and 2000 then raise exception using errcode='23514',message='Replacement requires active schedule and reason';end if;
 if exists(select 1 from public.receivables rr join public.receivable_installments ii on ii.id=rr.installment_id join public.collection_allocations aa on aa.receivable_id=rr.id where ii.schedule_id=sch.id) then raise exception using errcode='23514',message='Schedule with collection history immutable';end if;
 previous:=to_jsonb(sch);version:=sch.version+1;update public.receivable_schedules set status='superseded' where id=sch.id;update public.receivables set status='cancelled',updated_at=now() where installment_id in(select id from public.receivable_installments where schedule_id=sch.id);
 end if;
 if l.id is not null and exists(select 1 from public.receivable_schedules where source_id=s.id and status='active')then raise exception using errcode='23514',message='Lot has active schedule';end if;
 insert into public.receivable_schedules(company_id,source_id,period_reference,version,total_amount,currency_id,created_by)values(s.company_id,s.id,payload->>'period_reference',version,total,s.currency_id,auth.uid())returning * into sch;
 for item in select value from jsonb_array_elements(items)loop
 n:=n+1;
 if m.id is not null and exists(select 1 from public.receivable_installments ii join public.receivable_schedules ss on ss.id=ii.schedule_id where ss.source_id=s.id and ss.status='active' and ii.due_date=(item->>'due_date')::date)then raise exception using errcode='23514',message='Membership period already generated';end if;
 insert into public.receivable_installments(company_id,schedule_id,number,due_date,original_amount,currency_id)values(s.company_id,sch.id,n,(item->>'due_date')::date,private.expense_money(item->'amount'),s.currency_id)returning * into i;
 insert into public.receivables(company_id,customer_id,receivable_number,source_type,source_id,installment_id,currency_id,issue_date,due_date,original_amount,description,created_by)values(s.company_id,s.customer_id,private.next_document_number(s.company_id,'CXC'),s.source_type,s.id,i.id,s.currency_id,(payload->>'issue_date')::date,i.due_date,i.original_amount,s.description||' · cuota '||n,auth.uid());
 end loop;
 result:=to_jsonb(sch);perform private.cxc_history(s.company_id,'schedule',sch.id,'generate',payload->>'reason',previous,result);perform private.cxc_remember(s.company_id,operation_key,'schedule',key_payload,result);return result;
end $$;

revoke all on function private.cxc_history(uuid,text,uuid,text,text,jsonb,jsonb),private.cxc_retry(uuid,uuid,text,jsonb),private.cxc_remember(uuid,uuid,text,jsonb,jsonb),private.cxc_customer(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.customer_save(uuid,uuid,jsonb),public.customer_disable(uuid,text),public.receivable_source_create(uuid,jsonb,uuid),public.receivable_create(uuid,jsonb,uuid),public.receivable_schedule_generate(uuid,jsonb,uuid) from public,anon,service_role;
grant execute on function public.customer_save(uuid,uuid,jsonb),public.customer_disable(uuid,text),public.receivable_source_create(uuid,jsonb,uuid),public.receivable_create(uuid,jsonb,uuid),public.receivable_schedule_generate(uuid,jsonb,uuid) to authenticated;
commit;
