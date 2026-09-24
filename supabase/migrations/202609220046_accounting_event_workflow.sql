begin;
create function public.accounting_demo_configure(target_company uuid,enabled boolean,reason text)returns jsonb language plpgsql security definer set search_path='' as $$declare r public.accounting_feature_flags;begin
 perform private.treasury_lock();perform private.finance_require('accounting_configuration.manage',target_company);
 if enabled is null or coalesce(length(trim(reason)),0)not between 1 and 2000 then raise exception using errcode='22023',message='Explicit demo flag and reason required';end if;
 insert into public.accounting_feature_flags(company_id,demo_enabled,updated_by)values(target_company,enabled,auth.uid())on conflict(company_id)do update set demo_enabled=excluded.demo_enabled,updated_by=auth.uid(),updated_at=now()returning * into r;
 perform private.accounting_event(target_company,'accounting_configuration',target_company,'demo_configuration',reason,jsonb_build_object('demo_enabled',enabled,'auto_generate',false,'auto_post',false,'production_rules',false));return to_jsonb(r);
end $$;
create function public.accounting_demo_rule_designate(target_id uuid,reason text)returns jsonb language plpgsql security definer set search_path='' as $$declare r public.accounting_rules;begin
 perform private.treasury_lock();select * into r from public.accounting_rules where id=target_id;perform private.finance_require('accounting_configuration.manage',r.company_id);perform private.finance_require('accounting_rule.activate',r.company_id);
 if not exists(select 1 from public.accounting_feature_flags where company_id=r.company_id and demo_enabled)or r.code!~'^(DEMO|TEST)[_-]'or r.name!~*'^(DEMO|TEST)[ :_-]'or r.created_by=auth.uid()or coalesce(length(trim(reason)),0)not between 1 and 2000 then raise exception using errcode='23514',message='Explicit DEMO configuration, labels and independent actor required';end if;
 if exists(select 1 from public.accounting_rule_lines l join public.accounting_accounts a on a.id=l.account_id and a.company_id=l.company_id where l.rule_id=r.id and(a.code!~'^(DEMO|TEST)[_-]'or a.name!~*'^(DEMO|TEST)[ :_-]'))then raise exception using errcode='23514',message='Only explicitly synthetic accounts allowed';end if;
 insert into public.accounting_demo_rules(company_id,rule_id,designated_by)values(r.company_id,r.id,auth.uid())on conflict do nothing;
 perform private.accounting_event(r.company_id,'rule',r.id,'designate_demo',reason,jsonb_build_object('version',r.version,'production_enabled',false));return jsonb_build_object('rule_id',r.id,'demo',true,'production_enabled',false);
end $$;
create function private.accounting_resolve_event(e public.accounting_events)returns uuid language plpgsql stable security definer set search_path='' as $$declare chosen uuid;best integer;n integer;begin
 if not exists(select 1 from public.accounting_feature_flags where company_id=e.company_id and demo_enabled and not auto_generate and not auto_post and not production_rules)then return null;end if;
 select max(r.priority)into best from public.accounting_rules r join public.accounting_demo_rules d on d.rule_id=r.id and d.company_id=r.company_id
 where r.company_id=e.company_id and r.status='simulation_active'and r.source_event=e.event_type and r.valid_from<=e.event_date and(r.valid_to is null or r.valid_to>=e.event_date)
 and(not(r.conditions?'currency_id')or r.conditions->>'currency_id'=e.currency_id::text)
 and(not(r.conditions?'third_party_type')or r.conditions->>'third_party_type'=e.third_party_type)
 and(not(r.conditions?'minimum_amount')or (r.conditions->>'minimum_amount')::numeric<=e.amount)
 and(not(r.conditions?'maximum_amount')or (r.conditions->>'maximum_amount')::numeric>=e.amount)
 and not exists(select 1 from public.accounting_rule_lines l cross join lateral unnest(l.dimension_types)dim where l.rule_id=r.id and not(e.dimensions?dim));
 if best is null then return null;end if;
 select count(*),(array_agg(r.id))[1]into n,chosen from public.accounting_rules r join public.accounting_demo_rules d on d.rule_id=r.id and d.company_id=r.company_id
 where r.company_id=e.company_id and r.priority=best and r.status='simulation_active'and r.source_event=e.event_type and r.valid_from<=e.event_date and(r.valid_to is null or r.valid_to>=e.event_date)
 and(not(r.conditions?'currency_id')or r.conditions->>'currency_id'=e.currency_id::text)
 and(not(r.conditions?'third_party_type')or r.conditions->>'third_party_type'=e.third_party_type)
 and(not(r.conditions?'minimum_amount')or (r.conditions->>'minimum_amount')::numeric<=e.amount)
 and(not(r.conditions?'maximum_amount')or (r.conditions->>'maximum_amount')::numeric>=e.amount)
 and not exists(select 1 from public.accounting_rule_lines l cross join lateral unnest(l.dimension_types)dim where l.rule_id=r.id and not(e.dimensions?dim));
 if n<>1 then raise exception using errcode='23514',message='Ambiguous accounting rule priority';end if;return chosen;
