import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
let db;
if(process.env.TEST_DATABASE_URL){
  const {Client}=await import('pg');
  const client=new Client({connectionString:process.env.TEST_DATABASE_URL});await client.connect();
  db={query:(sql,params)=>client.query(sql,params),exec:sql=>client.query(sql),close:()=>client.end()};
}else db=new PGlite();
const admin='00000000-0000-0000-0000-000000000001';
const sandra='00000000-0000-0000-0000-000000000002';
const gianella='00000000-0000-0000-0000-000000000003';
const delegator='00000000-0000-0000-0000-000000000004';
const a='10000000-0000-0000-0000-000000000001';
const b='10000000-0000-0000-0000-000000000002';
let checks=0;
const scalar=async(sql,params=[])=>Object.values((await db.query(sql,params)).rows[0])[0];
async function test(label,fn){await fn();checks++;console.log(`OK ${label}`);}
async function asUser(id,sql,params=[]){
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${id}',false); select set_config('request.jwt.claims','{"sub":"${id}","session_id":"${id}"}',false)`);
  try{return await db.query(sql,params);}finally{await db.exec("reset role; select set_config('request.jwt.claim.sub','',false)");}
}
async function rpc(id,name,args){
  if(process.env.TEST_DATABASE_URL){
    const types=(await db.query("select t.typname from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral unnest(p.proargtypes) with ordinality a(oid,idx) join pg_type t on t.oid=a.oid where n.nspname='public' and p.proname=$1 and p.pronargs=$2 order by a.idx",[name,args.length])).rows;
    args=args.map((value,i)=>value!==null&&['json','jsonb'].includes(types[i]?.typname)?JSON.stringify(value):value);
  }
  return (await asUser(id,`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) as result`,args)).rows[0].result;
}
const can=(id,code,company=null)=>rpc(id,'has_permission',[code,company]);
const grant=(id,role,company=null,assign=true)=>rpc(admin,'admin_set_user_role',[id,role,company,assign]);
try {
  await db.exec(`do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
    end $$;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;
    grant select,insert on storage.objects to authenticated;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id));
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  for(const file of (await readdir(new URL('../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort()){
    await db.exec(await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
  }
  await db.exec(`insert into auth.users values ('${admin}','admin@example.test'),('${sandra}','sandra@example.test'),('${gianella}','gianella@example.test'),('${delegator}','delegator@example.test');`);
  await db.exec('insert into auth.sessions(id,user_id) select id,id from auth.users');
  const bootstrap=(await readFile(new URL('../bootstrap.sql',import.meta.url),'utf8')).replace('REPLACE_WITH_AUTH_USER_UUID',admin).replace('REPLACE_WITH_USERNAME','admin').replace('REPLACE_WITH_FULL_NAME','Administrator');
  await db.exec(bootstrap);
  for(const [id,name] of [[sandra,'sandra'],[gianella,'gianella'],[delegator,'delegator']]) await db.exec(`insert into public.profiles(id,email,username,full_name,status) values ('${id}','${name}@example.test','${name}','${name}','active')`);
  const treasury=await scalar("select id from public.roles where code='tesoreria'");
  const auditor=await scalar("select id from public.roles where code='auditor'");
  const sys=await scalar("select id from public.roles where is_system");
  const execute=await scalar("select id from public.permissions where code='payment.execute'");
  const view=await scalar("select id from public.permissions where code='payment.view'");
  const assign=await scalar("select id from public.permissions where code='role.assign'");
  const permissionAssign=await scalar("select id from public.permissions where code='permission.assign'");
  await test('migrations and system admin separates delegation from execution',async()=>{
    assert.equal(await can(admin,'role.assign'),true); assert.equal(await can(admin,'permission.assign'),true);
    assert.equal(await can(admin,'payment.execute',a),false);
    assert.equal(await scalar("select count(*)::int from pg_tables where schemaname='public' and not rowsecurity"),0);
  });
  for(const [id,name] of [[a,'A'],[b,'B']]) await db.exec(`insert into public.companies(id,legal_name,code,tax_id,country_code) values ('${id}','Company ${name}','C${name}','TEST-${name}','PE')`);
  await rpc(admin,'admin_set_role_permissions',[treasury,[execute]]);
  await rpc(admin,'admin_set_role_permissions',[auditor,[view]]);
  await test('cannot assign company role without active membership',async()=>{
    await assert.rejects(()=>grant(sandra,treasury,a),/Active company membership/);
  });
  for(const [id,company] of [[sandra,a],[gianella,a],[gianella,b]]) await rpc(admin,'admin_set_membership',[id,company,true]);
  await grant(sandra,treasury,a); await grant(gianella,treasury,a); await grant(gianella,auditor,b);
  await test('Sandra treasury A never authorizes B or missing context',async()=>{
    assert.equal(await can(sandra,'payment.execute',a),true);
    assert.equal(await can(sandra,'payment.execute',b),false);
    assert.equal(await can(sandra,'payment.execute'),false);
    assert.deepEqual((await asUser(sandra,'select id from public.companies')).rows,[{id:a}]);
  });
  await test('same user different roles by company',async()=>{
    assert.equal(await can(gianella,'payment.execute',a),true);
    assert.equal(await can(gianella,'payment.execute',b),false);
    assert.equal(await can(gianella,'payment.view',b),true);
  });
  await test('null-scope uniqueness and multiple company roles',async()=>{
    await grant(gianella,treasury,b); assert.equal(await can(gianella,'payment.execute',b),true);
    await grant(gianella,treasury,b); // Idempotent, no duplicate.
    assert.equal(await scalar(`select count(*)::int from public.user_roles where user_id='${gianella}' and role_id='${treasury}'`),2);
    await grant(gianella,treasury,b,false); assert.equal(await can(gianella,'payment.execute',b),false);
  });
  await test('membership revocation invalidates existing company grants immediately',async()=>{
    await rpc(admin,'admin_set_membership',[sandra,a,false]);
    assert.equal(await can(sandra,'payment.execute',a),false);
    await assert.rejects(()=>grant(sandra,treasury,a),/Active company membership/);
    await rpc(admin,'admin_set_membership',[sandra,a,true]);
    assert.equal(await can(sandra,'payment.execute',a),true);
  });
  await test('global deny beats company allow, company deny beats global allow',async()=>{
    await rpc(admin,'admin_set_override',[gianella,execute,null,'deny','Restricción global']);
    await rpc(admin,'admin_set_override',[gianella,execute,a,'allow','Excepción A']);
    assert.equal(await can(gianella,'payment.execute',a),false);
    await rpc(admin,'admin_set_override',[gianella,execute,null,'inherit','Restaurar']);
    assert.equal(await can(gianella,'payment.execute',a),true);
    await rpc(admin,'admin_set_override',[gianella,execute,null,'allow','Excepción global explícita']);
    await rpc(admin,'admin_set_override',[gianella,execute,b,'deny','Excluir B']);
    assert.equal(await can(gianella,'payment.execute',b),false);
    await rpc(admin,'admin_set_override',[gianella,execute,null,'inherit','Restaurar']);
    await rpc(admin,'admin_set_override',[gianella,execute,a,'inherit','Restaurar']);
  });
  await test('role.assign alone can assign configured financial role',async()=>{
    const role=await rpc(admin,'admin_save_entity',['role',null,{name:'Delegador',code:'delegador'}]);
    await rpc(admin,'admin_set_role_permissions',[role.id,[assign]]);
    await grant(delegator,role.id);
    assert.equal(await can(delegator,'permission.assign'),false);
    await rpc(delegator,'admin_set_user_role',[gianella,treasury,b,true]);
    assert.equal(await can(gianella,'payment.execute',b),false); // explicit deny remains
    await assert.rejects(()=>rpc(delegator,'admin_set_role_permissions',[treasury,[view]]),/Access denied/);
    await assert.rejects(()=>rpc(delegator,'admin_set_user_role',[delegator,treasury,a,true]),/Self security/);
  });
  await test('permission.assign alone can configure roles and overrides',async()=>{
    const role=await rpc(admin,'admin_save_entity',['role',null,{name:'Configurador',code:'configurador'}]);
    await rpc(admin,'admin_set_role_permissions',[role.id,[permissionAssign]]);
    await grant(delegator,role.id);
    // Remove delegation role so only permission.assign remains.
    const delegationRole=await scalar("select id from public.roles where code='delegador'");
    await grant(delegator,delegationRole,null,false);
    assert.equal(await can(delegator,'role.assign'),false);
    await rpc(delegator,'admin_set_role_permissions',[treasury,[execute,view]]);
    await rpc(delegator,'admin_set_override',[sandra,view,a,'deny','Separación']);
  });
  await test('system roles and own-role grants protected',async()=>{
    await assert.rejects(()=>rpc(admin,'admin_set_role_permissions',[sys,[execute]]),/own role/);
    await assert.rejects(()=>rpc(delegator,'admin_set_role_permissions',[sys,[execute]]),/financial permissions/);
    await assert.rejects(()=>rpc(admin,'admin_save_entity',['role',treasury,{is_system:true}]),/Unknown field/);
    await assert.rejects(()=>rpc(admin,'admin_save_entity',['role',sys,{code:'hacked'}]),/protected/);
    await assert.rejects(()=>rpc(delegator,'admin_set_role_permissions',[sys,[]]),/effective system administrator/);
  });
  await test('catalog immutable and direct table REST privileges denied',async()=>{
    await assert.rejects(()=>asUser(admin,"update public.profiles set status='active'"),/permission denied/);
    await assert.rejects(()=>asUser(admin,"insert into public.role_permissions(role_id,permission_id) values ($1,$2)",[treasury,permissionAssign]),/permission denied/);
    await assert.rejects(()=>asUser(admin,"delete from public.audit_logs"),/permission denied/);
    await assert.rejects(()=>db.exec("update public.permissions set scope='company' where code='request.view_own'"),/immutable/);
  });
  await test('inactive profile denies JWT-derived capabilities',async()=>{
    await rpc(admin,'admin_update_profile',[sandra,{status:'inactive'}]);
    assert.equal(await can(sandra,'payment.execute',a),false);
    assert.equal((await asUser(sandra,'select * from public.profiles')).rows.length,0);
    await rpc(admin,'admin_update_profile',[sandra,{status:'active'}]);
  });
  await test('organization validates global position and rejects manager cycles',async()=>{
    const position=await rpc(admin,'admin_save_entity',['position',null,{name:'Global'}]);
    await rpc(admin,'admin_update_profile',[sandra,{position_id:position.id,manager_id:gianella}]);
    await assert.rejects(()=>rpc(admin,'admin_update_profile',[gianella,{manager_id:sandra}]),/hierarchy cycle/);
    await assert.rejects(()=>rpc(admin,'admin_update_profile',[sandra,{manager_id:sandra}]),/check constraint/);
  });
  await test('provisioning reserves deterministic identity and is idempotent',async()=>{
    const key='20000000-0000-0000-0000-000000000001';
    const payload={email:'new@example.test',username:'new.user',full_name:'New User',status:'active'};
    const job=await rpc(admin,'begin_user_provisioning',[key,payload]);
    assert.equal((await rpc(admin,'begin_user_provisioning',[key,payload])).user_id,job.user_id);
    await assert.rejects(()=>rpc(admin,'begin_user_provisioning',[key,{...payload,full_name:'Other'}]),/Idempotency/);
    await assert.rejects(()=>rpc(admin,'finish_user_provisioning',[key]),/Auth identity mismatch/);
    await db.query('insert into auth.users(id,email) values ($1,$2)',[job.user_id,payload.email]);
    assert.equal((await rpc(admin,'finish_user_provisioning',[key])).id,job.user_id);
    assert.equal((await rpc(admin,'finish_user_provisioning',[key])).id,job.user_id);
    await rpc(admin,'prepare_email_change',[job.user_id,'changed@example.test']);
    await db.query('update auth.users set email=$1 where id=$2',['changed@example.test',job.user_id]);
    assert.equal(await scalar('select email from public.profiles where id=$1',[job.user_id]),'changed@example.test');
  });
  await test('login audit is server-only and requires real session; no arbitrary category',async()=>{
    const sid='30000000-0000-0000-0000-000000000001';
    await assert.rejects(()=>rpc(sandra,'record_authentication_success',[sandra,sid,'127.0.0.1']),/permission denied/);
    await db.exec('set role anon');
    try{await assert.rejects(()=>db.query('select public.record_authentication_success($1,$2,$3)',[sandra,sid,'127.0.0.1']),/permission denied/);}finally{await db.exec('reset role');}
    await db.query('insert into auth.sessions values ($1,$2)',[sid,sandra]);
    await db.exec('set role service_role');
    try{
      await db.query('select public.record_authentication_success($1,$2,$3)',[sandra,sid,'127.0.0.1']);
      await db.query('select public.record_authentication_success($1,$2,$3)',[sandra,sid,'127.0.0.1']);
      await assert.rejects(()=>db.query('select public.record_authentication_success($1,$2,$3)',[admin,sid,'127.0.0.1']),/Verified active session/);
      await assert.rejects(()=>db.query("update public.profiles set status='active'"),/permission denied/);
    }finally{await db.exec('reset role');}
    assert.equal(await scalar("select count(*)::int from public.audit_logs where action='login.success'"),1);
  });
  await test('retire assignments audit actor, company and reason transactionally',async()=>{
    await rpc(admin,'admin_set_override',[sandra,view,a,'inherit','Retiro documentado']);
    const event=(await db.query("select * from public.audit_logs where action='permission.delete' and reason='Retiro documentado'")).rows[0];
    assert.equal(event.user_id,admin);assert.equal(event.company_id,a);assert.equal(event.old_values.effect,'deny');
    const before=await scalar('select count(*) from public.audit_logs');
    await db.exec("begin; update public.companies set legal_name='Rollback'; rollback");
    assert.equal(await scalar('select count(*) from public.audit_logs'),before);
  });
  await test('revoked Auth session invalidates permissions and direct reads',async()=>{
    await db.query('delete from auth.sessions where id=$1',[sandra]);
    assert.equal(await can(sandra,'payment.execute',a),false);
    assert.equal((await asUser(sandra,'select * from public.profiles')).rows.length,0);
  });
  await test('master CRUD, company deactivation, settings and dedicated user status',async()=>{
    const area=await rpc(admin,'admin_save_entity',['area',null,{name:'Área prueba',code:'TEST'}]);
    const pos=await rpc(admin,'admin_save_entity',['position',null,{name:'Cargo área',area_id:area.id}]);
    await assert.rejects(()=>rpc(admin,'admin_update_profile',[gianella,{position_id:pos.id}]),/Position\/area mismatch/);
    await rpc(admin,'admin_update_profile',[gianella,{area_id:area.id,position_id:pos.id}]);
    assert.equal((await rpc(admin,'admin_save_entity',['area',area.id,{description:'Actualizado'}])).description,'Actualizado');
    const company=await rpc(admin,'admin_save_entity',['company',null,{legal_name:'Empresa prueba',code:'TC',tax_id:'TEST-C','country_code':'PE'}]);
    await rpc(admin,'admin_set_membership',[gianella,company.id,true]);
    await grant(gianella,treasury,company.id);
    assert.equal(await can(gianella,'payment.execute',company.id),true);
    await rpc(admin,'admin_save_entity',['company',company.id,{active:false}]);
    assert.equal(await can(gianella,'payment.execute',company.id),false);
    assert.equal((await rpc(admin,'admin_update_settings',[{system_name:'Prueba',timezone:'America/Lima'}])).system_name,'Prueba');
    await assert.rejects(()=>rpc(admin,'admin_update_settings',[{timezone:'Invalid/Zone'}]),/Invalid timezone/);
    await rpc(admin,'admin_set_profile_status',[gianella,'blocked']);assert.equal(await can(gianella,'payment.view',b),false);
    await rpc(admin,'admin_set_profile_status',[gianella,'active']);
  });
  await (await import('./phase3-checks.mjs')).phase3Checks({db,rpc,asUser,scalar,test,admin,gianella,a,b});
  const f4=await (await import('./phase4-checks.mjs')).phase4Checks({db,rpc,asUser,scalar,test,admin});
  await (await import('./phase5-checks.mjs')).phase5Checks({db,rpc,asUser,scalar,test,admin,...f4});
  const f6=await (await import('./phase6-foundation-checks.mjs')).phase6FoundationChecks({db,rpc,asUser,scalar,test,admin,...f4});
  const settlements=await (await import('./phase6-settlement-checks.mjs')).phase6SettlementChecks({db,rpc,asUser,scalar,test,admin,...f4,...f6});
  if(process.env.TEST_DATABASE_URL)await (await import('./phase6-concurrency-checks.mjs')).phase6ConcurrencyChecks({db,rpc,asUser,scalar,test,admin,...f4,...f6,...settlements});
  await (await import('./phase7-checks.mjs')).phase7Checks({db,rpc,asUser,scalar,test,admin,...f4,...settlements});
  const f8a=await (await import('./phase8a-checks.mjs')).phase8aChecks({db,rpc,asUser,scalar,test,admin,...f4,...settlements});
  if(process.env.TEST_DATABASE_URL)await (await import('./phase8a-concurrency-checks.mjs')).phase8aConcurrencyChecks({db,rpc,asUser,scalar,test,admin,...f4,...f8a});
  const f8b=await (await import('./phase8b-checks.mjs')).phase8bChecks({db,rpc,asUser,scalar,test,admin,...f4,...f8a});
  if(process.env.TEST_DATABASE_URL)await (await import('./phase8b-concurrency-checks.mjs')).phase8bConcurrencyChecks({db,rpc,scalar,test,admin,...f4,...f8a,...f8b});
  console.log(`PASS ${checks} Phase 2–8B database checks on ${process.version}`);
}catch(error){console.error({message:error.message,code:error.code,position:error.position,where:error.where});process.exitCode=1;}finally{await db.close();}
