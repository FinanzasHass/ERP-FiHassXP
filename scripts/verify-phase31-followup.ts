import {createClient} from '@supabase/supabase-js';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import ExcelJS from 'exceljs';
import {createApp} from '../src/server/app.js';
import {readConfig} from '../src/server/config/env.js';
import {createAuthentication} from '../src/server/services/authentication.js';
import {createPrivilegedAuth} from '../src/server/integrations/supabase/auth-admin.js';
import {createSessionRepository} from '../src/server/repositories/session-repository.js';
const config=readConfig(process.env),dir='docs/fase-3.1';
const report=JSON.parse(await readFile(dir+'/resultado-dev.json','utf8'));const manifest=JSON.parse(await readFile(dir+'/fixtures-dev.json','utf8'));
const admin=createClient(config.SUPABASE_URL,config.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const normal=createClient(config.SUPABASE_URL,config.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const assert=(v:unknown,label:string)=>{if(!v)throw new Error(label);};let server:any,browser:any;
async function session(id:string){const identity=await admin.auth.admin.getUserById(id);assert(!identity.error,'Auth identity unavailable');const link=await admin.auth.admin.generateLink({type:'magiclink',email:identity.data.user!.email!});assert(!link.error,'Session link unavailable');const result=await normal.auth.verifyOtp({token_hash:link.data.properties.hashed_token,type:'magiclink'});assert(!result.error&&result.data.session,'Real Auth session unavailable');return result.data.session!.access_token;}
async function request(token:string,path:string,method='GET',body?:unknown){const r=await fetch(config.APP_ORIGIN+'/api'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert(r.status>=200&&r.status<300,'HTTP failure '+r.status);return r.status===204?null:r.json();}
try{
 const app=createApp(config,{auth:createAuthentication(config),privileged:createPrivilegedAuth(config),repository:t=>createSessionRepository(config,t)});
 await new Promise<void>((resolve,reject)=>{server=app.listen(config.PORT,'127.0.0.1',resolve);server.once('error',()=>reject(new Error('Local server unavailable')));});
 const initial=await session(manifest.initialAdministrator),finance=manifest.users.find((u:any)=>u.kind==='finanzas'),token=await session(finance.id),A=manifest.companies[0];
 const permissions:any[]=[];for(let page=1;page<=20;page++){const r=await request(initial,'/permissions?limit=100&page='+page);permissions.push(...r.data);if(permissions.length>=r.count)break;}
 const codes=['cost_center.view','cost_center.create','cost_center.edit','cost_center.disable','project.view','project.create','project.edit','subproject.view','subproject.create','subproject.edit'];
 assert(codes.every(c=>permissions.some(p=>p.code===c&&p.active)),'Requested master permission absent');
 const role=manifest.roles.find((r:any)=>r.kind==='fin');
 await request(initial,`/roles/${role.id}/permissions`,'PUT',{permission_ids:permissions.filter(p=>codes.includes(p.code)).map(p=>p.id)});
 const projects=await request(token,'/projects?company_id='+A.id+'&limit=100');const project=projects.data.find((p:any)=>p.code===manifest.run+'_P');assert(project,'Project fixture absent');
 const sub=await request(token,'/subprojects?company_id='+A.id,'POST',{project_id:project.id,code:manifest.run+'_S',name:'Subproyecto DEV verificado'});assert(sub.company_id===A.id&&sub.project_id===project.id,'Subproject relationship invalid');
 report.history??=[];report.history.push({...report.results[12],resolvedAt:new Date().toISOString(),cause:'El verificador inicial leyó sólo la primera página del catálogo y omitió grants subproject. Corregida paginación; no se cambió autorización del producto.'});
 report.results[12].status='PASS';report.results[12].evidence='Proyecto/subproyecto creados en DEV con misma empresa. Repetición aprobada tras corregir paginación del verificador y completar grants sólo del rol sintético.';
 console.log('13: PASS (reverificado)');
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.addInitScript(t=>sessionStorage.setItem('erp.session',JSON.stringify({access_token:t,refresh_token:'unused',expires_in:3600})),token);
 await page.goto(config.APP_ORIGIN+'/app/cost-centers');await page.getByLabel('Empresa activa',{exact:true}).selectOption(A.id);
 for(const ext of ['csv','xlsx']){
   await page.getByRole('button',{name:'Importar Excel / CSV'}).click();
   const code=manifest.run+'_'+ext.toUpperCase();let buffer:Buffer;
   if(ext==='csv')buffer=Buffer.from(`company_code,code,name\n${A.code},${code},Centro CSV DEV confirmado`);
   else{const workbook=new ExcelJS.Workbook();workbook.addWorksheet('CECO').addRows([['company_code','code','name'],[A.code,code,'Centro XLSX DEV confirmado']]);buffer=Buffer.from(await workbook.xlsx.writeBuffer());}
   await page.locator('input[type=file]').setInputFiles({name:'verificacion.'+ext,mimeType:ext==='csv'?'text/csv':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer});
   await page.getByRole('button',{name:'Validar y previsualizar'}).click();await page.getByText('Vista previa · sin escrituras',{exact:false}).waitFor();
   const committed=page.waitForResponse(r=>r.url().endsWith('/api/cost-centers/import')&&r.request().postDataJSON()?.commit===true);
   await page.getByRole('button',{name:'Confirmar importación del lote'}).click();const response=await committed;const data=await response.json();assert(response.ok()&&data.committed&&data.created===1,'File import did not persist');
   const persisted=await request(token,'/cost-centers?company_id='+A.id+'&code='+code);assert(persisted.count===1,'File record not found');
   await page.getByRole('button',{name:'Centros de costo',exact:true}).last().click();
 }
 await mkdir(dir+'/capturas',{recursive:true});await page.screenshot({path:dir+'/capturas/ceco-dev-real.png',fullPage:true});
 report.results[13].status='PASS';report.results[13].evidence='CSV y XLSX cargados desde navegador real, previsualizados y confirmados por UI/Express/RPC; cada archivo persistió 1 centro en DEV. Sin mocks.';
 console.log('14: PASS (archivos confirmados por UI)');
}catch{console.log('Seguimiento requiere revisión; no se imprimen detalles sensibles.');report.followupIncomplete=true;}
finally{if(browser)await browser.close().catch(()=>{});if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));report.generatedAt=new Date().toISOString();await writeFile(dir+'/resultado-dev.json',JSON.stringify(report,null,2));}
