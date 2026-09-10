begin;
create function private.finance_require(p text,c uuid) returns void language plpgsql security definer set search_path='' as $$
begin if c is null or not private.has_company_access(c) or not private.has_permission(p,c) then
 raise exception using errcode='42501',message='Financial permission denied'; end if; end $$;

create function private.capture_dimensions(c uuid,center_id uuid,project uuid,subproject uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; ancestors jsonb; d jsonb; begin
 perform pg_advisory_xact_lock(609090005);
 if not exists(select 1 from public.cost_centers where id=center_id and company_id=c and active and valid_from<=current_date and (valid_to is null or valid_to>=current_date)) then
 raise exception using errcode='23514',message='Active cost center required'; end if;
 if project is not null and not exists(select 1 from public.projects where id=project and company_id=c and status='active') then raise exception using errcode='23514',message='Active project required'; end if;
 if subproject is not null and not exists(select 1 from public.subprojects where id=subproject and company_id=c and project_id=project and status='active') then raise exception using errcode='23514',message='Subproject mismatch'; end if;
 with recursive chain as (select id,parent_id from public.cost_centers where id=center_id and company_id=c
 union all select x.id,x.parent_id from public.cost_centers x join chain a on x.id=a.parent_id and x.company_id=c)
 update public.cost_centers set first_used_at=coalesce(first_used_at,now()) where id in (select id from chain);
 update public.projects set first_used_at=coalesce(first_used_at,now()) where id=project and company_id=c;
 update public.subprojects set first_used_at=coalesce(first_used_at,now()) where id=subproject and company_id=c;
 with recursive chain as (select x.* from public.cost_centers x where id=center_id and company_id=c
 union all select x.* from public.cost_centers x join chain a on x.id=a.parent_id and x.company_id=c)
 select jsonb_agg(to_jsonb(chain)||jsonb_build_object('category',(select to_jsonb(cat) from public.cost_center_categories cat where cat.id=chain.category_id)) order by level) into ancestors from chain;
 result:=jsonb_build_object('cost_centers',ancestors,'project',(select to_jsonb(x) from public.projects x where id=project),'subproject',(select to_jsonb(x) from public.subprojects x where id=subproject));
 insert into public.dimension_versions(company_id,dimension_type,dimension_id,snapshot,created_by) values(c,'cost_center',center_id,result,auth.uid());
 return result;
end $$;

create function private.request_history(rid uuid,act text,prev text,note text) returns void language sql security definer set search_path='' as $$
 insert into public.financial_request_history(company_id,request_id,actor,action,previous_state,new_state,comment,version,snapshot)
 select company_id,id,auth.uid(),act,prev,status,note,version,to_jsonb(r)||jsonb_build_object('items',(select jsonb_agg(i) from public.financial_request_items i where i.request_id=r.id)) from public.financial_requests r where id=rid;
$$;

create function public.financial_save(kind text,target_id uuid,target_company uuid,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tbl text; perm text; allowed text[]; previous jsonb; merged jsonb; result jsonb; k text; cols text; vals text; updates text;
 r public.financial_requests; o public.purchase_orders; doc public.tax_documents; term public.payment_terms; acceptance public.service_acceptances;
 items jsonb; total numeric; sid uuid; snapshot jsonb; base_date date; due date; item jsonb;
begin
 perform private.lock_security();
 case kind
 when 'request' then tbl:='financial_requests';perm:='request';allowed:=array['request_type','cost_center_id','project_id','subproject_id','currency_id','description','justification','required_date','priority','supplier_id','payment_modality','items'];
 when 'supplier' then tbl:='supplier_companies';perm:='supplier';allowed:=array['country_code','tax_id_type','tax_id','legal_name','trade_name','address','phone','email','reuse_identity'];
 when 'supplier_contact' then tbl:='supplier_contacts';perm:='supplier';allowed:=array['supplier_id','name','phone','email'];
 when 'bank_change' then tbl:='supplier_bank_account_changes';perm:='supplier';allowed:=array['supplier_id','account_id','proposed','reason'];
 when 'payment_term' then tbl:='payment_terms';perm:='payment_term';allowed:=array['code','name','days','due_date_basis','end_of_month','active'];
 when 'approval_policy' then tbl:='approval_policies';perm:='approval_policy';allowed:=array['name','request_type','approver_role_id','prevent_self_approval','active'];
 when 'purchase_order' then tbl:='purchase_orders';perm:='purchase_order';allowed:=array['request_id','supplier_id','order_type','description','requires_acceptance','items'];
 when 'service_acceptance' then tbl:='service_acceptances';perm:='service_acceptance';allowed:=array['request_id','order_id','supplier_id','observations'];
 when 'tax_document' then tbl:='tax_documents';perm:='tax_document';allowed:=array['request_id','order_id','supplier_id','document_type','series','number','issue_date','received_date','due_date','currency_id','subtotal','tax_amount','non_taxable_amount','amounts'];
 when 'payable' then tbl:='payables';perm:='payable';allowed:=array['request_id','order_id','supplier_id','tax_document_id','payment_term_id','issue_date','explicit_due_date','acceptance_id'];
 else raise exception using errcode='22023',message='Unknown financial entity'; end case;
 perform private.validate_keys(payload,allowed);
 perform private.finance_require(case when kind='bank_change' then 'supplier.bank_change' when kind='approval_policy' then 'approval_policy.manage'
 when kind='request' and target_id is not null then 'request.edit_own'
 when kind='supplier_contact' then 'supplier.edit' else perm||case when target_id is null then '.create' else '.edit' end end,target_company);
 if target_id is not null then
 execute format('select to_jsonb(t) from public.%I t where id=$1 for update',tbl) into previous using target_id;
 if previous is null then raise exception using errcode='P0002',message='Entity not found'; end if;
 if (previous->>'company_id')::uuid is distinct from target_company then raise exception using errcode='42501',message='Company mismatch'; end if;
 if kind in ('bank_change','payable','service_acceptance') then raise exception using errcode='23514',message='Use controlled transitions'; end if;
 if kind='request' and ((previous->>'requester_id')::uuid<>auth.uid() or previous->>'status' not in ('draft','observed')) then raise exception using errcode='42501',message='Only own editable request'; end if;
 if kind in ('purchase_order','tax_document') and previous->>'status' not in ('draft','observed') then raise exception using errcode='23514',message='Approved content immutable'; end if;
 end if;
 merged:=coalesce(previous,'{}')||payload;
 if kind='request' then
 if merged->>'request_type' in ('advance','reimbursement') then raise exception using errcode='23514',message='Employee advances and reimbursements reserved for Phase 6'; end if;
 if target_id is null then payload:=payload||jsonb_build_object('requester_id',auth.uid(),'area_id',(select area_id from public.profiles where id=auth.uid()),'request_number',private.next_document_number(target_company,'SOL')); end if;
 snapshot:=private.capture_dimensions(target_company,(merged->>'cost_center_id')::uuid,(merged->>'project_id')::uuid,(merged->>'subproject_id')::uuid);
 payload:=payload||jsonb_build_object('dimension_snapshot',snapshot);
 end if;
 if kind in ('request','purchase_order') then
 items:=payload->'items'; payload:=payload-'items';
 if items is null and target_id is null then raise exception using errcode='22023',message='Items required'; end if;
 if items is not null then
 if jsonb_typeof(items)<>'array' or jsonb_array_length(items) not between 1 and 100 then raise exception using errcode='22023',message='Invalid item count'; end if;
 total:=0;
 for item in select value from jsonb_array_elements(items) loop
 perform private.validate_keys(item,array['description','quantity','unit_price']);
 if length(trim(coalesce(item->>'description','')))=0 or (item->>'quantity')::numeric<=0 or (item->>'unit_price')::numeric<0 then raise exception using errcode='23514',message='Invalid item'; end if;
 total:=total+round((item->>'quantity')::numeric*(item->>'unit_price')::numeric,2);
 end loop;
 if total is null or total<=0 then raise exception using errcode='23514',message='Positive total required'; end if;
 payload:=payload||jsonb_build_object(case when kind='request' then 'estimated_amount' else 'total_amount' end,total);
 end if;
 end if;
 if kind='supplier' then
 if target_id is null then
 if coalesce((payload->>'reuse_identity')::boolean,false) then
 select id into sid from public.suppliers where country_code=coalesce(payload->>'country_code','PE') and tax_id_type=payload->>'tax_id_type' and tax_id=payload->>'tax_id' and legal_name=payload->>'legal_name';
 if sid is null then raise exception using errcode='23514',message='Exact legal identity required to link'; end if;
 else
 insert into public.suppliers(country_code,tax_id_type,tax_id,legal_name) values(coalesce(payload->>'country_code','PE'),payload->>'tax_id_type',payload->>'tax_id',payload->>'legal_name') returning id into sid;
 end if;
 payload:=payload||jsonb_build_object('supplier_id',sid);
 else
 sid:=(previous->>'supplier_id')::uuid;
 -- A company operator cannot change shared legal identity for other companies.
 if exists(select 1 from public.suppliers s where s.id=sid and ((payload ? 'legal_name' and payload->>'legal_name'<>s.legal_name) or (payload ? 'tax_id' and payload->>'tax_id'<>s.tax_id) or (payload ? 'tax_id_type' and payload->>'tax_id_type'<>s.tax_id_type) or (payload ? 'country_code' and payload->>'country_code'<>s.country_code))) then
 raise exception using errcode='23514',message='Shared legal identity immutable; operational data is company scoped'; end if;
 end if;
 payload:=payload-array['country_code','tax_id_type','tax_id','legal_name','reuse_identity'];
 end if;
 if kind='bank_change' then
 perform private.validate_keys(payload->'proposed',array['bank_name','currency_id','account_number','cci','account_type','is_primary']);
 if payload->>'account_id' is not null and not exists(select 1 from public.supplier_bank_accounts where id=(payload->>'account_id')::uuid and company_id=target_company and supplier_id=(payload->>'supplier_id')::uuid and status='active') then raise exception using errcode='23514',message='Account mismatch'; end if;
 payload:=payload||jsonb_build_object('requested_by',auth.uid());
 end if;
 if kind in ('purchase_order','service_acceptance','tax_document','payable') then
 select * into r from public.financial_requests where id=(merged->>'request_id')::uuid and company_id=target_company for update;
 if not found or r.status not in ('approved','in_process','completed') then raise exception using errcode='23514',message='Approved request in same company required'; end if;
 if not exists(select 1 from public.supplier_companies where company_id=target_company and supplier_id=(merged->>'supplier_id')::uuid and status='active') then raise exception using errcode='23514',message='Active supplier required'; end if;
 if r.supplier_id is not null and r.supplier_id<>(merged->>'supplier_id')::uuid then raise exception using errcode='23514',message='Approved supplier mismatch'; end if;
 if merged->>'order_id' is not null then
 select * into o from public.purchase_orders where id=(merged->>'order_id')::uuid and company_id=target_company and request_id=r.id and supplier_id=(merged->>'supplier_id')::uuid;
 if not found or o.status in ('draft','pending_approval','cancelled') then raise exception using errcode='23514',message='Approved order mismatch'; end if;
 end if;
 if target_id is null then payload:=payload||jsonb_build_object('created_by',auth.uid()); end if;
 end if;
 if kind='purchase_order' then
 if target_id is null then payload:=payload||jsonb_build_object('order_number',private.next_document_number(target_company,case when merged->>'order_type'='service' then 'OS' else 'OC' end)); end if;
 if total is null then total:=(previous->>'total_amount')::numeric; end if;
 if total+coalesce((select sum(total_amount) from public.purchase_orders where request_id=r.id and status<>'cancelled' and id<>coalesce(target_id,'00000000-0000-0000-0000-000000000000'::uuid)),0)>r.estimated_amount then raise exception using errcode='23514',message='Orders exceed approved request'; end if;
 payload:=payload||jsonb_build_object('currency_id',r.currency_id,'cost_center_id',r.cost_center_id,'project_id',r.project_id,'subproject_id',r.subproject_id,'dimension_snapshot',r.dimension_snapshot);
 end if;
 if kind='tax_document' then
 if (merged->>'currency_id')::uuid<>r.currency_id then raise exception using errcode='23514',message='Currency mismatch'; end if;
 payload:=payload||jsonb_build_object('total_amount',(merged->>'subtotal')::numeric+(merged->>'tax_amount')::numeric+coalesce((merged->>'non_taxable_amount')::numeric,0));
 items:=payload->'amounts'; payload:=payload-'amounts';
 if items is not null then
 total:=0; for item in select value from jsonb_array_elements(items) loop
 perform private.validate_keys(item,array['code','name','amount']); total:=total+(item->>'amount')::numeric; end loop;
 if total is distinct from (merged->>'tax_amount')::numeric then raise exception using errcode='23514',message='Tax breakdown mismatch'; end if;
 end if;
 end if;
 if kind='payable' then
 select * into term from public.payment_terms where id=(payload->>'payment_term_id')::uuid and company_id=target_company and active;
 if not found then raise exception using errcode='23514',message='Active payment term required'; end if;
 if payload->>'tax_document_id' is not null then
 select * into doc from public.tax_documents where id=(payload->>'tax_document_id')::uuid and company_id=target_company and request_id=r.id and supplier_id=(payload->>'supplier_id')::uuid and status='reviewed';
 if not found or doc.document_type='credit_note' or doc.order_id is distinct from (payload->>'order_id')::uuid then raise exception using errcode='23514',message='Reviewed obligation document required'; end if;
 total:=doc.total_amount;
 else
 if r.payment_modality<>'advance' then raise exception using errcode='23514',message='Only authorized supplier advance may precede invoice'; end if;
 total:=coalesce(o.total_amount,r.estimated_amount);
 end if;
 if payload->>'acceptance_id' is not null then
 select * into acceptance from public.service_acceptances where id=(payload->>'acceptance_id')::uuid and company_id=target_company and request_id=r.id and supplier_id=(payload->>'supplier_id')::uuid and order_id is not distinct from (payload->>'order_id')::uuid and status='accepted';
 if not found then raise exception using errcode='23514',message='Acceptance mismatch'; end if;
 end if;
 base_date:=case term.due_date_basis when 'invoice_date' then doc.issue_date when 'document_received_date' then doc.received_date when 'service_acceptance_date' then acceptance.acceptance_date when 'explicit_date' then (payload->>'explicit_due_date')::date end;
 if base_date is null then raise exception using errcode='23514',message='Missing due date basis'; end if;
 due:=case when term.due_date_basis='explicit_date' then base_date when term.end_of_month then (date_trunc('month',base_date+term.days)+interval '1 month - 1 day')::date else base_date+term.days end;
 if coalesce((select sum(original_amount) from public.payables where request_id=r.id and status<>'cancelled'),0)+total>r.estimated_amount then raise exception using errcode='23514',message='Obligations exceed approved amount'; end if;
 payload:=payload-'explicit_due_date'||jsonb_build_object('origin_type',case when doc.id is null then 'approved_obligation' else 'tax_document' end,'origin_id',coalesce(doc.id,r.id),'currency_id',r.currency_id,'original_amount',total,'outstanding_amount',total,'due_date',due,'due_date_basis_date',base_date,'payment_term_snapshot',to_jsonb(term),'requires_acceptance',case when doc.id is null and r.payment_modality='advance' then false else coalesce(o.requires_acceptance,r.request_type='service') end,'cost_center_id',r.cost_center_id,'project_id',r.project_id,'subproject_id',r.subproject_id,'dimension_snapshot',r.dimension_snapshot);
 end if;
 if target_id is null then payload:=payload||jsonb_build_object('company_id',target_company); end if;
 if payload='{}' then raise exception using errcode='22023',message='Empty edit'; end if;
 for k in select jsonb_object_keys(payload) loop
 cols:=concat_ws(',',cols,format('%I',k));vals:=concat_ws(',',vals,format('v.%I',k));updates:=concat_ws(',',updates,format('%I=v.%I',k,k)); end loop;
 if target_id is null then execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I,$1) v returning to_jsonb(%I.*)',tbl,cols,vals,tbl,tbl) into result using payload;
 else execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I,$1) v where t.id=$2 returning to_jsonb(t.*)',tbl,updates,tbl) into result using payload,target_id; end if;
 if kind in ('request','purchase_order') and items is not null then
 tbl:=case when kind='request' then 'financial_request_items' else 'purchase_order_items' end;k:=case when kind='request' then 'request_id' else 'order_id' end;
 execute format('delete from public.%I where %I=$1',tbl,k) using (result->>'id')::uuid;
 execute format('insert into public.%I(company_id,%I,description,quantity,unit_price) select $1,$2,x.description,x.quantity,x.unit_price from jsonb_to_recordset($3) x(description text,quantity numeric,unit_price numeric)',tbl,k) using target_company,(result->>'id')::uuid,items;
 end if;
 if kind='tax_document' and items is not null then
 delete from public.tax_document_amounts where tax_document_id=(result->>'id')::uuid;
 insert into public.tax_document_amounts(company_id,tax_document_id,code,name,amount) select target_company,(result->>'id')::uuid,x.code,x.name,x.amount from jsonb_to_recordset(items) x(code text,name text,amount numeric);
 end if;
 if kind='request' then perform private.request_history((result->>'id')::uuid,case when target_id is null then 'create' else 'edit' end,previous->>'status',null); end if;
 return result;
