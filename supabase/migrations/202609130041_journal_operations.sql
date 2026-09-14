begin;
create function public.journal_save(target_id uuid,target_company uuid,payload jsonb,operation_key uuid)returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.journal_entries;s public.accounting_settings;p public.accounting_periods;fx public.exchange_rates;item jsonb;dim jsonb;d jsonb;l public.journal_entry_lines;n integer:=0;result jsonb;rate numeric:=1;key_payload jsonb;begin
 perform private.treasury_lock();perform private.finance_require(case when target_id is null then 'journal.create'else 'journal.edit_draft'end,target_company);
 perform private.validate_keys(payload,array['entry_date','accounting_period_id','entry_type_id','source_type','source_id','description','currency_id','exchange_rate_id','lines']);key_payload:=payload||jsonb_build_object('id',target_id);
 result:=private.accounting_retry(target_company,operation_key,'journal_save',key_payload);if result is not null then return result;end if;
 select * into s from public.accounting_settings where company_id=target_company;if not found then raise exception using errcode='23514',message='Accounting settings required';end if;
 select * into p from public.accounting_periods where id=(payload->>'accounting_period_id')::uuid and company_id=target_company;
 if not found or p.status not in('open','reopened')or (payload->>'entry_date')::date not between p.start_date and p.end_date then raise exception using errcode='23514',message='Open matching accounting period required';end if;
 if not exists(select 1 from public.accounting_entry_types where id=(payload->>'entry_type_id')::uuid and company_id=target_company and active)then raise exception using errcode='23514',message='Active entry type required';end if;
 if not exists(select 1 from public.currencies where id=(payload->>'currency_id')::uuid and active and decimal_places=2)then raise exception using errcode='23514',message='Active two-decimal transaction currency required';end if;
 if (payload->>'currency_id')::uuid<>s.functional_currency_id then
  select * into fx from public.exchange_rates where id=(payload->>'exchange_rate_id')::uuid and(company_id=target_company or company_id is null)and date=(payload->>'entry_date')::date and currency_from=(payload->>'currency_id')::uuid and currency_to=s.functional_currency_id and accounting_rate is not null;
  if not found then raise exception using errcode='23514',message='Explicit matching accounting exchange rate required';end if;rate:=fx.accounting_rate;
 elsif payload->>'exchange_rate_id'is not null then raise exception using errcode='23514',message='Same currency needs no conversion';end if;
 perform private.accounting_source(target_company,coalesce(payload->>'source_type','manual'),(payload->>'source_id')::uuid);
 if jsonb_typeof(payload->'lines')is distinct from 'array'or jsonb_array_length(payload->'lines')not between 1 and 1000 then raise exception using errcode='22023',message='Journal requires 1–1000 explicit lines';end if;
 if target_id is null then
  insert into public.journal_entries(company_id,entry_number,entry_date,accounting_period_id,entry_type_id,source_type,source_id,description,functional_currency_id,currency_id,exchange_rate_id,exchange_rate,created_by)
  values(target_company,private.accounting_number(target_company,(payload->>'entry_date')::date),(payload->>'entry_date')::date,p.id,(payload->>'entry_type_id')::uuid,coalesce(payload->>'source_type','manual'),(payload->>'source_id')::uuid,payload->>'description',s.functional_currency_id,(payload->>'currency_id')::uuid,fx.id,rate,auth.uid())returning * into e;
 else
  select * into e from public.journal_entries where id=target_id and company_id=target_company;
  if not found or e.status not in('draft','validated')or e.posted_at is not null then raise exception using errcode='23514',message='Only draft or validated unposted journal may return to draft';end if;
  if extract(year from e.entry_date)<>extract(year from (payload->>'entry_date')::date)then raise exception using errcode='23514',message='Numbered journal year immutable';end if;
  update public.journal_entries set entry_date=(payload->>'entry_date')::date,accounting_period_id=p.id,entry_type_id=(payload->>'entry_type_id')::uuid,source_type=coalesce(payload->>'source_type','manual'),source_id=(payload->>'source_id')::uuid,description=payload->>'description',currency_id=(payload->>'currency_id')::uuid,exchange_rate_id=fx.id,exchange_rate=rate,status='draft',validated_at=null,validated_by=null,revision=revision+1,updated_at=now()where id=e.id returning * into e;
 end if;
 for item in select value from jsonb_array_elements(payload->'lines')loop
  n:=n+1;perform private.validate_keys(item,array['account_id','description','debit','credit','foreign_amount','third_party_type','third_party_id','dimensions']);
  if not exists(select 1 from public.accounting_accounts where id=(item->>'account_id')::uuid and company_id=target_company)then raise exception using errcode='23514',message='Line account company mismatch';end if;
  insert into public.journal_entry_lines(company_id,journal_entry_id,revision,line_number,account_id,description,debit,credit,currency_id,foreign_amount,exchange_rate,third_party_type,third_party_id)
  values(target_company,e.id,e.revision,n,(item->>'account_id')::uuid,item->>'description',private.expense_money(coalesce(item->'debit','0')),private.expense_money(coalesce(item->'credit','0')),e.currency_id,case when item->>'foreign_amount'is null then null else private.expense_money(item->'foreign_amount')end,rate,item->>'third_party_type',(item->>'third_party_id')::uuid)returning * into l;
  if item?'dimensions'and jsonb_typeof(item->'dimensions')is distinct from 'array'then raise exception using errcode='22023',message='Dimension array required';end if;
  for dim in select value from jsonb_array_elements(coalesce(item->'dimensions','[]'))loop
   perform private.validate_keys(dim,array['dimension_type','dimension_id']);d:=private.accounting_dimension(target_company,dim->>'dimension_type',(dim->>'dimension_id')::uuid,e.entry_date);
   insert into public.journal_line_dimensions(company_id,journal_line_id,dimension_type,dimension_id,snapshot_code,snapshot_name,snapshot)values(target_company,l.id,dim->>'dimension_type',(dim->>'dimension_id')::uuid,coalesce(d->>'code',''),d->>'name',d);
  end loop;
 end loop;
 result:=to_jsonb(e);perform private.accounting_event(target_company,'journal',e.id,'save',null,jsonb_build_object('entry_number',e.entry_number,'revision',e.revision,'line_count',n));perform private.accounting_remember(target_company,operation_key,'journal_save',key_payload,result);return result;
