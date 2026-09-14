begin;
create view public.accounting_ledger_lines with(security_invoker=true)as
 select e.company_id,e.id journal_entry_id,l.id line_id,e.entry_number,e.entry_date,e.accounting_period_id,l.line_number,l.account_id,l.account_snapshot->>'code'account_code,l.account_snapshot->>'name'account_name,l.account_snapshot->>'normal_balance'normal_balance,
 l.description,l.debit,l.credit,e.functional_currency_id,l.currency_id,l.foreign_amount,l.exchange_rate,l.third_party_type,l.third_party_id,l.third_party_snapshot,e.source_type,e.source_id,e.original_entry_id,e.reversed_entry_id,
 coalesce((select jsonb_agg(jsonb_build_object('dimension_type',d.dimension_type,'dimension_id',d.dimension_id,'snapshot_code',d.snapshot_code,'snapshot_name',d.snapshot_name))from public.journal_line_dimensions d where d.journal_line_id=l.id),'[]')dimensions
 from public.journal_postings p join public.journal_entries e on e.id=p.journal_entry_id and e.company_id=p.company_id join public.journal_entry_lines l on l.journal_entry_id=e.id and l.company_id=e.company_id and l.revision=e.revision;
revoke all on public.accounting_ledger_lines from public,anon,authenticated,service_role;grant select on public.accounting_ledger_lines to authenticated;
create function private.accounting_filtered_lines(c uuid,filters jsonb)returns setof public.accounting_ledger_lines language sql stable security definer set search_path='' as $$
 select l.* from public.accounting_ledger_lines l where l.company_id=c
 and(filters->>'account_id'is null or l.account_id=(filters->>'account_id')::uuid)
 and(filters->>'account_from'is null or l.account_code>=filters->>'account_from')and(filters->>'account_to'is null or l.account_code<=filters->>'account_to')
 and(filters->>'currency_id'is null or l.currency_id=(filters->>'currency_id')::uuid)
 and(filters->>'third_party_type'is null or l.third_party_type=filters->>'third_party_type')and(filters->>'third_party_id'is null or l.third_party_id=(filters->>'third_party_id')::uuid)
 and(filters->>'cost_center_id'is null or exists(select 1 from public.journal_line_dimensions d where d.journal_line_id=l.line_id and d.dimension_type='cost_center'and d.dimension_id=(filters->>'cost_center_id')::uuid))
 and(filters->>'project_id'is null or exists(select 1 from public.journal_line_dimensions d where d.journal_line_id=l.line_id and d.dimension_type='project'and d.dimension_id=(filters->>'project_id')::uuid));
