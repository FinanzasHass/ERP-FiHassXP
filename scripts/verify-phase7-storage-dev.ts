import {createClient} from '@supabase/supabase-js';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/server/app.js';
import {readConfig} from '../src/server/config/env.js';
import {createAuthentication} from '../src/server/services/authentication.js';
import {createPrivilegedAuth} from '../src/server/integrations/supabase/auth-admin.js';
import {createSessionRepository} from '../src/server/repositories/session-repository.js';
const cfg=readConfig(process.env),prior=JSON.parse(await readFile('docs/fase-7/resultado-dev.json','utf8')),ref=(await readFile('supabase/.temp/project-ref','utf8')).trim();
if(prior.status!=='PASS'||cfg.NODE_ENV==='production'||new URL(cfg.SUPABASE_URL).hostname!==ref+'.supabase.co'||!['localhost','127.0.0.1'].includes(new URL(cfg.APP_ORIGIN).hostname))throw new Error('Verified DEV required');
const admin=createClient(cfg.SUPABASE_URL,cfg.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}}).auth.admin;
const sessions:any[]=[];let server:any;
const report:any={executedAt:new Date().toISOString(),sourceRun:prior.run,status:'RUNNING',checks:[]};
const assert=(value:any,message:string)=>{if(!value)throw new Error(message);};
async function session(id:string,kind:string){
 const u=await admin.getUserById(id);assert(!u.error&&u.data.user?.email?.startsWith(prior.run.toLowerCase()+'_'+kind+'@'),'Synthetic identity mismatch');
 const link=await admin.generateLink({type:'magiclink',email:u.data.user!.email!});assert(!link.error,'Auth unavailable');
 const client=createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const login=await client.auth.verifyOtp({type:'magiclink',token_hash:link.data!.properties.hashed_token});assert(!login.error&&login.data.session,'Session unavailable');
 const token=login.data.session!.access_token,db=createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY,{global:{headers:{Authorization:'Bearer '+token}},auth:{persistSession:false,autoRefreshToken:false}});const s={token,db};sessions.push(s);return s;
}
async function call(s:any,path:string,body?:any,allowed=[200,201]){
 const r=await fetch(cfg.APP_ORIGIN+'/api'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+s.token,'Content-Type':'application/json','Idempotency-Key':randomUUID()},...(body?{body:JSON.stringify(body)}:{})});assert(allowed.includes(r.status),'API status '+r.status);return r.status===204?null:r.json();
}
try{
 const owner=await session(prior.fixtures.users[0],'owner'),foreign=await session(prior.fixtures.users[2],'foreign'),company=prior.fixtures.companyA,ctx='?company_id='+company;
 server=createApp(cfg,{auth:createAuthentication(cfg),privileged:createPrivilegedAuth(cfg),repository:t=>createSessionRepository(cfg,t)}).listen(cfg.PORT,'127.0.0.1');await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
 const options=await call(owner,'/receivable-context/options'+ctx),customer=options.customers[0],currency=options.currencies.find((r:any)=>r.name==='PEN');
 const method=await call(owner,'/payment-methods'+ctx,{code:'f7_support_'+Date.now(),name:'Medio de cobro sintético',requires_beneficiary_account:false});
 const coll=await call(owner,'/collections'+ctx,{currency_id:currency.id,collection_date:'2026-09-13',amount:10,payment_method_id:method.id,reference:'Sustento sintético F7'});
 await call(owner,'/collections/'+coll.id+'/identify',{customer_id:customer.id,reason:'Sustento sintético'});
 const debt=await call(owner,'/receivables'+ctx,{customer_id:customer.id,source_type:'manual_authorized',currency_id:currency.id,issue_date:'2026-09-13',due_date:'2026-09-30',original_amount:10,description:'Prueba de sustento cifrado'});
 const allocation={allocations:[{receivable_id:debt.id,amount:10}]};await call(owner,'/collections/'+coll.id+'/apply',allocation,[409]);
 const bytes=Buffer.from('%PDF-1.4\nDocumento exclusivamente sintético '+prior.run+'\n%%EOF');
 async function evidence(kind:string,id:string){
  const a=await call(owner,'/attachments/upload',{company_id:company,entity_type:kind,entity_id:id,filename:'synthetic.pdf',mime_type:'application/pdf',base64:bytes.toString('base64')});
  const downloaded=await call(owner,'/attachments/'+a.id+'/download');assert(Buffer.from(downloaded.base64,'base64').equals(bytes),'Roundtrip mismatch');
  const metadata=await owner.db.from('attachments').select('*').eq('id',a.id).single();assert(!metadata.error,'Metadata unavailable');
  const raw=await owner.db.storage.from('financial-encrypted').download(metadata.data.storage_path);assert(!raw.error,'Ciphertext unavailable');const encrypted=Buffer.from(await raw.data!.arrayBuffer());assert(!encrypted.includes(bytes)&&!encrypted.includes(Buffer.from('%PDF')),'Plaintext in Storage');
  await call(foreign,'/attachments/'+a.id+'/download',undefined,[403,404]);
  return a;
 }
 await evidence('collection_support',coll.id);await call(owner,'/collections/'+coll.id+'/apply',allocation);report.checks.push({name:'Cobro no bancario exige evidencia cifrada, descarga fiel y aislamiento empresarial',status:'PASS'});
 const issued=await call(owner,'/issued-documents'+ctx,{customer_id:customer.id,document_type:'other',series:'TEST',number:String(Date.now()),issue_date:'2026-09-13',description:'Referencia sintética no fiscal'});await evidence('issued_document',issued.id);report.checks.push({name:'Documento emitido usa Storage cifrado y empresa autorizada',status:'PASS'});
 const schedules=await call(owner,'/receivable-schedules'+ctx);const items=await call(owner,'/receivable-schedules/'+schedules.data[0].id+'/installments');assert(items.count>0&&items.data.every((i:any)=>i.financial_status&&Number(i.original_amount)-Number(i.collected_amount)===Number(i.outstanding_amount)),'Installment balances missing');report.checks.push({name:'API de cuotas devuelve saldos y estados derivados',status:'PASS'});
 report.status='PASS';
}catch(e){report.status='FAIL';report.incident=e instanceof Error&&/^(API status|Synthetic|Auth unavailable|Session unavailable|Roundtrip|Metadata|Ciphertext|Plaintext|Installment)/.test(e.message)?e.message:'Detalle sensible omitido';process.exitCode=1;}
finally{for(const s of sessions)await admin.signOut(s.token,'global').catch(()=>{});if(server){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}await writeFile('docs/fase-7/resultado-storage-dev.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));process.exit(process.exitCode??0);}
