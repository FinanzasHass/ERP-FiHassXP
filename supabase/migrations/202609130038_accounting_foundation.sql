begin;
insert into public.permissions(module,resource,action,code,description,requires_company,scope,is_sensitive)
select 'accounting',r,a,r||'.'||a,r||': '||a,true,'company',r||'.'||a in('accounting_period.close','accounting_period.reopen','journal.post','journal.reverse','accounting_rule.activate')
from(values('accounting_account','view create edit disable import'),('accounting_period','view manage close reopen'),('journal','view create edit_draft validate post reverse'),('accounting_rule','view create edit activate'),('general_ledger','view'),('trial_balance','view'))v(r,actions)
cross join lateral unnest(string_to_array(actions,' '))a on conflict(code)do update set active=true,is_sensitive=excluded.is_sensitive or public.permissions.is_sensitive;

create table public.accounting_settings(
 id uuid primary key default gen_random_uuid(),company_id uuid not null unique references public.companies(id),
 functional_currency_id uuid not null references public.currencies(id),number_prefix text not null check(number_prefix~'^[A-Z][A-Z0-9]{1,11}$'),
 number_digits integer not null check(number_digits between 4 and 12),created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(company_id,id)
);
create table public.accounting_accounts(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),code text not null check(length(trim(code))between 1 and 40),name text not null check(length(trim(name))between 1 and 200),parent_id uuid,level integer not null default 1 check(level>0),
 account_type text not null check(account_type in('asset','liability','equity','income','expense','memorandum')),normal_balance text not null check(normal_balance in('debit','credit')),
 allows_posting boolean not null default false,requires_cost_center boolean not null default false,requires_project boolean not null default false,requires_third_party boolean not null default false,active boolean not null default true,
 valid_from date not null,valid_to date,pcge_reference_code text,first_used_at timestamptz,created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(company_id,id),unique(company_id,code),foreign key(company_id,parent_id)references public.accounting_accounts(company_id,id),check(parent_id is distinct from id),check(valid_to is null or valid_to>=valid_from)
);
create table public.accounting_periods(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),year integer not null check(year between 1900 and 9999),month integer not null check(month between 1 and 12),start_date date not null,end_date date not null,
 status text not null default 'open' check(status in('open','soft_closed','closed','reopened')),created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(company_id,id),unique(company_id,year,month),check(start_date<=end_date),check(extract(year from start_date)=year and extract(year from end_date)=year and extract(month from start_date)=month and extract(month from end_date)=month)
);
create table public.accounting_entry_types(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),code text not null check(code~'^[a-z][a-z0-9_]{0,49}$'),name text not null check(length(trim(name))between 1 and 150),active boolean not null default true,created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),unique(company_id,id),unique(company_id,code)
);
create table public.accounting_sequences(company_id uuid not null references public.companies(id),year integer not null,last_number bigint not null default 0,primary key(company_id,year));
create table public.journal_entries(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),entry_number text not null,entry_date date not null,accounting_period_id uuid not null,entry_type_id uuid not null,
 source_type text not null default 'manual' check(source_type in('payable','payment','collection','receivable','expense_report','employee_return','employee_reimbursement','bank_adjustment','manual','opening')),source_id uuid,
 description text not null check(length(trim(description))between 1 and 2000),functional_currency_id uuid not null references public.currencies(id),currency_id uuid not null references public.currencies(id),exchange_rate_id uuid references public.exchange_rates(id),exchange_rate numeric(24,12),
 status text not null default 'draft' check(status in('draft','validated','posted','reversed')),created_by uuid not null references public.profiles(id),validated_by uuid references public.profiles(id),validated_at timestamptz,posted_by uuid references public.profiles(id),posted_at timestamptz,
 original_entry_id uuid,reversed_entry_id uuid,reversal_reason text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(company_id,id),unique(company_id,entry_number),unique(original_entry_id),foreign key(company_id,accounting_period_id)references public.accounting_periods(company_id,id),foreign key(company_id,entry_type_id)references public.accounting_entry_types(company_id,id),
 foreign key(company_id,original_entry_id)references public.journal_entries(company_id,id),foreign key(company_id,reversed_entry_id)references public.journal_entries(company_id,id),check((posted_at is null)=(posted_by is null)),check(exchange_rate is null or exchange_rate>0),check(source_id is null or source_type not in('manual','opening'))
);
create table public.journal_entry_lines(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,journal_entry_id uuid not null,line_number integer not null check(line_number>0),account_id uuid not null,description text not null check(length(trim(description))between 1 and 2000),
 debit numeric(18,2)not null default 0 check(debit>=0 and debit<1000000000000),credit numeric(18,2)not null default 0 check(credit>=0 and credit<1000000000000),currency_id uuid not null references public.currencies(id),foreign_amount numeric(18,2),exchange_rate numeric(24,12),
 third_party_type text check(third_party_type in('supplier','customer','employee')),third_party_id uuid,account_snapshot jsonb,third_party_snapshot jsonb,created_at timestamptz not null default now(),
 unique(company_id,id),unique(journal_entry_id,line_number),foreign key(company_id,journal_entry_id)references public.journal_entries(company_id,id),foreign key(company_id,account_id)references public.accounting_accounts(company_id,id),
 check((debit>0 and credit=0)or(credit>0 and debit=0)),check((third_party_type is null)=(third_party_id is null)),check(foreign_amount is null or foreign_amount>0)
);
create table public.journal_line_dimensions(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,journal_line_id uuid not null,dimension_type text not null check(dimension_type in('cost_center','project','subproject','area','afe_future')),dimension_id uuid not null,snapshot_code text not null,snapshot_name text not null,snapshot jsonb not null,
 unique(company_id,id),unique(journal_line_id,dimension_type),foreign key(company_id,journal_line_id)references public.journal_entry_lines(company_id,id)
);
-- Immutable posting evidence. Reversed originals remain part of the ledger alongside their inverse.
create table public.journal_postings(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,journal_entry_id uuid not null unique,posted_by uuid not null references public.profiles(id),posted_at timestamptz not null default now(),
 unique(company_id,id),foreign key(company_id,journal_entry_id)references public.journal_entries(company_id,id)
);
create table public.accounting_rules(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),code text not null check(length(trim(code))between 1 and 80),name text not null check(length(trim(name))between 1 and 200),version integer not null check(version>0),previous_version_id uuid,
 source_event text not null check(length(trim(source_event))between 1 and 100),conditions jsonb not null default '{}',priority integer not null default 0,valid_from date not null,valid_to date,
 status text not null default 'draft' check(status in('draft','simulation_active','disabled')),production_enabled boolean not null default false check(not production_enabled),created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),activated_by uuid references public.profiles(id),activated_at timestamptz,
 unique(company_id,id),unique(company_id,code,version),foreign key(company_id,previous_version_id)references public.accounting_rules(company_id,id),check(valid_to is null or valid_to>=valid_from)
);
create unique index accounting_rule_active_version on public.accounting_rules(company_id,code)where status='simulation_active';
create table public.accounting_rule_lines(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,rule_id uuid not null,line_number integer not null check(line_number>0),account_id uuid not null,side text not null check(side in('debit','credit')),description text not null,
 amount_key text not null check(amount_key in('amount','net_amount','tax_amount')),multiplier numeric(24,12)not null default 1 check(multiplier>0),use_third_party boolean not null default false,dimension_types text[]not null default '{}',
 unique(company_id,id),unique(rule_id,line_number),foreign key(company_id,rule_id)references public.accounting_rules(company_id,id),foreign key(company_id,account_id)references public.accounting_accounts(company_id,id),check(dimension_types<@array['cost_center','project','subproject','area'])
);
create table public.accounting_operation_keys(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),operation_key uuid not null,operation text not null,payload jsonb not null,result jsonb not null,created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),unique(company_id,operation_key));
create table public.accounting_history(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),entity_type text not null,entity_id uuid not null,action text not null,actor_id uuid not null references public.profiles(id),reason text,details jsonb not null default '{}',created_at timestamptz not null default now());
create index accounting_lines_account on public.journal_entry_lines(company_id,account_id,journal_entry_id);
create index accounting_entry_date on public.journal_entries(company_id,entry_date);
create index accounting_dimensions_lookup on public.journal_line_dimensions(company_id,dimension_type,dimension_id,journal_line_id);

