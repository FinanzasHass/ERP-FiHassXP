begin;
-- Values are explicit configuration, never inferred from a bank description or from another dimension.
insert into public.permissions(module,code,resource,action,description,active,requires_company,scope,is_sensitive) values
 ('contabilidad','bank_transaction.classify_accounting','bank_transaction','classify_accounting','Classify an eligible confirmed bank transaction as an accounting adjustment',true,true,'none',true)
on conflict(code) do nothing;

create table public.accounting_rule_dimension_matches(
 company_id uuid not null,rule_id uuid not null,dimension_type text not null check(dimension_type in('cost_center','project','subproject','area','afe_future')),
 dimension_id uuid not null,created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 primary key(rule_id,dimension_type),foreign key(company_id,rule_id)references public.accounting_rules(company_id,id)
);
create table public.bank_accounting_adjustments(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,bank_transaction_id uuid not null,reason text not null check(length(trim(reason))between 1 and 2000),created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 unique(company_id,id),unique(bank_transaction_id),foreign key(company_id,bank_transaction_id)references public.bank_transactions(company_id,id)
);
do $$declare t text;p text;begin
 for t,p in select * from (values
  ('accounting_rule_dimension_matches','private.has_permission(''accounting_rule.view'',company_id)'),
  ('bank_accounting_adjustments','private.has_permission(''accounting_event.view'',company_id)')
 )v(t,p) loop
  execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);execute format('grant select on public.%I to authenticated',t);execute format('create policy accounting_configuration_read on public.%I for select to authenticated using(%s)',t,p);
 end loop;
end $$;

create function private.guard_accounting_event_configuration()returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_op<>'INSERT' then raise exception using errcode='23514',message='Accounting configuration evidence is immutable; create a rule version';end if;return new;end $$;
create trigger guard_rule_dimension_matches before update or delete on public.accounting_rule_dimension_matches for each row execute function private.guard_accounting_event_configuration();
create trigger guard_bank_accounting_adjustments before update or delete on public.bank_accounting_adjustments for each row execute function private.guard_accounting_event_configuration();

