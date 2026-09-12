begin;
-- Supabase Storage preflight supplies contentLength; persisted objects supply size.
-- Both must exactly equal the authorized attachment size. Missing size still denies.
create or replace function private.storage_attachment_allowed(object_name text,object_metadata jsonb,writing boolean) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.attachments a where a.storage_path=object_name and
 private.attachment_access(a.entity_type,a.entity_id,a.company_id,writing) and
 case when writing then a.uploaded_by=auth.uid() and a.status='pending'
 and coalesce(object_metadata->>'size',object_metadata->>'contentLength')::bigint=a.size
 and object_metadata->>'mimetype'=a.mime_type
 else a.status='ready' or a.uploaded_by=auth.uid() end);
$$;
commit;
