begin;
-- DEV only after full local validation. Supplier references remain typed FKs.
create table public.employee_advances (
 id uuid primary key default gen_random_uuid(),company_id uuid not null,employee_id uuid not null,
 travel_request_id uuid not null,currency_id uuid not null references public.currencies(id),
 approved_amount numeric(18,2) not null check(approved_amount>0 and approved_amount<1000000000000),
 paid_amount numeric(18,2) not null default 0 check(paid_amount>=0 and paid_amount<=approved_amount),
 outstanding_to_render numeric(18,2) not null default 0 check(outstanding_to_render>=0 and outstanding_to_render<=paid_amount),
 status text not null default 'approved' check(status in ('approved','scheduled','partially_paid','paid','partially_settled','settled','cancelled')),
 approved_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 unique(company_id,id),unique(company_id,id,employee_id,currency_id),unique(travel_request_id),
 foreign key(company_id,employee_id) references public.employees(company_id,id),
 foreign key(company_id,travel_request_id) references public.travel_expense_requests(company_id,id)
);
create table public.employee_bank_accounts (
 id uuid primary key default gen_random_uuid(),company_id uuid not null,employee_id uuid not null,
 currency_id uuid not null references public.currencies(id),bank_name text not null,
 account_number text not null check(account_number ~ '^[0-9A-Za-z-]{6,40}$'),
 cci text check(cci ~ '^[0-9]{20}$'),account_type text not null,
 status text not null default 'pending' check(status in ('pending','active','rejected','superseded')),
 requested_by uuid not null references public.profiles(id),approved_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),approved_at timestamptz,
 unique(company_id,id),foreign key(company_id,employee_id) references public.employees(company_id,id),
 check(approved_by is null or approved_by<>requested_by)
);
insert into public.permissions(module,resource,action,code,description,requires_company,is_sensitive)
select 'gastos_colaboradores','employee',a,'employee.'||a,'employee: '||a,true,a='bank_change_approve'
from unnest(array['bank_view','bank_change','bank_change_approve']) a on conflict(code) do nothing;

alter table public.payables alter column supplier_id drop not null,alter column request_id drop not null,alter column payment_term_id drop not null;
alter table public.payables add column employee_id uuid,
 add column employee_advance_id uuid generated always as(case when origin_type='employee_advance' then origin_id end) stored,
 add foreign key(company_id,employee_id) references public.employees(company_id,id);
do $$ declare r record;begin
 for r in select conname from pg_constraint where conrelid='public.payables'::regclass and contype='c' and pg_get_constraintdef(oid) like '%origin_type%' loop
  execute format('alter table public.payables drop constraint %I',r.conname);
 end loop;
end $$;
alter table public.payables add constraint payable_origin_beneficiary check(
 (origin_type in ('tax_document','approved_obligation') and supplier_id is not null and employee_id is null and request_id is not null and payment_term_id is not null and
  ((origin_type='tax_document' and tax_document_id is not null and tax_document_id=origin_id) or
   (origin_type='approved_obligation' and tax_document_id is null and origin_id=request_id))) or
 (origin_type='employee_advance' and employee_id is not null and supplier_id is null and request_id is null and order_id is null and tax_document_id is null and not requires_acceptance and acceptance_id is null)
),add foreign key(company_id,employee_advance_id,employee_id,currency_id) references public.employee_advances(company_id,id,employee_id,currency_id);

alter table public.payment_orders drop constraint payment_orders_beneficiary_type_check,
 drop constraint payment_orders_company_id_beneficiary_id_fkey,
 drop constraint payment_orders_company_id_beneficiary_account_id_fkey;
alter table public.payments drop constraint payments_beneficiary_type_check,
 drop constraint payments_company_id_beneficiary_id_fkey;
do $$ declare t text;begin
 foreach t in array array['payment_orders','payments'] loop
  execute format('alter table public.%I add constraint employee_beneficiary_type check(beneficiary_type in (''supplier'',''employee'')),
   add column supplier_beneficiary_id uuid generated always as(case when beneficiary_type=''supplier'' then beneficiary_id end) stored,
   add column employee_beneficiary_id uuid generated always as(case when beneficiary_type=''employee'' then beneficiary_id end) stored,
   add foreign key(company_id,supplier_beneficiary_id) references public.supplier_companies(company_id,supplier_id),
   add foreign key(company_id,employee_beneficiary_id) references public.employees(company_id,id)',t);
 end loop;
end $$;
alter table public.payment_orders
 add column supplier_account_id uuid generated always as(case when beneficiary_type='supplier' then beneficiary_account_id end) stored,
 add column employee_account_id uuid generated always as(case when beneficiary_type='employee' then beneficiary_account_id end) stored,
 add foreign key(company_id,supplier_account_id) references public.supplier_bank_accounts(company_id,id),
 add foreign key(company_id,employee_account_id) references public.employee_bank_accounts(company_id,id);

create function private.employee_bank_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.audit_logs(user_id,action,category,entity_type,entity_id,company_id,old_values,new_values)
 values(auth.uid(),lower(tg_op),'finance',tg_table_name,new.id::text,new.company_id,
 case when tg_op='UPDATE' then to_jsonb(old)-array['account_number','cci'] end,to_jsonb(new)-array['account_number','cci']);return new;
end $$;
alter table public.employee_advances enable row level security;
alter table public.employee_bank_accounts enable row level security;
revoke all on public.employee_advances,public.employee_bank_accounts from public,anon,authenticated,service_role;
grant select on public.employee_advances to authenticated;
create policy advances_read on public.employee_advances for select to authenticated using(
 private.has_permission('employee_advance.view',company_id) or private.travel_visible(travel_request_id));
-- No raw account REST grant. A masked RPC is added with account administration.
create trigger employee_advance_audit after insert or update on public.employee_advances for each row execute function private.audit_finance();
create trigger employee_bank_audit after insert or update on public.employee_bank_accounts for each row execute function private.employee_bank_audit();

create function private.create_travel_advance() returns trigger language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare aid uuid;begin
 if new.status='approved' and old.status is distinct from 'approved' and new.requested_advance_amount>0 then
  insert into public.employee_advances(company_id,employee_id,travel_request_id,currency_id,approved_amount,approved_by)
  values(new.company_id,new.employee_id,new.id,new.currency_id,new.requested_advance_amount,new.approved_by)
  on conflict(travel_request_id) do nothing returning id into aid;
  if aid is not null then
   insert into public.payables(company_id,employee_id,origin_type,origin_id,currency_id,original_amount,outstanding_amount,issue_date,due_date,payment_term_snapshot,due_date_basis_date,requires_acceptance,status,cost_center_id,project_id,subproject_id,dimension_snapshot,created_by)
   values(new.company_id,new.employee_id,'employee_advance',aid,new.currency_id,new.requested_advance_amount,new.requested_advance_amount,current_date,new.start_date,
   jsonb_build_object('basis','approved_travel_start','travel_request_id',new.id),new.start_date,false,'approved',new.cost_center_id,new.project_id,new.subproject_id,new.dimension_snapshot,auth.uid());
  end if;
 end if;
 return new;
end $$;
create trigger create_travel_advance after update of status on public.travel_expense_requests for each row execute function private.create_travel_advance();
revoke all on function private.employee_bank_audit(),private.create_travel_advance() from public,anon,authenticated,service_role;
commit;
