begin;
alter table public.journal_entries add column revision integer not null default 1 check(revision>0);
alter table public.journal_entry_lines add column revision integer not null default 1 check(revision>0),drop constraint journal_entry_lines_journal_entry_id_line_number_key,add unique(journal_entry_id,revision,line_number);
create function private.accounting_event(c uuid,kind text,rid uuid,act text,note text,d jsonb default '{}')returns void language plpgsql security definer set search_path='' as $$begin
 insert into public.accounting_history(company_id,entity_type,entity_id,action,actor_id,reason,details)values(c,kind,rid,act,auth.uid(),note,d);
 insert into public.audit_logs(user_id,action,category,entity_type,entity_id,company_id,reason,new_values)values(auth.uid(),'accounting.'||act,'finance',kind,rid::text,c,note,d);
end $$;
create function private.accounting_retry(c uuid,k uuid,op text,p jsonb)returns jsonb language plpgsql security definer set search_path='' as $$declare r public.accounting_operation_keys;begin
 if k is null then raise exception using errcode='22023',message='Idempotency key required';end if;
 select * into r from public.accounting_operation_keys where company_id=c and operation_key=k;
 if found then if r.operation<>op or r.payload<>p then raise exception using errcode='23514',message='Idempotency payload mismatch';end if;return r.result;end if;return null;
end $$;
create function private.accounting_remember(c uuid,k uuid,op text,p jsonb,r jsonb)returns void language sql security definer set search_path='' as $$insert into public.accounting_operation_keys(company_id,operation_key,operation,payload,result,created_by)values(c,k,op,p,r,auth.uid());$$;
create function private.accounting_number(c uuid,on_date date)returns text language plpgsql security definer set search_path='' as $$declare s public.accounting_settings;n bigint;y integer:=extract(year from on_date);begin
 select * into s from public.accounting_settings where company_id=c;if not found then raise exception using errcode='23514',message='Explicit accounting configuration required';end if;
 insert into public.accounting_sequences(company_id,year,last_number)values(c,y,1)on conflict(company_id,year)do update set last_number=public.accounting_sequences.last_number+1 returning last_number into n;
 if length(n::text)>s.number_digits then raise exception using errcode='23514',message='Configured numbering exhausted';end if;
 return s.number_prefix||'-'||y||'-'||lpad(n::text,s.number_digits,'0');
end $$;
create function private.guard_accounting_account()returns trigger language plpgsql security definer set search_path='' as $$declare pl integer;begin
 perform private.treasury_lock();if tg_op='DELETE'then raise exception using errcode='23514',message='Accounting account deletion forbidden';end if;
 new.code:=trim(new.code);new.name:=trim(new.name);
 if tg_op='UPDATE'then
  if new.company_id<>old.company_id then raise exception using errcode='23514',message='Accounting company immutable';end if;
  if exists(with recursive descendants as(select id from public.accounting_accounts where id=old.id union all select a.id from public.accounting_accounts a join descendants d on a.parent_id=d.id)select 1 from public.accounting_accounts a join descendants d on d.id=a.id where a.first_used_at is not null)
   and (new.code<>old.code or new.parent_id is distinct from old.parent_id or new.account_type<>old.account_type or new.normal_balance<>old.normal_balance)then raise exception using errcode='23514',message='Used account identity and ancestry immutable';end if;
  if old.first_used_at is not null and new.first_used_at is distinct from old.first_used_at then raise exception using errcode='23514',message='First use immutable';end if;
 end if;
 if new.parent_id is not null then
  select level into pl from public.accounting_accounts where id=new.parent_id and company_id=new.company_id;if not found then raise exception using errcode='23514',message='Parent company mismatch';end if;
  if exists(with recursive ancestors as(select id,parent_id from public.accounting_accounts where id=new.parent_id union select a.id,a.parent_id from public.accounting_accounts a join ancestors x on a.id=x.parent_id)select 1 from ancestors where id=new.id)then raise exception using errcode='23514',message='Accounting hierarchy cycle';end if;
  new.level:=pl+1;
 else new.level:=1;end if;return new;
end $$;
create trigger accounting_account_guard before insert or update or delete on public.accounting_accounts for each row execute function private.guard_accounting_account();
create function private.guard_accounting_immutable()returns trigger language plpgsql security definer set search_path='' as $$declare e public.journal_entries;old_json jsonb;new_json jsonb;begin
 perform private.treasury_lock();if tg_op='DELETE'then raise exception using errcode='23514',message='Accounting deletion forbidden';end if;
 if tg_table_name='journal_postings'and tg_op='UPDATE'then raise exception using errcode='23514',message='Posting evidence immutable';end if;
 if tg_op='UPDATE'and tg_table_name in('accounting_rule_lines','accounting_operation_keys','accounting_history')then raise exception using errcode='23514',message='Accounting evidence and rule lines immutable';end if;
 if tg_op='UPDATE'and tg_table_name='accounting_rules'then
  if(to_jsonb(new)-array['status','activated_by','activated_at','first_used_at'])is distinct from(to_jsonb(old)-array['status','activated_by','activated_at','first_used_at'])then raise exception using errcode='23514',message='Rule content requires a new version';end if;
  if to_jsonb(old)->>'first_used_at'is not null and(to_jsonb(new)->>'first_used_at')is distinct from(to_jsonb(old)->>'first_used_at')then raise exception using errcode='23514',message='Rule first use immutable';end if;
 end if;
 if tg_op='UPDATE'and(to_jsonb(new)->>'company_id')<>(to_jsonb(old)->>'company_id')then raise exception using errcode='23514',message='Accounting company immutable';end if;
 if tg_table_name='journal_entries' then
 if tg_op='UPDATE' then
 if old.posted_at is not null then
  old_json:=to_jsonb(old)-array['status','reversed_entry_id','reversal_reason','updated_at'];new_json:=to_jsonb(new)-array['status','reversed_entry_id','reversal_reason','updated_at'];
  if old_json<>new_json or old.status<>'posted' or new.status<>'reversed' or new.reversed_entry_id is null or not exists(select 1 from public.journal_entries r where r.id=new.reversed_entry_id and r.original_entry_id=old.id and r.posted_at is not null)then raise exception using errcode='23514',message='Posted journal immutable';end if;
 end if;end if;
 elsif tg_table_name='journal_entry_lines'then
  select * into e from public.journal_entries where id=new.journal_entry_id;
  if e.posted_at is not null then raise exception using errcode='23514',message='Posted lines immutable';end if;
  if tg_op='UPDATE'and (old.journal_entry_id<>new.journal_entry_id or old.revision<>new.revision)then raise exception using errcode='23514',message='Line identity immutable';end if;
 elsif tg_table_name='journal_line_dimensions'then
  select j.* into e from public.journal_entries j join public.journal_entry_lines l on l.journal_entry_id=j.id where l.id=new.journal_line_id;
  if e.posted_at is not null then raise exception using errcode='23514',message='Posted dimensions immutable';end if;
 end if;return new;
