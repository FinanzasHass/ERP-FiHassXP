begin;
-- A mapping is intentionally never consulted in these transactional capture hooks.
create function private.capture_accounting_event(p jsonb)returns uuid language plpgsql security definer set search_path='' as $$
declare eid uuid;c uuid:=(p->>'company_id')::uuid;link jsonb;begin
 insert into public.accounting_events(company_id,event_type,source_type,source_id,source_revision,event_date,currency_id,amount,third_party_type,third_party_id,dimensions,source_snapshot,operation_actor_id)
 values(c,p->>'event_type',p->>'source_type',(p->>'source_id')::uuid,coalesce(p->>'source_revision','1'),(p->>'event_date')::date,(p->>'currency_id')::uuid,(p->>'amount')::numeric,p->>'third_party_type',(p->>'third_party_id')::uuid,coalesce(p->'dimensions','{}'),p->'source_snapshot',auth.uid())
 on conflict(company_id,event_type,source_type,source_id,source_revision)do nothing returning id into eid;
 if eid is null then select id into eid from public.accounting_events where company_id=c and event_type=p->>'event_type'and source_type=p->>'source_type'and source_id=(p->>'source_id')::uuid and source_revision=coalesce(p->>'source_revision','1');return eid;end if;
 insert into public.accounting_event_sources(company_id,event_id,entity_type,entity_id)values(c,eid,p->>'source_type',(p->>'source_id')::uuid);
 for link in select value from jsonb_array_elements(coalesce(p->'links','[]'))loop
  if link->>'entity_id'is not null then insert into public.accounting_event_sources(company_id,event_id,entity_type,entity_id)values(c,eid,link->>'entity_type',(link->>'entity_id')::uuid)on conflict do nothing;end if;
 end loop;
 perform private.accounting_event(c,'accounting_event',eid,'captured',null,jsonb_build_object('event_type',p->>'event_type','source_type',p->>'source_type','source_id',p->>'source_id','status','pending_mapping'));
 return eid;
