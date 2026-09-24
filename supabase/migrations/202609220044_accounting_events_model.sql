begin;
-- Additive to 001–043: no grants, no productive rule activation, no changes to financial balances.
insert into public.permissions(module,resource,action,code,description,requires_company,scope,is_sensitive)
select 'accounting',r,a,r||'.'||a,r||': '||a,true,'company',a in('generate','ignore','manage')
from(values('accounting_event','view resolve preview generate ignore'),('accounting_configuration','view manage'),('afe','view manage import'),('legacy_mapping','view manage import'),('demo_dashboard','view'))v(r,actions)
cross join lateral unnest(string_to_array(actions,' '))a on conflict(code)do nothing;

create table public.accounting_feature_flags(
 company_id uuid primary key references public.companies(id),demo_enabled boolean not null default false,
 auto_generate boolean not null default false check(not auto_generate),auto_post boolean not null default false check(not auto_post),
 production_rules boolean not null default false check(not production_rules),
 updated_by uuid not null references public.profiles(id),updated_at timestamptz not null default now()
);
create table public.afes(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 code text not null check(length(trim(code))between 1 and 60),name text not null check(length(trim(name))between 1 and 200),
 active boolean not null default true,valid_from date not null,valid_to date,first_used_at timestamptz,
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 unique(company_id,id),unique(company_id,code),check(valid_to is null or valid_to>=valid_from)
);
create table public.legacy_mappings(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 dictionary text not null check(dictionary in('SUBDIARIO','MONEDA','MODULO','TIPODOCUM','ELEMENTO','REPARABLE')),
 legacy_code text not null check(length(trim(legacy_code))between 1 and 100),description text,
 erp_mapping jsonb not null default '{}' check(jsonb_typeof(erp_mapping)='object'),
 valid_from date not null,valid_to date,notes text,version integer not null check(version>0),previous_version_id uuid,
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 unique(company_id,id),unique(company_id,dictionary,legacy_code,version),
 foreign key(company_id,previous_version_id)references public.legacy_mappings(company_id,id),check(valid_to is null or valid_to>=valid_from)
);
create table public.accounting_events(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 event_type text not null check(event_type in('PAYABLE_RECOGNIZED','SUPPLIER_PAYMENT_EXECUTED','SUPPLIER_PAYMENT_REVERSED','RECEIVABLE_RECOGNIZED','CUSTOMER_COLLECTION_APPLIED','CUSTOMER_COLLECTION_REVERSED','EMPLOYEE_ADVANCE_PAID','EMPLOYEE_ADVANCE_PAYMENT_REVERSED','EXPENSE_REPORT_SETTLED','EXPENSE_SETTLEMENT_SUPERSEDED','EMPLOYEE_RETURN_RECEIVED','EMPLOYEE_RETURN_REVERSED','EMPLOYEE_REIMBURSEMENT_PAID','EMPLOYEE_REIMBURSEMENT_PAYMENT_REVERSED','BANK_ADJUSTMENT')),
 source_type text not null check(source_type in('payable','payment','payment_allocation','receivable','collection_allocation','expense_settlement','employee_return','bank_adjustment')),
 source_id uuid not null,source_revision text not null,event_date date not null,currency_id uuid not null references public.currencies(id),
 amount numeric(20,2)not null check(amount>=0 and amount<'Infinity'::numeric),
 third_party_type text check(third_party_type in('supplier','customer','employee')),third_party_id uuid,
 dimensions jsonb not null default '{}'check(jsonb_typeof(dimensions)='object'),source_snapshot jsonb not null check(jsonb_typeof(source_snapshot)='object'),
 operation_actor_id uuid references public.profiles(id),
 workflow_status text not null default 'pending_mapping'check(workflow_status in('pending_mapping','ready','previewed','draft_generated','ignored_authorized','error')),
 rule_id uuid,preview_result jsonb,previewed_by uuid references public.profiles(id),previewed_at timestamptz,
 generated_by uuid references public.profiles(id),generated_at timestamptz,journal_entry_id uuid unique,
 ignored_by uuid references public.profiles(id),ignore_reason text,error_code text,
 created_at timestamptz not null default now(),
 unique(company_id,id),unique(company_id,event_type,source_type,source_id,source_revision),
 foreign key(company_id,rule_id)references public.accounting_rules(company_id,id),
 foreign key(company_id,journal_entry_id)references public.journal_entries(company_id,id),
 check((third_party_type is null)=(third_party_id is null))
);
-- Multiple sources may be related to one immutable event (e.g. allocation, payment, advance).
create table public.accounting_event_sources(
 company_id uuid not null,event_id uuid not null,entity_type text not null,entity_id uuid not null,
 primary key(event_id,entity_type,entity_id),foreign key(company_id,event_id)references public.accounting_events(company_id,id)
);
alter table public.journal_entries add column accounting_event_id uuid unique,
 add foreign key(company_id,accounting_event_id)references public.accounting_events(company_id,id);