create function private.accounting_read(c uuid)returns boolean language sql stable security definer set search_path='' as $$select private.has_permission('journal.view',c)or private.has_permission('general_ledger.view',c)or private.has_permission('trial_balance.view',c);$$;
do $$declare t text;p text;begin
 for t,p in select * from(values
 ('accounting_settings','private.has_company_access(company_id) and (private.accounting_read(company_id) or private.has_permission(''accounting_period.view'',company_id) or private.has_permission(''accounting_account.view'',company_id) or private.has_permission(''accounting_rule.view'',company_id))'),
 ('accounting_accounts','private.accounting_read(company_id) or private.has_permission(''accounting_account.view'',company_id)'),('accounting_periods','private.accounting_read(company_id) or private.has_permission(''accounting_period.view'',company_id)'),
 ('accounting_entry_types','private.accounting_read(company_id) or private.has_permission(''accounting_period.view'',company_id)'),('journal_entries','private.accounting_read(company_id)'),('journal_entry_lines','private.accounting_read(company_id)'),('journal_line_dimensions','private.accounting_read(company_id)'),('journal_postings','private.accounting_read(company_id)'),
 ('accounting_rules','private.has_permission(''accounting_rule.view'',company_id)'),('accounting_rule_lines','private.has_permission(''accounting_rule.view'',company_id)'),('accounting_operation_keys','false'),('accounting_history','private.accounting_read(company_id) or private.has_permission(''accounting_account.view'',company_id) or private.has_permission(''accounting_rule.view'',company_id) or private.has_permission(''accounting_period.view'',company_id)'))v(t,p)loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);execute format('grant select on public.%I to authenticated',t);execute format('create policy accounting_read on public.%I for select to authenticated using(%s)',t,p);
 end loop;
end $$;
alter table public.accounting_sequences enable row level security;revoke all on public.accounting_sequences from public,anon,authenticated,service_role;
revoke all on function private.accounting_read(uuid)from public,anon,authenticated,service_role;grant execute on function private.accounting_read(uuid)to authenticated;
commit;
