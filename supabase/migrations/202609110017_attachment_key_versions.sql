begin;
alter table public.attachments add column encryption_algorithm text;
alter table public.attachments add column encryption_key_version text;
update public.attachments set encryption_algorithm='AES-256-GCM',encryption_key_version='V1' where encryption_format='aes-256-gcm-v1';
alter table public.attachments alter column encryption_algorithm set default 'AES-256-GCM';
alter table public.attachments alter column encryption_key_version set default 'V1';
alter table public.attachments add constraint encryption_version_valid check(encryption_key_version is null or encryption_key_version ~ '^V[1-9][0-9]*$');
alter table public.attachments add constraint encryption_metadata_required check(status='legacy' or (encryption_algorithm is not distinct from 'AES-256-GCM' and encryption_key_version is not null));
-- Nonce (12 bytes) and authentication tag (16 bytes) remain in the authenticated
-- ERP1 envelope, offsets 4:16 and 16:32. They are not keys. No secret stored in SQL.
create function public.attachment_prepare_versioned(target_company uuid,kind text,target_id uuid,filename text,mime_type text,file_size integer,key_version text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a jsonb; begin
 if key_version is null or key_version !~ '^V[1-9][0-9]*$' then raise exception using errcode='22023',message='Invalid key version'; end if;
 a:=public.attachment_prepare(target_company,kind,target_id,filename,mime_type,file_size);
 update public.attachments set encryption_key_version=key_version where id=(a->>'id')::uuid returning to_jsonb(attachments.*) into a;
 return a; end $$;
revoke all on function public.attachment_prepare_versioned(uuid,text,uuid,text,text,integer,text) from public,anon,service_role;
grant execute on function public.attachment_prepare_versioned(uuid,text,uuid,text,text,integer,text) to authenticated;
commit;