$$;
create function public.accounting_report(kind text,target_company uuid,filters jsonb default '{}')returns jsonb language plpgsql stable security definer set search_path='' as $$
declare start_on date;end_on date;p public.accounting_periods;page integer:=coalesce((filters->>'page')::integer,1);page_size integer:=coalesce((filters->>'limit')::integer,100);result jsonb;begin
 if kind is null or kind not in('general_ledger','trial_balance')then raise exception using errcode='22023',message='Invalid accounting report';end if;perform private.finance_require(kind||'.view',target_company);
 if filters is distinct from '{}'::jsonb then perform private.validate_keys(filters,array['accounting_period_id','date_from','date_to','account_id','account_from','account_to','third_party_type','third_party_id','cost_center_id','project_id','currency_id','rollup','page','limit']);end if;
 if filters->>'accounting_period_id'is not null then select * into p from public.accounting_periods where id=(filters->>'accounting_period_id')::uuid and company_id=target_company;if not found then raise exception using errcode='42501',message='Period unavailable';end if;end if;
 start_on:=coalesce((filters->>'date_from')::date,p.start_date,'1900-01-01');end_on:=coalesce((filters->>'date_to')::date,p.end_date,'9999-12-31');
 if start_on>end_on or page<1 or page_size not between 1 and 1000 or(p.id is not null and(start_on<p.start_date or end_on>p.end_date))then raise exception using errcode='22023',message='Invalid report range or pagination';end if;
 if kind='general_ledger'then
  with all_lines as(select l.*,sum(l.debit-l.credit)over(partition by l.account_id order by l.entry_date,l.entry_number,l.line_number,l.line_id rows unbounded preceding)running_balance from private.accounting_filtered_lines(target_company,filters)l where l.entry_date<=end_on),
  current_lines as(select * from all_lines where entry_date>=start_on)
  select jsonb_build_object('data',(select coalesce(jsonb_agg(x),'[]')from(select * from current_lines order by account_code,entry_date,entry_number,line_number,line_id limit page_size offset(page-1)*page_size)x),'count',(select count(*)from current_lines),
   'opening_balances',(select coalesce(jsonb_agg(x),'[]')from(select account_id,account_code,sum(debit-credit)opening_balance from all_lines where entry_date<start_on group by account_id,account_code)x),
   'date_from',start_on,'date_to',end_on,'balance_convention','debit_minus_credit')into result;
 else
  with recursive base as(select * from private.accounting_filtered_lines(target_company,filters)where entry_date<=end_on),
  ancestor_map as(select id child_id,id account_id,parent_id from public.accounting_accounts where company_id=target_company
   union all select m.child_id,a.id,a.parent_id from ancestor_map m join public.accounting_accounts a on a.id=m.parent_id and a.company_id=target_company where coalesce((filters->>'rollup')::boolean,false)),
  totals as(select a.id account_id,a.code account_code,a.name account_name,a.parent_id,a.level,a.normal_balance,
    coalesce(sum(b.debit-b.credit)filter(where b.entry_date<start_on),0)opening_balance,
    coalesce(sum(b.debit)filter(where b.entry_date>=start_on),0)debits,coalesce(sum(b.credit)filter(where b.entry_date>=start_on),0)credits,coalesce(sum(b.debit-b.credit),0)closing_balance
   from public.accounting_accounts a join ancestor_map m on m.account_id=a.id join base b on b.account_id=m.child_id where a.company_id=target_company group by a.id)
  select jsonb_build_object('data',(select coalesce(jsonb_agg(x),'[]')from(select * from totals order by account_code limit page_size offset(page-1)*page_size)x),'count',(select count(*)from totals),'date_from',start_on,'date_to',end_on,'rollup',coalesce((filters->>'rollup')::boolean,false),'balance_convention','debit_minus_credit','legal_financial_statement',false)into result;
 end if;return result;
end $$;
create function public.accounting_options(target_company uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if not private.has_company_access(target_company)or not exists(select 1 from public.permissions where resource in('accounting_account','accounting_period','journal','accounting_rule','general_ledger','trial_balance')and private.has_permission(code,target_company))then raise exception using errcode='42501',message='Accounting context denied';end if;
 return jsonb_build_object('settings',(select to_jsonb(s)from public.accounting_settings s where company_id=target_company),
 'accounts',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',code||' · '||name,'code',code,'active',active,'allows_posting',allows_posting)),'[]')from public.accounting_accounts where company_id=target_company),
 'periods',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',year||'-'||lpad(month::text,2,'0')||' · '||status,'status',status,'start_date',start_date,'end_date',end_date)),'[]')from public.accounting_periods where company_id=target_company),
 'entry_types',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'code',code)),'[]')from public.accounting_entry_types where company_id=target_company and active),
 'currencies',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',code)),'[]')from public.currencies where active),
 'exchange_rates',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',date||' · '||accounting_rate||' · '||source,'currency_from',currency_from,'currency_to',currency_to,'date',date,'accounting_rate',accounting_rate)),'[]')from public.exchange_rates where(company_id=target_company or company_id is null)and accounting_rate is not null),
 'cost_centers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',code||' · '||name)),'[]')from public.cost_centers where company_id=target_company and active),
 'projects',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',code||' · '||name)),'[]')from public.projects where company_id=target_company and status='active'),
 'subprojects',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',code||' · '||name,'project_id',project_id)),'[]')from public.subprojects where company_id=target_company and status='active'),
 'areas',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',code||' · '||name)),'[]')from public.areas where active),
 'suppliers',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.legal_name)),'[]')from public.suppliers s join public.supplier_companies sc on sc.supplier_id=s.id where sc.company_id=target_company and sc.status='active'),
 'customers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',legal_name)),'[]')from public.customers where company_id=target_company and status='active'),
 'employees',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',full_name)),'[]')from public.employees where company_id=target_company and active));
end $$;
revoke all on function private.accounting_filtered_lines(uuid,jsonb)from public,anon,authenticated,service_role;
revoke all on function public.accounting_report(text,uuid,jsonb),public.accounting_options(uuid)from public,anon,service_role;
grant execute on function public.accounting_report(text,uuid,jsonb),public.accounting_options(uuid)to authenticated;
commit;
