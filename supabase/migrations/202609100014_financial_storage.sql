begin;
-- Storage objects themselves stay in Storage. Only their metadata is referenced here.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('financial-private','financial-private',false,5242880,array['application/pdf','application/xml','image/png','image/jpeg'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create function private.attachment_access(kind text,rid uuid,c uuid,writing boolean) returns boolean language plpgsql stable security definer set search_path='' as $$
declare d jsonb; tbl text; p text; begin
 if not private.has_company_access(c) then return false; end if;
 case kind when 'request' then tbl:='financial_requests';p:='request.edit_own';
 when 'purchase_order' then tbl:='purchase_orders';p:='purchase_order.edit';
 when 'service_acceptance' then tbl:='service_acceptances';p:='service_acceptance.create';
 when 'tax_document' then tbl:='tax_documents';p:='tax_document.edit';
 when 'payable' then tbl:='payables';p:='payable.create';
 when 'supplier_bank_change' then tbl:='supplier_bank_account_changes';p:='supplier.bank_change';
 else return false; end case;
 execute format('select to_jsonb(t) from public.%I t where id=$1 and company_id=$2',tbl) into d using rid,c;
 if d is null then return false; end if;
 if writing then
 return private.has_permission(p,c) and case when kind='request' then (d->>'requester_id')::uuid=auth.uid() and d->>'status' in ('draft','observed') when kind='supplier_bank_change' then (d->>'requested_by')::uuid=auth.uid() and d->>'status'='pending' else d->>'status' not in ('cancelled','rejected','closed') end;
 end if;
 return case kind when 'request' then private.can_read_request(rid) when 'supplier_bank_change' then private.has_permission('supplier.bank_view',c) else private.has_permission(kind||'.view',c) end;
end $$;
create function public.attachment_prepare(target_company uuid,kind text,target_id uuid,filename text,mime_type text,file_size integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare aid uuid:=gen_random_uuid(); ext text; result jsonb; begin
 perform private.lock_security();
 if not private.attachment_access(kind,target_id,target_company,true) then raise exception using errcode='42501',message='Attachment access denied'; end if;
 ext:=lower(substring(filename from '\.([A-Za-z0-9]+)$'));
 if filename ~ '[\\/[:cntrl:]]' or ext is null or not ((ext='pdf' and mime_type='application/pdf') or (ext='xml' and mime_type='application/xml') or (ext='png' and mime_type='image/png') or (ext in ('jpg','jpeg') and mime_type='image/jpeg')) then raise exception using errcode='22023',message='File type prohibited'; end if;
 insert into public.attachments(id,company_id,entity_type,entity_id,storage_path,filename,mime_type,size,uploaded_by)
 values(aid,target_company,kind,target_id,target_company::text||'/'||aid::text||'.'||ext,filename,mime_type,file_size,auth.uid()) returning to_jsonb(attachments.*) into result;
 return result; end $$;
create function private.storage_attachment_allowed(object_name text,object_metadata jsonb,writing boolean) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.attachments a where a.storage_path=object_name and
 private.attachment_access(a.entity_type,a.entity_id,a.company_id,writing) and
 case when writing then a.uploaded_by=auth.uid() and a.status='pending'
 and (object_metadata->>'size')::bigint=a.size and object_metadata->>'mimetype'=a.mime_type
 else a.status='ready' or a.uploaded_by=auth.uid() end);
$$;
create policy attachment_read on public.attachments for select to authenticated using(private.attachment_access(entity_type,entity_id,company_id,false));
create policy financial_object_insert on storage.objects for insert to authenticated with check(bucket_id='financial-private' and private.storage_attachment_allowed(name,metadata,true));
create policy financial_object_read on storage.objects for select to authenticated using(bucket_id='financial-private' and private.storage_attachment_allowed(name,metadata,false));
-- No update/delete policy: evidence objects cannot be overwritten or silently removed.
create function public.attachment_finish(target_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.attachments; result jsonb; begin
 perform private.lock_security(); select * into a from public.attachments where id=target_id for update;
 if not found or a.uploaded_by<>auth.uid() or not private.attachment_access(a.entity_type,a.entity_id,a.company_id,true) then raise exception using errcode='42501',message='Attachment access denied'; end if;
 if not exists(select 1 from storage.objects o where o.bucket_id=a.storage_bucket and o.name=a.storage_path and (o.metadata->>'size')::bigint=a.size and o.metadata->>'mimetype'=a.mime_type) then raise exception using errcode='23514',message='Stored object metadata mismatch'; end if;
 update public.attachments set status='ready' where id=target_id returning to_jsonb(attachments.*) into result;
 return result; end $$;
revoke all on function private.attachment_access(text,uuid,uuid,boolean),private.storage_attachment_allowed(text,jsonb,boolean) from public,anon,service_role;
grant execute on function private.attachment_access(text,uuid,uuid,boolean),private.storage_attachment_allowed(text,jsonb,boolean) to authenticated;
revoke all on function public.attachment_prepare(uuid,text,uuid,text,text,integer),public.attachment_finish(uuid) from public,anon,service_role;
grant execute on function public.attachment_prepare(uuid,text,uuid,text,text,integer),public.attachment_finish(uuid) to authenticated;
commit;