create function public.accounting_rule_dimension_match_save(target_rule uuid,target_company uuid,dimensions jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.accounting_rules;item jsonb;kind text;rid uuid;begin
 perform private.treasury_lock();perform private.finance_require('accounting_rule.edit',target_company);
 if jsonb_typeof(dimensions)is distinct from'array'or jsonb_array_length(dimensions)>5 then raise exception using errcode='22023',message='Explicit dimension matches required';end if;
 select * into r from public.accounting_rules where id=target_rule and company_id=target_company;if not found or r.status<>'draft' or r.first_used_at is not null then raise exception using errcode='23514',message='Only unused draft rule may receive dimension matches';end if;
 if exists(select 1 from public.accounting_rule_dimension_matches where rule_id=target_rule)then raise exception using errcode='23514',message='Create a new rule version to change dimensions';end if;
 for item in select value from jsonb_array_elements(dimensions)loop
  perform private.validate_keys(item,array['dimension_type','dimension_id']);kind:=item->>'dimension_type';rid:=(item->>'dimension_id')::uuid;if kind not in('cost_center','project','subproject','area','afe_future')then raise exception using errcode='22023',message='Unknown dimension type';end if;
  perform private.accounting_dimension(target_company,kind,rid,r.valid_from);insert into public.accounting_rule_dimension_matches(company_id,rule_id,dimension_type,dimension_id,created_by)values(target_company,target_rule,kind,rid,auth.uid());
 end loop;
 perform private.accounting_event(target_company,'rule',target_rule,'dimension_conditions',null,jsonb_build_object('count',jsonb_array_length(dimensions)));return jsonb_build_object('rule_id',target_rule,'persisted',true);
end $$;

create or replace function private.accounting_resolve_event(e public.accounting_events)returns uuid language plpgsql stable security definer set search_path='' as $$
declare chosen uuid;best integer;n integer;begin
 if not exists(select 1 from public.accounting_feature_flags where company_id=e.company_id and demo_enabled and not production_rules and not auto_generate and not auto_post)then return null;end if;
 select max(r.priority)into best from public.accounting_rules r join public.accounting_demo_rules d on d.rule_id=r.id and d.company_id=r.company_id
 where r.company_id=e.company_id and r.source_event=e.event_type and r.status='simulation_active'and r.valid_from<=e.event_date and(r.valid_to is null or r.valid_to>=e.event_date)
 and(not r.conditions?'currency_id'or(r.conditions->>'currency_id')::uuid=e.currency_id)
 and(not r.conditions?'third_party_type'or r.conditions->>'third_party_type'=e.third_party_type)
 and(not r.conditions?'minimum_amount'or e.amount>=(r.conditions->>'minimum_amount')::numeric)
 and(not r.conditions?'maximum_amount'or e.amount<=(r.conditions->>'maximum_amount')::numeric)
 and not exists(select 1 from public.accounting_rule_dimension_matches m where m.rule_id=r.id and e.dimensions->>m.dimension_type is distinct from m.dimension_id::text);
 if best is null then return null;end if;
 select count(*),(array_agg(r.id))[1]into n,chosen from public.accounting_rules r join public.accounting_demo_rules d on d.rule_id=r.id and d.company_id=r.company_id
 where r.company_id=e.company_id and r.priority=best and r.source_event=e.event_type and r.status='simulation_active'and r.valid_from<=e.event_date and(r.valid_to is null or r.valid_to>=e.event_date)
 and(not r.conditions?'currency_id'or(r.conditions->>'currency_id')::uuid=e.currency_id)
 and(not r.conditions?'third_party_type'or r.conditions->>'third_party_type'=e.third_party_type)
 and(not r.conditions?'minimum_amount'or e.amount>=(r.conditions->>'minimum_amount')::numeric)
 and(not r.conditions?'maximum_amount'or e.amount<=(r.conditions->>'maximum_amount')::numeric)
 and not exists(select 1 from public.accounting_rule_dimension_matches m where m.rule_id=r.id and e.dimensions->>m.dimension_type is distinct from m.dimension_id::text);
 if n<>1 then raise exception using errcode='23514',message='Ambiguous DEMO accounting mapping';end if;return chosen;end $$;

create function public.accounting_bank_adjustment_capture(target_transaction uuid,reason text)returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.bank_transactions;a public.bank_accounting_adjustments;eid uuid;begin
 perform private.treasury_lock();select * into t from public.bank_transactions where id=target_transaction;if not found then raise exception using errcode='42501',message='Bank transaction unavailable';end if;perform private.finance_require('bank_transaction.classify_accounting',t.company_id);perform private.finance_require('accounting_event.resolve',t.company_id);
 if t.source not in('manual','import')or t.evidence_state<>'confirmed'or t.status='reconciled'or coalesce(length(trim(reason)),0)not between 1 and 2000 then raise exception using errcode='23514',message='Only unreconciled confirmed manual/import bank transactions may be classified';end if;
 insert into public.bank_accounting_adjustments(company_id,bank_transaction_id,reason,created_by)values(t.company_id,t.id,reason,auth.uid())on conflict(bank_transaction_id)do nothing returning * into a;
 if a.id is null then select * into a from public.bank_accounting_adjustments where bank_transaction_id=t.id;if a.reason<>reason then raise exception using errcode='23514',message='Existing adjustment classification is immutable';end if;end if;
 eid:=private.capture_accounting_event(jsonb_build_object('company_id',t.company_id,'event_type','BANK_ADJUSTMENT','source_type','bank_adjustment','source_id',a.id,'source_revision','1','event_date',t.transaction_date,'currency_id',t.currency_id,'amount',t.amount,'dimensions',jsonb_build_object(),'source_snapshot',jsonb_build_object('bank_transaction_id',t.id,'transaction_type',t.transaction_type,'bank_reference',t.bank_reference,'description',t.description,'classification_reason',a.reason),'links',jsonb_build_array(jsonb_build_object('entity_type','bank_transaction','entity_id',t.id))));
 perform private.accounting_event(t.company_id,'bank_accounting_adjustment',a.id,'captured',reason,jsonb_build_object('accounting_event_id',eid));return jsonb_build_object('id',a.id,'accounting_event_id',eid,'persisted',true);
end $$;
revoke all on function private.guard_accounting_event_configuration(),private.accounting_resolve_event(public.accounting_events)from public,anon,authenticated,service_role;
revoke all on function public.accounting_rule_dimension_match_save(uuid,uuid,jsonb),public.accounting_bank_adjustment_capture(uuid,text)from public,anon,service_role;
grant execute on function public.accounting_rule_dimension_match_save(uuid,uuid,jsonb),public.accounting_bank_adjustment_capture(uuid,text)to authenticated;
commit;
