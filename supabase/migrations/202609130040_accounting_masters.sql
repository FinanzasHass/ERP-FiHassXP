begin;
create function public.accounting_master_save(kind text,target_id uuid,target_company uuid,payload jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare tbl text;perm text;allowed text[];previous jsonb;result jsonb;tid uuid;node record;begin
 perform private.treasury_lock();
 case kind
 when 'account'then tbl:='accounting_accounts';perm:=case when target_id is null then 'accounting_account.create'else 'accounting_account.edit'end;allowed:=array['code','name','parent_id','account_type','normal_balance','allows_posting','requires_cost_center','requires_project','requires_third_party','valid_from','valid_to','pcge_reference_code'];
 when 'settings'then tbl:='accounting_settings';perm:='accounting_period.manage';allowed:=array['functional_currency_id','number_prefix','number_digits'];
 when 'period'then tbl:='accounting_periods';perm:='accounting_period.manage';allowed:=array['year','month','start_date','end_date'];
 when 'entry_type'then tbl:='accounting_entry_types';perm:='accounting_period.manage';allowed:=array['code','name','active'];
 else raise exception using errcode='22023',message='Invalid accounting master';end case;
 perform private.finance_require(perm,target_company);perform private.validate_keys(payload,allowed);
 if target_id is not null then
  execute format('select to_jsonb(t)from public.%I t where id=$1 and company_id=$2',tbl)into previous using target_id,target_company;
  if previous is null then raise exception using errcode='42501',message='Accounting master unavailable';end if;
  if kind='period'then raise exception using errcode='23514',message='Use audited period actions; period dates immutable';end if;
  if kind='settings'and payload?'functional_currency_id'and payload->>'functional_currency_id'<>previous->>'functional_currency_id'and exists(select 1 from public.journal_entries where company_id=target_company)then raise exception using errcode='23514',message='Functional currency fixed after first journal';end if;
  if kind='entry_type'and payload?'code'and payload->>'code'<>previous->>'code'then raise exception using errcode='23514',message='Entry type code immutable';end if;
 end if;
 if kind='settings'and payload?'functional_currency_id'and not exists(select 1 from public.currencies where id=(payload->>'functional_currency_id')::uuid and active and decimal_places=2)then raise exception using errcode='23514',message='Active two-decimal functional currency required';end if;
 if kind='period'and exists(select 1 from public.accounting_periods where company_id=target_company and start_date<=(payload->>'end_date')::date and end_date>=(payload->>'start_date')::date)then raise exception using errcode='23514',message='Overlapping accounting periods';end if;
 if target_id is null then payload:=payload||jsonb_build_object('company_id',target_company,'created_by',auth.uid());end if;
 result:=private.treasury_write(tbl,target_id,target_company,payload);tid:=(result->>'id')::uuid;
 if kind='account'then
  for node in with recursive tree as(select id,level from public.accounting_accounts where id=tid union all select a.id,t.level+1 from public.accounting_accounts a join tree t on a.parent_id=t.id)select * from tree order by level loop
   update public.accounting_accounts set level=node.level where id=node.id and level<>node.level;
  end loop;
 end if;
 perform private.accounting_event(target_company,kind,tid,'save',null,jsonb_build_object('old',previous,'new',result));return result;
end $$;
create function public.accounting_account_disable(target_id uuid,reason text)returns jsonb language plpgsql security definer set search_path='' as $$declare a public.accounting_accounts;begin
 perform private.treasury_lock();select * into a from public.accounting_accounts where id=target_id;perform private.finance_require('accounting_account.disable',a.company_id);
 if coalesce(length(trim(reason)),0)not between 1 and 2000 then raise exception using errcode='22023',message='Reason required';end if;
 update public.accounting_accounts set active=false,updated_at=now()where id=a.id returning * into a;perform private.accounting_event(a.company_id,'account',a.id,'disable',reason,jsonb_build_object('code',a.code));return to_jsonb(a);
end $$;
create function public.accounting_period_action(target_id uuid,action text,reason text)returns jsonb language plpgsql security definer set search_path='' as $$declare p public.accounting_periods;previous text;begin
 perform private.treasury_lock();select * into p from public.accounting_periods where id=target_id;
 if action is null or action not in('soft_close','close','reopen')then raise exception using errcode='22023',message='Invalid period action';end if;
 perform private.finance_require(case when action='reopen'then 'accounting_period.reopen'else 'accounting_period.close'end,p.company_id);
 if coalesce(length(trim(reason)),0)not between 1 and 2000 then raise exception using errcode='22023',message='Reason required';end if;
 previous:=p.status;
 if action='reopen'and p.status in('closed','soft_closed')then p.status:='reopened';
 elsif action='soft_close'and p.status in('open','reopened')then p.status:='soft_closed';
 elsif action='close'and p.status in('open','reopened','soft_closed')then p.status:='closed';
 else raise exception using errcode='23514',message='Invalid accounting period transition';end if;
 update public.accounting_periods set status=p.status,updated_at=now()where id=p.id;
 perform private.accounting_event(p.company_id,'period',p.id,action,reason,jsonb_build_object('previous_state',previous,'new_state',p.status));return to_jsonb(p);
end $$;
create function public.accounting_exchange_rate_save(target_company uuid,payload jsonb)returns jsonb language plpgsql security definer set search_path='' as $$declare r public.exchange_rates;n numeric;k text;begin
 perform private.treasury_lock();perform private.finance_require('accounting_period.manage',target_company);perform private.validate_keys(payload,array['date','currency_from','currency_to','buy_rate','sell_rate','accounting_rate','source']);
 foreach k in array array['buy_rate','sell_rate','accounting_rate']loop
 if jsonb_typeof(payload->k)is distinct from 'number'then raise exception using errcode='22023',message='Explicit numeric exchange rate required';end if;
 n:=(payload->>k)::numeric;if n<=0 or n>=1000000000000 or n<>round(n,12)then raise exception using errcode='22023',message='Invalid exchange rate precision';end if;end loop;
 if not exists(select 1 from public.currencies where id=(payload->>'currency_from')::uuid and active)or not exists(select 1 from public.currencies where id=(payload->>'currency_to')::uuid and active)then raise exception using errcode='23514',message='Active currencies required';end if;
 insert into public.exchange_rates(company_id,date,currency_from,currency_to,buy_rate,sell_rate,accounting_rate,source)values(target_company,(payload->>'date')::date,(payload->>'currency_from')::uuid,(payload->>'currency_to')::uuid,(payload->>'buy_rate')::numeric,(payload->>'sell_rate')::numeric,(payload->>'accounting_rate')::numeric,payload->>'source')returning * into r;
 perform private.accounting_event(target_company,'exchange_rate',r.id,'create',null,jsonb_build_object('date',r.date,'source',r.source,'accounting_rate',r.accounting_rate));return to_jsonb(r);
end $$;
create function public.accounting_account_import(target_company uuid,rows jsonb,confirm boolean,operation_key uuid)returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb;pending jsonb:=rows;remaining jsonb;parent uuid;result jsonb;inserted integer:=0;progress integer;made public.accounting_accounts;key_payload jsonb;source_row integer;problems jsonb;begin
 perform private.treasury_lock();perform private.finance_require('accounting_account.import',target_company);
 if confirm is null then raise exception using errcode='22023',message='Explicit confirmation boolean required';end if;
 if jsonb_typeof(rows)is distinct from 'array'or jsonb_array_length(rows)not between 1 and 2000 then raise exception using errcode='22023',message='Import requires 1–2000 explicit account rows';end if;
 key_payload:=jsonb_build_object('rows',rows);if confirm then result:=private.accounting_retry(target_company,operation_key,'account_import',key_payload);if result is not null then return result;end if;end if;
 if not confirm then
  select jsonb_agg(jsonb_build_object('row',r.ordinality+1,'code',r.value->>'code','error','duplicate_code'))into problems
  from jsonb_array_elements(rows)with ordinality r(value,ordinality)
  where exists(select 1 from public.accounting_accounts a where a.company_id=target_company and a.code=trim(r.value->>'code'))
   or(select count(*)from jsonb_array_elements(rows)x where trim(x->>'code')=trim(r.value->>'code'))>1;
  if problems is not null then return jsonb_build_object('status','invalid','persisted',false,'validated_rows',0,'errors',problems);end if;
 end if;
 -- The exception subtransaction guarantees preview performs full DB validation without persisting rows.
 begin
  while jsonb_array_length(pending)>0 loop
   progress:=0;remaining:='[]';
   for item in select value from jsonb_array_elements(pending)loop
    select min(ordinality)+1 into source_row from jsonb_array_elements(rows)with ordinality r where r.value=item;
    perform private.validate_keys(item,array['code','name','parent_code','account_type','normal_balance','allows_posting','requires_cost_center','requires_project','requires_third_party','active','valid_from','valid_to','pcge_reference_code']);
    parent:=null;if nullif(trim(item->>'parent_code'),'')is not null then select id into parent from public.accounting_accounts where company_id=target_company and code=trim(item->>'parent_code');
     if parent is null then remaining:=remaining||jsonb_build_array(item);continue;end if;end if;
    if exists(select 1 from public.accounting_accounts where company_id=target_company and code=trim(item->>'code'))then raise exception using errcode='23514',message='Duplicate account code; import never renames existing accounts';end if;
    insert into public.accounting_accounts(company_id,code,name,parent_id,account_type,normal_balance,allows_posting,requires_cost_center,requires_project,requires_third_party,active,valid_from,valid_to,pcge_reference_code,created_by)
    values(target_company,item->>'code',item->>'name',parent,item->>'account_type',item->>'normal_balance',coalesce((item->>'allows_posting')::boolean,false),coalesce((item->>'requires_cost_center')::boolean,false),coalesce((item->>'requires_project')::boolean,false),coalesce((item->>'requires_third_party')::boolean,false),coalesce((item->>'active')::boolean,true),(item->>'valid_from')::date,(item->>'valid_to')::date,item->>'pcge_reference_code',auth.uid())returning * into made;
    progress:=progress+1;inserted:=inserted+1;
   end loop;
   if progress=0 then raise exception using errcode='23514',message='Unresolved parent or cyclic import hierarchy';end if;pending:=remaining;
  end loop;
  if not confirm then raise exception using errcode='P8010',message='Preview rollback';end if;
 exception when sqlstate 'P8010'then null;
 when check_violation or not_null_violation or unique_violation or foreign_key_violation or invalid_text_representation or invalid_parameter_value or datetime_field_overflow then
  if confirm then raise;end if;
  return jsonb_build_object('status','invalid','persisted',false,'validated_rows',0,'errors',jsonb_build_array(jsonb_build_object('row',source_row,'code',item->>'code','error',case when sqlerrm='Unresolved parent or cyclic import hierarchy' then 'unresolved_hierarchy'else 'invalid_account_fields'end,'sqlstate',sqlstate)));
 end;
 result:=jsonb_build_object('status',case when confirm then 'imported'else 'preview'end,'validated_rows',inserted,'persisted',confirm);
 if confirm then perform private.accounting_remember(target_company,operation_key,'account_import',key_payload,result);perform private.accounting_event(target_company,'account_import',operation_key,'import',null,jsonb_build_object('row_count',inserted));end if;return result;
end $$;
revoke all on function public.accounting_master_save(text,uuid,uuid,jsonb),public.accounting_account_disable(uuid,text),public.accounting_period_action(uuid,text,text),public.accounting_exchange_rate_save(uuid,jsonb),public.accounting_account_import(uuid,jsonb,boolean,uuid)from public,anon,service_role;
grant execute on function public.accounting_master_save(text,uuid,uuid,jsonb),public.accounting_account_disable(uuid,text),public.accounting_period_action(uuid,text,text),public.accounting_exchange_rate_save(uuid,jsonb),public.accounting_account_import(uuid,jsonb,boolean,uuid)to authenticated;
commit;
