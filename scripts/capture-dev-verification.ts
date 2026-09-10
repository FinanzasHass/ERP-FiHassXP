import {createClient} from '@supabase/supabase-js';
import {readFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {createApp} from '../src/server/app.js';
import {readConfig} from '../src/server/config/env.js';
import {createAuthentication} from '../src/server/services/authentication.js';
import {createPrivilegedAuth} from '../src/server/integrations/supabase/auth-admin.js';
import {createSessionRepository} from '../src/server/repositories/session-repository.js';
let server:any,browser:any;try{
 const c=readConfig(process.env),m=JSON.parse(await readFile('docs/fase-3.1/fixtures-dev.json','utf8'));
 const a=createClient(c.SUPABASE_URL,c.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}}),n=createClient(c.SUPABASE_URL,c.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const identity=await a.auth.admin.getUserById(m.users.find((u:any)=>u.kind==='finanzas').id);if(identity.error)throw new Error();
 const link=await a.auth.admin.generateLink({type:'magiclink',email:identity.data.user!.email!});if(link.error)throw new Error();
 const session=await n.auth.verifyOtp({token_hash:link.data.properties.hashed_token,type:'magiclink'});if(session.error||!session.data.session)throw new Error();
 const app=createApp(c,{auth:createAuthentication(c),privileged:createPrivilegedAuth(c),repository:t=>createSessionRepository(c,t)});
 await new Promise<void>((resolve,reject)=>{server=app.listen(c.PORT,'127.0.0.1',resolve);server.once('error',reject);});
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1100}});
 await page.addInitScript(t=>sessionStorage.setItem('erp.session',JSON.stringify({access_token:t,refresh_token:'unused',expires_in:3600})),session.data.session.access_token);
 await page.goto(c.APP_ORIGIN+'/app/cost-centers');await page.getByRole('cell',{name:m.run+'_XLSX',exact:true}).waitFor();
 await page.screenshot({path:'docs/fase-3.1/capturas/ceco-dev-real.png',fullPage:true});
 await a.auth.admin.signOut(session.data.session.access_token,'local');console.log('Captura real verificada con registros cargados; sesión de captura cerrada.');
}catch{console.log('Captura no completada; sin detalles sensibles.');process.exitCode=1;}
finally{if(browser)await browser.close().catch(()=>{});if(server){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}}
