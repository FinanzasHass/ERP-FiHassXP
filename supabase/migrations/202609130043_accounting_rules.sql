begin;
alter table public.accounting_rules add column first_used_at timestamptz;
alter table public.journal_entries add column accounting_rule_id uuid,add foreign key(company_id,accounting_rule_id)references public.accounting_rules(company_id,id);
create function public.accounting_rule_save(target_id uuid,target_company uuid,payload jsonb,operation_key uuid)returns jsonb language plpgsql security definer set search_path='' as $$
declare old_rule public.accounting_rules;r public.accounting_rules;item jsonb;n integer:=0;v integer:=1;result jsonb;kp jsonb;conditions jsonb;mult numeric;begin
 perform private.treasury_lock();perform private.finance_require(case when target_id is null then 'accounting_rule.create'else 'accounting_rule.edit'end,target_company);
 perform private.validate_keys(payload,array['code','name','source_event','conditions','priority','valid_from','valid_to','lines']);kp:=payload||jsonb_build_object('id',target_id);result:=private.accounting_retry(target_company,operation_key,'rule_save',kp);if result is not null then return result;end if;
 if target_id is not null then
  select * into old_rule from public.accounting_rules where id=target_id and company_id=target_company;if not found or payload->>'code'<>old_rule.code then raise exception using errcode='23514',message='Rule company/code immutable';end if;
  select max(version)+1 into v from public.accounting_rules where company_id=target_company and code=old_rule.code;
 elsif exists(select 1 from public.accounting_rules where company_id=target_company and code=payload->>'code')then raise exception using errcode='23514',message='Use versioned rule edit';end if;
 conditions:=coalesce(payload->'conditions','{}');if conditions<>'{}'::jsonb then perform private.validate_keys(conditions,array['currency_id','minimum_amount','maximum_amount','third_party_type']);end if;
 if conditions?'currency_id'and not exists(select 1 from public.currencies where id=(conditions->>'currency_id')::uuid and active)then raise exception using errcode='23514',message='Condition currency unavailable';end if;
 if conditions?'minimum_amount'then perform private.expense_money(conditions->'minimum_amount');end if;if conditions?'maximum_amount'then perform private.expense_money(conditions->'maximum_amount');end if;
 if (conditions->>'minimum_amount')::numeric>(conditions->>'maximum_amount')::numeric then raise exception using errcode='22023',message='Invalid rule amount range';end if;
 if conditions->>'third_party_type'is not null and conditions->>'third_party_type'not in('supplier','customer','employee')then raise exception using errcode='22023',message='Invalid third-party condition';end if;
 if jsonb_typeof(payload->'lines')is distinct from 'array'or jsonb_array_length(payload->'lines')not between 2 and 1000 then raise exception using errcode='22023',message='Rule requires explicit lines';end if;
 insert into public.accounting_rules(company_id,code,name,version,previous_version_id,source_event,conditions,priority,valid_from,valid_to,created_by)
 values(target_company,payload->>'code',payload->>'name',v,old_rule.id,payload->>'source_event',conditions,coalesce((payload->>'priority')::integer,0),(payload->>'valid_from')::date,(payload->>'valid_to')::date,auth.uid())returning * into r;
 for item in select value from jsonb_array_elements(payload->'lines')loop
  n:=n+1;perform private.validate_keys(item,array['account_id','side','description','amount_key','multiplier','use_third_party','dimension_types']);
  if not exists(select 1 from public.accounting_accounts where id=(item->>'account_id')::uuid and company_id=target_company)then raise exception using errcode='23514',message='Rule account company mismatch';end if;
  if item?'multiplier'and jsonb_typeof(item->'multiplier')is distinct from 'number'then raise exception using errcode='22023',message='Numeric multiplier required';end if;
  mult:=coalesce((item->>'multiplier')::numeric,1);if mult<=0 or mult>=1000000000000 or mult<>round(mult,12)then raise exception using errcode='22023',message='Invalid multiplier precision';end if;
  insert into public.accounting_rule_lines(company_id,rule_id,line_number,account_id,side,description,amount_key,multiplier,use_third_party,dimension_types)
  values(target_company,r.id,n,(item->>'account_id')::uuid,item->>'side',item->>'description',item->>'amount_key',mult,coalesce((item->>'use_third_party')::boolean,false),array(select jsonb_array_elements_text(coalesce(item->'dimension_types','[]'))));
 end loop;
 result:=to_jsonb(r);perform private.accounting_event(target_company,'rule',r.id,'version',null,jsonb_build_object('code',r.code,'version',r.version,'previous_version_id',old_rule.id,'line_count',n));perform private.accounting_remember(target_company,operation_key,'rule_save',kp,result);return result;
