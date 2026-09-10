begin;
-- Additive Phase 4: no changes to the Phase 1–3 permission evaluator or grants.
insert into public.permissions(module,resource,action,code,description,requires_company,scope)
select 'operaciones_financieras',r,a,r||'.'||a,r||': '||a,true,
 case a when 'view_own' then 'own' when 'view_area' then 'area' when 'view_company' then 'company' else 'none' end
from (values
 ('request','view_own view_area view_company create edit_own submit approve observe reject cancel'),
 ('supplier','view create edit disable bank_view bank_change bank_change_approve'),
 ('purchase_order','view create edit approve cancel'),
 ('service_acceptance','view create accept observe'),
 ('tax_document','view create edit review cancel'),
 ('payable','view create review approve hold cancel'),
 ('payment_term','view create edit'),('approval_policy','view manage')
) v(r,actions) cross join lateral unnest(string_to_array(actions,' ')) a
on conflict(code) do update set active=true;

alter table public.projects add column first_used_at timestamptz;
alter table public.subprojects add column first_used_at timestamptz;
alter table public.subprojects add unique(company_id,id);
create table public.dimension_versions (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 dimension_type text not null check(dimension_type in ('cost_center','project','subproject')),
 dimension_id uuid not null, snapshot jsonb not null, created_by uuid references public.profiles(id),
 created_at timestamptz not null default now(), unique(company_id,id)
);
-- A transaction captures the complete ancestry before the operation becomes visible.
-- Used CECO hierarchy/code are already protected by guard_cost_center in migration 010.
create function private.guard_used_dimension() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception using errcode='23514',message='Deactivate dimensions instead of deleting'; end if;
 if new.company_id<>old.company_id or new.code<>old.code or
 (old.first_used_at is not null and (new.first_used_at is distinct from old.first_used_at or
 (tg_table_name='subprojects' and to_jsonb(new)->'project_id' is distinct from to_jsonb(old)->'project_id'))) then
 raise exception using errcode='23514',message='Historical dimension identity protected'; end if;
 return new;
end $$;
create trigger guard_used_dimension before update or delete on public.projects for each row execute function private.guard_used_dimension();
create trigger guard_used_dimension before update or delete on public.subprojects for each row execute function private.guard_used_dimension();

