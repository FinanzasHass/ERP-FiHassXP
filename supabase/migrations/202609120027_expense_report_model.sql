begin;
alter table public.employee_expense_policies add column allow_reopen boolean not null default false,
 add column allow_cancel_unpaid_travel boolean not null default false,
 add column allow_payment_evidence boolean not null default false,add column allow_other_support boolean not null default false;
insert into public.permissions(module,resource,action,code,description,requires_company,is_sensitive)
values('gastos_colaboradores','expense_report','create_for_employee','expense_report.create_for_employee','Registrar rendición en nombre de colaborador',true,true)
on conflict(code) do nothing;
create table public.expense_reports (
 id uuid primary key default gen_random_uuid(),company_id uuid not null,employee_id uuid not null,
 report_number text not null,travel_expense_request_id uuid,employee_advance_id uuid,
 currency_id uuid not null references public.currencies(id),policy_id uuid not null,
 status text not null default 'draft' check(status in ('draft','submitted','under_review','observed','approved','settlement_pending','settled','cancelled')),
 version integer not null default 1,
 total_reported numeric(18,2) not null default 0,total_accepted numeric(18,2) not null default 0,total_rejected numeric(18,2) not null default 0,
 submitted_at timestamptz,submitted_by uuid references public.profiles(id),approved_by uuid references public.profiles(id),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(company_id,id),unique(company_id,report_number),
 foreign key(company_id,employee_id) references public.employees(company_id,id),
 foreign key(company_id,travel_expense_request_id) references public.travel_expense_requests(company_id,id),
 foreign key(company_id,employee_advance_id,employee_id,currency_id) references public.employee_advances(company_id,id,employee_id,currency_id),
 foreign key(company_id,policy_id) references public.employee_expense_policies(company_id,id),
 check(total_reported>=0 and total_reported<1000000000000 and total_accepted>=0 and total_rejected>=0 and total_accepted+total_rejected<=total_reported)
);
-- One consolidated report consumes an advance; cancelled drafts preserve history.
create unique index one_report_per_advance on public.expense_reports(employee_advance_id) where status<>'cancelled';
create unique index one_report_per_travel on public.expense_reports(travel_expense_request_id) where status<>'cancelled';
create table public.expense_report_items (
 id uuid primary key default gen_random_uuid(),company_id uuid not null,report_id uuid not null,
 expense_date date not null,category_id uuid not null,description text not null check(length(trim(description)) between 1 and 2000),
 currency_id uuid not null references public.currencies(id),reported_amount numeric(18,2) not null check(reported_amount>0 and reported_amount<1000000000000),
 accepted_amount numeric(18,2) not null default 0,rejected_amount numeric(18,2) not null default 0,
 status text not null default 'pending' check(status in ('pending','accepted','observed','rejected')),
 support_type text not null check(support_type in ('tax_document','declaration','payment_evidence','other_authorized')),
 tax_document_id uuid unique,cost_center_id uuid not null,project_id uuid,subproject_id uuid,dimension_snapshot jsonb not null,
 reviewed_by uuid references public.profiles(id),reviewed_at timestamptz,decision_reason text,
 created_at timestamptz not null default now(),unique(company_id,id),
 foreign key(company_id,report_id) references public.expense_reports(company_id,id),
 foreign key(company_id,category_id) references public.expense_categories(company_id,id),
 foreign key(company_id,tax_document_id) references public.tax_documents(company_id,id),
 foreign key(company_id,cost_center_id) references public.cost_centers(company_id,id),
 foreign key(company_id,project_id) references public.projects(company_id,id),foreign key(company_id,subproject_id) references public.subprojects(company_id,id),
 check((status in ('pending','observed') and accepted_amount=0 and rejected_amount=0) or
 (status='accepted' and accepted_amount>0 and rejected_amount>=0 and accepted_amount+rejected_amount=reported_amount) or
 (status='rejected' and accepted_amount=0 and rejected_amount=reported_amount))
);
create table public.expense_declarations (
 id uuid primary key default gen_random_uuid(),company_id uuid not null,item_id uuid not null unique,
 declared_on date not null,reason text not null check(length(trim(reason)) between 1 and 4000),
 amount numeric(18,2) not null check(amount>0 and amount<1000000000000),
 original_values jsonb not null,status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created_by uuid not null references public.profiles(id),approved_by uuid references public.profiles(id),
 approved_at timestamptz,decision_reason text,created_at timestamptz not null default now(),
 unique(company_id,id),foreign key(company_id,item_id) references public.expense_report_items(company_id,id),
 check(approved_by is null or approved_by<>created_by)
);
create table public.expense_report_history (
 id uuid primary key default gen_random_uuid(),company_id uuid not null,report_id uuid not null,
 actor_id uuid not null references public.profiles(id),action text not null,version integer not null,
 previous_state text,new_state text not null,reason text,old_values jsonb,new_values jsonb,
 created_at timestamptz not null default now(),foreign key(company_id,report_id) references public.expense_reports(company_id,id)
);
create table public.expense_settlements (
 id uuid primary key default gen_random_uuid(),company_id uuid not null,report_id uuid not null,
 version integer not null,advance_paid numeric(18,2) not null,accepted_expenses numeric(18,2) not null,
 employee_return_due numeric(18,2) not null,employee_reimbursement_due numeric(18,2) not null,
 status text not null default 'valid' check(status in ('valid','superseded')),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 unique(company_id,id),unique(report_id,version),foreign key(company_id,report_id) references public.expense_reports(company_id,id),
 check(advance_paid>=0 and accepted_expenses>=0 and employee_return_due=greatest(advance_paid-accepted_expenses,0) and employee_reimbursement_due=greatest(accepted_expenses-advance_paid,0))
);
create unique index one_valid_expense_settlement on public.expense_settlements(report_id) where status='valid';
create table public.employee_reimbursements (
 id uuid primary key default gen_random_uuid(),company_id uuid not null,employee_id uuid not null,
 report_id uuid not null unique,settlement_id uuid not null unique,currency_id uuid not null references public.currencies(id),
 approved_amount numeric(18,2) not null check(approved_amount>0),paid_amount numeric(18,2) not null default 0,
 status text not null default 'approved' check(status in ('approved','partially_paid','paid','cancelled')),
 approved_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 unique(company_id,id),unique(company_id,id,employee_id,currency_id),check(paid_amount>=0 and paid_amount<=approved_amount),
 foreign key(company_id,employee_id) references public.employees(company_id,id),foreign key(company_id,report_id) references public.expense_reports(company_id,id),
 foreign key(company_id,settlement_id) references public.expense_settlements(company_id,id)
);
create table public.employee_returns (
 id uuid primary key default gen_random_uuid(),company_id uuid not null,employee_id uuid not null,settlement_id uuid not null,
 currency_id uuid not null references public.currencies(id),amount numeric(18,2) not null check(amount>0 and amount<1000000000000),
 return_date date not null,payment_method_id uuid not null,reference text not null,
 idempotency_key uuid not null,status text not null default 'registered' check(status in ('registered','matched','reconciled','cancelled','reversed')),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 unique(company_id,id),unique(company_id,idempotency_key),
 foreign key(company_id,employee_id) references public.employees(company_id,id),foreign key(company_id,settlement_id) references public.expense_settlements(company_id,id),
 foreign key(company_id,payment_method_id) references public.payment_methods(company_id,id)
);
alter table public.payables add column employee_reimbursement_id uuid generated always as(case when origin_type='employee_reimbursement' then origin_id end) stored,
 add foreign key(company_id,employee_reimbursement_id,employee_id,currency_id) references public.employee_reimbursements(company_id,id,employee_id,currency_id);
