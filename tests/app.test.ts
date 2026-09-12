import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdtemp, writeFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server/app.js';
import { readConfig } from '../src/server/config/env.js';
import { HttpError } from '../src/server/middleware/errors.js';
import { hasPermission, canReadRequest } from '../src/server/services/permissions.js';
import { provisionUser } from '../src/server/services/provisioning.js';
import type { Dependencies } from '../src/server/routes/api.js';
import type { Profile } from '../src/shared/contracts.js';

const user='00000000-0000-4000-8000-000000000001';
const other='00000000-0000-4000-8000-000000000002';
const company='10000000-0000-4000-8000-000000000001';
const config=readConfig({SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test_fixture',SUPABASE_SECRET_KEY:'sb_secret_server_test_fixture',APP_ORIGIN:'http://localhost:3000',NODE_ENV:'test',TRUST_PROXY_HOPS:'0'});
const profile:Profile={id:user,email:'test@example.test',username:'tester',full_name:'Tester',status:'active',area_id:null,position_id:null,manager_id:null};
function fixture(options:{inactive?:boolean;grants?:string[];companyAllowed?:boolean}={}){
  const calls:{name:string;args:Record<string,unknown>}[]=[];
  const deps:Dependencies={
    auth:{
      async verify(token){if(token!=='valid')throw new HttpError(401,'INVALID_TOKEN');return {id:user,sessionId:other};},
      async login(_email,password){if(password==='wrong')throw new HttpError(401,'INVALID_CREDENTIALS');return {access_token:'valid',refresh_token:'refresh',expires_in:3600};},
      async refresh(){return {access_token:'valid',refresh_token:'refresh',expires_in:3600};},
      async recover(){},async verifyOtp(){return {access_token:'valid',refresh_token:'refresh',expires_in:3600};},async updatePassword(){},
    },
    privileged:{async ensureIdentity(){},async updateEmail(){},async logout(){},async recordVerifiedLogin(id,sid,ip){calls.push({name:'audit',args:{id,sid,ip}});}},
    repository:()=>({
      async profile(){return options.inactive?{...profile,status:'inactive'}:profile;},
      async rpc<T>(name:string,args:Record<string,unknown>):Promise<T>{
        calls.push({name,args});
        if(name==='has_permission')return (options.grants??[]).includes(String(args.permission_code)) as T;
        if(name==='has_company_access')return (options.companyAllowed??false) as T;
        if(name==='effective_permissions')return [] as T;
        return {} as T;
      },
      async list(){return {data:[],count:0};},
    }),
  };
  return {deps,calls,app:createApp(config,deps)};
}
test('master endpoints validate company, input, and use authorized RPC only',async()=>{
  const {app,calls}=fixture({grants:['cost_center.view']});
  assert.equal((await request(app).get('/api/cost-centers').auth('valid',{type:'bearer'})).status,400);
  assert.equal((await request(app).get('/api/cost-centers?company_id='+company).auth('valid',{type:'bearer'})).status,200);
  assert.equal((await request(app).post('/api/cost-centers?company_id='+company).auth('valid',{type:'bearer'}).send({code:'ROOT',name:'Root',company_id:other})).status,400);
  assert.equal((await request(app).post('/api/cost-centers?company_id='+company).auth('valid',{type:'bearer'}).send({code:'ROOT',name:'Root'})).status,201);
  assert.equal(calls.find(c=>c.name==='master_save')?.args.target_company,company);
  assert.equal((await request(app).post('/api/cost-centers/import').auth('valid',{type:'bearer'}).send({company_id:company,commit:false,rows:[]})).status,400);
  assert.equal((await request(app).post('/api/cost-centers/import').auth('valid',{type:'bearer'}).send({company_id:company,commit:false,rows:[{company_code:'A',code:'CC',name:'Center'}]})).status,200);
  assert.equal(calls.find(c=>c.name==='import_cost_centers')?.args.commit_batch,false);
});
test('financial endpoints require live authentication, validate payload and delegate company/resource checks to RPC',async()=>{
 const {app,calls}=fixture({companyAllowed:true});
 assert.equal((await request(app).get('/api/financial-requests?company_id='+company)).status,401);
 assert.equal((await request(fixture({inactive:true}).app).get('/api/payables?company_id='+company).auth('valid',{type:'bearer'})).status,403);
 assert.equal((await request(fixture().app).get('/api/payables?company_id='+company).auth('valid',{type:'bearer'})).status,403);
 const payload={request_type:'service',cost_center_id:other,currency_id:other,description:'Synthetic',justification:'Test',required_date:'2026-09-10',payment_modality:'credit',items:[{description:'Item',quantity:1,unit_price:100}]};
 assert.equal((await request(app).post('/api/financial-requests?company_id='+company).auth('valid',{type:'bearer'}).send({...payload,company_id:other})).status,400);
 assert.equal((await request(app).post('/api/financial-requests?company_id='+company).auth('valid',{type:'bearer'}).send(payload)).status,201);
 assert.equal(calls.find(c=>c.name==='financial_save')?.args.target_company,company);
 assert.equal((await request(app).post('/api/financial-requests/'+other+'/actions').auth('valid',{type:'bearer'}).send({action:'approve',comment:'Review'})).status,200);
 const transition=calls.find(c=>c.name==='financial_transition')!;assert.equal(transition.args.target_id,other);assert.equal(transition.args.company_id,undefined);
 assert.equal((await request(app).post('/api/payables/'+other+'/actions').auth('valid',{type:'bearer'}).send({action:'paid',comment:'Invalid'})).status,400);
});
test('username login resolves only through narrow server identity operation',async()=>{
 const {deps,calls}=fixture();let resolved='';deps.privileged.resolveUsername=async name=>{resolved=name;return 'test@example.test';};
 const result=await request(createApp(config,deps)).post('/api/auth/login').send({email:'tester',password:'correct'});
 assert.equal(result.status,200);assert.equal(resolved,'tester');assert.equal(result.body.email,undefined);assert.ok(calls.some(c=>c.name==='audit'));
});
test('health is public; missing/invalid bearer denied',async()=>{
  const {app}=fixture();
  assert.equal((await request(app).get('/health')).status,200);
  assert.equal((await request(app).get('/api/users')).status,401);
  assert.equal((await request(app).get('/api/users').auth('wrong',{type:'bearer'})).status,401);
});
test('verified JWT plus inactive profile returns 403',async()=>{
  const {app}=fixture({inactive:true,grants:['user.view']});
  const result=await request(app).get('/api/users').auth('valid',{type:'bearer'});
  assert.equal(result.status,403);assert.equal(result.body.error,'PROFILE_DISABLED');
});
test('permission middleware denies before mutation and cannot trust role payload',async()=>{
  const {app,calls}=fixture();
  assert.equal((await request(app).post('/api/roles').auth('valid',{type:'bearer'}).send({name:'Injected',code:'injected',roles:['system_administrator']})).status,403);
  assert.equal(calls.some(c=>c.name==='admin_save_entity'),false);
});
test('role.assign only is sufficient at HTTP layer; company context preserved',async()=>{
  const {app,calls}=fixture({grants:['role.assign']});
  assert.equal((await request(app).put(`/api/users/${other}/roles`).auth('valid',{type:'bearer'}).send({role_id:other,company_id:company,assign:true})).status,204);
  assert.equal(calls.find(c=>c.name==='admin_set_user_role')?.args.target_company,company);
  assert.equal(calls.some(c=>c.args.permission_code==='permission.assign'),false);
});
test('strict validation rejects is_system, unknown fields, missing explicit role scope',async()=>{
  const {app}=fixture({grants:['role.create','role.assign']});
  assert.equal((await request(app).post('/api/roles').auth('valid',{type:'bearer'}).send({name:'Injected',code:'injected',is_system:true})).status,400);
  assert.equal((await request(app).put(`/api/users/${other}/roles`).auth('valid',{type:'bearer'}).send({role_id:other,assign:true})).status,400);
  assert.equal((await request(app).post('/api/roles').auth('valid',{type:'bearer'}).set('Content-Type','application/json').send('{')).status,400);
});
test('company supplied by frontend is checked and not accepted as authorization',async()=>{
  const {app}=fixture();
  assert.equal((await request(app).get(`/api/auth/me?company_id=${company}`).auth('valid',{type:'bearer'})).status,403);
});
test('login audit takes verified identity and trusted IP, rejects forged metadata',async()=>{
  const {app,calls}=fixture();
  assert.equal((await request(app).post('/api/auth/login').send({email:'test@example.test',password:'valid',actor:other,category:'finance'})).status,400);
  assert.equal((await request(app).post('/api/auth/login').set('X-Forwarded-For','1.2.3.4').send({email:'test@example.test',password:'valid'})).status,200);
  const event=calls.find(c=>c.name==='audit');assert.equal(event?.args.id,user);assert.notEqual(event?.args.ip,'1.2.3.4');
});
test('failed login exposes no error internals or secret and writes no arbitrary audit',async()=>{
  const {app,calls}=fixture();
  const result=await request(app).post('/api/auth/login').send({email:'test@example.test',password:'wrong'});
  assert.equal(result.status,401);assert.equal(calls.some(c=>c.name==='audit'),false);
  assert.equal(JSON.stringify(result.body).includes(config.SUPABASE_SECRET_KEY),false);
});
test('security headers, origin check, no-store and bounded pagination',async()=>{
  const {app}=fixture({grants:['user.view']});
  const response=await request(app).get('/api/users').auth('valid',{type:'bearer'});
  assert.equal(response.headers['cache-control'],'no-store');assert.ok(response.headers['content-security-policy']);
  assert.equal((await request(app).get('/api/users?limit=9999').auth('valid',{type:'bearer'})).status,400);
  assert.equal((await request(app).post('/api/auth/login').set('Origin','https://other.example').send({})).status,403);
});
test('SPA cannot swallow API, health subpaths, missing assets or unknown URLs',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'erp-static-'));
  await writeFile(path.join(dir,'index.html'),'<html>phase2-static</html>');
  await mkdir(path.join(dir,'assets'));await writeFile(path.join(dir,'assets','ok.js'),'export {}');
  const {deps}=fixture();const app=createApp(config,deps,dir);
  assert.match((await request(app).get('/')).text,/phase2-static/);
  assert.equal((await request(app).get('/assets/ok.js')).status,200);
  for(const url of ['/api/missing','/health/missing','/assets/missing.js','/missing','/.env']){
    const result=await request(app).get(url).auth('valid',{type:'bearer'});
    assert.equal(result.status,404);assert.equal(result.text.includes('phase2-static'),false);
  }
});
test('permission helper rejects identity spoof and persisted resource outside membership',async()=>{
  const {deps}=fixture({grants:['request.view_all']});
  const actor={id:user,token:'valid',sessionId:other,profile,db:deps.repository('valid')};
  await assert.rejects(()=>hasPermission(actor,other,'request.view_all',company),/IDENTITY_MISMATCH/);
  assert.equal(await canReadRequest(actor,{company_id:company,area_id:null,owner_id:user},company),false);
});
test('provisioning retries same reservation without deleting ambiguous identity',async()=>{
  const {deps}=fixture();let ensureCount=0;let finishes=0;
  deps.privileged.ensureIdentity=async()=>{ensureCount++;};
  const repository=deps.repository('valid');
  repository.rpc=async<T>(name:string)=>{
    if(name==='begin_user_provisioning')return {request_id:other,user_id:other,status:finishes>0?'complete':'pending'} as T;
    finishes++;return {...profile,id:other} as T;
  };
  const actor={id:user,token:'valid',sessionId:other,profile,db:repository};
  await provisionUser(actor,deps.privileged,other,{email:'new@example.test'});
  await provisionUser(actor,deps.privileged,other,{email:'new@example.test'});
  assert.equal(ensureCount,1);
});
test('client/shared/bundle do not contain secret keys or privileged imports',async()=>{
  for(const directory of ['src/client','src/shared','dist/client']){
    for(const file of await readdir(directory,{recursive:true,withFileTypes:true})){
      if(!file.isFile())continue;
      const contents=await readFile(path.join(file.parentPath,file.name),'utf8');
      assert.doesNotMatch(contents,/SUPABASE_SECRET_KEY|sb_secret_|auth-admin|SUPABASE_SERVICE_ROLE_KEY/);
    }
  }
});

