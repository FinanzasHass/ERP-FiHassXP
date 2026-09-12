begin;
-- RPC callers must satisfy the same monetary precision contract as HTTP callers.
create function private.validate_treasury_numbers(data jsonb) returns void language plpgsql immutable set search_path='' as $$
declare k text;v jsonb;n numeric;begin
 if jsonb_typeof(data)='object' then
 for k,v in select * from jsonb_each(data) loop
 if k in ('amount','amount_to_pay','allocated_amount','opening_balance') and not(k='opening_balance' and v='null'::jsonb) then
 if jsonb_typeof(v)<>'number' then raise exception using errcode='22023',message='Monetary values must be JSON numbers';end if;
 n:=(v#>>'{}')::numeric;
 if abs(n)>999999999999.99 or n<>round(n,2) or (k<>'opening_balance' and n<=0) then raise exception using errcode='22023',message='Invalid monetary precision or range';end if;
 else perform private.validate_treasury_numbers(v);end if;
 end loop;
 elsif jsonb_typeof(data)='array' then for v in select * from jsonb_array_elements(data) loop perform private.validate_treasury_numbers(v);end loop;end if;end $$;
alter function public.treasury_save(text,uuid,uuid,jsonb) rename to treasury_save_v5_core;
alter function public.treasury_import(uuid,uuid,text,jsonb,jsonb,boolean) rename to treasury_import_v5_core;
alter function public.treasury_match(uuid,uuid,uuid,uuid,numeric) rename to treasury_match_v5_core;
revoke all on function public.treasury_save_v5_core(text,uuid,uuid,jsonb),public.treasury_import_v5_core(uuid,uuid,text,jsonb,jsonb,boolean),public.treasury_match_v5_core(uuid,uuid,uuid,uuid,numeric) from public,anon,authenticated,service_role;
create function public.treasury_save(kind text,target_id uuid,target_company uuid,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin perform private.validate_treasury_numbers(payload);return public.treasury_save_v5_core(kind,target_id,target_company,payload);end $$;
create function public.treasury_import(target_company uuid,account_id uuid,source_filename text,column_mapping jsonb,rows jsonb,confirm boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$ begin perform private.validate_treasury_numbers(rows);return public.treasury_import_v5_core(target_company,account_id,source_filename,column_mapping,rows,confirm);end $$;
create function public.treasury_match(target_company uuid,period_id uuid,transaction_id uuid,payment_id uuid,match_amount numeric) returns jsonb language plpgsql security definer set search_path='' as $$ begin
 if match_amount is null or match_amount::text in ('NaN','Infinity','-Infinity') or match_amount<=0 or match_amount>999999999999.99 or match_amount<>round(match_amount,2) then raise exception using errcode='22023',message='Invalid matching amount';end if;
 return public.treasury_match_v5_core(target_company,period_id,transaction_id,payment_id,match_amount);end $$;
revoke all on function private.validate_treasury_numbers(jsonb),public.treasury_save(text,uuid,uuid,jsonb),public.treasury_import(uuid,uuid,text,jsonb,jsonb,boolean),public.treasury_match(uuid,uuid,uuid,uuid,numeric) from public,anon,service_role;
grant execute on function public.treasury_save(text,uuid,uuid,jsonb),public.treasury_import(uuid,uuid,text,jsonb,jsonb,boolean),public.treasury_match(uuid,uuid,uuid,uuid,numeric) to authenticated;
commit;
