import {Client} from 'pg';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function phase8bConcurrencyChecks({db,rpc,scalar,test,admin,c,generator,accountingPeriod,accountingType}){
 const url=new URL(process.env.TEST_DATABASE_URL);
 if(!['localhost','127.0.0.1'].includes(url.hostname)||!url.pathname.startsWith('/phase6_fixture_'))throw new Error('DISPOSABLE_LOCAL_DATABASE_REQUIRED');
 const clients=await Promise.all([0,1].map(async()=>{const client=new Client({connectionString:process.env.TEST_DATABASE_URL});await client.connect();await client.query('set role authenticated');return client;}));
 const race=calls=>Promise.allSettled(calls.map(async({user,fn,args},i)=>{const client=clients[i];await client.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[user,JSON.stringify({sub:user,session_id:user})]);return(await client.query(`select public.${fn}(${args.map((_,n)=>'$'+(n+1)).join(',')}) result`,args.map(a=>typeof a==='object'&&a!==null?JSON.stringify(a):a))).rows[0].result;}));
 try{
  await rpc(generator,'accounting_demo_configure',[c,true,'Prueba de concurrencia DEMO']);
  const e=(await db.query("select * from public.accounting_events where company_id=$1 and event_type='PAYABLE_RECOGNIZED'and journal_entry_id is null and amount>0 and event_date between '2026-09-01'and '2026-09-30' order by id limit 1",[c])).rows[0];assert.ok(e);
  await rpc(generator,'accounting_event_resolve',[e.id]);
  const args=()=>[e.id,accountingPeriod.id,accountingType.id,randomUUID()];
  await test('F8B CONCURRENT double generation creates exactly one journal and preserves its source',async()=>{
   const results=await race([0,1].map(()=>({user:generator,fn:'accounting_event_generate',args:args()})));
   for(const result of results)assert.equal(result.status,'fulfilled',result.reason?.message);
   assert.equal(results[0].value.id,results[1].value.id);
   assert.equal(Number(await scalar('select count(*)from public.journal_entries where accounting_event_id=$1',[e.id])),1);
  });
  await test('F8B CONCURRENT membership revocation prevents subsequent replay of a generated event',async()=>{
   const results=await race([{user:admin,fn:'admin_set_membership',args:[generator,c,false]},{user:generator,fn:'accounting_event_generate',args:args()}]);
   assert.equal(results[0].status,'fulfilled');
   await assert.rejects(()=>rpc(generator,'accounting_event_generate',args()));
   assert.equal(Number(await scalar('select count(*)from public.journal_entries where accounting_event_id=$1',[e.id])),1);
   await rpc(admin,'admin_set_membership',[generator,c,true]);
  });
 }finally{await Promise.all(clients.map(client=>client.end()));}
}
