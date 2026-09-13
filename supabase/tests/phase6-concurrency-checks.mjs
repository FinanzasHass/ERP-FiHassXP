import {Client} from 'pg';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function phase6ConcurrencyChecks({db,rpc,asUser,scalar,test,admin,c,owner,reviewer,outsider,offline,base,reportWithItem,review,method,approver}) {
 const target=new URL(process.env.TEST_DATABASE_URL);
 if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.startsWith('/phase6_fixture_'))throw new Error('DISPOSABLE_LOCAL_DATABASE_REQUIRED');
 const connections=await Promise.all([0,1].map(async()=>{const client=new Client({connectionString:process.env.TEST_DATABASE_URL});await client.connect();return client;}));
 async function concurrent(user,fn,args){
  await Promise.all(connections.map(client=>client.query(`set role authenticated`)));
  await Promise.all(connections.map(client=>client.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[user,JSON.stringify({sub:user,session_id:user})])));
  return Promise.allSettled(connections.map((client,index)=>client.query(`select public.${fn}(${args[index].map((_,i)=>'$'+(i+1)).join(',')}) result`,args[index])));
 }
 const delegate=await scalar("select id from public.permissions where code='travel_expense.create_for_employee'");
 await rpc(admin,'admin_set_override',[owner,delegate,c,'allow','Concurrent local synthetic fixture']);
 try{
  await test('F6 CONCURRENT approve VIA is idempotent across independent PostgreSQL transactions',async()=>{
   const travel=await rpc(owner,'travel_expense_save',[null,c,{...base,employee_id:offline.id}]);await rpc(owner,'travel_expense_transition',[travel.id,'submit',null]);
   const result=await concurrent(reviewer,'travel_expense_transition',[[travel.id,'approve',null],[travel.id,'approve',null]]);
   assert.equal(result.filter(x=>x.status==='fulfilled').length,2);
   assert.equal(await scalar('select count(*)::int from public.employee_advances where travel_request_id=$1',[travel.id]),1);
   assert.equal(await scalar('select count(*)::int from public.payables p join public.employee_advances a on a.id=p.employee_advance_id where a.travel_request_id=$1',[travel.id]),1);
  });
  await test('F6 CONCURRENT reimbursement creation cannot duplicate obligations',async()=>{
   const f=await reportWithItem(0,40);await review(f,40,false);
   const result=await concurrent(approver,'expense_report_transition',[[f.report.id,'approve',null],[f.report.id,'approve',null]]);
   assert.equal(result.filter(x=>x.status==='fulfilled').length,2);
   assert.equal(await scalar('select count(*)::int from public.employee_reimbursements where report_id=$1',[f.report.id]),1);
   assert.equal(await scalar('select count(*)::int from public.payables p join public.employee_reimbursements e on e.id=p.employee_reimbursement_id where e.report_id=$1',[f.report.id]),1);
  });
  await test('F6 CONCURRENT closes consume the settlement once and preserve one close event',async()=>{
   const f=await reportWithItem(180,180);await review(f);
   const result=await concurrent(approver,'expense_report_transition',[[f.report.id,'close',null],[f.report.id,'close',null]]);
   assert.equal(result.filter(x=>x.status==='fulfilled').length,2);
   assert.equal(await scalar("select count(*)::int from public.expense_report_history where report_id=$1 and action='close'",[f.report.id]),1);
   assert.equal(Number(await scalar('select outstanding_to_render from public.employee_advances where id=$1',[f.advanceRow.id])),0);
  });
  await test('F6 CONCURRENT returns reserve the same remainder only once',async()=>{
   const f=await reportWithItem(180,160);const s=await review(f);
   const payload={amount:20,return_date:'2027-01-02',payment_method_id:method.id,reference:'Concurrent synthetic return'};
   const result=await concurrent(owner,'employee_return_register',[[s.id,{...payload,idempotency_key:randomUUID()}],[s.id,{...payload,idempotency_key:randomUUID()}]]);
   assert.equal(result.filter(x=>x.status==='fulfilled').length,1);
   assert.equal(Number(await scalar('select sum(amount) from public.employee_returns where settlement_id=$1',[s.id])),20);
  });
  await test('F6 CONCURRENT payment execution and reversal keep advance equal to net allocations',async()=>{
   const f=await reportWithItem(180,180);
   await rpc(reviewer,'treasury_action',['payment',f.advancePayment.payment.id,'reverse',{reason:'Prepare concurrency fixture'}]);
   const payable=await scalar('select id from public.payables where employee_advance_id=$1',[f.advanceRow.id]);
   async function draft(){
    const p=await rpc(outsider,'treasury_save',['payment',null,c,{payment_order_id:f.advancePayment.order.id,payment_date:'2027-01-02',operation_number:randomUUID(),allocations:[{payable_id:payable,allocated_amount:180}]}]);
    const a=await rpc(outsider,'attachment_prepare_versioned',[c,'payment',p.id,'synthetic.pdf','application/pdf',10,'V1']);
    await asUser(outsider,'insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',['financial-encrypted',a.storage_path,{size:42,mimetype:'application/octet-stream'}]);await rpc(outsider,'attachment_finish',[a.id]);return p;
   }
   const left=await draft(),right=await draft();await rpc(outsider,'treasury_action',['payment',left.id,'execute',{}]);
   const result=await concurrent(outsider,'treasury_action',[['payment',left.id,'reverse',{reason:'Concurrent reversal'}],['payment',right.id,'execute',{}]]);
   assert.equal(result[0].status,'fulfilled');
   const paid=Number(await scalar('select paid_amount from public.employee_advances where id=$1',[f.advanceRow.id]));
   const allocated=Number(await scalar("select coalesce(sum(a.allocated_amount),0) from public.payment_allocations a join public.payments p on p.id=a.payment_id where a.payable_id=$1 and p.status='executed'",[payable]));
   assert.equal(paid,allocated);assert.ok([0,180].includes(paid));
  });
 }finally{await Promise.all(connections.map(client=>client.end()));await rpc(admin,'admin_set_override',[owner,delegate,c,'inherit','Restore fixture']);}
}