end $$;
create function private.capture_financial_accounting_event()returns trigger language plpgsql security definer set search_path='' as $$
declare v jsonb:=to_jsonb(new);previous jsonb;payload jsonb;event text;kind text;d jsonb;party text;party_id uuid;curr uuid;amt numeric;on_date date;links jsonb:='[]';snapshot jsonb;item record;parent record;begin
 if tg_op='UPDATE'then previous:=to_jsonb(old);else previous:='{}';end if;
 d:=jsonb_strip_nulls(jsonb_build_object('cost_center',v->'cost_center_id','project',v->'project_id','subproject',v->'subproject_id','area',v->'area_id','afe_future',v->'afe_id'));
 snapshot:=jsonb_strip_nulls(jsonb_build_object('status',v->'status','document',coalesce(v->'payment_number',v->'receivable_number',v->'report_number',v->'reference'),'description',v->'description','dimension_snapshot',v->'dimension_snapshot'));
 curr:=(v->>'currency_id')::uuid;
 if tg_table_name='payables'then
  if v->>'status'<>'approved'or previous->>'status'='approved'then return new;end if;
  event:='PAYABLE_RECOGNIZED';kind:='payable';amt:=(v->>'original_amount')::numeric;on_date:=(v->>'issue_date')::date;
  party:=case when v->>'employee_id'is null then 'supplier'else 'employee'end;party_id:=coalesce(v->>'employee_id',v->>'supplier_id')::uuid;
  links:=jsonb_build_array(jsonb_build_object('entity_type',v->>'origin_type','entity_id',v->>'origin_id'));
 elsif tg_table_name='receivables'then
  if tg_op<>'INSERT'or v->>'status'<>'active'then return new;end if;
  event:='RECEIVABLE_RECOGNIZED';kind:='receivable';amt:=(v->>'original_amount')::numeric;on_date:=(v->>'issue_date')::date;party:='customer';party_id:=(v->>'customer_id')::uuid;
 elsif tg_table_name='payments'then
  if v->>'status'not in('executed','reversed')or v->>'status'=previous->>'status'then return new;end if;
  on_date:=case when v->>'status'='reversed'then (v->>'reversed_at')::timestamptz::date else(v->>'payment_date')::date end;
  if v->>'beneficiary_type'='employee'then
   for item in select pa.id allocation_id,pa.allocated_amount,p.* from public.payment_allocations pa join public.payables p on p.id=pa.payable_id and p.company_id=pa.company_id where pa.payment_id=new.id and pa.company_id=new.company_id loop
    event:=case item.origin_type when 'employee_advance'then case when new.status='executed'then 'EMPLOYEE_ADVANCE_PAID'else 'EMPLOYEE_ADVANCE_PAYMENT_REVERSED'end when 'employee_reimbursement'then case when new.status='executed'then 'EMPLOYEE_REIMBURSEMENT_PAID'else 'EMPLOYEE_REIMBURSEMENT_PAYMENT_REVERSED'end end;
    if event is null then raise exception using errcode='23514',message='Employee accounting source type unsupported';end if;
    perform private.capture_accounting_event(jsonb_build_object('company_id',new.company_id,'event_type',event,'source_type','payment_allocation','source_id',item.allocation_id,'event_date',on_date,'currency_id',new.currency_id,'amount',item.allocated_amount,'third_party_type','employee','third_party_id',new.beneficiary_id,
     'dimensions',jsonb_strip_nulls(jsonb_build_object('cost_center',item.cost_center_id,'project',item.project_id,'subproject',item.subproject_id)),
     'source_snapshot',snapshot||jsonb_build_object('payment_id',new.id,'origin_type',item.origin_type,'origin_id',item.origin_id,'payable_id',item.id,'dimension_snapshot',item.dimension_snapshot),
     'links',jsonb_build_array(jsonb_build_object('entity_type','payment','entity_id',new.id),jsonb_build_object('entity_type','payable','entity_id',item.id),jsonb_build_object('entity_type',item.origin_type,'entity_id',item.origin_id))));
   end loop;return new;
  end if;
  event:=case when new.status='executed'then 'SUPPLIER_PAYMENT_EXECUTED'else 'SUPPLIER_PAYMENT_REVERSED'end;kind:='payment';amt:=new.amount;party:='supplier';party_id:=new.beneficiary_id;
  -- Multiple allocations retain their individual dimension snapshots without inventing one shared CECO.
  snapshot:=snapshot||jsonb_build_object('allocations',(select coalesce(jsonb_agg(jsonb_build_object('payable_id',p.id,'amount',a.allocated_amount,'dimensions',p.dimension_snapshot)),'[]')from public.payment_allocations a join public.payables p on p.id=a.payable_id and p.company_id=a.company_id where a.payment_id=new.id and a.company_id=new.company_id));
  select coalesce(jsonb_agg(jsonb_build_object('entity_type','payable','entity_id',payable_id)),'[]')into links from public.payment_allocations where payment_id=new.id and company_id=new.company_id;
 elsif tg_table_name='collection_allocations'then
  if tg_op='UPDATE'and v->>'status'=previous->>'status'then return new;end if;
  select * into parent from public.collections where id=(v->>'collection_id')::uuid and company_id=(v->>'company_id')::uuid;
  event:=case when v->>'status'='valid'then 'CUSTOMER_COLLECTION_APPLIED'else 'CUSTOMER_COLLECTION_REVERSED'end;kind:='collection_allocation';amt:=(v->>'amount')::numeric;curr:=parent.currency_id;party:='customer';party_id:=parent.customer_id;on_date:=case when v->>'status'='reversed'then(v->>'reversed_at')::timestamptz::date else parent.collection_date end;
  snapshot:=snapshot||jsonb_build_object('collection_id',parent.id,'collection_number',parent.collection_number,'receivable_id',v->'receivable_id');
  links:=jsonb_build_array(jsonb_build_object('entity_type','collection','entity_id',parent.id),jsonb_build_object('entity_type','receivable','entity_id',v->'receivable_id'));
 elsif tg_table_name='expense_settlements'then
  if tg_op='UPDATE'and v->>'status'=previous->>'status'then return new;end if;
  select * into parent from public.expense_reports where id=(v->>'report_id')::uuid and company_id=(v->>'company_id')::uuid;
  event:=case when v->>'status'='valid'then 'EXPENSE_REPORT_SETTLED'else 'EXPENSE_SETTLEMENT_SUPERSEDED'end;kind:='expense_settlement';amt:=(v->>'accepted_expenses')::numeric;curr:=parent.currency_id;party:='employee';party_id:=parent.employee_id;on_date:=current_date;
  snapshot:=snapshot||jsonb_build_object('report_number',parent.report_number,'report_id',parent.id,'advance_paid',v->'advance_paid','accepted_expenses',v->'accepted_expenses','return_due',v->'employee_return_due','reimbursement_due',v->'employee_reimbursement_due');
  links:=jsonb_build_array(jsonb_build_object('entity_type','expense_report','entity_id',parent.id),jsonb_build_object('entity_type','employee_advance','entity_id',parent.employee_advance_id));
 elsif tg_table_name='employee_returns'then
  if tg_op='UPDATE'and not(v->>'status'in('cancelled','reversed')and previous->>'status'not in('cancelled','reversed'))then return new;end if;
  event:=case when tg_op='INSERT'then 'EMPLOYEE_RETURN_RECEIVED'else 'EMPLOYEE_RETURN_REVERSED'end;kind:='employee_return';amt:=(v->>'amount')::numeric;party:='employee';party_id:=(v->>'employee_id')::uuid;on_date:=case when tg_op='INSERT'then(v->>'return_date')::date else current_date end;
  snapshot:=snapshot||jsonb_build_object('reconciliation','not_implied','settlement_id',v->'settlement_id');
 else return new;end if;
 payload:=jsonb_build_object('company_id',v->'company_id','event_type',event,'source_type',kind,'source_id',v->'id','source_revision',coalesce(v->>'version','1'),'event_date',on_date,'currency_id',curr,'amount',amt,'third_party_type',party,'third_party_id',party_id,'dimensions',d,'source_snapshot',snapshot,'links',links);
 perform private.capture_accounting_event(payload);return new;
end $$;
do $$declare t text;begin foreach t in array array['payables','payments','receivables','collection_allocations','expense_settlements','employee_returns']loop execute format('create trigger capture_accounting_event after insert or update on public.%I for each row execute function private.capture_financial_accounting_event()',t);end loop;end $$;
revoke all on function private.capture_accounting_event(jsonb),private.capture_financial_accounting_event()from public,anon,authenticated,service_role;
commit;