end $$;
create function private.journal_check(target_id uuid)returns void language plpgsql stable security definer set search_path='' as $$
declare e public.journal_entries;a public.accounting_accounts;l public.journal_entry_lines;dm public.journal_line_dimensions;d jsonb;debits numeric;credits numeric;n integer;begin
 select * into e from public.journal_entries where id=target_id;
 if not found or not private.has_company_access(e.company_id)then raise exception using errcode='42501',message='Journal unavailable';end if;
 if not exists(select 1 from public.accounting_periods where id=e.accounting_period_id and company_id=e.company_id and status in('open','reopened')and e.entry_date between start_date and end_date)then raise exception using errcode='23514',message='Open matching period required for posting';end if;
 select sum(debit),sum(credit),count(*)into debits,credits,n from public.journal_entry_lines where journal_entry_id=e.id and revision=e.revision;
 if n<2 or debits<>credits or debits<=0 then raise exception using errcode='23514',message='Journal must balance exactly';end if;
 if e.original_entry_id is not null then
  if not exists(select 1 from public.journal_postings where journal_entry_id=e.original_entry_id and company_id=e.company_id)then raise exception using errcode='23514',message='Reversal requires original posting';end if;
  if exists(
   with original as(select src.* from public.journal_entry_lines src join public.journal_entries j on j.id=src.journal_entry_id where j.id=e.original_entry_id and src.revision=j.revision),inverse as(select * from public.journal_entry_lines where journal_entry_id=e.id and revision=e.revision)
   select 1 from original o full join inverse r using(line_number)where o.id is null or r.id is null or
   (to_jsonb(o)-array['id','journal_entry_id','revision','debit','credit','created_at','description'])is distinct from(to_jsonb(r)-array['id','journal_entry_id','revision','debit','credit','created_at','description'])or o.debit<>r.credit or o.credit<>r.debit
  )then raise exception using errcode='23514',message='Reversal must preserve exact original inverse';end if;
  return;
 end if;
 perform private.accounting_source(e.company_id,e.source_type,e.source_id);
 if not exists(select 1 from public.currencies where id=e.currency_id and active)or not exists(select 1 from public.currencies where id=e.functional_currency_id and active)then raise exception using errcode='23514',message='Inactive currency';end if;
 if not exists(select 1 from public.accounting_entry_types where id=e.entry_type_id and company_id=e.company_id and active)then raise exception using errcode='23514',message='Inactive entry type';end if;
 if e.currency_id<>e.functional_currency_id and not exists(select 1 from public.exchange_rates where id=e.exchange_rate_id and(company_id=e.company_id or company_id is null)and date=e.entry_date and currency_from=e.currency_id and currency_to=e.functional_currency_id and accounting_rate=e.exchange_rate)then raise exception using errcode='23514',message='Exchange rate context changed';end if;
 for l in select * from public.journal_entry_lines where journal_entry_id=e.id and revision=e.revision loop
  select * into a from public.accounting_accounts where id=l.account_id and company_id=e.company_id;
  if not found or not a.active or not a.allows_posting or e.entry_date<a.valid_from or(a.valid_to is not null and e.entry_date>a.valid_to)then raise exception using errcode='23514',message='Active postable account required at entry date';end if;
  if l.currency_id<>e.currency_id or l.exchange_rate<>e.exchange_rate then raise exception using errcode='23514',message='Line currency mismatch';end if;
  if e.currency_id<>e.functional_currency_id then
   if l.foreign_amount is null or l.foreign_amount*e.exchange_rate<>l.debit+l.credit then raise exception using errcode='23514',message='Exact explicit conversion required; no silent rounding';end if;
  elsif l.foreign_amount is not null and l.foreign_amount<>l.debit+l.credit then raise exception using errcode='23514',message='Same-currency amount mismatch';end if;
  if a.requires_third_party and l.third_party_id is null then raise exception using errcode='23514',message='Third party required';end if;
  perform private.accounting_third_party(e.company_id,l.third_party_type,l.third_party_id);
  if a.requires_cost_center and not exists(select 1 from public.journal_line_dimensions where journal_line_id=l.id and dimension_type='cost_center')then raise exception using errcode='23514',message='Cost center required';end if;
  if a.requires_project and not exists(select 1 from public.journal_line_dimensions where journal_line_id=l.id and dimension_type='project')then raise exception using errcode='23514',message='Project required';end if;
  for dm in select * from public.journal_line_dimensions where journal_line_id=l.id loop
   d:=private.accounting_dimension(e.company_id,dm.dimension_type,dm.dimension_id,e.entry_date);
   if dm.dimension_type='subproject'and not exists(select 1 from public.journal_line_dimensions where journal_line_id=l.id and dimension_type='project'and dimension_id=(d->>'project_id')::uuid)then raise exception using errcode='23514',message='Subproject requires matching project dimension';end if;
  end loop;
 end loop;