end $$;

create function public.financial_transition(kind text,target_id uuid,action text,comment text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.financial_requests; pol public.approval_policies; inst public.approval_instances; step public.approval_steps;
 previous jsonb; result jsonb; tbl text; perm text; c uuid; next_status text; s text; bank public.supplier_bank_account_changes; account uuid;
begin
 perform private.lock_security();
 if length(trim(coalesce(comment,''))) not between 1 and 2000 then raise exception using errcode='22023',message='Reason required'; end if;
 case kind when 'request' then tbl:='financial_requests'; when 'purchase_order' then tbl:='purchase_orders'; when 'service_acceptance' then tbl:='service_acceptances'; when 'tax_document' then tbl:='tax_documents'; when 'payable' then tbl:='payables'; when 'bank_change' then tbl:='supplier_bank_account_changes'; when 'supplier' then tbl:='supplier_companies'; else raise exception using errcode='22023',message='Unknown transition'; end case;
 execute format('select to_jsonb(t) from public.%I t where id=$1 for update',tbl) into previous using target_id;
 if previous is null then raise exception using errcode='P0002',message='Entity not found'; end if;
 c:=(previous->>'company_id')::uuid;s:=previous->>'status';
 if kind='request' then
 select * into r from public.financial_requests where id=target_id;
 perm:=case action when 'submit' then 'request.submit' when 'reopen' then 'request.submit' when 'start_review' then 'request.approve' when 'approve' then 'request.approve' when 'observe' then 'request.observe' when 'reject' then 'request.reject' when 'cancel' then 'request.cancel' else null end;
 if perm is null then raise exception using errcode='22023',message='Unknown action'; end if;
 perform private.finance_require(perm,c);
 if action in ('submit','reopen') and (r.requester_id<>auth.uid() or not private.has_permission('request.edit_own',c)) then raise exception using errcode='42501',message='Only requester may submit/reopen'; end if;
 if action='submit' and s in ('draft','observed') then
 select * into pol from public.approval_policies where company_id=c and request_type=r.request_type and active;
 if not found then raise exception using errcode='23514',message='Configure approval policy first'; end if;
 if s='observed' then update public.financial_requests set version=version+1 where id=target_id returning * into r; end if;
 insert into public.approval_instances(company_id,request_id,request_version,policy_snapshot) values(c,r.id,r.version,to_jsonb(pol)) returning * into inst;
 insert into public.approval_steps(company_id,instance_id,approver_role_id) values(c,inst.id,pol.approver_role_id);
 next_status:='submitted';
 elsif action in ('start_review','approve','observe','reject') and s in ('submitted','under_review') then
 if not private.can_review_request(r.id) then raise exception using errcode='42501',message='Configured approver required'; end if;
 select * into inst from public.approval_instances where request_id=r.id and request_version=r.version and status='pending' for update;
 if not found then raise exception using errcode='23514',message='Pending approval required'; end if;
 if coalesce((inst.policy_snapshot->>'prevent_self_approval')::boolean,true) and r.requester_id=auth.uid() then raise exception using errcode='42501',message='Self approval prohibited'; end if;
 if action='start_review' and s='submitted' then next_status:='under_review';
 elsif action in ('approve','observe','reject') and s='under_review' then
 next_status:=case action when 'approve' then 'approved' when 'observe' then 'observed' else 'rejected' end;
 select * into step from public.approval_steps where instance_id=inst.id and status='pending' order by sequence limit 1;
 update public.approval_instances set status=next_status where id=inst.id;
 update public.approval_steps set status=next_status where id=step.id;
 insert into public.approval_actions(company_id,step_id,actor,action,comment,previous_state,new_state) values(c,step.id,auth.uid(),action,comment,s,next_status);
 end if;
 elsif action='reopen' and s='approved' then
 if exists(select 1 from public.purchase_orders where request_id=r.id) or exists(select 1 from public.payables where request_id=r.id) or exists(select 1 from public.tax_documents where request_id=r.id) or exists(select 1 from public.service_acceptances where request_id=r.id) then raise exception using errcode='23514',message='Downstream operations prevent reopening'; end if;
 update public.financial_requests set version=version+1 where id=r.id;
 next_status:='draft';
 elsif action='cancel' and s in ('draft','submitted','under_review','observed','approved') then
 if not private.can_read_request(r.id) then raise exception using errcode='42501',message='Request access required'; end if;
 if exists(select 1 from public.purchase_orders where request_id=r.id and status<>'cancelled') or exists(select 1 from public.payables where request_id=r.id and status<>'cancelled') or exists(select 1 from public.tax_documents where request_id=r.id and status<>'cancelled') then raise exception using errcode='23514',message='Cancel downstream operations first'; end if;
 update public.approval_instances set status='cancelled' where request_id=r.id and status='pending';
 update public.approval_steps set status='cancelled' where instance_id in(select id from public.approval_instances where request_id=r.id and status='cancelled');
 next_status:='cancelled';
 end if;
 elsif kind='purchase_order' then
 perform private.finance_require('purchase_order.'||case action when 'approve' then 'approve' when 'cancel' then 'cancel' else 'edit' end,c);
 next_status:=case when action='submit' and s='draft' then 'pending_approval' when action='approve' and s='pending_approval' then 'approved' when action='send' and s='approved' then 'sent' when action='start' and s='sent' then 'in_progress' when action='partial_receive' and s in ('in_progress','partially_received') then 'partially_received' when action='receive' and s in ('in_progress','partially_received') then 'received' when action='close' and s='received' then 'closed' when action='cancel' and s not in ('closed','cancelled') then 'cancelled' end;
 if action='approve' and (previous->>'created_by')::uuid=auth.uid() then raise exception using errcode='42501',message='Independent order approver required'; end if;
 if action='cancel' and (exists(select 1 from public.payables where order_id=target_id and status<>'cancelled') or exists(select 1 from public.tax_documents where order_id=target_id and status<>'cancelled')) then raise exception using errcode='23514',message='Active downstream obligations'; end if;
 elsif kind='service_acceptance' then
 perform private.finance_require('service_acceptance.'||case when action='accept' then 'accept' else 'observe' end,c);
 next_status:=case when action='accept' and s in ('pending','observed') then 'accepted' when action='observe' and s='pending' then 'observed' when action='reject' and s in ('pending','observed') then 'rejected' end;
 if next_status='accepted' then update public.service_acceptances set accepted_by=auth.uid(),acceptance_date=current_date where id=target_id; end if;
 elsif kind='tax_document' then
 perform private.finance_require('tax_document.'||case when action='cancel' then 'cancel' else 'review' end,c);
 next_status:=case when action='review' and s in ('draft','observed') then 'reviewed' when action='observe' and s='draft' then 'observed' when action='cancel' and s<>'cancelled' then 'cancelled' end;
 if action='cancel' and exists(select 1 from public.payables where tax_document_id=target_id and status<>'cancelled') then raise exception using errcode='23514',message='Cancel payable first'; end if;
 elsif kind='payable' then
 perform private.finance_require('payable.'||action,c);
 next_status:=case when action='review' and s in ('draft','on_hold') then 'under_review' when action='approve' and s='under_review' then 'approved' when action='hold' and s in ('draft','under_review','approved') then 'on_hold' when action='cancel' and s<>'cancelled' then 'cancelled' end;
 if action='approve' and (previous->>'requires_acceptance')::boolean and not exists(select 1 from public.service_acceptances where company_id=c and request_id=(previous->>'request_id')::uuid and supplier_id=(previous->>'supplier_id')::uuid and order_id is not distinct from (previous->>'order_id')::uuid and status='accepted') then raise exception using errcode='23514',message='Accepted service required'; end if;
 elsif kind='supplier' then
 perform private.finance_require('supplier.disable',c); next_status:=case action when 'disable' then 'inactive' when 'enable' then 'active' end;
 elsif kind='bank_change' then
 select * into bank from public.supplier_bank_account_changes where id=target_id;
 perform private.finance_require(case when action='cancel' then 'supplier.bank_change' else 'supplier.bank_change_approve' end,c);
 if s<>'pending' then raise exception using errcode='23514',message='Only pending change'; end if;
 if action='cancel' and bank.requested_by<>auth.uid() then raise exception using errcode='42501',message='Only requester can cancel'; end if;
 if action in ('approve','reject') and bank.requested_by=auth.uid() then raise exception using errcode='42501',message='Independent bank reviewer required'; end if;
 next_status:=case action when 'approve' then 'approved' when 'reject' then 'rejected' when 'cancel' then 'cancelled' end;
 if action='approve' then
 if bank.account_id is not null then
 update public.supplier_bank_accounts set status='superseded',is_primary=false where id=bank.account_id and company_id=c and supplier_id=bank.supplier_id and status='active';
 if not found then raise exception using errcode='23514',message='Stale bank change'; end if;
 end if;
 if coalesce((bank.proposed->>'is_primary')::boolean,false) then update public.supplier_bank_accounts set is_primary=false where company_id=c and supplier_id=bank.supplier_id and currency_id=(bank.proposed->>'currency_id')::uuid and status='active'; end if;
 insert into public.supplier_bank_accounts(company_id,supplier_id,bank_name,currency_id,account_number,cci,account_type,is_primary)
 values(c,bank.supplier_id,bank.proposed->>'bank_name',(bank.proposed->>'currency_id')::uuid,bank.proposed->>'account_number',bank.proposed->>'cci',bank.proposed->>'account_type',coalesce((bank.proposed->>'is_primary')::boolean,false)) returning id into account;
 end if;
 update public.supplier_bank_account_changes set reviewed_by=case when action='cancel' then null else auth.uid() end,reviewed_at=now(),review_comment=comment where id=target_id;
 end if;
 if next_status is null then raise exception using errcode='23514',message='Invalid state transition'; end if;
 execute format('update public.%I set status=$1 where id=$2 returning to_jsonb(%I.*)',tbl,tbl) into result using next_status,target_id;
 -- Transition reasons are separate from automatic row-change audit events.
 insert into public.audit_logs(user_id,action,category,entity_type,entity_id,company_id,new_values) values(auth.uid(),action,'finance',tbl,target_id::text,c,jsonb_build_object('previous_state',s,'new_state',next_status,'comment',comment));
 if kind='request' then perform private.request_history(target_id,action,s,comment); end if;
 return result;
end $$;

create function public.payable_change_due_date(target_id uuid,new_date date,reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.payables; result jsonb; begin
 perform private.lock_security(); select * into p from public.payables where id=target_id for update;
 if not found then raise exception using errcode='P0002',message='Payable not found'; end if;
 perform private.finance_require('payable.review',p.company_id);
 if p.status not in ('draft','under_review','on_hold') or length(trim(coalesce(reason,''))) not between 1 and 2000 then raise exception using errcode='23514',message='Due date change requires review and reason'; end if;
 update public.payables set due_date=new_date,payment_term_snapshot=payment_term_snapshot||jsonb_build_object('override',jsonb_build_object('actor',auth.uid(),'at',now(),'reason',reason,'previous_due_date',due_date,'new_due_date',new_date)) where id=target_id returning to_jsonb(payables.*) into result;
 return result; end $$;

create function public.financial_options(target_company uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_company_access(target_company) or not exists(select 1 from public.permissions p where p.resource in ('request','purchase_order','service_acceptance','tax_document','payable','supplier','approval_policy','payment_term') and private.has_permission(p.code,target_company)) then raise exception using errcode='42501',message='Financial access required'; end if;
 return jsonb_build_object(
 'currencies',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',code||' · '||name)),'[]') from public.currencies where active),
 'cost_centers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',code||' · '||name)),'[]') from public.cost_centers where company_id=target_company and active),
 'projects',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',code||' · '||name)),'[]') from public.projects where company_id=target_company and status='active'),
 'subprojects',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'project_id',project_id,'name',code||' · '||name)),'[]') from public.subprojects where company_id=target_company and status='active'),
 'suppliers',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.tax_id||' · '||s.legal_name)),'[]') from public.suppliers s join public.supplier_companies sc on sc.supplier_id=s.id where sc.company_id=target_company and sc.status='active'),
 'payment_terms',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') from public.payment_terms where company_id=target_company and active),
 'roles',case when private.has_permission('approval_policy.manage',target_company) then (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') from public.roles where active) else '[]'::jsonb end);
end $$;

-- Reports run as INVOKER: aggregate only rows visible through existing policies.
create function public.financial_reports(target_company uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'requests_by_status',(select coalesce(jsonb_agg(x),'[]') from(select status,count(*) as count from public.financial_requests where company_id=target_company group by status) x),
 'requests_by_area',(select coalesce(jsonb_agg(x),'[]') from(select area_id,count(*) as count from public.financial_requests where company_id=target_company group by area_id) x),
 'payables_by_due_date',(select coalesce(jsonb_agg(x),'[]') from(select due_date,currency_id,sum(outstanding_amount) as amount from public.payables where company_id=target_company and status<>'cancelled' group by due_date,currency_id) x),
 'obligations_by_cost_center',(select coalesce(jsonb_agg(x),'[]') from(select cost_center_id,currency_id,dimension_snapshot->'cost_centers' as history,sum(original_amount) as amount from public.payables where company_id=target_company and status<>'cancelled' group by cost_center_id,currency_id,dimension_snapshot->'cost_centers') x),
 'obligations_by_project',(select coalesce(jsonb_agg(x),'[]') from(select project_id,currency_id,dimension_snapshot->'project' as history,sum(original_amount) as amount from public.payables where company_id=target_company and status<>'cancelled' group by project_id,currency_id,dimension_snapshot->'project') x),
 'pending_requests',(select count(*) from public.financial_requests where company_id=target_company and status in ('submitted','under_review','observed')),
 'pending_approvals',(select count(*) from public.financial_requests where company_id=target_company and status in ('submitted','under_review') and private.can_review_request(id)),
 'observed_documents',(select count(*) from public.tax_documents where company_id=target_company and status='observed'),
 'payables_due_soon',(select count(*) from public.payables where company_id=target_company and status<>'cancelled' and due_date<=current_date+7)
 );
$$;
-- Bind identity visibility explicitly; never correlate to the inner relation id.
drop policy supplier_identity_read on public.suppliers;
create policy supplier_identity_read on public.suppliers for select to authenticated using(exists(select 1 from public.supplier_companies sc where sc.supplier_id=suppliers.id and private.has_permission('supplier.view',sc.company_id)));
do $$ declare t text; begin
 foreach t in array array['supplier_companies','supplier_contacts','payment_terms','approval_policies','financial_requests','purchase_orders','service_acceptances','tax_documents','payables'] loop
 execute format('create trigger touch_updated_at before update on public.%I for each row execute function private.touch_updated_at()',t);
 end loop; end $$;
revoke all on function private.finance_require(text,uuid),private.capture_dimensions(uuid,uuid,uuid,uuid),private.request_history(uuid,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.financial_save(text,uuid,uuid,jsonb),public.financial_transition(text,uuid,text,text),public.payable_change_due_date(uuid,date,text),public.financial_options(uuid),public.financial_reports(uuid) from public,anon,service_role;
grant execute on function public.financial_save(text,uuid,uuid,jsonb),public.financial_transition(text,uuid,text,text),public.payable_change_due_date(uuid,date,text),public.financial_options(uuid),public.financial_reports(uuid) to authenticated;
commit;
