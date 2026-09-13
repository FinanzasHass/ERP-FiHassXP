begin;
insert into public.permissions(module,resource,action,code,description,requires_company,scope,is_sensitive)
select 'cobranzas',r,a,r||'.'||a,r||': '||a,true,'company',a in ('adjust','cancel','reverse','modify','create')
from (values ('customer','view create edit disable'),('receivable','view create adjust cancel'),
 ('collection','view create identify apply reverse'),('receivable_schedule','view create modify'),
 ('membership','view manage'),('lot_receivable','view manage'),('receivable_report','view'),('collection_report','view'))v(r,actions)
cross join lateral unnest(string_to_array(actions,' ')) a
on conflict(code) do update set active=true,is_sensitive=public.permissions.is_sensitive or excluded.is_sensitive;

create table public.customers(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 customer_type text not null check(customer_type in ('natural','legal')),
 document_type text not null check(length(trim(document_type)) between 1 and 30),document_number text not null check(length(trim(document_number)) between 1 and 40),
 legal_name text not null check(length(trim(legal_name)) between 1 and 200),trade_name text,email text,phone text,address text,
 status text not null default 'active' check(status in ('active','inactive')),created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(company_id,id)
);
create unique index customer_document_company on public.customers(company_id,upper(trim(document_type)),upper(trim(document_number)));
create table public.receivable_source_types(code text primary key,name text not null,active boolean not null default true);
insert into public.receivable_source_types values('membership','Membresía',true),('lot_sale','Contrato/lote financiero',true),('manual_authorized','Manual autorizada',true),('other','Otro origen',true);
create table public.receivable_sources(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),customer_id uuid not null,
 source_type text not null references public.receivable_source_types(code),reference text not null check(length(trim(reference)) between 1 and 200),description text not null check(length(trim(description)) between 1 and 2000),
 currency_id uuid not null references public.currencies(id),status text not null default 'active' check(status in ('active','closed','cancelled')),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(company_id,id),unique(company_id,source_type,reference),unique(company_id,id,customer_id,currency_id,source_type),
 foreign key(company_id,customer_id) references public.customers(company_id,id)
);
create table public.membership_accounts(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,source_id uuid not null unique,
 plan_name text not null,start_date date not null,end_date date,periodic_amount numeric(18,2) not null check(periodic_amount>0 and periodic_amount<1000000000000),
 period_months integer not null check(period_months between 1 and 120),created_at timestamptz not null default now(),
 unique(company_id,id),foreign key(company_id,source_id) references public.receivable_sources(company_id,id),check(end_date is null or end_date>=start_date)
);
create table public.lot_finance_contracts(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,source_id uuid not null unique,lot_identifier text not null,
 agreed_price numeric(18,2) not null check(agreed_price>0 and agreed_price<1000000000000),down_payment numeric(18,2) not null check(down_payment>=0 and down_payment<=agreed_price),
 financed_amount numeric(18,2) generated always as(agreed_price-down_payment) stored,created_at timestamptz not null default now(),
 unique(company_id,id),foreign key(company_id,source_id) references public.receivable_sources(company_id,id)
);
create table public.receivable_schedules(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,source_id uuid not null,period_reference text not null,
 version integer not null default 1,status text not null default 'active' check(status in ('active','superseded','cancelled')),
 total_amount numeric(18,2) not null check(total_amount>0 and total_amount<1000000000000),currency_id uuid not null references public.currencies(id),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 unique(company_id,id),unique(source_id,period_reference,version),foreign key(company_id,source_id) references public.receivable_sources(company_id,id)
);
create unique index one_current_receivable_schedule on public.receivable_schedules(source_id,period_reference) where status='active';
create table public.receivable_installments(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,schedule_id uuid not null,number integer not null check(number>0),
 due_date date not null,original_amount numeric(18,2) not null check(original_amount>0 and original_amount<1000000000000),
 currency_id uuid not null references public.currencies(id),created_at timestamptz not null default now(),
 unique(company_id,id),unique(schedule_id,number),foreign key(company_id,schedule_id) references public.receivable_schedules(company_id,id)
);
-- These are references to issued documents, not purchase tax_documents or electronic invoices.
create table public.issued_document_references(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,customer_id uuid not null,document_type text not null,
 series text not null,number text not null,issue_date date not null,description text,created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 unique(company_id,id),unique(company_id,document_type,series,number),foreign key(company_id,customer_id) references public.customers(company_id,id)
);
create table public.receivables(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,customer_id uuid not null,receivable_number text not null,
 source_type text not null references public.receivable_source_types(code),source_id uuid,installment_id uuid unique,document_id uuid,
 currency_id uuid not null references public.currencies(id),issue_date date not null,due_date date not null,
 original_amount numeric(18,2) not null check(original_amount>0 and original_amount<1000000000000),description text not null,
 status text not null default 'active' check(status in ('active','cancelled')),created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(company_id,id),unique(company_id,receivable_number),
 foreign key(company_id,customer_id) references public.customers(company_id,id),
 foreign key(company_id,source_id,customer_id,currency_id,source_type) references public.receivable_sources(company_id,id,customer_id,currency_id,source_type),
 foreign key(company_id,installment_id) references public.receivable_installments(company_id,id),
 foreign key(company_id,document_id) references public.issued_document_references(company_id,id),
 check(source_id is not null or source_type in ('manual_authorized','other'))
);
create table public.collections(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,customer_id uuid,currency_id uuid not null references public.currencies(id),
 collection_number text not null,collection_date date not null,amount numeric(18,2) not null check(amount>0 and amount<1000000000000),
 payment_method_id uuid,bank_transaction_id uuid,reference text not null,status text not null default 'active' check(status in ('active','reversed')),
 identified_by uuid references public.profiles(id),identified_at timestamptz,created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 reversed_by uuid references public.profiles(id),reversed_at timestamptz,reason text,
 unique(company_id,id),unique(company_id,collection_number),foreign key(company_id,customer_id) references public.customers(company_id,id),
 foreign key(company_id,bank_transaction_id) references public.bank_transactions(company_id,id),foreign key(company_id,payment_method_id) references public.payment_methods(company_id,id),
 check(bank_transaction_id is not null or payment_method_id is not null),check((customer_id is null)=(identified_by is null))
);
create unique index one_active_collection_per_credit on public.collections(bank_transaction_id) where status='active' and bank_transaction_id is not null;
create table public.collection_allocations(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,collection_id uuid not null,receivable_id uuid not null,
 amount numeric(18,2) not null check(amount>0 and amount<1000000000000),status text not null default 'valid' check(status in ('valid','reversed')),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),reversed_by uuid references public.profiles(id),reversed_at timestamptz,reason text,
 unique(company_id,id),foreign key(company_id,collection_id) references public.collections(company_id,id),foreign key(company_id,receivable_id) references public.receivables(company_id,id)
);
create table public.receivable_operation_keys(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),operation_key uuid not null,
 operation text not null,payload jsonb not null,result jsonb not null,created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),unique(company_id,operation_key)
);
create table public.receivable_history(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),entity_type text not null,entity_id uuid not null,
 action text not null,actor_id uuid not null references public.profiles(id),reason text,old_values jsonb,new_values jsonb,created_at timestamptz not null default now()
);
create index collection_allocation_receivable on public.collection_allocations(receivable_id,status);
create index collection_allocation_collection on public.collection_allocations(collection_id,status);
create index receivable_company_due on public.receivables(company_id,due_date);

