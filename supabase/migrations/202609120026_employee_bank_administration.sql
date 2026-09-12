begin;
alter table public.employee_bank_accounts add column replaces_id uuid,
 add foreign key(company_id,replaces_id) references public.employee_bank_accounts(company_id,id);
create function public.employee_bank_change(target_company uuid,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare row public.employee_bank_accounts;begin
 perform private.treasury_lock();perform private.finance_require('employee.bank_change',target_company);
 if jsonb_typeof(payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(payload) k where k not in
 ('employee_id','currency_id','bank_name','account_number','cci','account_type','replaces_id')) then raise exception using errcode='22023',message='Invalid employee account fields';end if;
 if not exists(select 1 from public.employees where company_id=target_company and id=(payload->>'employee_id')::uuid and active) then raise exception using errcode='23514',message='Active employee required';end if;
 if not exists(select 1 from public.currencies where id=(payload->>'currency_id')::uuid and active) then raise exception using errcode='23514',message='Active currency required';end if;
 if coalesce(length(trim(payload->>'bank_name')),0) not between 1 and 150 or coalesce(length(trim(payload->>'account_type')),0) not between 1 and 50 then raise exception using errcode='22023',message='Bank name and account type required';end if;
 if payload->>'replaces_id' is not null and not exists(select 1 from public.employee_bank_accounts where id=(payload->>'replaces_id')::uuid and company_id=target_company and employee_id=(payload->>'employee_id')::uuid and currency_id=(payload->>'currency_id')::uuid and status='active') then raise exception using errcode='23514',message='Replacement account mismatch';end if;
 insert into public.employee_bank_accounts(company_id,employee_id,currency_id,bank_name,account_number,cci,account_type,requested_by,replaces_id)
 values(target_company,(payload->>'employee_id')::uuid,(payload->>'currency_id')::uuid,trim(payload->>'bank_name'),payload->>'account_number',payload->>'cci',trim(payload->>'account_type'),auth.uid(),(payload->>'replaces_id')::uuid) returning * into row;
 return (to_jsonb(row)-array['account_number','cci'])||jsonb_build_object('account_mask','••••'||right(row.account_number,4));
end $$;
create function public.employee_bank_decide(target_id uuid,approve boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare row public.employee_bank_accounts;begin
 perform private.treasury_lock();select * into row from public.employee_bank_accounts where id=target_id for update;
 if not found then raise exception using errcode='42501',message='Account unavailable';end if;
 perform private.finance_require('employee.bank_change_approve',row.company_id);
 if row.requested_by=auth.uid() or exists(select 1 from public.employees where id=row.employee_id and profile_id=auth.uid()) then raise exception using errcode='42501',message='Employee account approval segregation';end if;
 if approve is null or row.status<>'pending' then raise exception using errcode='23514',message='Pending account required';end if;
 if not exists(select 1 from public.employees where id=row.employee_id and active) then raise exception using errcode='23514',message='Active employee required';end if;
 if approve and row.replaces_id is not null then
  update public.employee_bank_accounts set status='superseded' where id=row.replaces_id and company_id=row.company_id and status='active';
  if not found then raise exception using errcode='23514',message='Account already replaced';end if;
 end if;
 update public.employee_bank_accounts set status=case when approve then 'active' else 'rejected' end,approved_by=auth.uid(),approved_at=now() where id=row.id returning * into row;
 return (to_jsonb(row)-array['account_number','cci'])||jsonb_build_object('account_mask','••••'||right(row.account_number,4));
end $$;
create function public.employee_bank_list(target_company uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform private.finance_require('employee.bank_view',target_company);
 return (select coalesce(jsonb_agg((to_jsonb(a)-array['account_number','cci'])||jsonb_build_object('account_mask','••••'||right(account_number,4)) order by created_at desc),'[]') from public.employee_bank_accounts a where company_id=target_company);
end $$;
create function private.employee_obligation_identity() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='employee_advances' then
  if new.company_id<>old.company_id or new.employee_id<>old.employee_id or new.travel_request_id<>old.travel_request_id or new.currency_id<>old.currency_id or new.approved_amount<>old.approved_amount or new.approved_by<>old.approved_by then raise exception using errcode='23514',message='Original advance immutable';end if;
 elsif tg_table_name='payables' then
  if new.employee_id is distinct from old.employee_id or new.origin_type<>old.origin_type or new.origin_id<>old.origin_id then raise exception using errcode='23514',message='Obligation beneficiary and origin immutable';end if;
 end if;return new;
end $$;
create trigger employee_advance_identity before update on public.employee_advances for each row execute function private.employee_obligation_identity();
create trigger employee_payable_identity before update on public.payables for each row execute function private.employee_obligation_identity();
revoke all on function private.employee_obligation_identity(),public.employee_bank_change(uuid,jsonb),public.employee_bank_decide(uuid,boolean),public.employee_bank_list(uuid) from public,anon,service_role;
grant execute on function public.employee_bank_change(uuid,jsonb),public.employee_bank_decide(uuid,boolean),public.employee_bank_list(uuid) to authenticated;
commit;
