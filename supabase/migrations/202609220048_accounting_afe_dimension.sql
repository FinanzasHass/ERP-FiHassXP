begin;
-- Preserve the existing preview and option contracts; add only the configurable AFE dimension.
create or replace function public.accounting_preview(target_id uuid,payload jsonb)returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.accounting_rules;l public.accounting_rule_lines;a public.accounting_accounts;cfg public.accounting_settings;fx public.exchange_rates;rate numeric:=1;source_amount numeric;functional numeric;debits numeric:=0;credits numeric:=0;dim text;d jsonb;dims jsonb;party jsonb;proposal jsonb:='[]';errors jsonb:='[]';begin
 select * into r from public.accounting_rules where id=target_id;perform private.finance_require('accounting_rule.view',r.company_id);
 perform private.validate_keys(payload,array['source_event','entry_date','currency_id','exchange_rate_id','amounts','third_party_type','third_party_id','dimensions']);
 if r.status<>'simulation_active'or payload->>'source_event'is distinct from r.source_event or payload->>'entry_date'is null or(payload->>'entry_date')::date<r.valid_from or(r.valid_to is not null and(payload->>'entry_date')::date>r.valid_to)then raise exception using errcode='23514',message='Active simulation rule/date/event required';end if;
 perform private.validate_keys(payload->'amounts',array['amount','net_amount','tax_amount']);
 if payload?'dimensions'and payload->'dimensions'<>'{}'::jsonb then perform private.validate_keys(payload->'dimensions',array['cost_center','project','subproject','area','afe_future']);end if;
 if r.conditions?'currency_id'and r.conditions->>'currency_id'<>payload->>'currency_id' or r.conditions?'third_party_type'and r.conditions->>'third_party_type'is distinct from payload->>'third_party_type'
 or r.conditions?'minimum_amount'and private.expense_money(payload->'amounts'->'amount')<(r.conditions->>'minimum_amount')::numeric
 or r.conditions?'maximum_amount'and private.expense_money(payload->'amounts'->'amount')>(r.conditions->>'maximum_amount')::numeric then raise exception using errcode='23514',message='Source does not satisfy rule conditions';end if;
 select * into cfg from public.accounting_settings where company_id=r.company_id;if not found then raise exception using errcode='23514',message='Functional currency configuration required';end if;
 if not exists(select 1 from public.currencies where id=(payload->>'currency_id')::uuid and active)then raise exception using errcode='23514',message='Active transaction currency required';end if;
 if (payload->>'currency_id')::uuid<>cfg.functional_currency_id then
  select * into fx from public.exchange_rates where id=(payload->>'exchange_rate_id')::uuid and(company_id=r.company_id or company_id is null)and date=(payload->>'entry_date')::date and currency_from=(payload->>'currency_id')::uuid and currency_to=cfg.functional_currency_id and accounting_rate is not null;
  if not found then raise exception using errcode='23514',message='Explicit exchange rate required';end if;rate:=fx.accounting_rate;
 elsif payload->>'exchange_rate_id'is not null then raise exception using errcode='23514',message='Same currency needs no conversion';end if;
 for l in select * from public.accounting_rule_lines where rule_id=r.id order by line_number loop
  select * into a from public.accounting_accounts where id=l.account_id and company_id=r.company_id;
  if not a.active or not a.allows_posting or(payload->>'entry_date')::date<a.valid_from or(a.valid_to is not null and(payload->>'entry_date')::date>a.valid_to)then raise exception using errcode='23514',message='Rule account is not postable at date';end if;
  source_amount:=private.expense_money(payload->'amounts'->l.amount_key)*l.multiplier;functional:=source_amount*rate;
  if functional<=0 or functional>=1000000000000 or functional<>round(functional,2)or source_amount<>round(source_amount,2)then raise exception using errcode='23514',message='Rule amount requires explicit precision policy';end if;
  party:=null;if l.use_third_party then party:=private.accounting_third_party(r.company_id,payload->>'third_party_type',(payload->>'third_party_id')::uuid);end if;
  if a.requires_third_party and party is null then errors:=errors||jsonb_build_array(jsonb_build_object('line',l.line_number,'error','third_party_required'));end if;
  dims:='[]';foreach dim in array l.dimension_types loop
   d:=private.accounting_dimension(r.company_id,dim,(payload->'dimensions'->>dim)::uuid,(payload->>'entry_date')::date);dims:=dims||jsonb_build_array(jsonb_build_object('dimension_type',dim,'dimension_id',d->>'id','snapshot_code',d->>'code','snapshot_name',d->>'name'));
   if dim='subproject'and d->>'project_id'is distinct from payload->'dimensions'->>'project'then raise exception using errcode='23514',message='Subproject requires matching project';end if;
  end loop;
  if a.requires_cost_center and not('cost_center'=any(l.dimension_types))then errors:=errors||jsonb_build_array(jsonb_build_object('line',l.line_number,'error','cost_center_required'));end if;
  if a.requires_project and not('project'=any(l.dimension_types))then errors:=errors||jsonb_build_array(jsonb_build_object('line',l.line_number,'error','project_required'));end if;
  if l.side='debit'then debits:=debits+functional;else credits:=credits+functional;end if;
  proposal:=proposal||jsonb_build_array(jsonb_build_object('account_id',a.id,'account_code',a.code,'account_name',a.name,'description',l.description,'debit',case when l.side='debit'then functional else 0 end,'credit',case when l.side='credit'then functional else 0 end,'currency_id',payload->>'currency_id','functional_currency_id',cfg.functional_currency_id,'foreign_amount',source_amount,'exchange_rate',rate,'third_party',party,'dimensions',dims));
 end loop;
 if debits<>credits then errors:=errors||jsonb_build_array(jsonb_build_object('error','unbalanced'));end if;
 return jsonb_build_object('rule_id',r.id,'version',r.version,'lines',proposal,'debits',debits,'credits',credits,'errors',errors,'valid',jsonb_array_length(errors)=0,'persisted',false,'posted',false,'production_enabled',false);
end $$;
create or replace function public.accounting_options(target_company uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if not private.has_company_access(target_company)or not exists(select 1 from public.permissions where resource in('accounting_account','accounting_period','journal','accounting_rule','general_ledger','trial_balance')and private.has_permission(code,target_company))then raise exception using errcode='42501',message='Accounting context denied';end if;
 return jsonb_build_object('afes',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',code||' · '||name)),'[]')from public.afes where company_id=target_company and active),'settings',(select to_jsonb(s)from public.accounting_settings s where company_id=target_company),
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
commit;
