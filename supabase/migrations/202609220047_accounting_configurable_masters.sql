begin;
create function public.accounting_afe_save(target_id uuid,target_company uuid,payload jsonb)returns jsonb language plpgsql security definer set search_path='' as $$declare r jsonb;begin
 perform private.treasury_lock();perform private.finance_require('afe.manage',target_company);perform private.validate_keys(payload,array['code','name','active','valid_from','valid_to']);
 if target_id is not null and not exists(select 1 from public.afes where id=target_id and company_id=target_company)then raise exception using errcode='42501',message='AFE unavailable';end if;
 if target_id is null then payload:=payload||jsonb_build_object('company_id',target_company,'created_by',auth.uid());end if;
 r:=private.treasury_write('afes',target_id,target_company,payload);perform private.accounting_event(target_company,'afe',(r->>'id')::uuid,'save',null,jsonb_build_object('record',r));return r;
end $$;
create function public.accounting_legacy_save(target_id uuid,target_company uuid,payload jsonb)returns jsonb language plpgsql security definer set search_path='' as $$declare oldrow public.legacy_mappings;r public.legacy_mappings;n integer;begin
 perform private.treasury_lock();perform private.finance_require('legacy_mapping.manage',target_company);perform private.validate_keys(payload,array['dictionary','legacy_code','description','erp_mapping','valid_from','valid_to','notes']);
 if target_id is not null then select * into oldrow from public.legacy_mappings where id=target_id and company_id=target_company;if not found or oldrow.dictionary is distinct from payload->>'dictionary'or oldrow.legacy_code is distinct from payload->>'legacy_code'then raise exception using errcode='23514',message='Legacy mapping identity immutable';end if;
 elsif exists(select 1 from public.legacy_mappings where company_id=target_company and dictionary=payload->>'dictionary'and legacy_code=payload->>'legacy_code')then raise exception using errcode='23514',message='Create a new mapping version';end if;
 select coalesce(max(version),0)+1 into n from public.legacy_mappings where company_id=target_company and dictionary=payload->>'dictionary'and legacy_code=payload->>'legacy_code';
 insert into public.legacy_mappings(company_id,dictionary,legacy_code,description,erp_mapping,valid_from,valid_to,notes,version,previous_version_id,created_by)
 values(target_company,payload->>'dictionary',payload->>'legacy_code',payload->>'description',coalesce(payload->'erp_mapping','{}'),(payload->>'valid_from')::date,(payload->>'valid_to')::date,payload->>'notes',n,oldrow.id,auth.uid())returning * into r;
 perform private.accounting_event(target_company,'legacy_mapping',r.id,'version',null,jsonb_build_object('dictionary',r.dictionary,'legacy_code',r.legacy_code,'version',n));return to_jsonb(r);
