begin;
create function public.expense_tax_document(item_id uuid,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare i public.expense_report_items;r public.expense_reports;d public.tax_documents;subtotal numeric;tax numeric;non_tax numeric;begin
 perform private.treasury_lock();select * into i from public.expense_report_items where id=item_id for update;
 if not found then raise exception using errcode='42501',message='Expense item unavailable';end if;r:=private.expense_editable(i.report_id);
 if i.support_type<>'tax_document' or i.tax_document_id is not null then raise exception using errcode='23514',message='Tax support already fixed or incompatible';end if;
 if jsonb_typeof(payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(payload) k where k not in ('existing_id','supplier_id','document_type','series','number','issue_date','received_date','subtotal','tax_amount','non_taxable_amount')) then raise exception using errcode='22023',message='Invalid tax support fields';end if;
 if payload->>'existing_id' is not null then
  perform private.finance_require('tax_document.view',r.company_id);
  select * into d from public.tax_documents where id=(payload->>'existing_id')::uuid and company_id=r.company_id and currency_id=r.currency_id and status<>'cancelled';
  if not found or d.expense_report_item_id is not null or exists(select 1 from public.payables where tax_document_id=d.id and status<>'cancelled') then raise exception using errcode='23514',message='Tax document unavailable or already obligated';end if;
 else
  perform private.finance_require('tax_document.create',r.company_id);
  if not exists(select 1 from public.supplier_companies where supplier_id=(payload->>'supplier_id')::uuid and company_id=r.company_id and status='active') then raise exception using errcode='23514',message='Supplier company mismatch';end if;
  subtotal:=private.expense_money(payload->'subtotal');tax:=private.expense_money(payload->'tax_amount');non_tax:=private.expense_money(payload->'non_taxable_amount');
  insert into public.tax_documents(company_id,supplier_id,expense_report_item_id,document_type,series,number,issue_date,received_date,currency_id,subtotal,tax_amount,non_taxable_amount,total_amount,created_by)
  values(r.company_id,(payload->>'supplier_id')::uuid,i.id,payload->>'document_type',upper(payload->>'series'),payload->>'number',(payload->>'issue_date')::date,(payload->>'received_date')::date,r.currency_id,subtotal,tax,non_tax,subtotal+tax+non_tax,auth.uid()) returning * into d;
 end if;
 if i.reported_amount>d.total_amount then raise exception using errcode='23514',message='Expense exceeds supporting document';end if;
 update public.expense_report_items set tax_document_id=d.id where id=i.id;
 perform private.expense_history(r.id,'tax_document.link',null,null,to_jsonb(d));return to_jsonb(d);
end $$;
create function public.expense_tax_document_review(target_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare d public.tax_documents;r public.expense_reports;begin
 perform private.treasury_lock();select * into d from public.tax_documents where id=target_id for update;
 if not found then raise exception using errcode='42501',message='Tax document unavailable';end if;
 perform private.finance_require('tax_document.review',d.company_id);
 select r0.* into r from public.expense_reports r0 join public.expense_report_items i on i.report_id=r0.id where i.tax_document_id=d.id;
 if not found or r.status not in ('draft','submitted','under_review','observed') or d.status not in ('draft','observed') then raise exception using errcode='23514',message='Document review unavailable';end if;
 if auth.uid() in (d.created_by,r.created_by,r.submitted_by) then raise exception using errcode='42501',message='Tax document review segregation';end if;
 update public.tax_documents set status='reviewed',updated_at=now() where id=d.id returning * into d;
 perform private.expense_history(r.id,'tax_document.review',null,null,to_jsonb(d));return to_jsonb(d);
end $$;
create function private.prevent_double_expense_obligation() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.tax_document_id is not null and exists(select 1 from public.expense_report_items where tax_document_id=new.tax_document_id) then raise exception using errcode='23514',message='Document belongs to employee expense';end if;return new;
end $$;
create trigger prevent_double_expense_obligation before insert or update of tax_document_id on public.payables for each row execute function private.prevent_double_expense_obligation();
create policy expense_tax_read on public.tax_documents for select to authenticated using(exists(select 1 from public.expense_report_items i where i.tax_document_id=public.tax_documents.id and private.expense_visible(i.report_id)));

alter function private.attachment_access(text,uuid,uuid,boolean) rename to attachment_access_before_expense;
create function private.attachment_access(kind text,rid uuid,c uuid,writing boolean) returns boolean language plpgsql stable security definer set search_path='' as $$
declare r public.expense_reports;u uuid;s text;begin
 if kind not in ('expense_receipt','tax_support','declaration_support','employee_payment_evidence','employee_return_evidence','employee_reimbursement_support','expense_representation') then return private.attachment_access_before_expense(kind,rid,c,writing);end if;
 if not private.has_company_access(c) then return false;end if;
 if kind in ('expense_receipt','tax_support','employee_payment_evidence') then
  select r0.* into r from public.expense_reports r0 join public.expense_report_items i on i.report_id=r0.id where i.id=rid and i.company_id=c;
 elsif kind='declaration_support' then
  select r0.* into r from public.expense_reports r0 join public.expense_report_items i on i.report_id=r0.id join public.expense_declarations d on d.item_id=i.id where d.id=rid and d.company_id=c;
 elsif kind='expense_representation' then select * into r from public.expense_reports where id=rid and company_id=c;
 elsif kind='employee_return_evidence' then
  select created_by,status into u,s from public.employee_returns where id=rid and company_id=c;
  if not found then return false;end if;
  if writing then return u=auth.uid() and s='registered' and private.has_permission('employee_return.register',c);end if;
  return private.has_permission('employee_return.view',c) or exists(select 1 from public.employee_returns e join public.expense_settlements se on se.id=e.settlement_id where e.id=rid and private.expense_visible(se.report_id));
 else
  select r0.* into r from public.expense_reports r0 join public.employee_reimbursements e on e.report_id=r0.id where e.id=rid and e.company_id=c;
  if writing then return r.id is not null and r.status='settlement_pending' and private.has_permission('employee_reimbursement.create',c);end if;
  return r.id is not null and (private.expense_visible(r.id) or private.has_permission('employee_reimbursement.view',c));
 end if;
 if r.id is null then return false;end if;
 if not writing then return private.expense_visible(r.id);end if;
 return r.status in ('draft','observed') and private.has_permission('expense_report.create',c) and
 (exists(select 1 from public.employees where id=r.employee_id and profile_id=auth.uid() and active) or private.has_permission('expense_report.create_for_employee',c));
end $$;
alter table public.attachments drop constraint attachments_entity_type_check;
alter table public.attachments add constraint attachments_entity_type_check check(entity_type in ('request','purchase_order','service_acceptance','tax_document','payable','supplier_bank_change','payment','expense_receipt','tax_support','declaration_support','employee_payment_evidence','employee_return_evidence','employee_reimbursement_support','expense_representation'));
revoke all on function private.prevent_double_expense_obligation(),private.attachment_access(text,uuid,uuid,boolean),private.attachment_access_before_expense(text,uuid,uuid,boolean) from public,anon,authenticated,service_role;
-- Existing attachment SELECT policies invoke this predicate as authenticated.
grant execute on function private.attachment_access(text,uuid,uuid,boolean) to authenticated;
drop policy attachment_read on public.attachments;
create policy attachment_read on public.attachments for select to authenticated using(private.attachment_access(entity_type,entity_id,company_id,false));
revoke all on function public.expense_tax_document(uuid,jsonb),public.expense_tax_document_review(uuid) from public,anon,service_role;
grant execute on function public.expense_tax_document(uuid,jsonb),public.expense_tax_document_review(uuid) to authenticated;
commit;
