import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function phase4Checks({db,rpc,asUser,scalar,test,admin}) {
 const c=randomUUID(), b=randomUUID(), owner=randomUUID(), reviewer=randomUUID(), outsider=randomUUID();
 for(const [id,code] of [[c,'F4A'],[b,'F4B']]) await db.query("insert into public.companies(id,code,legal_name,tax_id,country_code) values($1,$2,$2,$2,'PE')",[id,code]);
 for(const [id,name] of [[owner,'f4owner'],[reviewer,'f4reviewer'],[outsider,'f4outsider']]) {
  await db.query('insert into auth.users values($1,$2)',[id,name+'@example.test']);await db.query('insert into auth.sessions values($1,$1)',[id]);
  await db.query("insert into public.profiles(id,email,username,full_name,status) values($1,$2,$3,$3,'active')",[id,name+'@example.test',name]);
  await rpc(admin,'admin_set_membership',[id,c,true]);
 }
 const role=await rpc(admin,'admin_save_entity',['role',null,{code:'phase4_operator',name:'Phase4 synthetic operator'}]);
 const permissions=(await db.query("select id from public.permissions where resource in ('request','supplier','purchase_order','service_acceptance','tax_document','payable','payment_term','approval_policy','cost_center','project','subproject') and active")).rows.map(x=>x.id);
 await rpc(admin,'admin_set_role_permissions',[role.id,permissions]);
 for(const id of [owner,reviewer]) await rpc(admin,'admin_set_user_role',[id,role.id,c,true]);
 const save=(user,kind,payload,id=null,company=c)=>rpc(user,'financial_save',[kind,id,company,payload]);
 const trans=(user,kind,id,action)=>rpc(user,'financial_transition',[kind,id,action,'Motivo sintético de prueba']);
 const currency=await scalar("select id from public.currencies where code='PEN'");
 const center=await rpc(owner,'master_save',['cost_center',null,c,{code:'F4ROOT',name:'Centro F4'}]);
 const project=await rpc(owner,'master_save',['project',null,c,{code:'F4PROJECT',name:'Proyecto F4'}]);
 const sub=await rpc(owner,'master_save',['subproject',null,c,{code:'F4SUB',name:'Subproyecto F4',project_id:project.id}]);
 const base={request_type:'service',cost_center_id:center.id,project_id:project.id,subproject_id:sub.id,currency_id:currency,description:'Servicio sintético',justification:'Prueba',required_date:'2026-09-10',payment_modality:'credit',items:[{description:'Servicio',quantity:1,unit_price:100}]};
 let request,supplier,policy,document,payable,acceptance;
 await test('F4 no automatic financial grants to System Administrator',async()=>{
  assert.equal(await rpc(admin,'has_permission',['request.create',c]),false);
  await assert.rejects(()=>save(admin,'request',base),/denied/);
 });
 await test('F4 first use, snapshot, project history are transactional',async()=>{
  await assert.rejects(()=>save(owner,'request',{...base,items:[{description:'Invalid',quantity:0,unit_price:100}]}));
  assert.equal(await scalar('select first_used_at from public.cost_centers where id=$1',[center.id]),null);
  request=await save(owner,'request',base); assert.match(request.request_number,/^SOL-\d{4}-\d{6}$/);
  assert.ok(await scalar('select first_used_at from public.cost_centers where id=$1',[center.id]));
  assert.ok(await scalar('select first_used_at from public.projects where id=$1',[project.id]));
  await assert.rejects(()=>rpc(owner,'master_save',['cost_center',center.id,c,{code:'CHANGED'}]),/protected/);
  await rpc(owner,'master_save',['cost_center',center.id,c,{name:'Nombre nuevo'}]);
  assert.equal(request.dimension_snapshot.cost_centers[0].name,'Centro F4');
  assert.equal(await scalar('select count(*)::int from public.dimension_versions where company_id=$1',[c]),1);
 });
 await test('F4 company A cannot read B, REST writes denied, inactive JWT denied',async()=>{
  await assert.rejects(()=>save(owner,'request',base,null,b),/denied/);
  assert.equal((await asUser(outsider,'select * from public.financial_requests')).rows.length,0);
  await assert.rejects(()=>asUser(owner,"update public.financial_requests set status='approved'"),/permission denied/);
  await rpc(admin,'admin_set_profile_status',[owner,'blocked']);
  await assert.rejects(()=>save(owner,'request',base),/Active profile required/);
  await rpc(admin,'admin_set_profile_status',[owner,'active']);
 });
 await test('F4 own and area request visibility use permissions, not job titles',async()=>{
  const area=await rpc(admin,'admin_save_entity',['area',null,{name:'F4 area',code:'F4AREA'}]);
  await rpc(admin,'admin_update_profile',[owner,{area_id:area.id}]);await rpc(admin,'admin_update_profile',[outsider,{area_id:area.id}]);
  const areaRole=await rpc(admin,'admin_save_entity',['role',null,{code:'f4_area',name:'F4 area reader'}]);
  await rpc(admin,'admin_set_role_permissions',[areaRole.id,[(await db.query("select id from public.permissions where code='request.view_area'")).rows[0].id]]);
  await rpc(admin,'admin_set_user_role',[outsider,areaRole.id,c,true]);
  const ar=await save(owner,'request',base);
  assert.deepEqual((await asUser(outsider,'select id from public.financial_requests order by id')).rows,[{id:ar.id}]);
  await rpc(admin,'admin_set_user_role',[outsider,areaRole.id,c,false]);
  const ownCodes=(await db.query("select id from public.permissions where code in ('request.view_own','request.create')")).rows.map(p=>p.id);
  await rpc(admin,'admin_set_role_permissions',[areaRole.id,ownCodes]);await rpc(admin,'admin_set_user_role',[outsider,areaRole.id,c,true]);
  const own=await save(outsider,'request',base);
  assert.deepEqual((await asUser(outsider,'select id from public.financial_requests')).rows,[{id:own.id}]);
  await rpc(admin,'admin_set_user_role',[outsider,areaRole.id,c,false]);
  assert.equal((await asUser(outsider,'select id from public.financial_requests')).rows.length,0);
 });
 await test('F4 approval requires configured policy, role, own segregation and valid transition',async()=>{
  await assert.rejects(()=>trans(owner,'request',request.id,'submit'),/Configure approval policy/);
  policy=await save(owner,'approval_policy',{name:'Synthetic review',request_type:'service',approver_role_id:role.id});
  await trans(owner,'request',request.id,'submit');
  await assert.rejects(()=>trans(outsider,'request',request.id,'start_review'),/denied/);
  await assert.rejects(()=>trans(owner,'request',request.id,'start_review'),/Self approval/);
  await assert.rejects(()=>trans(reviewer,'request',request.id,'approve'),/Invalid state/);
  await trans(reviewer,'request',request.id,'start_review');await trans(reviewer,'request',request.id,'observe');
  await save(owner,'request',{description:'Atención a observación'},request.id);
  await trans(owner,'request',request.id,'submit');await trans(reviewer,'request',request.id,'start_review');
  request=await trans(reviewer,'request',request.id,'approve');assert.equal(request.version,2);
  await assert.rejects(()=>save(owner,'request',{description:'Cambio silencioso'},request.id),/Only own editable/);
 });
 await test('F4 supplier legal uniqueness and cross-company relationships',async()=>{
  supplier=await save(owner,'supplier',{tax_id_type:'other',tax_id:'SYNTH-F4',legal_name:'Proveedor sintético'});
  await assert.rejects(()=>save(owner,'supplier',{tax_id_type:'other',tax_id:'SYNTH-F4',legal_name:'Duplicado'}),/unique constraint/);
  await assert.rejects(()=>save(owner,'supplier',{tax_id_type:'ruc',tax_id:'123',legal_name:'Inválido'}),/check constraint/);
 });
 await test('F4 bank proposals cannot mutate accounts or approve themselves',async()=>{
  const change=await save(owner,'bank_change',{supplier_id:supplier.supplier_id,reason:'Cuenta de prueba',proposed:{bank_name:'Banco sintético',currency_id:currency,account_number:'000000000012',account_type:'checking',is_primary:true}});
  assert.equal(await scalar('select count(*)::int from public.supplier_bank_accounts where company_id=$1',[c]),0);
  await assert.rejects(()=>trans(owner,'bank_change',change.id,'approve'),/Independent bank reviewer/);
  await trans(reviewer,'bank_change',change.id,'approve');
  assert.equal(await scalar('select count(*)::int from public.supplier_bank_accounts where company_id=$1',[c]),1);
  await assert.rejects(()=>trans(reviewer,'bank_change',change.id,'approve'),/Only pending/);
 });
 await test('F4 orders use approved request, totals and independent approval',async()=>{
  const order=await save(owner,'purchase_order',{request_id:request.id,supplier_id:supplier.supplier_id,order_type:'service',description:'OS sintética',items:base.items});
  assert.match(order.order_number,/^OS-/);
  await trans(owner,'purchase_order',order.id,'submit');
  await assert.rejects(()=>trans(owner,'purchase_order',order.id,'approve'),/Independent order approver/);
  await trans(reviewer,'purchase_order',order.id,'approve');
  await assert.rejects(()=>save(owner,'purchase_order',{description:'Cambio'},order.id),/Approved content/);
  await trans(owner,'purchase_order',order.id,'cancel');
 });
 await test('F4 duplicate invoice constraint includes normalized numeric document number',async()=>{
  const payload={request_id:request.id,supplier_id:supplier.supplier_id,document_type:'invoice',series:'F001',number:'000123',issue_date:'2026-09-10',received_date:'2026-09-10',currency_id:currency,subtotal:100,tax_amount:0};
  document=await save(owner,'tax_document',payload);
  await assert.rejects(()=>save(owner,'tax_document',{...payload,number:'123'}),/unique constraint/);
  await trans(reviewer,'tax_document',document.id,'review');
 });
 await test('F4 credit 30 days derives October 10; service acceptance blocks approval',async()=>{
  const term=await save(owner,'payment_term',{code:'C30',name:'Crédito 30',days:30,due_date_basis:'invoice_date'});
  payable=await save(owner,'payable',{request_id:request.id,supplier_id:supplier.supplier_id,tax_document_id:document.id,payment_term_id:term.id,issue_date:'2026-09-10'});
  assert.equal(payable.due_date,'2026-10-10');assert.equal(Number(payable.outstanding_amount),100);
  await trans(reviewer,'payable',payable.id,'review');
  await assert.rejects(()=>trans(reviewer,'payable',payable.id,'approve'),/Accepted service required/);
  acceptance=await save(owner,'service_acceptance',{request_id:request.id,supplier_id:supplier.supplier_id,observations:'Evidencia sintética'});
  await trans(reviewer,'service_acceptance',acceptance.id,'accept');
  await trans(reviewer,'payable',payable.id,'approve');
  await assert.rejects(()=>trans(owner,'request',request.id,'reopen'),/Downstream/);
  await assert.rejects(()=>trans(owner,'payable',payable.id,'paid'),/denied/);
 });
 await test('F4 supplier advance without invoice and explicit due date',async()=>{
  const advance=await save(owner,'request',{...base,payment_modality:'advance'});
  await trans(owner,'request',advance.id,'submit');await trans(reviewer,'request',advance.id,'start_review');await trans(reviewer,'request',advance.id,'approve');
  const term=await save(owner,'payment_term',{code:'EXPLICIT',name:'Fecha explícita',due_date_basis:'explicit_date'});
  const p=await save(owner,'payable',{request_id:advance.id,supplier_id:supplier.supplier_id,payment_term_id:term.id,issue_date:'2026-09-10',explicit_due_date:'2026-09-15'});
  assert.equal(p.tax_document_id,null);assert.equal(p.due_date,'2026-09-15');assert.equal(p.requires_acceptance,false);
  await rpc(reviewer,'payable_change_due_date',[p.id,'2026-09-16','Acuerdo sintético']);
  await trans(reviewer,'payable',p.id,'review');await trans(reviewer,'payable',p.id,'approve');
 });
 await test('F4 attachments reject prohibited files, wrong company, missing object',async()=>{
  const draft=await save(owner,'request',base);
  await assert.rejects(()=>rpc(owner,'attachment_prepare',[b,'request',draft.id,'evidence.pdf','application/pdf',10]),/denied/);
  await assert.rejects(()=>rpc(owner,'attachment_prepare',[c,'request',draft.id,'run.exe','application/pdf',10]),/prohibited/);
  const att=await rpc(owner,'attachment_prepare',[c,'request',draft.id,'evidence.pdf','application/pdf',10]);
  assert.equal(await scalar('select private.storage_attachment_allowed($1,$2,true)',[att.storage_path,{contentLength:42,mimetype:'application/octet-stream'}]),false); // no authenticated session
  assert.equal((await asUser(owner,'select private.storage_attachment_allowed($1,$2,true) as allowed',[att.storage_path,{contentLength:42,mimetype:'application/octet-stream'}])).rows[0].allowed,true);
  assert.equal((await asUser(owner,'select private.storage_attachment_allowed($1,$2,true) as allowed',[att.storage_path,{contentLength:43,mimetype:'application/octet-stream'}])).rows[0].allowed,false);
  assert.equal((await asUser(owner,'select private.storage_attachment_allowed($1,$2,true) as allowed',[att.storage_path,{mimetype:'application/pdf'}])).rows[0].allowed,false);
  await assert.rejects(()=>rpc(owner,'attachment_finish',[att.id]),/metadata mismatch/);
  await assert.rejects(()=>asUser(outsider,'insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',['financial-encrypted',att.storage_path,{size:42,mimetype:'application/octet-stream'}]),/row-level security/);
  await asUser(owner,'insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',['financial-encrypted',att.storage_path,{size:42,mimetype:'application/octet-stream'}]);
  await rpc(owner,'attachment_finish',[att.id]);
  await rpc(admin,'admin_set_membership',[owner,c,false]);
  assert.equal((await asUser(owner,'select id from storage.objects')).rows.length,0);
  await rpc(admin,'admin_set_membership',[owner,c,true]);
 });
 await test('F4 financial audit includes actor/company; bank secrets excluded; reports use RLS',async()=>{
  assert.ok(await scalar("select count(*)::int from public.audit_logs where company_id=$1 and category='finance' and user_id=$2",[c,owner]));
  assert.equal(await scalar("select count(*)::int from public.audit_logs where company_id=$1 and entity_type='supplier_bank_accounts' and new_values ? 'account_number'",[c]),0);
  const reports=await rpc(outsider,'financial_reports',[c]);assert.equal(reports.pending_requests,0);assert.deepEqual(reports.payables_by_due_date,[]);
  assert.ok((await rpc(owner,'financial_reports',[c])).payables_by_due_date.length>0);
 });
 return {c,b,owner,reviewer,outsider,role,currency,supplier};
}
