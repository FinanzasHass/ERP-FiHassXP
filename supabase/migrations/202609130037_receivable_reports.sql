begin;
create function public.receivable_options(target_company uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_company_access(target_company) or not exists(select 1 from public.permissions where resource in('customer','receivable','collection','receivable_schedule','membership','lot_receivable','receivable_report','collection_report')and private.has_permission(code,target_company))then raise exception using errcode='42501',message='Receivable context denied';end if;
 return jsonb_build_object(
 'customers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',legal_name,'status',status)),'[]')from public.customers where company_id=target_company),
 'currencies',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',code)),'[]')from public.currencies where active),
 'sources',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',reference,'source_type',source_type,'customer_id',customer_id,'currency_id',currency_id)),'[]')from public.receivable_sources where company_id=target_company),
 'methods',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]')from public.payment_methods where company_id=target_company and active),
 'bank_accounts',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',display_name,'currency_id',currency_id)),'[]')from public.company_bank_accounts where company_id=target_company and active));
end $$;
create function public.collection_candidates(target_id uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.collections;begin
 select * into c from public.collections where id=target_id;if not found then raise exception using errcode='42501',message='Collection unavailable';end if;
 perform private.finance_require('collection.identify',c.company_id);perform private.finance_require('customer.view',c.company_id);
 if c.status<>'active'then raise exception using errcode='23514',message='Collection inactive';end if;
 return(select coalesce(jsonb_agg(x),'[]')from(
 select cu.id customer_id,cu.legal_name,
  (case when length(cu.document_number)>=4 and position(lower(cu.document_number)in lower(c.reference))>0 then 100 else 0 end+
   case when position(lower(cu.legal_name)in lower(c.reference))>0 then 50 else 0 end+
   case when private.receivable_read(c.company_id) and exists(select 1 from public.receivable_balances r where r.customer_id=cu.id and r.currency_id=c.currency_id and r.status='active' and r.outstanding_amount=c.amount)then 30 else 0 end+
   case when private.receivable_read(c.company_id) and exists(select 1 from public.receivable_balances r join public.receivable_sources s on s.id=r.source_id where r.customer_id=cu.id and r.currency_id=c.currency_id and r.status='active' and (abs(r.due_date-c.collection_date)<=7 or position(lower(s.reference)in lower(c.reference))>0 or position(lower(r.receivable_number)in lower(c.reference))>0))then 20 else 0 end) score,
  'Sugerencia por referencia/documento/nombre, importe y vencimiento; requiere confirmación' qualification
 from public.customers cu where cu.company_id=c.company_id and cu.status='active' order by score desc,cu.id limit 100)x);
end $$;
create function public.collection_deposit_queue(target_company uuid,page integer default 1,page_size integer default 30)returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.finance_require('collection.view',target_company);
 if page<1 or page_size not between 1 and 100 then raise exception using errcode='22023',message='Invalid pagination';end if;
 return(with q as(select t.id,t.transaction_date,t.amount,t.currency_id,t.bank_reference,c.id collection_id,'unidentified' financial_status
 from public.bank_transactions t left join public.collections c on c.bank_transaction_id=t.id and c.status='active'
 where t.company_id=target_company and t.transaction_type='credit' and t.evidence_state='confirmed' and t.status<>'excluded' and c.customer_id is null
 and not exists(select 1 from public.bank_reconciliation_matches m where m.bank_transaction_id=t.id and m.collection_id is null and m.status<>'cancelled'))
 select jsonb_build_object('data',(select coalesce(jsonb_agg(x),'[]')from(select * from q order by transaction_date,id limit page_size offset(page-1)*page_size)x),'count',(select count(*)from q),'page',page,'limit',page_size));
end $$;
create function public.receivable_dashboard(target_company uuid,as_of date default current_date)returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if not private.has_company_access(target_company) or not(private.has_permission('receivable_report.view',target_company)or private.has_permission('collection_report.view',target_company))then raise exception using errcode='42501',message='Receivable reports denied';end if;
 return jsonb_build_object('as_of',as_of,
 'portfolio',(select coalesce(jsonb_agg(x),'[]')from(select currency_id,sum(outstanding_amount) outstanding_amount,sum(outstanding_amount)filter(where due_date<as_of) overdue_amount,sum(outstanding_amount)filter(where due_date>=as_of) upcoming_amount,count(distinct customer_id)filter(where due_date<as_of and outstanding_amount>0) overdue_customers from public.receivable_balances where company_id=target_company and status='active' group by currency_id)x),
 'aging',(select coalesce(jsonb_agg(x),'[]')from(select currency_id,case when due_date>=as_of then 'al_dia' when as_of-due_date<=30 then '1_30' when as_of-due_date<=60 then '31_60' when as_of-due_date<=90 then '61_90' else 'over_90'end bucket,sum(outstanding_amount)amount from public.receivable_balances where company_id=target_company and status='active' and outstanding_amount>0 group by currency_id,bucket)x),
 'collections',(select coalesce(jsonb_agg(x),'[]')from(select currency_id,collection_date,financial_status,sum(amount) amount,sum(applied_amount)applied_amount,sum(unapplied_amount)unapplied_amount from public.collection_balances where company_id=target_company and status='active' group by currency_id,collection_date,financial_status)x),
 'credits',(select coalesce(jsonb_agg(x),'[]')from(select customer_id,currency_id,sum(unapplied_amount)unapplied_amount from public.collection_balances where company_id=target_company and status='active' and customer_id is not null and unapplied_amount>0 group by customer_id,currency_id)x),
 'customer_portfolio',(select coalesce(jsonb_agg(x),'[]')from(select customer_id,source_type,source_id,currency_id,sum(outstanding_amount)outstanding_amount from public.receivable_balances where company_id=target_company and status='active' group by customer_id,source_type,source_id,currency_id)x),
 'due_soon',(select coalesce(jsonb_agg(x),'[]')from(select id,customer_id,receivable_number,currency_id,due_date,outstanding_amount from public.receivable_balances where company_id=target_company and status='active' and outstanding_amount>0 and due_date between as_of and as_of+30 order by due_date,id limit 100)x));
end $$;
alter function public.treasury_cashflow(uuid)rename to treasury_cashflow_before_receivable;
create function public.treasury_cashflow(target_company uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb;begin
 perform private.finance_require('cashflow.view',target_company);r:=public.treasury_cashflow_before_receivable(target_company);
 return r||jsonb_build_object('expected_receivables',(select coalesce(jsonb_agg(x),'[]')from(select due_date,currency_id,sum(outstanding_amount)amount from public.receivable_balances where company_id=target_company and status='active' and outstanding_amount>0 group by due_date,currency_id)x));
end $$;
create function public.issued_document_create(target_company uuid,payload jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.issued_document_references;begin
 perform private.treasury_lock();perform private.finance_require('receivable.create',target_company);
 perform private.validate_keys(payload,array['customer_id','document_type','series','number','issue_date','description']);
 if not exists(select 1 from public.customers where id=(payload->>'customer_id')::uuid and company_id=target_company and status='active')then raise exception using errcode='23514',message='Active customer required';end if;
 insert into public.issued_document_references(company_id,customer_id,document_type,series,number,issue_date,description,created_by)values(target_company,(payload->>'customer_id')::uuid,payload->>'document_type',upper(trim(payload->>'series')),payload->>'number',(payload->>'issue_date')::date,payload->>'description',auth.uid())returning * into r;return to_jsonb(r);
end $$;
create function public.receivable_source_close(target_id uuid,reason text)returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.receivable_sources;previous jsonb;begin
 perform private.treasury_lock();select * into s from public.receivable_sources where id=target_id;if not found then raise exception using errcode='42501',message='Source unavailable';end if;
 perform private.finance_require(case s.source_type when 'membership'then 'membership.manage' when 'lot_sale'then 'lot_receivable.manage'else 'receivable.adjust'end,s.company_id);
 if coalesce(length(trim(reason)),0)not between 1 and 2000 then raise exception using errcode='22023',message='Reason required';end if;
 previous:=to_jsonb(s);update public.receivable_sources set status='closed',updated_at=now()where id=s.id returning * into s;
 perform private.cxc_history(s.company_id,'source',s.id,'close',reason,previous,to_jsonb(s));return to_jsonb(s);
end $$;
revoke all on function public.treasury_cashflow_before_receivable(uuid)from public,anon,authenticated,service_role;
revoke all on function public.receivable_options(uuid),public.collection_candidates(uuid),public.collection_deposit_queue(uuid,integer,integer),public.receivable_dashboard(uuid,date),public.treasury_cashflow(uuid),public.issued_document_create(uuid,jsonb),public.receivable_source_close(uuid,text)from public,anon,service_role;
grant execute on function public.receivable_options(uuid),public.collection_candidates(uuid),public.collection_deposit_queue(uuid,integer,integer),public.receivable_dashboard(uuid,date),public.treasury_cashflow(uuid),public.issued_document_create(uuid,jsonb),public.receivable_source_close(uuid,text)to authenticated;
create function public.receivable_schedule_installments(target_id uuid,page integer default 1,page_size integer default 100)returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c uuid;begin
 select company_id into c from public.receivable_schedules where id=target_id;
 if c is null or not private.has_company_access(c) or not(private.has_permission('receivable_schedule.view',c)or private.receivable_read(c))then raise exception using errcode='42501',message='Schedule unavailable';end if;
 if page<1 or page_size not between 1 and 100 then raise exception using errcode='22023',message='Invalid pagination';end if;
 return jsonb_build_object('data',(select coalesce(jsonb_agg(x),'[]')from(select i.*,r.receivable_number,r.collected_amount,r.outstanding_amount,r.financial_status,r.days_overdue from public.receivable_installments i join public.receivable_balances r on r.installment_id=i.id and r.company_id=i.company_id where i.schedule_id=target_id and i.company_id=c order by i.number limit page_size offset(page-1)*page_size)x),'count',(select count(*)from public.receivable_installments where schedule_id=target_id and company_id=c));
end $$;
revoke all on function public.receivable_schedule_installments(uuid,integer,integer)from public,anon,service_role;
grant execute on function public.receivable_schedule_installments(uuid,integer,integer)to authenticated;
commit;
