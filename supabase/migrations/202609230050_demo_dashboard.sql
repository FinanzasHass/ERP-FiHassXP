begin;
create function public.accounting_demo_dashboard(target_company uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 perform private.finance_require('demo_dashboard.view',target_company);
 if not exists(select 1 from public.accounting_feature_flags where company_id=target_company and demo_enabled and not auto_generate and not auto_post and not production_rules)then raise exception using errcode='42501',message='DEMO dashboard disabled for company';end if;
 return jsonb_build_object(
  'payables_outstanding',(select coalesce(jsonb_agg(x order by x.currency_code),'[]')from(select c.code currency_code,sum(p.outstanding_amount) amount from public.payables p join public.currencies c on c.id=p.currency_id where p.company_id=target_company and p.status='approved'and p.outstanding_amount>0 group by c.code)x),
  'receivables_outstanding',(select coalesce(jsonb_agg(x order by x.currency_code),'[]')from(select c.code currency_code,sum(r.original_amount-coalesce((select sum(a.amount)from public.collection_allocations a where a.receivable_id=r.id and a.status='valid'),0)) amount from public.receivables r join public.currencies c on c.id=r.currency_id where r.company_id=target_company and r.status='active' group by c.code)x),
  'upcoming_payments',(select coalesce(jsonb_agg(x order by x.due_date),'[]')from(select p.due_date,c.code currency_code,sum(p.outstanding_amount) amount from public.payables p join public.currencies c on c.id=p.currency_id where p.company_id=target_company and p.status='approved'and p.outstanding_amount>0 and p.due_date between current_date and current_date+30 group by p.due_date,c.code limit 100)x),
  'collections',(select coalesce(jsonb_agg(x order by x.currency_code),'[]')from(select c.code currency_code,sum(a.amount) amount from public.collection_allocations a join public.collections n on n.id=a.collection_id and n.status='active' join public.currencies c on c.id=n.currency_id where a.company_id=target_company and a.status='valid'group by c.code)x),
  'registered_bank',(select coalesce(jsonb_agg(x order by x.currency_code),'[]')from(select c.code currency_code,sum(case t.transaction_type when 'credit'then t.amount else -t.amount end) amount from public.bank_transactions t join public.currencies c on c.id=t.currency_id where t.company_id=target_company and t.evidence_state='confirmed'group by c.code)x),
  'travel_pending',(select count(*)from public.travel_expense_requests where company_id=target_company and status not in('closed','cancelled','rejected')),
  'accounting_pending',(select count(*)from public.accounting_events where company_id=target_company and workflow_status in('pending_mapping','ready','previewed','error')),
  'journals_posted',(select count(*)from public.journal_entries where company_id=target_company and status in('posted','reversed')),
  'open_period',(select jsonb_build_object('year',year,'month',month,'start_date',start_date,'end_date',end_date)from public.accounting_periods where company_id=target_company and status='open'order by start_date desc limit 1)
 );
end $$;
revoke all on function public.accounting_demo_dashboard(uuid)from public,anon,service_role;
grant execute on function public.accounting_demo_dashboard(uuid)to authenticated;
commit;