create table public.suppliers (
 id uuid primary key default gen_random_uuid(), country_code text not null default 'PE' check(country_code ~ '^[A-Z]{2}$'),
 tax_id_type text not null check(tax_id_type in ('ruc','dni','foreign','other')),
 tax_id text not null check(length(tax_id) between 1 and 32),
 legal_name text not null check(length(trim(legal_name)) between 1 and 200),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(country_code,tax_id_type,tax_id), check(tax_id_type<>'ruc' or tax_id ~ '^(10|15|16|17|20)[0-9]{9}$')
);
create table public.supplier_companies (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 supplier_id uuid not null references public.suppliers(id), trade_name text, address text, phone text, email text,
 status text not null default 'active' check(status in ('active','inactive')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(company_id,supplier_id), unique(company_id,id)
);
create table public.supplier_contacts (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, supplier_id uuid not null,
 name text not null check(length(trim(name)) between 1 and 150), phone text, email text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(company_id,supplier_id) references public.supplier_companies(company_id,supplier_id)
);
create table public.supplier_bank_accounts (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, supplier_id uuid not null,
 bank_name text not null, currency_id uuid not null references public.currencies(id),
 account_number text not null check(account_number ~ '^[0-9A-Za-z-]{6,40}$'), cci text check(cci ~ '^[0-9]{20}$'),
 account_type text not null check(account_type in ('checking','savings','other')), is_primary boolean not null default false,
 status text not null default 'active' check(status in ('active','superseded')),
 created_at timestamptz not null default now(), unique(company_id,id),
 foreign key(company_id,supplier_id) references public.supplier_companies(company_id,supplier_id)
);
create unique index supplier_one_primary on public.supplier_bank_accounts(company_id,supplier_id,currency_id) where is_primary and status='active';
create table public.supplier_bank_account_changes (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, supplier_id uuid not null,
 account_id uuid, proposed jsonb not null, reason text not null check(length(trim(reason)) between 1 and 2000),
 status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
 requested_by uuid not null references public.profiles(id), reviewed_by uuid references public.profiles(id),
 reviewed_at timestamptz, review_comment text, created_at timestamptz not null default now(),
 unique(company_id,id), foreign key(company_id,supplier_id) references public.supplier_companies(company_id,supplier_id),
 foreign key(company_id,account_id) references public.supplier_bank_accounts(company_id,id),
 check(reviewed_by is null or reviewed_by<>requested_by)
);
create table public.payment_terms (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 code text not null check(code ~ '^[A-Za-z0-9_.-]{1,50}$'), name text not null,
 days integer not null default 0 check(days between 0 and 3650),
 due_date_basis text not null check(due_date_basis in ('invoice_date','document_received_date','service_acceptance_date','explicit_date','other_future')),
 end_of_month boolean not null default false, active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(company_id,code), unique(company_id,id)
);
create table public.approval_policies (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 name text not null, request_type text not null check(request_type in ('purchase','service','direct_payment','other')),
 approver_role_id uuid not null references public.roles(id), prevent_self_approval boolean not null default true,
 active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(company_id,id)
);
create unique index one_active_request_policy on public.approval_policies(company_id,request_type) where active;
create table private.document_counters (
 company_id uuid not null references public.companies(id), prefix text not null, year integer not null, value integer not null,
 primary key(company_id,prefix,year)
);
create function private.next_document_number(c uuid,p text) returns text language plpgsql security definer set search_path='' as $$
declare n integer; y integer:=extract(year from current_date); begin
 insert into private.document_counters values(c,p,y,1) on conflict(company_id,prefix,year)
 do update set value=private.document_counters.value+1 returning value into n;
 if n>999999 then raise exception using errcode='23514',message='Number range exhausted'; end if;
 return p||'-'||y||'-'||lpad(n::text,6,'0'); end $$;
create table public.financial_requests (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), request_number text not null,
 request_type text not null check(request_type in ('purchase','service','direct_payment','advance','reimbursement','other')),
 requester_id uuid not null references public.profiles(id), area_id uuid references public.areas(id),
 cost_center_id uuid not null, project_id uuid, subproject_id uuid,
 currency_id uuid not null references public.currencies(id), estimated_amount numeric(20,2) not null check(estimated_amount>0),
 description text not null check(length(trim(description)) between 1 and 2000), justification text not null check(length(trim(justification)) between 1 and 4000),
 required_date date not null, priority text not null default 'normal' check(priority in ('low','normal','high','urgent')),
 supplier_id uuid, payment_modality text not null check(payment_modality in ('advance','cash','credit','against_invoice','against_delivery','custom')),
 status text not null default 'draft' check(status in ('draft','submitted','under_review','approved','observed','rejected','cancelled','in_process','completed')),
 version integer not null default 1, dimension_snapshot jsonb not null default '{}',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(company_id,id), unique(company_id,request_number),
 foreign key(company_id,cost_center_id) references public.cost_centers(company_id,id),
 foreign key(company_id,project_id) references public.projects(company_id,id),
 foreign key(company_id,subproject_id) references public.subprojects(company_id,id),
 foreign key(company_id,supplier_id) references public.supplier_companies(company_id,supplier_id),
 check(subproject_id is null or project_id is not null)
);
create table public.financial_request_items (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, request_id uuid not null,
 description text not null, quantity numeric(18,4) not null check(quantity>0), unit_price numeric(18,4) not null check(unit_price>=0),
 amount numeric(20,2) generated always as (round(quantity*unit_price,2)) stored,
 foreign key(company_id,request_id) references public.financial_requests(company_id,id)
);
create table public.financial_request_history (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, request_id uuid not null,
 actor uuid not null references public.profiles(id), action text not null, previous_state text, new_state text not null,
 comment text, version integer not null, snapshot jsonb not null, created_at timestamptz not null default now(),
 foreign key(company_id,request_id) references public.financial_requests(company_id,id)
);
create table public.approval_instances (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, request_id uuid not null,
 request_version integer not null, policy_snapshot jsonb not null,
 status text not null default 'pending' check(status in ('pending','approved','observed','rejected','cancelled')),
 created_at timestamptz not null default now(), unique(company_id,id), unique(request_id,request_version),
 foreign key(company_id,request_id) references public.financial_requests(company_id,id)
);
create table public.approval_steps (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, instance_id uuid not null,
 sequence integer not null default 1, approver_role_id uuid not null references public.roles(id),
 status text not null default 'pending' check(status in ('pending','approved','observed','rejected','cancelled')),
 unique(company_id,id), unique(instance_id,sequence), foreign key(company_id,instance_id) references public.approval_instances(company_id,id)
);
create table public.approval_actions (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, step_id uuid not null,
 actor uuid not null references public.profiles(id), action text not null check(action in ('approve','observe','reject')),
 comment text not null, previous_state text not null, new_state text not null, created_at timestamptz not null default now(),
 foreign key(company_id,step_id) references public.approval_steps(company_id,id)
);
create table public.purchase_orders (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, request_id uuid not null, supplier_id uuid not null,
 order_type text not null check(order_type in ('purchase','service')), order_number text not null,
 currency_id uuid not null references public.currencies(id), total_amount numeric(20,2) not null check(total_amount>0),
 description text not null, requires_acceptance boolean not null default true,
 status text not null default 'draft' check(status in ('draft','pending_approval','approved','sent','in_progress','partially_received','received','closed','cancelled')),
 cost_center_id uuid not null, project_id uuid, subproject_id uuid, dimension_snapshot jsonb not null,
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(company_id,id), unique(company_id,order_number),
 foreign key(company_id,request_id) references public.financial_requests(company_id,id),
 foreign key(company_id,supplier_id) references public.supplier_companies(company_id,supplier_id),
 foreign key(company_id,cost_center_id) references public.cost_centers(company_id,id),
 foreign key(company_id,project_id) references public.projects(company_id,id),
 foreign key(company_id,subproject_id) references public.subprojects(company_id,id)
);
create table public.purchase_order_items (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, order_id uuid not null, description text not null,
 quantity numeric(18,4) not null check(quantity>0), unit_price numeric(18,4) not null check(unit_price>=0),
 amount numeric(20,2) generated always as (round(quantity*unit_price,2)) stored,
 foreign key(company_id,order_id) references public.purchase_orders(company_id,id)
);
create table public.service_acceptances (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, request_id uuid not null, order_id uuid, supplier_id uuid not null,
 accepted_by uuid references public.profiles(id), acceptance_date date,
 status text not null default 'pending' check(status in ('pending','accepted','observed','rejected')),
 observations text, created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(company_id,id), foreign key(company_id,request_id) references public.financial_requests(company_id,id),
 foreign key(company_id,order_id) references public.purchase_orders(company_id,id),
 foreign key(company_id,supplier_id) references public.supplier_companies(company_id,supplier_id)
);
create table public.tax_documents (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, supplier_id uuid not null,
 request_id uuid not null, order_id uuid,
 document_type text not null check(document_type in ('invoice','receipt','fee_receipt','credit_note','debit_note','other')),
 series text not null check(series ~ '^[A-Z0-9-]{1,20}$'), number text not null check(number ~ '^[0-9]{1,20}$'),
 issue_date date not null, received_date date not null, due_date date,
 currency_id uuid not null references public.currencies(id), subtotal numeric(20,2) not null check(subtotal>=0),
 tax_amount numeric(20,2) not null check(tax_amount>=0), non_taxable_amount numeric(20,2) not null default 0 check(non_taxable_amount>=0),
 total_amount numeric(20,2) not null check(total_amount>0),
 status text not null default 'draft' check(status in ('draft','reviewed','observed','cancelled')),
 sunat_status text, sunat_validated_at timestamptz,
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(company_id,id), check(total_amount=subtotal+tax_amount+non_taxable_amount),
 foreign key(company_id,supplier_id) references public.supplier_companies(company_id,supplier_id),
 foreign key(company_id,request_id) references public.financial_requests(company_id,id),
 foreign key(company_id,order_id) references public.purchase_orders(company_id,id),
 check(sunat_status is null and sunat_validated_at is null)
);
create unique index tax_document_unique_identity on public.tax_documents(company_id,supplier_id,document_type,series,(number::numeric));
create table public.tax_document_amounts (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, tax_document_id uuid not null,
 code text not null, name text not null, amount numeric(20,2) not null check(amount>=0),
 unique(tax_document_id,code), foreign key(company_id,tax_document_id) references public.tax_documents(company_id,id)
);
create table public.payables (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, supplier_id uuid not null,
 origin_type text not null check(origin_type in ('tax_document','approved_obligation')), origin_id uuid not null,
 request_id uuid not null, order_id uuid, tax_document_id uuid,
 currency_id uuid not null references public.currencies(id), original_amount numeric(20,2) not null check(original_amount>0),
 outstanding_amount numeric(20,2) not null, issue_date date not null, due_date date not null,
 payment_term_id uuid not null, payment_term_snapshot jsonb not null, due_date_basis_date date not null,
 requires_acceptance boolean not null default true, acceptance_id uuid,
 status text not null default 'draft' check(status in ('draft','under_review','approved','on_hold','cancelled')),
 cost_center_id uuid not null, project_id uuid, subproject_id uuid, dimension_snapshot jsonb not null,
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(company_id,id), unique(company_id,origin_type,origin_id),
 check(outstanding_amount=original_amount),
 check((origin_type='tax_document' and tax_document_id=origin_id) or (origin_type='approved_obligation' and tax_document_id is null and origin_id=request_id)),
 foreign key(company_id,request_id) references public.financial_requests(company_id,id),
 foreign key(company_id,order_id) references public.purchase_orders(company_id,id),
 foreign key(company_id,supplier_id) references public.supplier_companies(company_id,supplier_id),
 foreign key(company_id,tax_document_id) references public.tax_documents(company_id,id),
 foreign key(company_id,payment_term_id) references public.payment_terms(company_id,id),
 foreign key(company_id,acceptance_id) references public.service_acceptances(company_id,id),
 foreign key(company_id,cost_center_id) references public.cost_centers(company_id,id),
 foreign key(company_id,project_id) references public.projects(company_id,id),
 foreign key(company_id,subproject_id) references public.subprojects(company_id,id)
);
create table public.attachments (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 entity_type text not null check(entity_type in ('request','purchase_order','service_acceptance','tax_document','payable','supplier_bank_change')),
 entity_id uuid not null, storage_bucket text not null default 'financial-private' check(storage_bucket='financial-private'), storage_path text not null unique,
 filename text not null check(length(filename) between 1 and 180), mime_type text not null check(mime_type in ('application/pdf','application/xml','image/png','image/jpeg')),
 size integer not null check(size between 1 and 5242880), uploaded_by uuid not null references public.profiles(id),
 status text not null default 'pending' check(status in ('pending','ready')), created_at timestamptz not null default now(), unique(company_id,id)
);

