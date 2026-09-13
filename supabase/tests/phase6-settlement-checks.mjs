import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function phase6SettlementChecks({db,rpc,asUser,scalar,test,admin,c,b,owner,reviewer,outsider,currency,offline,category,base,supplier}) {
 const approver=await scalar("select id from public.profiles where username='reconciler'");
 const save=(u,k,p,id=null)=>rpc(u,'treasury_save',[k,id,c,p]);
 const action=(u,k,id,a,p={})=>rpc(u,'treasury_action',[k,id,a,p]);
 const reportAction=(u,id,a,reason=null)=>rpc(u,'expense_report_transition',[id,a,reason]);
 const delegate=await scalar("select id from public.permissions where code='travel_expense.create_for_employee'");
 await rpc(admin,'admin_set_override',[owner,delegate,c,'allow','Settlement synthetic fixture']);
 const policy=await rpc(owner,'employee_foundation_save',['policy',null,c,{currency_id:currency,allow_declarations:true,category_ids:[category.id],declaration_max_amount:500,allow_partial_acceptance:true,allow_reopen:true,allow_other_support:true}]);
 const bank=await scalar('select id from public.company_bank_accounts where company_id=$1 limit 1',[c]);
 const method=await save(owner,'payment_method',{code:'f6_settlement_fixture',name:'Medio sintético',requires_beneficiary_account:false});
 async function evidence(u,kind,id){
  const a=await rpc(u,'attachment_prepare_versioned',[c,kind,id,'synthetic.pdf','application/pdf',10,'V1']);
  await asUser(u,'insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',['financial-encrypted',a.storage_path,{size:42,mimetype:'application/octet-stream'}]);
  await rpc(u,'attachment_finish',[a.id]);return a;
 }
 async function payObligation(payable,opApprover=approver){
  const order=await save(owner,'payment_order',{beneficiary_type:'employee',beneficiary_id:offline.id,currency_id:currency,payment_method_id:method.id,requested_payment_date:'2027-01-02',description:'Fixture rendición',items:[{payable_id:payable.id,amount_to_pay:Number(payable.outstanding_amount)}]});
  await action(owner,'payment_order',order.id,'submit');await action(opApprover,'payment_order',order.id,'approve');
  await action(outsider,'payment_order',order.id,'schedule',{bank_account_id:bank,scheduled_payment_date:'2027-01-02'});
  const payment=await save(outsider,'payment',{payment_order_id:order.id,payment_date:'2027-01-02',operation_number:randomUUID(),allocations:[{payable_id:payable.id,allocated_amount:Number(payable.outstanding_amount)}]});
  await evidence(outsider,'payment',payment.id);await action(outsider,'payment',payment.id,'execute');return {order,payment};
 }
 async function reportWithItem(advance,amount,support='declaration'){
  let travel,advanceRow,advancePayment;
  if(advance){
   travel=await rpc(owner,'travel_expense_save',[null,c,{...base,employee_id:offline.id,start_date:'2027-01-01',end_date:'2027-01-03',requested_advance_amount:advance,items:[{...base.items[0],estimated_amount:Math.max(advance,amount)}]}]);
   await rpc(owner,'travel_expense_transition',[travel.id,'submit',null]);await rpc(reviewer,'travel_expense_transition',[travel.id,'approve',null]);
   advanceRow=(await db.query('select * from public.employee_advances where travel_request_id=$1',[travel.id])).rows[0];
   const payable=(await db.query('select * from public.payables where employee_advance_id=$1',[advanceRow.id])).rows[0];
   advancePayment=await payObligation(payable);
  }
  const report=await rpc(owner,'expense_report_create',[c,{employee_id:offline.id,currency_id:currency,...(travel?{travel_expense_request_id:travel.id}:{})}]);
  const item=await rpc(owner,'expense_item_save',[report.id,null,{expense_date:'2027-01-02',category_id:category.id,description:'Gasto sintético',reported_amount:amount,support_type:support,cost_center_id:base.cost_center_id,project_id:base.project_id}]);
  return {report,item,advanceRow,advancePayment};
 }
 async function review(f,accepted=Number(f.item.reported_amount),approve=true){
  if(f.item.support_type==='declaration'){
   const declaration=await rpc(owner,'expense_declaration_create',[f.item.id,'2027-01-02','Declaración sintética estructurada']);
   await assert.rejects(()=>rpc(owner,'expense_declaration_decide',[declaration.id,true,'Auto aprobación']),/segregation/);
   await rpc(reviewer,'expense_declaration_decide',[declaration.id,true,'Aprobación sintética']);
   assert.equal(await scalar('select status from public.expense_report_items where id=$1',[f.item.id]),'pending');
  }
  await reportAction(owner,f.report.id,'submit');
  await rpc(reviewer,'expense_item_review',[f.item.id,'accepted',accepted,'Revisión sintética']);
  await assert.rejects(()=>reportAction(reviewer,f.report.id,'approve'),/Reviewer and approver/);
  if(!approve)return null;
  await reportAction(approver,f.report.id,'approve');
  return rpc(approver,'expense_settlement_detail',[f.report.id]);
 }
 await test('F6 expense own/company security and no manually supplied totals',async()=>{
  await assert.rejects(()=>rpc(owner,'expense_report_create',[b,{employee_id:offline.id,currency_id:currency}]));
  await assert.rejects(()=>rpc(owner,'expense_report_create',[c,{employee_id:offline.id,currency_id:currency,total_accepted:1}]),/Invalid/);
  await assert.rejects(()=>asUser(owner,"update public.expense_reports set status='settled'"),/permission denied/);
 });
 await test('F6 declaration policy and exact partial item acceptance apply in database',async()=>{
  const f=await reportWithItem(0,100);assert.match(f.report.report_number,/REN-\d{4}-\d{6}/);
  const s=await review(f,80);
  assert.equal(Number(s.reimbursement_due),80);assert.equal(Number(s.return_due),0);
  const item=(await db.query('select * from public.expense_report_items where id=$1',[f.item.id])).rows[0];
  assert.equal(Number(item.rejected_amount),20);assert.ok(item.dimension_snapshot.expense_category.name);
  const high=await reportWithItem(0,501);await assert.rejects(()=>rpc(owner,'expense_declaration_create',[high.item.id,'2027-01-02','Over policy']),/policy/);
 });
 let reimbursementCase;
 await test('F6 180 advance / 220 accepted creates exactly one 40 reimbursement and no direct paid',async()=>{
  const f=await reportWithItem(180,220);const s=await review(f);reimbursementCase={...f,s};
  assert.equal(Number(s.reimbursement_due),40);assert.equal(Number(s.return_due),0);
  await reportAction(approver,f.report.id,'approve');
  assert.equal(await scalar('select count(*)::int from public.employee_reimbursements where report_id=$1',[f.report.id]),1);
  await assert.rejects(()=>reportAction(approver,f.report.id,'close'),/Outstanding/);
  await assert.rejects(()=>action(reviewer,'payment',f.advancePayment.payment.id,'reverse',{reason:'Invalidated basis'}),/Reopen expense/);
 });
 await test('F6 reimbursement uses Phase5 payments, closes, and reversal restores pending settlement',async()=>{
  const {report,s}=reimbursementCase;
  const payable=(await db.query('select p.* from public.payables p join public.employee_reimbursements e on e.id=p.employee_reimbursement_id where e.report_id=$1',[report.id])).rows[0];
  const paid=await payObligation(payable,reviewer);
  assert.equal(Number((await rpc(owner,'expense_settlement_detail',[report.id])).reimbursement_outstanding),0);
  await reportAction(approver,report.id,'close');assert.equal(await scalar('select outstanding_to_render::text from public.employee_advances where id=$1',[reimbursementCase.advanceRow.id]),'0.00');
  await action(reviewer,'payment',paid.payment.id,'reverse',{reason:'Reverso sintético de reembolso'});
  assert.equal(await scalar('select status from public.expense_reports where id=$1',[report.id]),'settlement_pending');
  assert.equal(Number((await rpc(owner,'expense_settlement_detail',[report.id])).reimbursement_outstanding),40);
  assert.equal(Number(await scalar('select outstanding_to_render from public.employee_advances where id=$1',[reimbursementCase.advanceRow.id])),180);
 });
 await test('F6 180 / 160 requires evidence and explicit credit reconciliation for return',async()=>{
  const f=await reportWithItem(180,160);const s=await review(f);assert.equal(Number(s.return_due),20);
  const payload={amount:20,return_date:'2027-01-02',payment_method_id:method.id,reference:'DEV synthetic return',idempotency_key:randomUUID()};
  const returned=await rpc(owner,'employee_return_register',[s.id,payload]);assert.equal(returned.status,'registered');
  assert.equal((await rpc(owner,'employee_return_register',[s.id,payload])).id,returned.id);
  await assert.rejects(()=>rpc(owner,'employee_return_register',[s.id,{...payload,idempotency_key:randomUUID()}]),/unreserved/);
  await assert.rejects(()=>reportAction(approver,f.report.id,'close'),/Outstanding/);
  const period=await save(reviewer,'reconciliation_period',{bank_account_id:bank,start_date:'2027-01-01',end_date:'2027-01-31'});
  const transaction=await save(reviewer,'bank_transaction',{bank_account_id:bank,transaction_date:'2027-01-02',transaction_type:'credit',amount:20,bank_reference:'SYNTHETIC-RETURN',description:'Devolución sintética'});
  await assert.rejects(()=>rpc(reviewer,'employee_return_match',[returned.id,period.id,transaction.id,20]),/evidence/);
  await evidence(owner,'employee_return_evidence',returned.id);
  const match=await rpc(reviewer,'employee_return_match',[returned.id,period.id,transaction.id,20]);
  assert.equal(Number((await rpc(owner,'expense_settlement_detail',[f.report.id])).return_outstanding),20);
  await action(reviewer,'reconciliation_match',match.id,'reconcile');
  await reportAction(approver,f.report.id,'close');await reportAction(approver,f.report.id,'close');
  assert.equal(await scalar('select status from public.expense_reports where id=$1',[f.report.id]),'settled');
  await action(reviewer,'reconciliation_match',match.id,'unmatch',{reason:'Unmatch sintético'});
  assert.equal(await scalar('select status from public.expense_reports where id=$1',[f.report.id]),'settlement_pending');
 });
 await test('F6 exact settlement closes and controlled reopening preserves old settlement',async()=>{
  const f=await reportWithItem(180,180);await review(f);await reportAction(approver,f.report.id,'close');
  await assert.rejects(()=>reportAction(approver,f.report.id,'reopen'),/reason/);
  await reportAction(approver,f.report.id,'reopen','Corrección autorizada sintética');
  assert.equal(await scalar("select count(*)::int from public.expense_settlements where report_id=$1 and status='superseded'",[f.report.id]),1);
  assert.ok(await scalar("select count(*)::int from public.expense_report_history where report_id=$1 and action='reopen' and actor_id=$2",[f.report.id,approver]));
 });
 await test('F6 existing tax_documents, encrypted support and duplicate protection are reused',async()=>{
  const f=await reportWithItem(0,100,'tax_document');
  const data={supplier_id:supplier.supplier_id,document_type:'invoice',series:'F6',number:'123456',issue_date:'2027-01-02',received_date:'2027-01-02',subtotal:100,tax_amount:0,non_taxable_amount:0};
  const doc=await rpc(owner,'expense_tax_document',[f.item.id,data]);
  assert.equal(doc.request_id,null);assert.equal(doc.expense_report_item_id,f.item.id);
  const duplicate=await reportWithItem(0,100,'tax_document');await assert.rejects(()=>rpc(owner,'expense_tax_document',[duplicate.item.id,data]),/unique/);
  await evidence(owner,'tax_support',f.item.id);await rpc(reviewer,'expense_tax_document_review',[doc.id]);
  await review(f);assert.equal(Number((await rpc(owner,'expense_settlement_detail',[f.report.id])).reimbursement_due),100);
  await assert.rejects(()=>rpc(reviewer,'financial_transition',['tax_document',doc.id,'cancel','Intento de invalidar sustento aceptado']),/Accepted expense document immutable/);
 });
 await test('F6 unpaid approved VIA cancellation requires policy, reason and no delivered money',async()=>{
  const make=async()=>{const t=await rpc(owner,'travel_expense_save',[null,c,{...base,employee_id:offline.id,requested_advance_amount:100,items:[{...base.items[0],estimated_amount:100}]}]);await rpc(owner,'travel_expense_transition',[t.id,'submit',null]);await rpc(reviewer,'travel_expense_transition',[t.id,'approve',null]);return t;};
  const denied=await make();await assert.rejects(()=>rpc(owner,'travel_cancel_unpaid',[denied.id,'Fixture cancellation']),/Policy/);
  await rpc(owner,'employee_foundation_save',['policy',null,c,{currency_id:currency,allow_declarations:true,category_ids:[category.id],declaration_max_amount:500,allow_partial_acceptance:true,allow_reopen:true,allow_cancel_unpaid_travel:true,allow_other_support:true}]);
  const t=await make();await assert.rejects(()=>rpc(owner,'travel_cancel_unpaid',[t.id,'']),/reason/);
  await rpc(owner,'travel_cancel_unpaid',[t.id,'Cancelación sin desembolso sintético']);
  await rpc(owner,'travel_cancel_unpaid',[t.id,'Reintento idempotente']);
  assert.equal(await scalar('select status from public.employee_advances where travel_request_id=$1',[t.id]),'cancelled');
  assert.equal(await scalar("select count(*)::int from public.travel_expense_history where request_id=$1 and action='cancel_unpaid'",[t.id]),1);
  const delivered=await reportWithItem(100,100);await assert.rejects(()=>rpc(owner,'travel_cancel_unpaid',[delivered.advanceRow.travel_request_id,'No debe cancelar']),/Financial effects/);
 });
 await rpc(admin,'admin_set_override',[owner,delegate,c,'inherit','Restore fixture']);
 return {reportWithItem,review,bank,method,approver};
}