end $$;
create function public.accounting_master_import(kind text,target_company uuid,rows jsonb,confirm boolean,operation_key uuid)returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb;p jsonb;r jsonb;counted integer:=0;row_number integer:=1;parent uuid;kp jsonb;begin
 perform private.treasury_lock();
 if kind is null or kind not in('project','subproject','afe','entry_type','legacy_mapping','rule')or confirm is null or operation_key is null or jsonb_typeof(rows)is distinct from 'array'or jsonb_array_length(rows)not between 1 and 2000 then raise exception using errcode='22023',message='Explicit supported import and confirmation required';end if;
 perform private.finance_require(case kind when 'project'then 'project.create'when 'subproject'then 'subproject.create'when 'afe'then 'afe.import'when 'legacy_mapping'then 'legacy_mapping.import'when 'rule'then 'accounting_rule.create'else 'accounting_period.manage'end,target_company);
 kp:=jsonb_build_object('kind',kind,'rows',rows);if confirm then r:=private.accounting_retry(target_company,operation_key,'configurable_import',kp);if r is not null then return r;end if;end if;
 begin
  for item in select value from jsonb_array_elements(rows)loop
   row_number:=row_number+1;p:=item;
   if kind in('project','subproject')then
    perform private.validate_keys(item,case when kind='project'then array['code','name','description','status']else array['code','name','description','status','project_code']end);
    if exists(select 1 from public.projects where kind='project'and company_id=target_company and code=item->>'code')or exists(select 1 from public.subprojects where kind='subproject'and company_id=target_company and code=item->>'code')then raise exception using errcode='23514',message='Duplicate code';end if;
    if kind='subproject'then select id into parent from public.projects where company_id=target_company and code=item->>'project_code'and status='active';if parent is null then raise exception using errcode='23514',message='Explicit active parent required';end if;p:=(item-'project_code')||jsonb_build_object('project_id',parent);end if;
    r:=public.master_save(kind,null,target_company,p);
   elsif kind='afe'then r:=public.accounting_afe_save(null,target_company,p);
   elsif kind='entry_type'then r:=public.accounting_master_save('entry_type',null,target_company,p);
   elsif kind='legacy_mapping'then r:=public.accounting_legacy_save(null,target_company,p);
   else
    -- Rule templates contain explicitly selected account IDs; no inferred chart or automatic designation.
    r:=public.accounting_rule_save(null,target_company,p,gen_random_uuid());
   end if;counted:=counted+1;
  end loop;
  if not confirm then raise exception using errcode='P8010',message='Preview rollback';end if;
 exception when sqlstate 'P8010'then null;
 when check_violation or not_null_violation or unique_violation or foreign_key_violation or invalid_parameter_value or invalid_text_representation or datetime_field_overflow then
  if confirm then raise;end if;return jsonb_build_object('status','invalid','persisted',false,'errors',jsonb_build_array(jsonb_build_object('row',row_number,'error','INVALID_OR_AMBIGUOUS_CONFIGURATION')));
 end;
 r:=jsonb_build_object('status',case when confirm then 'imported'else 'preview'end,'persisted',confirm,'validated_rows',counted);
 if confirm then perform private.accounting_remember(target_company,operation_key,'configurable_import',kp,r);perform private.accounting_event(target_company,'import',operation_key,'configurable_import',null,jsonb_build_object('kind',kind,'row_count',counted));end if;return r;
end $$;
create or replace function private.accounting_dimension(c uuid,kind text,rid uuid,on_date date)returns jsonb language plpgsql stable security definer set search_path='' as $$declare r jsonb;begin
 if kind='cost_center'then select to_jsonb(t)into r from public.cost_centers t where id=rid and company_id=c and active and valid_from<=on_date and(valid_to is null or valid_to>=on_date);
 elsif kind='project'then select to_jsonb(t)into r from public.projects t where id=rid and company_id=c and status='active';
 elsif kind='subproject'then select to_jsonb(t)into r from public.subprojects t where id=rid and company_id=c and status='active';
 elsif kind='area'then select to_jsonb(t)into r from public.areas t where id=rid and active;
 elsif kind='afe_future'then select to_jsonb(t)into r from public.afes t where id=rid and company_id=c and active and valid_from<=on_date and(valid_to is null or valid_to>=on_date);end if;
 if r is null then raise exception using errcode='23514',message='Active dimension unavailable in company';end if;return r;
end $$;
create function private.mark_afe_first_use()returns trigger language plpgsql security definer set search_path='' as $$begin
 update public.afes a set first_used_at=now()where a.company_id=new.company_id and a.first_used_at is null and exists(select 1 from public.journal_line_dimensions d join public.journal_entry_lines l on l.id=d.journal_line_id join public.journal_entries e on e.id=l.journal_entry_id and e.revision=l.revision where e.id=new.journal_entry_id and d.dimension_type='afe_future'and d.dimension_id=a.id);return new;
end $$;
create trigger accounting_afe_first_use after insert on public.journal_postings for each row execute function private.mark_afe_first_use();
alter table public.accounting_rule_lines drop constraint accounting_rule_lines_dimension_types_check;
alter table public.accounting_rule_lines add constraint accounting_rule_lines_dimension_types_check check(dimension_types<@array['cost_center','project','subproject','area','afe_future']);
revoke all on function private.mark_afe_first_use()from public,anon,authenticated,service_role;
revoke all on function public.accounting_afe_save(uuid,uuid,jsonb),public.accounting_legacy_save(uuid,uuid,jsonb),public.accounting_master_import(text,uuid,jsonb,boolean,uuid)from public,anon,service_role;
grant execute on function public.accounting_afe_save(uuid,uuid,jsonb),public.accounting_legacy_save(uuid,uuid,jsonb),public.accounting_master_import(text,uuid,jsonb,boolean,uuid)to authenticated;
commit;