create function private.audit_finance() returns trigger language plpgsql security definer set search_path='' as $$
declare b jsonb; a jsonb; d jsonb; begin
 if tg_op<>'INSERT' then b:=to_jsonb(old); end if; if tg_op<>'DELETE' then a:=to_jsonb(new); end if; d:=coalesce(a,b);
 -- Bank account values are restricted to bank_view, never copied to general audit.
 if tg_table_name in ('supplier_bank_accounts','supplier_bank_account_changes') then
 b:=b-array['account_number','cci','proposed']; a:=a-array['account_number','cci','proposed']; end if;
 insert into public.audit_logs(user_id,action,category,entity_type,entity_id,company_id,old_values,new_values)
 values(auth.uid(),lower(tg_op)||case when a->>'status' is distinct from b->>'status' then '.'||coalesce(a->>'status','deleted') else '' end,
 'finance',tg_table_name,d->>'id',(d->>'company_id')::uuid,b,a);
 return coalesce(new,old); end $$;
create function private.request_visible(c uuid,owner_id uuid,area uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.has_company_access(c) and (private.has_permission('request.view_company',c) or private.has_permission('request.view_all',c)
 or (owner_id=auth.uid() and private.has_permission('request.view_own',c))
 or (area is not null and area=(select area_id from public.profiles where id=auth.uid()) and private.has_permission('request.view_area',c)));
$$;
create function private.can_review_request(rid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.financial_requests r join public.approval_instances i on i.request_id=r.id and i.request_version=r.version
 join public.approval_steps s on s.instance_id=i.id join public.user_roles ur on ur.role_id=s.approver_role_id
 join public.roles ro on ro.id=ur.role_id and ro.active
 where r.id=rid and ur.user_id=auth.uid() and (ur.company_id=r.company_id or ur.company_id is null)
 and private.has_company_access(r.company_id) and
 (private.has_permission('request.approve',r.company_id) or private.has_permission('request.observe',r.company_id) or private.has_permission('request.reject',r.company_id)));
$$;
create function private.can_read_request(rid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.financial_requests where id=rid and (private.request_visible(company_id,requester_id,area_id) or private.can_review_request(id)));
$$;
do $$ declare t text; p text; begin
 for t,p in select * from (values
 ('dimension_versions','cost_center.view'),('supplier_companies','supplier.view'),('supplier_contacts','supplier.view'),
 ('supplier_bank_accounts','supplier.bank_view'),('supplier_bank_account_changes','supplier.bank_view'),('payment_terms','payment_term.view'),
 ('approval_policies','approval_policy.view'),('purchase_orders','purchase_order.view'),('purchase_order_items','purchase_order.view'),
 ('service_acceptances','service_acceptance.view'),('tax_documents','tax_document.view'),('tax_document_amounts','tax_document.view'),('payables','payable.view')
 ) v(t,p) loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated,service_role',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy finance_read on public.%I for select to authenticated using (private.has_permission(%L,company_id))',t,p);
 execute format('create trigger audit_finance after insert or update or delete on public.%I for each row execute function private.audit_finance()',t);
 end loop;
 foreach t in array array['financial_requests','financial_request_items','financial_request_history','approval_instances','approval_steps','approval_actions','attachments','suppliers'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated,service_role',t);
 execute format('grant select on public.%I to authenticated',t);
 if t<>'suppliers' then execute format('create trigger audit_finance after insert or update or delete on public.%I for each row execute function private.audit_finance()',t); end if;
 end loop;
end $$;
create policy request_read on public.financial_requests for select to authenticated using(private.can_read_request(id));
create policy request_item_read on public.financial_request_items for select to authenticated using(private.can_read_request(request_id));
create policy request_history_read on public.financial_request_history for select to authenticated using(private.can_read_request(request_id));
create policy instance_read on public.approval_instances for select to authenticated using(private.can_read_request(request_id));
create policy step_read on public.approval_steps for select to authenticated using(exists(select 1 from public.approval_instances i where i.id=instance_id));
create policy action_read on public.approval_actions for select to authenticated using(exists(select 1 from public.approval_steps s where s.id=step_id));
create policy supplier_identity_read on public.suppliers for select to authenticated using(exists(select 1 from public.supplier_companies s where s.supplier_id=id and private.has_permission('supplier.view',s.company_id)));
revoke all on all functions in schema private from public,anon,service_role;
grant execute on function private.can_read_request(uuid),private.has_permission(text,uuid),private.can_review_request(uuid) to authenticated;
commit;