create function private.receivable_read(c uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.has_permission('receivable.view',c) or private.has_permission('receivable_report.view',c);
$$;
create function private.collection_read(c uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.has_permission('collection.view',c) or private.has_permission('collection_report.view',c);
$$;
do $$ declare t text;p text;begin
 for t,p in select * from(values
 ('customers','private.has_permission(''customer.view'',company_id)'),
 ('receivable_sources','private.receivable_read(company_id) or private.has_permission(''membership.view'',company_id) or private.has_permission(''lot_receivable.view'',company_id)'),
 ('membership_accounts','private.has_permission(''membership.view'',company_id)'),('lot_finance_contracts','private.has_permission(''lot_receivable.view'',company_id)'),
 ('receivable_schedules','private.has_permission(''receivable_schedule.view'',company_id) or private.receivable_read(company_id)'),
 ('receivable_installments','private.has_permission(''receivable_schedule.view'',company_id) or private.receivable_read(company_id)'),
 ('issued_document_references','private.receivable_read(company_id)'),('receivables','private.receivable_read(company_id)'),
 ('collections','private.collection_read(company_id)'),('collection_allocations','private.collection_read(company_id) or private.receivable_read(company_id)'),
 ('receivable_operation_keys','false'),('receivable_history','private.receivable_read(company_id) or private.collection_read(company_id)'))v(t,p)loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy receivable_read on public.%I for select to authenticated using(%s)',t,p);
  execute format('create trigger receivable_audit after insert or update on public.%I for each row execute function private.audit_finance()',t);
 end loop;
end $$;
revoke all on public.receivable_source_types from public,anon,authenticated,service_role;
alter table public.receivable_source_types enable row level security;
grant select on public.receivable_source_types to authenticated;
create policy source_types_read on public.receivable_source_types for select to authenticated using(private.is_active());
revoke all on function private.receivable_read(uuid),private.collection_read(uuid) from public,anon,authenticated,service_role;
grant execute on function private.receivable_read(uuid),private.collection_read(uuid) to authenticated;
commit;