end $$;
create function public.journal_validate(target_id uuid)returns jsonb language plpgsql security definer set search_path='' as $$declare e public.journal_entries;begin
 perform private.treasury_lock();select * into e from public.journal_entries where id=target_id;perform private.finance_require('journal.validate',e.company_id);
 if e.status not in('draft','validated')then raise exception using errcode='23514',message='Unposted journal required';end if;perform private.journal_check(e.id);
 update public.journal_entries set status='validated',validated_by=auth.uid(),validated_at=now(),updated_at=now()where id=e.id returning * into e;
 perform private.accounting_event(e.company_id,'journal',e.id,'validate',null,jsonb_build_object('revision',e.revision));return to_jsonb(e);
end $$;
create function private.journal_finish_post(target_id uuid)returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.journal_entries;l public.journal_entry_lines;dm public.journal_line_dimensions;d jsonb;begin
 select * into e from public.journal_entries where id=target_id;perform private.journal_check(e.id);
 if e.original_entry_id is null then
  for l in select * from public.journal_entry_lines where journal_entry_id=e.id and revision=e.revision loop
   update public.journal_entry_lines set account_snapshot=(select to_jsonb(a)from public.accounting_accounts a where id=l.account_id),third_party_snapshot=private.accounting_third_party(e.company_id,l.third_party_type,l.third_party_id)where id=l.id;
   with recursive ancestors as(select id,parent_id from public.accounting_accounts where id=l.account_id union all select a.id,a.parent_id from public.accounting_accounts a join ancestors p on a.id=p.parent_id)
   update public.accounting_accounts set first_used_at=now()where id in(select id from ancestors)and first_used_at is null;
   for dm in select * from public.journal_line_dimensions where journal_line_id=l.id loop
    d:=private.accounting_dimension(e.company_id,dm.dimension_type,dm.dimension_id,e.entry_date);
    update public.journal_line_dimensions set snapshot_code=coalesce(d->>'code',''),snapshot_name=d->>'name',snapshot=d where id=dm.id;
    if dm.dimension_type='cost_center'then
     with recursive ancestors as(select id,parent_id from public.cost_centers where id=dm.dimension_id union all select a.id,a.parent_id from public.cost_centers a join ancestors p on a.id=p.parent_id)
     update public.cost_centers set first_used_at=now()where id in(select id from ancestors)and first_used_at is null;
    elsif dm.dimension_type='project'then update public.projects set first_used_at=now()where id=dm.dimension_id and first_used_at is null;
    elsif dm.dimension_type='subproject'then update public.subprojects set first_used_at=now()where id=dm.dimension_id and first_used_at is null;end if;
   end loop;
  end loop;
 end if;
 update public.journal_entries set status='posted',posted_by=auth.uid(),posted_at=now(),updated_at=now()where id=e.id returning * into e;
 insert into public.journal_postings(company_id,journal_entry_id,posted_by)values(e.company_id,e.id,auth.uid());
 perform private.accounting_event(e.company_id,'journal',e.id,'post',null,jsonb_build_object('entry_number',e.entry_number,'revision',e.revision,'original_entry_id',e.original_entry_id));return to_jsonb(e);
