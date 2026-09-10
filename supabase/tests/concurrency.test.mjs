import { Client } from 'pg';
import assert from 'node:assert/strict';
if(!process.env.TEST_DATABASE_URL)throw new Error('TEST_DATABASE_URL must target a disposable fixture database after phase2.test.mjs');
const clients=await Promise.all([0,1,2].map(async()=>{const c=new Client({connectionString:process.env.TEST_DATABASE_URL});await c.connect();return c;}));
const [owner,left,right]=clients;
const admin='00000000-0000-0000-0000-000000000001';
const sandra='00000000-0000-0000-0000-000000000002';
const gianella='00000000-0000-0000-0000-000000000003';
try{
  await owner.query('update public.profiles set manager_id=null');
  const cycle=await Promise.allSettled([
    left.query('update public.profiles set manager_id=$1 where id=$2',[gianella,sandra]),
    right.query('update public.profiles set manager_id=$1 where id=$2',[sandra,gianella]),
  ]);
  assert.equal(cycle.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await owner.query('select private.hierarchy_has_cycle() as cycle')).rows[0].cycle,false);
  console.log('OK concurrent hierarchy writes cannot commit a cycle');
  await owner.query('update public.profiles set manager_id=null');
  await owner.query(`insert into public.user_roles(user_id,role_id) select $1,id from public.roles where is_system`,[gianella]);
  for(const [client,id] of [[left,admin],[right,gianella]]){
    await client.query('set role authenticated');
    await client.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[id,JSON.stringify({sub:id,session_id:id})]);
  }
  const results=await Promise.allSettled([
    left.query('select public.admin_update_profile($1,$2)',[gianella,{status:'inactive'}]),
    right.query('select public.admin_update_profile($1,$2)',[admin,{status:'inactive'}]),
  ]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const count=await owner.query(`select count(*)::int n from public.profiles p join public.user_roles ur on ur.user_id=p.id
    join public.roles r on r.id=ur.role_id where r.is_system and p.status='active'`);
  assert.equal(count.rows[0].n,1);
  console.log('OK concurrent administrator deactivation preserves an effective administrator');
}finally{await Promise.all(clients.map(c=>c.end()));}
