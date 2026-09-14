import{Client}from'pg';
import assert from'node:assert/strict';
import{randomUUID}from'node:crypto';
export async function phase8aConcurrencyChecks({rpc,scalar,test,c,owner,reviewer,accountingDraft:draft,accountingPeriod:period,accountingType:type,accountingDebit:debit,accountingCredit:credit}){
 const url=new URL(process.env.TEST_DATABASE_URL);if(!['localhost','127.0.0.1'].includes(url.hostname)||!url.pathname.startsWith('/phase6_fixture_'))throw new Error('DISPOSABLE_LOCAL_DATABASE_REQUIRED');
 const clients=await Promise.all([0,1].map(async()=>{const client=new Client({connectionString:process.env.TEST_DATABASE_URL});await client.connect();await client.query('set role authenticated');return client;}));
 const race=(calls)=>Promise.allSettled(calls.map(async({user,fn,args},i)=>{const client=clients[i];await client.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[user,JSON.stringify({sub:user,session_id:user})]);return(await client.query(`select public.${fn}(${args.map((_,n)=>'$'+(n+1)).join(',')}) result`,args.map(a=>typeof a==='object'&&a!==null?JSON.stringify(a):a))).rows[0].result;}));
 try{
  let posted;
  await test('F8A CONCURRENT two posts produce one immutable posting',async()=>{
   posted=await draft();await rpc(owner,'journal_validate',[posted.id]);const result=await race([0,1].map(()=>({user:reviewer,fn:'journal_post',args:[posted.id,randomUUID()]})));assert.equal(result.filter(x=>x.status==='fulfilled').length,2);assert.equal(Number(await scalar('select count(*)from public.journal_postings where journal_entry_id=$1',[posted.id])),1);
  });
  await test('F8A CONCURRENT reversal creates exactly one inverse',async()=>{
   const payload={entry_date:'2026-09-13',accounting_period_id:period.id,entry_type_id:type.id,reason:'Reverso concurrente sintético'};const result=await race([0,1].map(()=>({user:owner,fn:'journal_reverse',args:[posted.id,payload,randomUUID()]})));assert.equal(result.filter(x=>x.status==='fulfilled').length,1);assert.equal(Number(await scalar('select count(*)from public.journal_entries where original_entry_id=$1',[posted.id])),1);
  });
  await test('F8A CONCURRENT period close and post serialize without late posting',async()=>{
   const e=await draft();await rpc(owner,'journal_validate',[e.id]);const result=await race([{user:reviewer,fn:'accounting_period_action',args:[period.id,'close','Cierre concurrente sintético']},{user:reviewer,fn:'journal_post',args:[e.id,randomUUID()]}]);assert.equal(result[0].status,'fulfilled');
   const count=Number(await scalar('select count(*)from public.journal_postings where journal_entry_id=$1',[e.id]));assert.equal(count,result[1].status==='fulfilled'?1:0);await assert.rejects(()=>draft(),/Open/);await rpc(reviewer,'accounting_period_action',[period.id,'reopen','Restaurar período sintético']);
  });
  await test('F8A CONCURRENT competing rule versions leave one simulation version active',async()=>{
   const payload={code:'CONCURRENT-SYNTH',name:'Regla sintética',source_event:'manual',valid_from:'2026-01-01',lines:[{account_id:debit.id,side:'debit',description:'Sintético',amount_key:'amount'},{account_id:credit.id,side:'credit',description:'Sintético',amount_key:'amount'}]};
   const first=await rpc(owner,'accounting_rule_save',[null,c,payload,randomUUID()]);const second=await rpc(owner,'accounting_rule_save',[first.id,c,payload,randomUUID()]);const result=await race([first,second].map(r=>({user:reviewer,fn:'accounting_rule_action',args:[r.id,'activate_simulation','Activación concurrente sintética']})));assert.equal(result.filter(x=>x.status==='fulfilled').length,2);assert.equal(Number(await scalar("select count(*)from public.accounting_rules where company_id=$1 and code=$2 and status='simulation_active'",[c,payload.code])),1);
  });
 }finally{await Promise.all(clients.map(c=>c.end()));}
}
