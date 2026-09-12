begin;
-- Additive protection against provider CDN caching: only authenticated ciphertext
-- is stored remotely; plaintext is released solely by the request-scoped API.
alter table public.attachments drop constraint attachments_storage_bucket_check;
alter table public.attachments add constraint attachments_storage_bucket_check check(storage_bucket in ('financial-private','financial-encrypted'));
alter table public.attachments alter column storage_bucket set default 'financial-encrypted';
alter table public.attachments add column encryption_format text;
alter table public.attachments add constraint attachment_cipher_format check(encryption_format is null or encryption_format='aes-256-gcm-v1');
alter table public.attachments drop constraint attachments_status_check;
alter table public.attachments add constraint attachments_status_check check(status in ('pending','ready','legacy'));
-- Previous files are synthetic DEV fixtures, preserved for diagnosis, not silently deleted.
update public.attachments set status='legacy' where encryption_format is null;
alter table public.attachments add constraint attachment_storage_format_consistent check(
 (storage_bucket='financial-private' and encryption_format is null and status='legacy') or
 (storage_bucket='financial-encrypted' and encryption_format is not distinct from 'aes-256-gcm-v1' and status<>'legacy'));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('financial-encrypted','financial-encrypted',false,5242912,array['application/octet-stream'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create or replace function public.attachment_prepare(target_company uuid,kind text,target_id uuid,filename text,mime_type text,file_size integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare aid uuid:=gen_random_uuid(); ext text; result jsonb; begin
 perform private.lock_security();
 if not private.attachment_access(kind,target_id,target_company,true) then raise exception using errcode='42501',message='Attachment access denied'; end if;
 ext:=lower(substring(filename from '\.([A-Za-z0-9]+)$'));
 if filename ~ '[\\/[:cntrl:]]' or ext is null or not ((ext='pdf' and mime_type='application/pdf') or (ext='xml' and mime_type='application/xml') or (ext='png' and mime_type='image/png') or (ext in ('jpg','jpeg') and mime_type='image/jpeg')) then raise exception using errcode='22023',message='File type prohibited'; end if;
 insert into public.attachments(id,company_id,entity_type,entity_id,storage_bucket,storage_path,filename,mime_type,size,uploaded_by,encryption_format)
 values(aid,target_company,kind,target_id,'financial-encrypted',target_company::text||'/'||aid::text||'.enc',filename,mime_type,file_size,auth.uid(),'aes-256-gcm-v1') returning to_jsonb(attachments.*) into result;
 return result; end $$;
create or replace function private.storage_attachment_allowed(object_name text,object_metadata jsonb,writing boolean) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.attachments a where a.storage_path=object_name and a.storage_bucket='financial-encrypted'
 and a.encryption_format='aes-256-gcm-v1' and a.status<>'legacy'
 and private.attachment_access(a.entity_type,a.entity_id,a.company_id,writing) and
 case when writing then a.uploaded_by=auth.uid() and a.status='pending'
 and coalesce(object_metadata->>'size',object_metadata->>'contentLength')::bigint=a.size+32
 and object_metadata->>'mimetype'='application/octet-stream'
 else a.status='ready' or a.uploaded_by=auth.uid() end);
$$;
drop policy financial_object_insert on storage.objects;
drop policy financial_object_read on storage.objects;
create policy financial_object_insert on storage.objects for insert to authenticated with check(bucket_id='financial-encrypted' and private.storage_attachment_allowed(name,metadata,true));
create policy financial_object_read on storage.objects for select to authenticated using(bucket_id='financial-encrypted' and private.storage_attachment_allowed(name,metadata,false));
create or replace function public.attachment_finish(target_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.attachments; result jsonb; begin
 perform private.lock_security(); select * into a from public.attachments where id=target_id for update;
 if not found or a.uploaded_by<>auth.uid() or a.encryption_format is distinct from 'aes-256-gcm-v1' or a.status='legacy' or not private.attachment_access(a.entity_type,a.entity_id,a.company_id,true) then raise exception using errcode='42501',message='Attachment access denied'; end if;
 if not exists(select 1 from storage.objects o where o.bucket_id=a.storage_bucket and o.name=a.storage_path and (o.metadata->>'size')::bigint=a.size+32 and o.metadata->>'mimetype'='application/octet-stream') then raise exception using errcode='23514',message='Stored object metadata mismatch'; end if;
 update public.attachments set status='ready' where id=target_id returning to_jsonb(attachments.*) into result;
 return result; end $$;
commit;