end $$;
create function private.accounting_event_preview_payload(e public.accounting_events)returns jsonb language plpgsql stable security definer set search_path='' as $$declare cfg public.accounting_settings;fx uuid;begin
 select * into cfg from public.accounting_settings where company_id=e.company_id;if not found then raise exception using errcode='23514',message='Accounting settings required';end if;
 if e.currency_id<>cfg.functional_currency_id then
  select id into fx from public.exchange_rates where(company_id=e.company_id or company_id is null)and date=e.event_date and currency_from=e.currency_id and currency_to=cfg.functional_currency_id and accounting_rate is not null order by company_id nulls last limit 1;
  if fx is null then raise exception using errcode='23514',message='Explicit dated accounting exchange rate required';end if;
 end if;
 return jsonb_build_object('source_event',e.event_type,'entry_date',e.event_date,'currency_id',e.currency_id,'exchange_rate_id',fx,'amounts',jsonb_build_object('amount',e.amount),'third_party_type',e.third_party_type,'third_party_id',e.third_party_id,'dimensions',e.dimensions);
end $$;
create function public.accounting_event_resolve(target_id uuid)returns jsonb language plpgsql security definer set search_path='' as $$declare e public.accounting_events;r uuid;begin
 perform private.treasury_lock();select * into e from public.accounting_events where id=target_id;perform private.finance_require('accounting_event.resolve',e.company_id);
 if e.journal_entry_id is not null or e.workflow_status='ignored_authorized'then raise exception using errcode='23514',message='Event already generated or ignored';end if;
 begin r:=private.accounting_resolve_event(e);
 exception when check_violation then update public.accounting_events set workflow_status='error',rule_id=null,preview_result=null,error_code='AMBIGUOUS_RULE'where id=e.id returning * into e;perform private.accounting_event(e.company_id,'accounting_event',e.id,'resolve_error',null,jsonb_build_object('code','AMBIGUOUS_RULE'));return to_jsonb(e);end;
 update public.accounting_events set workflow_status=case when r is null then 'pending_mapping'else 'ready'end,rule_id=r,preview_result=null,previewed_by=null,previewed_at=null,error_code=null where id=e.id returning * into e;
 perform private.accounting_event(e.company_id,'accounting_event',e.id,'resolved',null,jsonb_build_object('rule_id',r,'status',e.workflow_status));return to_jsonb(e);