end $$;
create function public.journal_post(target_id uuid,operation_key uuid)returns jsonb language plpgsql security definer set search_path='' as $$declare e public.journal_entries;r jsonb;p jsonb:=jsonb_build_object('id',target_id);begin
 perform private.treasury_lock();select * into e from public.journal_entries where id=target_id;perform private.finance_require('journal.post',e.company_id);
 r:=private.accounting_retry(e.company_id,operation_key,'journal_post',p);if r is not null then return r;end if;
 if e.status='posted'then r:=to_jsonb(e);elsif e.status='validated'then
  if e.created_by=auth.uid()then raise exception using errcode='42501',message='Journal posting requires independent actor';end if;r:=private.journal_finish_post(e.id);
 else raise exception using errcode='23514',message='Validated journal required for posting';end if;
 perform private.accounting_remember(e.company_id,operation_key,'journal_post',p,r);return r;
end $$;
create function public.journal_reverse(target_id uuid,payload jsonb,operation_key uuid)returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.journal_entries;r public.journal_entries;l public.journal_entry_lines;nl public.journal_entry_lines;p public.accounting_periods;result jsonb;kp jsonb;begin
 perform private.treasury_lock();select * into e from public.journal_entries where id=target_id;perform private.finance_require('journal.reverse',e.company_id);perform private.finance_require('journal.post',e.company_id);
 perform private.validate_keys(payload,array['entry_date','accounting_period_id','entry_type_id','reason']);kp:=payload||jsonb_build_object('id',target_id);
 result:=private.accounting_retry(e.company_id,operation_key,'journal_reverse',kp);if result is not null then return result;end if;
 if e.status<>'posted'or e.original_entry_id is not null or e.reversed_entry_id is not null then raise exception using errcode='23514',message='Original unreversed posted journal required';end if;
 if e.posted_by=auth.uid()then raise exception using errcode='42501',message='Journal reversal requires actor independent of original poster';end if;
 if coalesce(length(trim(payload->>'reason')),0)not between 1 and 2000 then raise exception using errcode='22023',message='Reversal reason required';end if;
 select * into p from public.accounting_periods where id=(payload->>'accounting_period_id')::uuid and company_id=e.company_id and status in('open','reopened')and (payload->>'entry_date')::date between start_date and end_date;
 if not found then raise exception using errcode='23514',message='Open reversal period required';end if;
 if not exists(select 1 from public.accounting_entry_types where id=(payload->>'entry_type_id')::uuid and company_id=e.company_id and active)then raise exception using errcode='23514',message='Active reversal type required';end if;
 insert into public.journal_entries(company_id,entry_number,entry_date,accounting_period_id,entry_type_id,source_type,description,functional_currency_id,currency_id,exchange_rate_id,exchange_rate,status,created_by,validated_by,validated_at,original_entry_id,reversal_reason)
 values(e.company_id,private.accounting_number(e.company_id,(payload->>'entry_date')::date),(payload->>'entry_date')::date,p.id,(payload->>'entry_type_id')::uuid,'manual','Reverso de '||e.entry_number,e.functional_currency_id,e.currency_id,e.exchange_rate_id,e.exchange_rate,'validated',auth.uid(),auth.uid(),now(),e.id,payload->>'reason')returning * into r;
 for l in select * from public.journal_entry_lines where journal_entry_id=e.id and revision=e.revision loop
  insert into public.journal_entry_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit,currency_id,foreign_amount,exchange_rate,third_party_type,third_party_id,account_snapshot,third_party_snapshot)
  values(e.company_id,r.id,l.line_number,l.account_id,l.description,l.credit,l.debit,l.currency_id,l.foreign_amount,l.exchange_rate,l.third_party_type,l.third_party_id,l.account_snapshot,l.third_party_snapshot)returning * into nl;
  insert into public.journal_line_dimensions(company_id,journal_line_id,dimension_type,dimension_id,snapshot_code,snapshot_name,snapshot)select company_id,nl.id,dimension_type,dimension_id,snapshot_code,snapshot_name,snapshot from public.journal_line_dimensions where journal_line_id=l.id;
 end loop;
 result:=private.journal_finish_post(r.id);
 update public.journal_entries set status='reversed',reversed_entry_id=r.id,reversal_reason=payload->>'reason',updated_at=now()where id=e.id;
 perform private.accounting_event(e.company_id,'journal',e.id,'reverse',payload->>'reason',jsonb_build_object('original_entry_id',e.id,'reversal_entry_id',r.id));perform private.accounting_remember(e.company_id,operation_key,'journal_reverse',kp,result);return result;
end $$;
revoke all on function private.journal_check(uuid),private.journal_finish_post(uuid)from public,anon,authenticated,service_role;
revoke all on function public.journal_save(uuid,uuid,jsonb,uuid),public.journal_validate(uuid),public.journal_post(uuid,uuid),public.journal_reverse(uuid,jsonb,uuid)from public,anon,service_role;
grant execute on function public.journal_save(uuid,uuid,jsonb,uuid),public.journal_validate(uuid),public.journal_post(uuid,uuid),public.journal_reverse(uuid,jsonb,uuid)to authenticated;
commit;