end $$;
create function public.accounting_rule_action(target_id uuid,action text,reason text)returns jsonb language plpgsql security definer set search_path='' as $$declare r public.accounting_rules;old_rule public.accounting_rules;begin
 perform private.treasury_lock();select * into r from public.accounting_rules where id=target_id;perform private.finance_require('accounting_rule.activate',r.company_id);
 if action is null or action not in('activate_simulation','disable')or coalesce(length(trim(reason)),0)not between 1 and 2000 then raise exception using errcode='22023',message='Simulation action and reason required';end if;
 if action='activate_simulation'then
  if r.created_by=auth.uid()then raise exception using errcode='42501',message='Rule activation requires independent actor';end if;
  if exists(select 1 from public.accounting_rule_lines l join public.accounting_accounts a on a.id=l.account_id where l.rule_id=r.id and(not a.active or not a.allows_posting))then raise exception using errcode='23514',message='Rule requires configured postable accounts';end if;
  for old_rule in update public.accounting_rules set status='disabled'where company_id=r.company_id and code=r.code and status='simulation_active'and id<>r.id returning * loop perform private.accounting_event(r.company_id,'rule',old_rule.id,'disable',reason,jsonb_build_object('replaced_by',r.id));end loop;
  update public.accounting_rules set status='simulation_active',activated_by=auth.uid(),activated_at=now()where id=r.id returning * into r;
 else update public.accounting_rules set status='disabled'where id=r.id returning * into r;end if;
 perform private.accounting_event(r.company_id,'rule',r.id,action,reason,jsonb_build_object('version',r.version,'production_enabled',false));return to_jsonb(r);
end $$;
create function public.accounting_preview(target_id uuid,payload jsonb)returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.accounting_rules;l public.accounting_rule_lines;a public.accounting_accounts;cfg public.accounting_settings;fx public.exchange_rates;rate numeric:=1;source_amount numeric;functional numeric;debits numeric:=0;credits numeric:=0;dim text;d jsonb;dims jsonb;party jsonb;proposal jsonb:='[]';errors jsonb:='[]';begin
 select * into r from public.accounting_rules where id=target_id;perform private.finance_require('accounting_rule.view',r.company_id);
 perform private.validate_keys(payload,array['source_event','entry_date','currency_id','exchange_rate_id','amounts','third_party_type','third_party_id','dimensions']);
 if r.status<>'simulation_active'or payload->>'source_event'is distinct from r.source_event or payload->>'entry_date'is null or(payload->>'entry_date')::date<r.valid_from or(r.valid_to is not null and(payload->>'entry_date')::date>r.valid_to)then raise exception using errcode='23514',message='Active simulation rule/date/event required';end if;
 perform private.validate_keys(payload->'amounts',array['amount','net_amount','tax_amount']);
 if payload?'dimensions'and payload->'dimensions'<>'{}'::jsonb then perform private.validate_keys(payload->'dimensions',array['cost_center','project','subproject','area']);end if;
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
revoke all on function public.accounting_rule_save(uuid,uuid,jsonb,uuid),public.accounting_rule_action(uuid,text,text),public.accounting_preview(uuid,jsonb)from public,anon,service_role;
grant execute on function public.accounting_rule_save(uuid,uuid,jsonb,uuid),public.accounting_rule_action(uuid,text,text),public.accounting_preview(uuid,jsonb)to authenticated;
commit;