end $$;
create function public.accounting_event_preview(target_id uuid)returns jsonb language plpgsql security definer set search_path='' as $$declare e public.accounting_events;r uuid;p jsonb;begin
 perform private.treasury_lock();select * into e from public.accounting_events where id=target_id;perform private.finance_require('accounting_event.preview',e.company_id);
 if e.journal_entry_id is not null or e.workflow_status='ignored_authorized'then raise exception using errcode='23514',message='Event already generated or ignored';end if;
 r:=private.accounting_resolve_event(e);if r is null or r is distinct from e.rule_id then raise exception using errcode='23514',message='Resolve a unique configured DEMO rule first';end if;
 p:=public.accounting_preview(r,private.accounting_event_preview_payload(e));
 p:=p||jsonb_build_object('configuration','CONFIGURACIÓN DEMO - NO PRODUCTIVA','event_id',e.id);
 update public.accounting_events set preview_result=p,previewed_by=auth.uid(),previewed_at=now(),workflow_status=case when(p->>'valid')::boolean then 'previewed'else 'error'end,error_code=case when(p->>'valid')::boolean then null else 'INVALID_PREVIEW'end where id=e.id;
 perform private.accounting_event(e.company_id,'accounting_event',e.id,'previewed',null,jsonb_build_object('rule_id',r,'valid',p->'valid','journal_persisted',false));return p;
end $$;
create function public.accounting_event_generate(target_id uuid,period_id uuid,entry_type_id uuid,operation_key uuid)returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.accounting_events;r uuid;p jsonb;input jsonb;line jsonb;ls jsonb:='[]';generated jsonb;source_kind text;source_uuid uuid;begin
 perform private.treasury_lock();select * into e from public.accounting_events where id=target_id;perform private.finance_require('accounting_event.generate',e.company_id);perform private.finance_require('journal.create',e.company_id);
 if not exists(select 1 from public.accounting_feature_flags where company_id=e.company_id and demo_enabled and not production_rules and not auto_generate and not auto_post)then raise exception using errcode='42501',message='DEMO generation disabled';end if;
 if e.operation_actor_id=auth.uid()then raise exception using errcode='42501',message='Financial operator cannot generate accounting draft';end if;
 if operation_key is null then raise exception using errcode='22023',message='Idempotency key required';end if;
 if e.journal_entry_id is not null then
  select to_jsonb(j)into generated from public.journal_entries j where id=e.journal_entry_id and company_id=e.company_id;return generated;
 end if;
 if e.workflow_status not in('ready','previewed')then raise exception using errcode='23514',message='Ready event required';end if;
 r:=private.accounting_resolve_event(e);if r is null or r is distinct from e.rule_id then raise exception using errcode='23514',message='Mapping changed; resolve again';end if;
 input:=private.accounting_event_preview_payload(e);p:=public.accounting_preview(r,input);if not coalesce((p->>'valid')::boolean,false)then raise exception using errcode='23514',message='Valid preview required';end if;
 for line in select value from jsonb_array_elements(p->'lines')loop
  ls:=ls||jsonb_build_array(jsonb_build_object('account_id',line->'account_id','description',coalesce(line->>'description','DEMO'),'debit',line->'debit','credit',line->'credit','foreign_amount',line->'foreign_amount','third_party_type',case when line->'third_party'<>'null'::jsonb then e.third_party_type end,'third_party_id',line->'third_party'->'id','dimensions',(select coalesce(jsonb_agg(jsonb_build_object('dimension_type',d->'dimension_type','dimension_id',d->'dimension_id')),'[]')from jsonb_array_elements(line->'dimensions')d)));
 end loop;
 source_kind:=case e.source_type when 'payment_allocation'then 'payment'when 'collection_allocation'then 'collection'when 'expense_settlement'then 'expense_report'else e.source_type end;
 source_uuid:=case e.source_type when 'payment_allocation'then(e.source_snapshot->>'payment_id')::uuid when 'collection_allocation'then(e.source_snapshot->>'collection_id')::uuid when 'expense_settlement'then(e.source_snapshot->>'report_id')::uuid else e.source_id end;
 generated:=public.journal_save(null,e.company_id,jsonb_build_object('entry_date',e.event_date,'accounting_period_id',period_id,'entry_type_id',entry_type_id,'description','CONFIGURACIÓN DEMO - NO PRODUCTIVA · '||e.event_type,'source_type',source_kind,'source_id',source_uuid,'currency_id',e.currency_id,'exchange_rate_id',input->'exchange_rate_id','lines',ls),operation_key);
 update public.journal_entries set accounting_event_id=e.id,accounting_rule_id=r where id=(generated->>'id')::uuid;
 update public.accounting_events set journal_entry_id=(generated->>'id')::uuid,generated_by=auth.uid(),generated_at=now(),workflow_status='draft_generated',preview_result=p where id=e.id;
 update public.accounting_rules set first_used_at=now()where id=r and first_used_at is null;
 perform private.accounting_event(e.company_id,'accounting_event',e.id,'draft_generated',null,jsonb_build_object('journal_entry_id',generated->'id','rule_id',r,'demo',true));
 return generated||jsonb_build_object('accounting_event_id',e.id,'accounting_rule_id',r,'demo',true);
