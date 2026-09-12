import {createClient} from '@supabase/supabase-js';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {createApp} from '../src/server/app.js';
import {readConfig} from '../src/server/config/env.js';
import {createAuthentication} from '../src/server/services/authentication.js';
import {createPrivilegedAuth} from '../src/server/integrations/supabase/auth-admin.js';
import {createSessionRepository} from '../src/server/repositories/session-repository.js';
const cfg=readConfig(process.env),dir='docs/fase-4',tag='F4_'+new Date().toISOString().replace(/\D/g,'').slice(0,14);
if(cfg.NODE_ENV==='production'||!['localhost','127.0.0.1'].includes(new URL(cfg.APP_ORIGIN).hostname))throw new Error('DEV verification only');
const ref=(await readFile('supabase/.temp/project-ref','utf8')).trim();if(new URL(cfg.SUPABASE_URL).hostname!==ref+'.supabase.co')throw new Error('DEV project mismatch');
const migration=JSON.parse(await readFile(dir+'/migraciones-dev.json','utf8'));if(migration.status!=='PASS')throw new Error('Apply and verify DEV migrations first');
const previous=JSON.parse(await readFile('docs/fase-3.1/fixtures-dev.json','utf8'));
const privileged=createClient(cfg.SUPABASE_URL,cfg.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const normal=createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
class ProofError extends Error{}
const assert=(v:unknown,message:string)=>{if(!v)throw new ProofError(message);};
const report:any={run:tag,startedAt:new Date().toISOString(),environment:'DEV',sameProjectAsApplication:true,results:[],fixtures:{companies:[],roles:[],users:previous.users.map((u:any)=>({id:u.id,kind:u.kind}))}};
await mkdir(dir+'/capturas',{recursive:true});
let server:any,browser:any,browserServer:any;const tokens:string[]=[];
async function persist(){report.updatedAt=new Date().toISOString();report.summary={pass:report.results.filter((r:any)=>r.status==='PASS').length,fail:report.results.filter((r:any)=>r.status==='FAIL').length};await writeFile(dir+'/resultado-dev.json',JSON.stringify(report,null,2));}
async function test(name:string,fn:()=>Promise<void>){try{await fn();report.results.push({name,status:'PASS'});console.log('PASS '+name);}catch(e){report.results.push({name,status:'FAIL',evidence:e instanceof ProofError?e.message:'Detalle sensible omitido; revisar la operación indicada.'});console.log('FAIL '+name);throw e;}finally{await persist();}}
async function session(id:string){const u=await privileged.auth.admin.getUserById(id);assert(!u.error,'Auth identity unavailable');const l=await privileged.auth.admin.generateLink({type:'magiclink',email:u.data.user!.email!});assert(!l.error,'Auth link unavailable');const r=await normal.auth.verifyOtp({type:'magiclink',token_hash:l.data.properties.hashed_token});assert(!r.error&&r.data.session,'Auth session unavailable');tokens.push(r.data.session!.access_token);return r.data.session!.access_token;}
async function call(token:string,path:string,method='GET',body?:unknown,expected?:number){await new Promise(r=>setTimeout(r,520));const response=await fetch(cfg.APP_ORIGIN+'/api'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=response.status===204?null:await response.json();if(expected!==undefined)assert(response.status===expected,`${method} ${path.split('?')[0]} expected ${expected}, received ${response.status}`);else assert(response.ok,`${method} ${path.split('?')[0]} failed ${response.status}: ${String(data?.error||'UNKNOWN')}`);return data;}
async function list(token:string,path:string){const rows:any[]=[];for(let page=1;page<=30;page++){const r=await call(token,path+(path.includes('?')?'&':'?')+'limit=100&page='+page);rows.push(...r.data);if(rows.length>=r.count)break;}return rows;}
const rest=(token:string)=>createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY,{global:{headers:{Authorization:'Bearer '+token}},auth:{persistSession:false,autoRefreshToken:false}});
try{
 const app=createApp(cfg,{auth:createAuthentication(cfg),privileged:createPrivilegedAuth(cfg),repository:t=>createSessionRepository(cfg,t)});
 await new Promise<void>((resolve,reject)=>{server=app.listen(cfg.PORT,'127.0.0.1',resolve);server.once('error',()=>reject(new ProofError('Local port unavailable')));});
 const admin=await session(previous.initialAdministrator),ownerId=previous.users.find((u:any)=>u.kind==='solicitante').id,reviewerId=previous.users.find((u:any)=>u.kind==='aprobador').id;
 const owner=await session(ownerId),reviewer=await session(reviewerId);
 let A:any,B:any,role:any,center:any,project:any,sub:any,currency:any,supplier:any,request:any,doc:any,payable:any,term:any,advance:any,attachment:any,order:any;
 const post=(token:string,path:string,body:any)=>call(token,'/'+path+'?company_id='+A.id,'POST',body);
 const action=(token:string,path:string,id:string,action:string,status?:number)=>call(token,'/'+path+'/'+id+'/actions','POST',{action,comment:'Verificación sintética '+tag},status);
 await test('Setup sintético por API; sin grants de migración ni ejecución financiera del administrador',async()=>{
  A=await call(admin,'/companies','POST',{code:tag+'_A',legal_name:'DEV sintética Fase 4 A '+tag,tax_id:tag+'A',country_code:'PE'});B=await call(admin,'/companies','POST',{code:tag+'_B',legal_name:'DEV sintética Fase 4 B '+tag,tax_id:tag+'B',country_code:'PE'});report.fixtures.companies=[{id:A.id,code:A.code},{id:B.id,code:B.code}];
  for(const id of [ownerId,reviewerId])await call(admin,'/users/'+id+'/companies','PUT',{company_id:A.id,active:true});
  const ps=await list(admin,'/permissions');const resources=['request','supplier','purchase_order','service_acceptance','tax_document','payable','payment_term','approval_policy','cost_center','project','subproject'];
  role=await call(admin,'/roles','POST',{code:tag.toLowerCase(),name:'Operador sintético '+tag});report.fixtures.roles=[role.id];
  await call(admin,'/roles/'+role.id+'/permissions','PUT',{permission_ids:ps.filter(p=>p.active&&resources.includes(p.resource)).map(p=>p.id)});
  for(const id of [ownerId,reviewerId])await call(admin,'/users/'+id+'/roles','PUT',{role_id:role.id,company_id:A.id,assign:true});
  const me=await call(admin,'/auth/me');assert(!me.permissions.some((p:any)=>p.code==='payment.execute'),'Administrator financial execution grant');
  const opts=await call(owner,'/finance/options?company_id='+A.id);currency=opts.currencies[0];
 });
 await test('A no lee B y REST directo no permite crear ni aprobar solicitudes',async()=>{
  await call(owner,'/financial-requests?company_id='+B.id,'GET',undefined,403);
  const r=await rest(owner).from('financial_requests').select('id').eq('company_id',B.id);assert(!r.error&&r.data.length===0,'Cross-company REST rows');
  const write=await rest(owner).from('financial_requests').insert({company_id:A.id,status:'approved'});assert(!!write.error,'Direct REST write accepted');
 });
 await test('CECO/proyecto/subproyecto y primer uso transaccional',async()=>{
  center=await post(owner,'cost-centers',{code:tag+'_CC',name:'CECO sintético Fase 4'});project=await post(owner,'projects',{code:tag+'_P',name:'Proyecto sintético Fase 4'});sub=await post(owner,'subprojects',{code:tag+'_S',name:'Subproyecto sintético Fase 4',project_id:project.id});
  assert(center.first_used_at===null,'Unexpected first use');
 });
 const base=()=>({request_type:'service',cost_center_id:center.id,project_id:project.id,subproject_id:sub.id,currency_id:currency.id,description:'Servicio sintético '+tag,justification:'Validación del circuito DEV',required_date:'2026-09-10',payment_modality:'credit',items:[{description:'Servicio de prueba',quantity:1,unit_price:100}]});
 await test('Solicitud e historial; CECO usado no permite cambio de código',async()=>{
  request=await post(owner,'financial-requests',base());report.fixtures.request=request.id;assert(/^SOL-\d{4}-\d{6}$/.test(request.request_number),'Invalid numbering');
  const centers=await list(owner,'/cost-centers?company_id='+A.id);assert(centers.find(x=>x.id===center.id)?.first_used_at,'First use absent');
  await call(owner,'/cost-centers/'+center.id+'?company_id='+A.id,'PATCH',{code:'CHANGED'},409);
  await call(owner,'/cost-centers/'+center.id+'?company_id='+A.id,'PATCH',{name:'Nombre futuro Fase 4'});
  assert(request.dimension_snapshot.cost_centers[0].name==='CECO sintético Fase 4','Historical name mutated');
 });
 await test('Aprobación configurada, autoaprobación prohibida, transición inválida y observación versionada',async()=>{
  await post(owner,'approval-policies',{name:'Revisión sintética',request_type:'service',approver_role_id:role.id});
  await action(owner,'financial-requests',request.id,'submit');
  await action(owner,'financial-requests',request.id,'start_review',403);
  await action(reviewer,'financial-requests',request.id,'approve',409);
  await action(reviewer,'financial-requests',request.id,'start_review');await action(reviewer,'financial-requests',request.id,'observe');
  await call(owner,'/financial-requests/'+request.id+'?company_id='+A.id,'PATCH',{description:'Servicio corregido '+tag});
  await action(owner,'financial-requests',request.id,'submit');await action(reviewer,'financial-requests',request.id,'start_review');request=await action(reviewer,'financial-requests',request.id,'approve');
  assert(request.version===2,'Observed resubmission did not preserve version');
  await call(owner,'/financial-requests/'+request.id+'?company_id='+A.id,'PATCH',{description:'Silencioso'},403);
 });
 await test('Proveedor compartible por identidad y duplicado rechazado',async()=>{
  supplier=await post(owner,'suppliers',{tax_id_type:'other',tax_id:tag,legal_name:'Proveedor sintético '+tag});report.fixtures.supplier=supplier.supplier_id;
  await call(owner,'/suppliers?company_id='+A.id,'POST',{tax_id_type:'other',tax_id:tag,legal_name:'Duplicado'},409);
 });
 await test('Cuenta bancaria pendiente no activa; aprobación independiente',async()=>{
  const change=await post(owner,'bank-changes',{supplier_id:supplier.supplier_id,reason:'Titular sintético verificado',proposed:{bank_name:'Banco de prueba',currency_id:currency.id,account_number:'000000000012',account_type:'checking',is_primary:true}});
  assert((await list(owner,'/supplier-bank-accounts?company_id='+A.id)).length===0,'Pending account became active');
  await action(owner,'bank-changes',change.id,'approve',403);await action(reviewer,'bank-changes',change.id,'approve');
  assert((await list(owner,'/supplier-bank-accounts?company_id='+A.id)).length===1,'Approved account absent');
 });
 await test('Orden de servicio, separación de aprobación y prohibición de edición posterior',async()=>{
  order=await post(owner,'purchase-orders',{request_id:request.id,supplier_id:supplier.supplier_id,order_type:'service',description:'OS DEV',requires_acceptance:true,items:base().items});
  assert(order.order_number.startsWith('OS-'),'Order prefix');await action(owner,'purchase-orders',order.id,'submit');await action(owner,'purchase-orders',order.id,'approve',403);await action(reviewer,'purchase-orders',order.id,'approve');
  await call(owner,'/purchase-orders/'+order.id+'?company_id='+A.id,'PATCH',{description:'Cambio'},409);
  for(const x of ['send','start','receive','close'])await action(owner,'purchase-orders',order.id,x);
 });
 await test('Comprobante duplicado protegido en base de datos',async()=>{
  const payload={request_id:request.id,order_id:order.id,supplier_id:supplier.supplier_id,document_type:'invoice',series:'F001',number:'0001',issue_date:'2026-09-10',received_date:'2026-09-10',currency_id:currency.id,subtotal:100,tax_amount:0};
  doc=await post(owner,'tax-documents',payload);await call(owner,'/tax-documents?company_id='+A.id,'POST',{...payload,number:'1'},409);await action(reviewer,'tax-documents',doc.id,'review');
 });
 await test('CxP a 30 días y conformidad obligatoria',async()=>{
  term=await post(owner,'payment-terms',{code:'C30',name:'Crédito 30',days:30,due_date_basis:'invoice_date'});
  payable=await post(owner,'payables',{request_id:request.id,order_id:order.id,supplier_id:supplier.supplier_id,tax_document_id:doc.id,payment_term_id:term.id,issue_date:'2026-09-10'});report.fixtures.payable=payable.id;
  assert(payable.due_date==='2026-10-10','Wrong due date');await action(reviewer,'payables',payable.id,'review');await action(reviewer,'payables',payable.id,'approve',409);
  const acceptance=await post(owner,'service-acceptances',{request_id:request.id,order_id:order.id,supplier_id:supplier.supplier_id,observations:'Servicio sintético terminado'});await action(reviewer,'service-acceptances',acceptance.id,'accept');await action(reviewer,'payables',payable.id,'approve');
  await action(owner,'financial-requests',request.id,'reopen',409);
 });
 await test('Anticipado sin factura, fecha explícita y ausencia de estado PAID',async()=>{
  advance=await post(owner,'financial-requests',{...base(),payment_modality:'advance'});await action(owner,'financial-requests',advance.id,'submit');await action(reviewer,'financial-requests',advance.id,'start_review');await action(reviewer,'financial-requests',advance.id,'approve');
  const t=await post(owner,'payment-terms',{code:'EXPLICIT',name:'Fecha explícita',due_date_basis:'explicit_date'});const p=await post(owner,'payables',{request_id:advance.id,supplier_id:supplier.supplier_id,payment_term_id:t.id,issue_date:'2026-09-10',explicit_due_date:'2026-09-15'});
  assert(p.tax_document_id===null&&p.due_date==='2026-09-15'&&!p.requires_acceptance,'Advance obligation incorrect');await call(owner,'/payables/'+p.id+'/actions','POST',{action:'paid',comment:'Fuera de fase'},400);
 });
 await test('Storage privado, upload y download reales; empresa y extensión incorrectas rechazadas',async()=>{
  const draft=await post(owner,'financial-requests',base());const body={company_id:A.id,entity_type:'request',entity_id:draft.id,filename:'evidencia.pdf',mime_type:'application/pdf',base64:Buffer.from('%PDF-1.4\nEvidencia sintetica DEV\n%%EOF').toString('base64')};
  await call(owner,'/attachments/upload','POST',{...body,filename:'run.exe'},400);await call(owner,'/attachments/upload','POST',{...body,company_id:B.id},403);
  attachment=await call(owner,'/attachments/upload','POST',body);assert(attachment.status==='ready','Attachment not ready');
  const file=await call(owner,'/attachments/'+attachment.id+'/download');assert(file.base64===body.base64,'Download mismatch');
  const invalid=await rest(owner).storage.from('financial-encrypted').upload(B.id+'/arbitrary.enc',Buffer.from('ERP1 synthetic'),{contentType:'application/octet-stream'});assert(!!invalid.error,'Storage wrong company accepted');
 });
 await test('Bloqueo y revocación invalidan sesión existente, REST y archivos',async()=>{
  await call(admin,'/users/'+ownerId+'/status','PUT',{status:'blocked'});await call(owner,'/financial-requests?company_id='+A.id,'GET',undefined,403);const r=await rest(owner).from('financial_requests').select('id').eq('company_id',A.id);assert(!r.error&&r.data.length===0,'Inactive REST read');await call(admin,'/users/'+ownerId+'/status','PUT',{status:'active'});
  await call(admin,'/users/'+ownerId+'/companies','PUT',{company_id:A.id,active:false});
  try{await call(owner,'/attachments/'+attachment.id+'/download','GET',undefined,404);const files=await rest(owner).storage.from('financial-encrypted').download(attachment.storage_path);if(files.data){const bytes=Buffer.from(await files.data.arrayBuffer());assert(bytes.subarray(0,4).toString()==='ERP1'&&!bytes.includes(Buffer.from('%PDF-')),'Storage exposed plaintext after revocation');}}
  finally{await call(admin,'/users/'+ownerId+'/companies','PUT',{company_id:A.id,active:true});}
 });
 await test('Reportes y auditoría real preservan actor/empresa y no incluyen cuentas bancarias',async()=>{
  const ps=await list(admin,'/permissions');const audit=ps.find(p=>p.code==='audit.finance_view');const current=await call(admin,'/roles/'+role.id+'/permissions');
  const ids=Array.isArray(current)?current.map((r:any)=>r.permission_id):current.data?.map((r:any)=>r.permission_id); // inspect through explicit IDs if shape differs
  const grants=ps.filter(p=>p.active&&['request','supplier','purchase_order','service_acceptance','tax_document','payable','payment_term','approval_policy','cost_center','project','subproject'].includes(p.resource)).map(p=>p.id);
  await call(admin,'/roles/'+role.id+'/permissions','PUT',{permission_ids:[...grants,audit.id]});
  const events=await list(owner,'/audit?category=finance&company_id='+A.id);assert(events.some(e=>e.user_id===ownerId&&e.company_id===A.id&&e.entity_type==='financial_requests'),'Missing financial audit');assert(!events.some(e=>e.entity_type==='supplier_bank_accounts'&&e.new_values?.account_number),'Account leaked in audit');
  const reports=await call(owner,'/finance/reports?company_id='+A.id);assert(reports.payables_by_due_date.length>=2,'Missing real report rows');
 });
 await test('UI real: creación de solicitud y dashboard sin mocks',async()=>{
  browserServer=await chromium.launchServer({channel:'msedge',headless:true});browser=await chromium.connect(browserServer.wsEndpoint());const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.addInitScript(({token,user,company})=>{sessionStorage.setItem('erp.session',JSON.stringify({access_token:token,refresh_token:'unused',expires_in:3600}));localStorage.setItem('erp.company.'+user,company);},{token:owner,user:ownerId,company:A.id});
  await page.goto(cfg.APP_ORIGIN+'/app/requests');await page.getByRole('button',{name:'Nuevo registro'}).click();const form=page.getByRole('dialog');
  await form.getByLabel('Tipo *',{exact:true}).selectOption('service');await form.getByLabel('Centro de costo *',{exact:true}).selectOption(center.id);await form.getByLabel('Moneda *',{exact:true}).selectOption(currency.id);await form.getByLabel('Descripción *',{exact:true}).fill('Creada desde UI '+tag);await form.getByLabel('Justificación *',{exact:true}).fill('Prueba real de interfaz');await form.getByLabel('Fecha requerida *',{exact:true}).fill('2026-09-10');await form.getByLabel('Descripción',{exact:true}).fill('Ítem UI');await form.getByLabel('Precio unitario',{exact:true}).fill('25');
  await form.getByRole('button',{name:'Guardar',exact:true}).click();await form.waitFor({state:'hidden'});await page.getByRole('cell',{name:'Creada desde UI '+tag,exact:true}).waitFor();await page.screenshot({path:dir+'/capturas/solicitudes-dev.png',fullPage:true});
  await page.getByRole('button',{name:'Dashboard',exact:true}).click();await page.getByRole('heading',{name:'Control operativo'}).waitFor();await page.locator('.finance-number').first().filter({hasText:/\d/}).waitFor();await page.screenshot({path:dir+'/capturas/dashboard-dev.png',fullPage:true});await page.close();
 });
 report.status='PASS';
}catch(e){report.status='FAIL';report.error=e instanceof ProofError?e.message:'Error de verificación; detalle sensible omitido.';console.log('Verificación DEV requiere revisión.');process.exitCode=1;}
finally{
 await persist();
 // Revoke verification sessions before terminating browser resources on Windows.
 for(const token of tokens)await privileged.auth.admin.signOut(token,'local').catch(()=>{});
 if(browserServer)browserServer.process()?.kill();
 if(server){server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
 // Playwright's remote connection can keep the CLI alive after browser termination.
 process.exit(process.exitCode ?? 0);
}
