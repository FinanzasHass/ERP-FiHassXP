import {createClient} from '@supabase/supabase-js';
import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {createApp} from '../src/server/app.js';
import {readConfig} from '../src/server/config/env.js';
import {createAuthentication} from '../src/server/services/authentication.js';
import {createPrivilegedAuth} from '../src/server/integrations/supabase/auth-admin.js';
import {createSessionRepository} from '../src/server/repositories/session-repository.js';
const cfg=readConfig(process.env),prior=JSON.parse(await readFile('docs/fase-7/resultado-dev.json','utf8')),ref=(await readFile('supabase/.temp/project-ref','utf8')).trim();
if(prior.status!=='PASS'||cfg.NODE_ENV==='production'||new URL(cfg.SUPABASE_URL).hostname!==ref+'.supabase.co'||!['localhost','127.0.0.1'].includes(new URL(cfg.APP_ORIGIN).hostname))throw new Error('Verified DEV required');
const admin=createClient(cfg.SUPABASE_URL,cfg.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}}).auth.admin;
let server:any,browserServer:any,token:string|undefined;
const result:any={executedAt:new Date().toISOString(),sourceRun:prior.run,status:'RUNNING',readOnlyFinancialData:true,checks:[]};
try{
 const u=await admin.getUserById(prior.fixtures.users[0]);if(u.error||!u.data.user?.email?.startsWith(prior.run.toLowerCase()+'_owner@'))throw new Error('Synthetic identity mismatch');
 const link=await admin.generateLink({type:'magiclink',email:u.data.user.email});if(link.error)throw new Error('Auth unavailable');
 const normal=createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const login=await normal.auth.verifyOtp({type:'magiclink',token_hash:link.data.properties.hashed_token});if(login.error||!login.data.session)throw new Error('Session unavailable');token=login.data.session.access_token;
 server=createApp(cfg,{auth:createAuthentication(cfg),privileged:createPrivilegedAuth(cfg),repository:t=>createSessionRepository(cfg,t)}).listen(cfg.PORT,'127.0.0.1');await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
 browserServer=await chromium.launchServer({channel:'msedge',headless:true});const browser=await chromium.connect(browserServer.wsEndpoint()),page=await browser.newPage({viewport:{width:1440,height:1050}});
 await page.addInitScript(({access,refresh,user,company}:any)=>{sessionStorage.setItem('erp.session',JSON.stringify({access_token:access,refresh_token:refresh,expires_in:3600}));localStorage.setItem('erp.company.'+user,company);},{access:token,refresh:login.data.session.refresh_token,user:u.data.user.id,company:prior.fixtures.companyA});
 await page.goto(cfg.APP_ORIGIN+'/app/receivable-dashboard');await page.getByRole('cell',{name:'Al día',exact:true}).first().waitFor();await page.getByText('Tesorería y cobranzas · Fase 7',{exact:true}).waitFor();await page.screenshot({path:'docs/fase-7/capturas/cobranzas-dev.png',fullPage:true});
 result.checks.push({name:'Panel DEV final muestra aging en español y versión Fase 7',status:'PASS'});
 await page.goto(cfg.APP_ORIGIN+'/app/collections');await page.getByRole('cell',{name:/^COB-\d{4}-/}).first().waitFor();await page.screenshot({path:'docs/fase-7/capturas/cobros-dev.png',fullPage:true});result.checks.push({name:'Listado real de cobros con saldos derivados visible',status:'PASS'});result.status='PASS';
}catch{result.status='FAIL';process.exitCode=1;}
finally{if(browserServer)browserServer.process()?.kill();if(token)await admin.signOut(token,'global').catch(()=>{});if(server){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}await writeFile('docs/fase-7/resultado-ui-dev.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));process.exit(process.exitCode??0);}