alter table public.payables drop constraint payable_origin_beneficiary;
alter table public.payables add constraint payable_origin_beneficiary check(
 (origin_type in ('tax_document','approved_obligation') and supplier_id is not null and employee_id is null and request_id is not null and payment_term_id is not null and
 ((origin_type='tax_document' and tax_document_id is not null and tax_document_id=origin_id) or (origin_type='approved_obligation' and tax_document_id is null and origin_id=request_id))) or
 (origin_type in ('employee_advance','employee_reimbursement') and employee_id is not null and supplier_id is null and request_id is null and order_id is null and tax_document_id is null and not requires_acceptance and acceptance_id is null));
alter table public.tax_documents alter column request_id drop not null,
 add column expense_report_item_id uuid,
 add foreign key(company_id,expense_report_item_id) references public.expense_report_items(company_id,id),
 add constraint tax_document_single_context check((request_id is not null and expense_report_item_id is null) or (request_id is null and expense_report_item_id is not null and order_id is null));

create function private.expense_visible(rid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.expense_reports r join public.employees e on e.id=r.employee_id where r.id=rid and private.has_company_access(r.company_id) and
 (private.has_permission('expense_report.view_company',r.company_id) or (e.profile_id=auth.uid() and e.active and private.has_permission('expense_report.view_own',r.company_id))));
$$;
do $$ declare t text;predicate text;begin
 for t,predicate in select * from (values
 ('expense_reports','private.expense_visible(id)'),('expense_report_items','private.expense_visible(report_id)'),
 ('expense_report_history','private.expense_visible(report_id)'),('expense_settlements','private.expense_visible(report_id)'),
 ('expense_declarations','exists(select 1 from public.expense_report_items i where i.id=item_id and private.expense_visible(i.report_id))'),
 ('employee_reimbursements','private.has_permission(''employee_reimbursement.view'',company_id) or private.expense_visible(report_id)'),
 ('employee_returns','private.has_permission(''employee_return.view'',company_id) or exists(select 1 from public.expense_settlements s where s.id=settlement_id and private.expense_visible(s.report_id))')
 ) v(t,predicate) loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy expense_read on public.%I for select to authenticated using(%s)',t,predicate);
  execute format('create trigger expense_audit after insert or update on public.%I for each row execute function private.audit_finance()',t);
 end loop;
end $$;
revoke all on function private.expense_visible(uuid) from public,anon,authenticated,service_role;
grant execute on function private.expense_visible(uuid) to authenticated;
commit;