end $$;
create function public.accounting_event_ignore(target_id uuid,reason text)returns jsonb language plpgsql security definer set search_path='' as $$declare e public.accounting_events;begin
 perform private.treasury_lock();select * into e from public.accounting_events where id=target_id;perform private.finance_require('accounting_event.ignore',e.company_id);
 if e.journal_entry_id is not null or coalesce(length(trim(reason)),0)not between 1 and 2000 then raise exception using errcode='23514',message='Ungenerated event and reason required';end if;
 update public.accounting_events set workflow_status='ignored_authorized',ignored_by=auth.uid(),ignore_reason=reason where id=e.id returning * into e;
 perform private.accounting_event(e.company_id,'accounting_event',e.id,'ignored',reason,jsonb_build_object('source_id',e.source_id));return to_jsonb(e);
end $$;
create function private.guard_event_journal()returns trigger language plpgsql security definer set search_path='' as $$declare e public.accounting_events;begin
 if new.accounting_event_id is null then return new;end if;
 select * into e from public.accounting_events where id=new.accounting_event_id and company_id=new.company_id;
 if not found then raise exception using errcode='42501',message='Event journal company mismatch';end if;
 if new.status<>'reversed'and not exists(select 1 from public.accounting_feature_flags where company_id=new.company_id and demo_enabled and not production_rules and not auto_generate and not auto_post)then raise exception using errcode='42501',message='Event journal requires active DEMO configuration';end if;
 if tg_op='UPDATE'and old.accounting_event_id is not null and(new.revision<>old.revision or new.accounting_event_id<>old.accounting_event_id or new.accounting_rule_id is distinct from old.accounting_rule_id)then raise exception using errcode='23514',message='Generated draft source and lines cannot be edited';end if;
 if new.status='validated'and (auth.uid()=new.created_by or auth.uid()=e.operation_actor_id)then raise exception using errcode='42501',message='Validation requires actor independent of operation and generation';end if;
 if new.status='posted'and(auth.uid()=new.created_by or auth.uid()=new.validated_by or auth.uid()=e.operation_actor_id)then raise exception using errcode='42501',message='Posting requires independent operator, generator and validator';end if;
 return new;
end $$;
create trigger accounting_event_segregation before insert or update on public.journal_entries for each row execute function private.guard_event_journal();
revoke all on function private.accounting_resolve_event(public.accounting_events),private.accounting_event_preview_payload(public.accounting_events),private.guard_event_journal()from public,anon,authenticated,service_role;
revoke all on function public.accounting_demo_configure(uuid,boolean,text),public.accounting_demo_rule_designate(uuid,text),public.accounting_event_resolve(uuid),public.accounting_event_preview(uuid),public.accounting_event_generate(uuid,uuid,uuid,uuid),public.accounting_event_ignore(uuid,text)from public,anon,service_role;
grant execute on function public.accounting_demo_configure(uuid,boolean,text),public.accounting_demo_rule_designate(uuid,text),public.accounting_event_resolve(uuid),public.accounting_event_preview(uuid),public.accounting_event_generate(uuid,uuid,uuid,uuid),public.accounting_event_ignore(uuid,text)to authenticated;
commit;

