import {createClient} from '@supabase/supabase-js';import{readFile,writeFile}from'node:fs/promises';import{chromium}from'@playwright/test';
import{createApp}from'../src/server/app.js';import{readConfig}from'../src/server/config/env.js';import{createAuthentication}from'../src/server/services/authentication.js';import{createPrivilegedAuth}from'../src/server/integrations/supabase/auth-admin.js';import{createSessionRepository}from'../src/server/repositories/session-repository.js';
const cfg=readConfig(process.env),dir='docs/fase-4',report=JSON.parse(await readFile(dir+'/resultado-dev.json','utf8')),company=report.fixtures.companies[0].id,user=report.fixtures.users.find((x:any)=>x.kind==='solicitante').id;
if(cfg.NODE_ENV==='production'||!['localhost','127.0.0.1'].includes(new URL(cfg.APP_ORIGIN).hostname))throw new Error('DEV only');
const auth=createClient(cfg.SUPABASE_URL,cfg.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}}),normal=createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
let server:any,browser:any,page:any,token='',stage='setup';
try{
 const app=createApp(cfg,{auth:createAuthentication(cfg),privileged:createPrivilegedAuth(cfg),repository:t=>createSessionRepository(cfg,t)});await new Promise<void>((r,j)=>{server=app.listen(cfg.PORT,'127.0.0.1',r);server.once('error',j);});
 const u=await auth.auth.admin.getUserById(user),l=await auth.auth.admin.generateLink({type:'magiclink',email:u.data.user!.email!});const s=await normal.auth.verifyOtp({type:'magiclink',token_hash:l.data.properties.hashed_token});token=s.data.session!.access_token;
 const response=await fetch(cfg.APP_ORIGIN+'/api/finance/options?company_id='+company,{headers:{Authorization:'Bearer '+token}});if(!response.ok)throw new Error('options');const opts=await response.json();
 stage='browser_launch';browser=await chromium.launch({channel:'msedge',headless:true});page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.addInitScript(({token,user,company}:{token:string;user:string;company:string})=>{sessionStorage.setItem('erp.session',JSON.stringify({access_token:token,refresh_token:'unused',expires_in:3600}));localStorage.setItem('erp.company.'+user,company);},{token,user,company});
 stage='open_requests';await page.goto(cfg.APP_ORIGIN+'/app/requests');await page.getByRole('button',{name:'Nuevo registro'}).click();const form=page.getByRole('dialog');
 stage='form_type';await form.getByLabel('Tipo *',{exact:true}).selectOption('service');
 stage='form_center';await form.getByLabel('Centro de costo *',{exact:true}).selectOption(opts.cost_centers[0].id);
 stage='form_currency';await form.getByLabel('Moneda *',{exact:true}).selectOption(opts.currencies[0].id);
 stage='form_description';const description='Creada desde UI '+Date.now();await form.getByLabel('Descripción *',{exact:true}).fill(description);
 stage='form_justification';await form.getByLabel('Justificación *',{exact:true}).fill('Prueba real de formulario DEV');
 stage='form_date';await form.getByLabel('Fecha requerida *',{exact:true}).fill('2026-09-10');
 stage='form_item';await form.getByLabel('Descripción',{exact:true}).fill('Ítem UI');await form.getByLabel('Precio unitario',{exact:true}).fill('25');
 stage='save';await form.getByRole('button',{name:'Guardar',exact:true}).click();await form.waitFor({state:'hidden'});
 stage='persisted_row';await page.getByRole('cell',{name:description,exact:true}).waitFor();await page.screenshot({path:dir+'/capturas/solicitudes-dev.png',fullPage:true});
 stage='dashboard';await page.getByRole('button',{name:'Dashboard',exact:true}).click();await page.getByRole('heading',{name:'Control operativo'}).waitFor();await page.locator('.finance-number').first().filter({hasText:/\d/}).waitFor();await page.screenshot({path:dir+'/capturas/dashboard-dev.png',fullPage:true});
 const name='UI real: creación de solicitud y dashboard sin mocks';report.results=report.results.filter((r:any)=>r.name!==name);report.results.push({name,status:'PASS'});report.status='PASS';delete report.error;console.log('PASS UI real');
}catch(e){report.status='FAIL';report.error='UI verification stage: '+stage;console.log(JSON.stringify({stage,errorType:e instanceof Error?e.name:'UNKNOWN'}));if(page)await page.screenshot({path:dir+'/capturas/ui-diagnostico.png',fullPage:true}).catch(()=>{});process.exitCode=1;}
finally{if(browser)await browser.close().catch(()=>{});if(server){server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}if(token)await auth.auth.admin.signOut(token,'local').catch(()=>{});report.updatedAt=new Date().toISOString();report.summary={pass:report.results.filter((r:any)=>r.status==='PASS').length,fail:report.results.filter((r:any)=>r.status==='FAIL').length};await writeFile(dir+'/resultado-dev.json',JSON.stringify(report,null,2));}