-- Separate immutable designation: existing 8A rules never become DEMO implicitly.
create table public.accounting_demo_rules(
 company_id uuid not null,rule_id uuid primary key,designated_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 foreign key(company_id,rule_id)references public.accounting_rules(company_id,id)
);
create index accounting_events_queue on public.accounting_events(company_id,workflow_status,event_date);
create index accounting_event_source_lookup on public.accounting_event_sources(company_id,entity_type,entity_id);

do $$declare t text;p text;begin
 for t,p in select * from(values
 ('accounting_feature_flags','private.has_permission(''accounting_configuration.view'',company_id) or private.has_permission(''accounting_event.view'',company_id)'),
 ('afes','private.has_permission(''afe.view'',company_id) or private.accounting_read(company_id)'),
 ('legacy_mappings','private.has_permission(''legacy_mapping.view'',company_id)'),
 ('accounting_events','private.has_permission(''accounting_event.view'',company_id)'),
 ('accounting_event_sources','private.has_permission(''accounting_event.view'',company_id)'),
 ('accounting_demo_rules','private.has_permission(''accounting_rule.view'',company_id) or private.has_permission(''accounting_event.view'',company_id)'))v(t,p)loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);execute format('grant select on public.%I to authenticated',t);execute format('create policy accounting_read on public.%I for select to authenticated using(%s)',t,p);
 end loop;
end $$;
create view public.accounting_event_queue with(security_invoker=true)as
select e.*,case when exists(select 1 from public.journal_postings p where p.company_id=e.company_id and p.journal_entry_id=e.journal_entry_id)then 'posted'else e.workflow_status end status,
 exists(select 1 from public.accounting_demo_rules r where r.rule_id=e.rule_id)demo_configuration
from public.accounting_events e;
revoke all on public.accounting_event_queue from public,anon,authenticated,service_role;grant select on public.accounting_event_queue to authenticated;

create function private.guard_accounting_event()returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_op='DELETE'then raise exception using errcode='23514',message='Accounting event evidence cannot be deleted';end if;
 if tg_op='UPDATE'then
  if tg_table_name in('accounting_event_sources','accounting_demo_rules','legacy_mappings')then raise exception using errcode='23514',message='Accounting evidence is immutable; create a version';end if;
  if(to_jsonb(new)->>'company_id')is distinct from(to_jsonb(old)->>'company_id')then raise exception using errcode='23514',message='Company immutable';end if;
  if tg_table_name='accounting_events'then
   if(to_jsonb(new)-array['workflow_status','rule_id','preview_result','previewed_by','previewed_at','generated_by','generated_at','journal_entry_id','ignored_by','ignore_reason','error_code'])is distinct from(to_jsonb(old)-array['workflow_status','rule_id','preview_result','previewed_by','previewed_at','generated_by','generated_at','journal_entry_id','ignored_by','ignore_reason','error_code'])then raise exception using errcode='23514',message='Event source evidence immutable';end if;
   if old.journal_entry_id is not null and to_jsonb(new)is distinct from to_jsonb(old)then raise exception using errcode='23514',message='Generated event immutable';end if;
  elsif tg_table_name='afes'then
   if old.first_used_at is not null and(new.code<>old.code or new.first_used_at is distinct from old.first_used_at)then raise exception using errcode='23514',message='Used AFE identity immutable';end if;
  end if;
 end if;return new;
end $$;
do $$declare t text;begin foreach t in array array['accounting_feature_flags','afes','legacy_mappings','accounting_events','accounting_event_sources','accounting_demo_rules']loop execute format('create trigger accounting_event_guard before update or delete on public.%I for each row execute function private.guard_accounting_event()',t);end loop;end $$;
revoke all on function private.guard_accounting_event()from public,anon,authenticated,service_role;
commit;
