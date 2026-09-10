begin;
create function public.import_cost_centers(target_company uuid, rows jsonb, commit_batch boolean default false, update_existing boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare pending jsonb; remaining jsonb; item jsonb; parent uuid; category uuid; existing public.cost_centers;
 payload jsonb; result jsonb; issues jsonb:='[]'; report jsonb:='[]'; code_company text;
 created integer:=0; updated integer:=0; ignored integer:=0; progress boolean; line integer; msg text;
begin
 perform private.lock_security();
 if target_company is null or not private.has_permission('cost_center.create',target_company) then raise exception using errcode='42501',message='Access denied'; end if;
 if rows is null or jsonb_typeof(rows)<>'array' or jsonb_array_length(rows) not between 1 and 200 or commit_batch is null or update_existing is null then raise exception using errcode='22023',message='1 to 200 rows required'; end if;
 select code into code_company from public.companies where id=target_company;
 select coalesce(jsonb_agg(value||jsonb_build_object('_line',ordinality+1)),'[]') into pending from jsonb_array_elements(rows) with ordinality;
 begin
   for item in select value from jsonb_array_elements(pending) loop
     line:=(item->>'_line')::int;
     if jsonb_typeof(item)<>'object' or item->>'company_code' is distinct from code_company then issues:=issues||jsonb_build_object('line',line,'error','Empresa incorrecta'); end if;
     if (select count(*) from jsonb_array_elements(pending) x where x->>'code'=item->>'code')>1 then issues:=issues||jsonb_build_object('line',line,'error','Código duplicado en archivo'); end if;
   end loop;
   if jsonb_array_length(issues)>0 then raise exception using errcode='PZ001',message='preview'; end if;
   while jsonb_array_length(pending)>0 loop
     remaining:='[]'; progress:=false;
     for item in select value from jsonb_array_elements(pending) loop
       line:=(item->>'_line')::int; parent:=null; category:=null;
       if nullif(item->>'parent_code','') is not null then
         select id into parent from public.cost_centers where company_id=target_company and code=item->>'parent_code';
         if parent is null then remaining:=remaining||jsonb_build_array(item); continue; end if;
       end if;
       begin
         if nullif(item->>'category','') is not null then
           select id into category from public.cost_center_categories where company_id=target_company and code=item->>'category' and active;
           if category is null then raise exception using errcode='23514',message='Categoría inexistente o inactiva'; end if;
         end if;
         payload:=jsonb_build_object('code',item->>'code','name',item->>'name','description',nullif(item->>'description',''),'parent_id',parent,'category_id',category,'active',coalesce((item->>'active')::boolean,true));
         select * into existing from public.cost_centers where company_id=target_company and code=item->>'code';
         if found then
           if (to_jsonb(existing) @> payload) then ignored:=ignored+1; report:=report||jsonb_build_object('line',line,'code',item->>'code','result','ignorado');
           elsif update_existing then
             perform public.master_save('cost_center',existing.id,target_company,payload);
             updated:=updated+1; report:=report||jsonb_build_object('line',line,'code',item->>'code','result','actualizado');
           else raise exception using errcode='23514',message='Código existente con diferencias: habilite actualización explícita'; end if;
         else
           perform public.master_save('cost_center',null,target_company,payload);
           created:=created+1; report:=report||jsonb_build_object('line',line,'code',item->>'code','result','creado');
         end if;
       exception when check_violation or not_null_violation or unique_violation or invalid_text_representation or insufficient_privilege then
         get stacked diagnostics msg=message_text;
         issues:=issues||jsonb_build_object('line',line,'error',case when sqlstate='42501' then 'Sin permiso para esta modificación' else 'Datos inválidos, jerarquía, categoría o código en conflicto' end);
       end;
       progress:=true;
     end loop;
     pending:=remaining;
     if not progress then
       for item in select value from jsonb_array_elements(pending) loop issues:=issues||jsonb_build_object('line',(item->>'_line')::int,'error','Padre inexistente o ciclo en archivo'); end loop;
       exit;
     end if;
   end loop;
   if not commit_batch or jsonb_array_length(issues)>0 then raise exception using errcode='PZ001',message='preview'; end if;
 exception when sqlstate 'PZ001' then null; -- Roll back ALL batch writes and audit entries, retaining the validation report.
 end;
 return jsonb_build_object('committed',commit_batch and jsonb_array_length(issues)=0,'created',created,'updated',updated,'ignored',ignored,'errors',issues,'rows',report);
end $$;
revoke all on function public.import_cost_centers(uuid,jsonb,boolean,boolean) from public,anon,service_role;
grant execute on function public.import_cost_centers(uuid,jsonb,boolean,boolean) to authenticated;
commit;