end $$;
do $$declare t text;begin foreach t in array array['accounting_settings','accounting_periods','accounting_entry_types','journal_entries','journal_entry_lines','journal_line_dimensions','journal_postings','accounting_rules','accounting_rule_lines','accounting_operation_keys','accounting_history']loop
 execute format('create trigger accounting_immutable before insert or update or delete on public.%I for each row execute function private.guard_accounting_immutable()',t);end loop;end $$;
create function private.accounting_post_constraint()returns trigger language plpgsql security definer set search_path='' as $$declare e public.journal_entries;d numeric;c numeric;n integer;begin
 select * into e from public.journal_entries where id=new.journal_entry_id;
 select sum(debit),sum(credit),count(*)into d,c,n from public.journal_entry_lines where journal_entry_id=e.id and revision=e.revision;
 if e.posted_at is null or e.status not in('posted','reversed')or n<2 or d<>c or d<=0 then raise exception using errcode='23514',message='Posted journal must balance exactly';end if;return new;
end $$;
create constraint trigger accounting_double_entry after insert on public.journal_postings deferrable initially deferred for each row execute function private.accounting_post_constraint();
create function private.accounting_source(c uuid,kind text,rid uuid)returns void language plpgsql stable security definer set search_path='' as $$declare tbl text;ok boolean;begin
 if kind in('manual','opening')then if rid is not null then raise exception using errcode='23514',message='Manual source has no foreign record';end if;return;end if;
 tbl:=case kind when 'payable'then 'payables'when 'payment'then 'payments'when 'collection'then 'collections'when 'receivable'then 'receivables'when 'expense_report'then 'expense_reports'when 'employee_return'then 'employee_returns'when 'employee_reimbursement'then 'employee_reimbursements'when 'bank_adjustment'then 'bank_transactions'end;
 if tbl is null or rid is null then raise exception using errcode='23514',message='Persisted source required';end if;
 execute format('select exists(select 1 from public.%I where id=$1 and company_id=$2)',tbl)into ok using rid,c;if not ok then raise exception using errcode='23514',message='Source company mismatch';end if;
end $$;
create function private.accounting_third_party(c uuid,kind text,rid uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$declare r jsonb;begin
 if kind is null and rid is null then return null;end if;
 if kind='supplier'then select jsonb_build_object('id',s.id,'code',s.tax_id,'name',s.legal_name)into r from public.suppliers s join public.supplier_companies sc on sc.supplier_id=s.id where s.id=rid and sc.company_id=c and sc.status='active';
 elsif kind='customer'then select jsonb_build_object('id',id,'code',document_number,'name',legal_name)into r from public.customers where id=rid and company_id=c and status='active';
 elsif kind='employee'then select jsonb_build_object('id',id,'code',document_number,'name',full_name)into r from public.employees where id=rid and company_id=c and active;end if;
 if r is null then raise exception using errcode='23514',message='Third party company or active status mismatch';end if;return r;
end $$;
create function private.accounting_dimension(c uuid,kind text,rid uuid,on_date date)returns jsonb language plpgsql stable security definer set search_path='' as $$declare r jsonb;begin
 if kind='cost_center'then select to_jsonb(t)into r from public.cost_centers t where id=rid and company_id=c and active and valid_from<=on_date and(valid_to is null or valid_to>=on_date);
 elsif kind='project'then select to_jsonb(t)into r from public.projects t where id=rid and company_id=c and status='active';
 elsif kind='subproject'then select to_jsonb(t)into r from public.subprojects t where id=rid and company_id=c and status='active';
 elsif kind='area'then select to_jsonb(t)into r from public.areas t where id=rid and active;end if;
 if r is null then raise exception using errcode='23514',message='Active dimension unavailable in company; AFE not implemented';end if;return r;
end $$;
revoke all on function private.accounting_event(uuid,text,uuid,text,text,jsonb),private.accounting_retry(uuid,uuid,text,jsonb),private.accounting_remember(uuid,uuid,text,jsonb,jsonb),private.accounting_number(uuid,date),private.guard_accounting_account(),private.guard_accounting_immutable(),private.accounting_post_constraint(),private.accounting_source(uuid,text,uuid),private.accounting_third_party(uuid,text,uuid),private.accounting_dimension(uuid,text,uuid,date)from public,anon,authenticated,service_role;
commit;
