import assert from'node:assert/strict';
import{randomUUID}from'node:crypto';
export async function phase8bChecks({db,rpc,asUser,scalar,test,admin,c,b,owner,reviewer,currency,accountingRole,accountingPeriod,accountingType}){
 const existing=(await db.query('select permission_id from public.role_permissions where role_id=$1',[accountingRole.id])).rows.map(x=>x.permission_id);
 const more=(await db.query("select id from public.permissions where resource in('accounting_event','accounting_configuration','afe','legacy_mapping','demo_dashboard') or code='bank_transaction.classify_accounting'")).rows.map(x=>x.id);
 await rpc(admin,'admin_set_role_permissions',[accountingRole.id,[...existing,...more]]);
 const actors=[];for(const name of ['generator','validator','poster']){const id=randomUUID();await db.query('insert into auth.users values($1,$2)',[id,'f8b_'+name+'@example.test']);await db.query('insert into auth.sessions values($1,$1)',[id]);await db.query("insert into public.profiles(id,email,username,full_name,status)values($1,$2,$3,$3,'active')",[id,'f8b_'+name+'@example.test','f8b_'+name]);await rpc(admin,'admin_set_membership',[id,c,true]);await rpc(admin,'admin_set_user_role',[id,accountingRole.id,c,true]);actors.push(id);}
 const[generator,validator,poster]=actors;
 const e=(await db.query("select * from public.accounting_events where company_id=$1 and event_type='PAYABLE_RECOGNIZED'and event_date between '2026-09-01'and '2026-09-30'and currency_id=$2 limit 1",[c,currency])).rows[0];assert.ok(e);
 let rule,journal,debit,credit;
 await test('F8B financial operations succeed without mapping and capture immutable scoped events',async()=>{
  assert.equal(e.workflow_status,'pending_mapping');assert.ok(Number(await scalar('select count(*)from public.accounting_events'))>10);
  assert.equal(await rpc(admin,'has_permission',['accounting_event.generate',c]),false);
  await assert.rejects(()=>asUser(generator,"select private.capture_accounting_event('{}')"),/permission denied/);
  await assert.rejects(()=>asUser(generator,'insert into public.accounting_events(company_id)values($1)',[c]),/permission denied/);
 });
 await test('F8B event logical uniqueness is enforced by a real database constraint',async()=>{
  await assert.rejects(()=>db.query('insert into public.accounting_events(company_id,event_type,source_type,source_id,source_revision,event_date,currency_id,amount,source_snapshot)select company_id,event_type,source_type,source_id,source_revision,event_date,currency_id,amount,source_snapshot from public.accounting_events where id=$1',[e.id]),/unique|duplicate/);
  assert.equal(Number(await scalar('select count(*)from public.accounting_events where company_id=$1 and event_type=$2 and source_type=$3 and source_id=$4 and source_revision=$5',[c,e.event_type,e.source_type,e.source_id,e.source_revision])),1);
 });
 await test('F8B feature flags block productive accounting and resolution stays pending without configuration',async()=>{
  assert.equal((await rpc(generator,'accounting_event_resolve',[e.id])).workflow_status,'pending_mapping');
  await assert.rejects(()=>rpc(generator,'accounting_demo_configure',[c,true,'Sin designación']),/designation/);
  await rpc(generator,'accounting_demo_company_designate',[c,'Empresa exclusivamente sintética para pruebas DEMO']);
  await assert.rejects(()=>rpc(generator,'accounting_demo_company_designate',[c,'Otro motivo']),/immutable/);
  await assert.rejects(()=>asUser(generator,'delete from public.accounting_demo_companies where company_id=$1',[c]),/permission denied/);
  await rpc(generator,'accounting_demo_configure',[c,true,'Configuración exclusivamente DEMO']);
  await assert.rejects(()=>db.query('update public.accounting_feature_flags set auto_post=true where company_id=$1',[c]),/check constraint/);
  const account={name:'DEMO cuenta ficticia',account_type:'asset',normal_balance:'debit',allows_posting:true,valid_from:'2000-01-01'};
  debit=await rpc(generator,'accounting_master_save',['account',null,c,{...account,code:'DEMO-DEBIT'}]);credit=await rpc(generator,'accounting_master_save',['account',null,c,{...account,code:'DEMO-CREDIT'}]);
  rule=await rpc(generator,'accounting_rule_save',[null,c,{code:'DEMO-RULE',name:'DEMO regla ficticia',source_event:e.event_type,valid_from:e.event_date,lines:[{account_id:debit.id,side:'debit',description:'DEMO',amount_key:'amount'},{account_id:credit.id,side:'credit',description:'DEMO',amount_key:'amount'}]},randomUUID()]);
  await rpc(validator,'accounting_rule_action',[rule.id,'activate_simulation','Prueba DEMO']);
  assert.equal((await rpc(generator,'accounting_event_resolve',[e.id])).workflow_status,'pending_mapping');
  await rpc(validator,'accounting_demo_rule_designate',[rule.id,'Designación DEMO explícita']);
  assert.equal((await rpc(generator,'accounting_event_resolve',[e.id])).workflow_status,'ready');
 });
 await test('F8B preview is based on the immutable persisted event and never posts',async()=>{
  const before=await scalar('select count(*)from public.journal_entries');const p=await rpc(generator,'accounting_event_preview',[e.id]);assert.equal(p.valid,true);assert.equal(p.persisted,false);assert.equal(p.configuration,'CONFIGURACIÓN DEMO - NO PRODUCTIVA');assert.equal(Number(p.debits),Number(e.amount));assert.equal(await scalar('select count(*)from public.journal_entries'),before);
 });
 await test('F8B executive DEMO dashboard is derived from scoped persisted aggregates',async()=>{
  const dashboard=await rpc(generator,'accounting_demo_dashboard',[c]);
  for(const key of ['payables_outstanding','receivables_outstanding','upcoming_payments','collections','registered_bank'])assert.ok(Array.isArray(dashboard[key]));
  assert.equal(typeof dashboard.travel_pending,'number');assert.equal(typeof dashboard.accounting_pending,'number');
  await assert.rejects(()=>rpc(generator,'accounting_demo_dashboard',[b]));
 });
 await test('F8B manual generation is idempotent and preserves bidirectional source links',async()=>{
  await assert.rejects(()=>rpc(e.operation_actor_id,'accounting_event_generate',[e.id,accountingPeriod.id,accountingType.id,randomUUID()]),/operator|permission|denied/i);
  const key=randomUUID();journal=await rpc(generator,'accounting_event_generate',[e.id,accountingPeriod.id,accountingType.id,key]);assert.equal(journal.status,'draft');assert.equal(journal.accounting_event_id,e.id);
  const retry=await rpc(generator,'accounting_event_generate',[e.id,accountingPeriod.id,accountingType.id,randomUUID()]);assert.equal(retry.id,journal.id);
  assert.equal(Number(await scalar('select count(*)from public.journal_entries where accounting_event_id=$1',[e.id])),1);
  assert.equal(await scalar('select journal_entry_id from public.accounting_events where id=$1',[e.id]),journal.id);
  assert.ok(Number(await scalar('select count(*)from public.accounting_event_sources where event_id=$1',[e.id]))>=1);
 });
 await test('F8B operation, generation, validation and posting require distinct actors',async()=>{
  await assert.rejects(()=>rpc(generator,'journal_validate',[journal.id]),/independent/);
  await rpc(validator,'journal_validate',[journal.id]);await assert.rejects(()=>rpc(validator,'journal_post',[journal.id,randomUUID()]),/independent/);
  await rpc(poster,'journal_post',[journal.id,randomUUID()]);assert.equal((await asUser(generator,'select status from public.accounting_event_queue where id=$1',[e.id])).rows[0].status,'posted');
  await assert.rejects(()=>asUser(generator,"update public.accounting_events set workflow_status='posted'where id=$1",[e.id]),/permission denied/);
 });
 await test('F8B company isolation and membership revocation apply to existing events and retries',async()=>{
  await rpc(admin,'admin_set_membership',[generator,c,false]);assert.equal((await asUser(generator,'select * from public.accounting_event_queue')).rows.length,0);await assert.rejects(()=>rpc(generator,'accounting_event_generate',[e.id,accountingPeriod.id,accountingType.id,randomUUID()]));await rpc(admin,'admin_set_membership',[generator,c,true]);
  assert.equal((await asUser(generator,'select * from public.accounting_events where company_id=$1',[b])).rows.length,0);
  await rpc(generator,'accounting_demo_configure',[c,false,'Bloqueo DEMO']);await assert.rejects(()=>rpc(generator,'accounting_event_generate',[e.id,accountingPeriod.id,accountingType.id,randomUUID()]),/disabled/);await rpc(generator,'accounting_demo_configure',[c,true,'Restaurar DEMO']);
 });
 await test('F8B event audit records source, mapping, preview and generated journal without secrets',async()=>{
  const actions=(await db.query("select action from public.audit_logs where company_id=$1 and entity_id=$2",[c,e.id])).rows.map(x=>x.action);
  for(const action of ['accounting.captured','accounting.resolved','accounting.previewed','accounting.draft_generated'])assert.ok(actions.includes(action));
 });
 await test('F8B configurable AFE import preview rolls back and confirmation is idempotent',async()=>{
  const rows=[{code:'TEST-AFE',name:'TEST dimensión sin significado asumido',valid_from:'2026-01-01'}],key=randomUUID();
  const p=await rpc(generator,'accounting_master_import',['afe',c,rows,false,key]);assert.equal(p.status,'preview');
  assert.equal(Number(await scalar("select count(*)from public.afes where company_id=$1 and code='TEST-AFE'",[c])),0);
  assert.equal((await rpc(generator,'accounting_master_import',['afe',c,rows,true,key])).status,'imported');
  await rpc(generator,'accounting_master_import',['afe',c,rows,true,key]);
  assert.equal(Number(await scalar("select count(*)from public.afes where company_id=$1 and code='TEST-AFE'",[c])),1);
  await assert.rejects(()=>rpc(generator,'accounting_master_import',['afe',b,rows,true,randomUUID()]));
 });
 await test('F8B legacy mappings preserve explicit versions without inferring meanings',async()=>{
  const p={dictionary:'SUBDIARIO',legacy_code:'TEST-UNDEFINED',valid_from:'2026-01-01',notes:'Pendiente de definición empresarial'};
  const a=await rpc(generator,'accounting_legacy_save',[null,c,p]);assert.deepEqual(a.erp_mapping,{});
  const b=await rpc(generator,'accounting_legacy_save',[a.id,c,{...p,notes:'Nueva revisión explícita'}]);assert.equal(b.version,2);assert.equal(b.previous_version_id,a.id);
  await assert.rejects(()=>asUser(generator,"update public.legacy_mappings set description='altered'where id=$1",[a.id]),/permission denied/);
  await assert.rejects(()=>rpc(generator,'accounting_legacy_save',[a.id,c,{...p,legacy_code:'OTHER'}]),/identity immutable/);
 });
 await test('F8B rule dimension values are explicit, company-scoped and immutable',async()=>{
  const afe=await scalar("select id from public.afes where company_id=$1 and code='TEST-AFE'",[c]);
  const draft=await rpc(generator,'accounting_rule_save',[null,c,{code:'DEMO-DIMENSION-RULE',name:'DEMO regla con dimensión explícita',source_event:'PAYABLE_RECOGNIZED',valid_from:'2026-09-22',lines:[{account_id:debit.id,side:'debit',description:'DEMO',amount_key:'amount'},{account_id:credit.id,side:'credit',description:'DEMO',amount_key:'amount'}]},randomUUID()]);
  await rpc(generator,'accounting_rule_dimension_match_save',[draft.id,c,[{dimension_type:'afe_future',dimension_id:afe}]]);
  assert.equal(Number(await scalar("select count(*)from public.accounting_rule_dimension_matches where rule_id=$1 and dimension_id=$2",[draft.id,afe])),1);
  await assert.rejects(()=>rpc(generator,'accounting_rule_dimension_match_save',[draft.id,c,[{dimension_type:'afe_future',dimension_id:afe}]]),/new rule version/);
 });
 await test('F8B bank adjustment needs explicit authorized classification and never infers all bank movements',async()=>{
  const bank=(await db.query("select * from public.bank_transactions where company_id=$1 and source in('manual','import') and evidence_state='confirmed' and status<>'reconciled' order by id limit 1",[c])).rows[0];assert.ok(bank);
  const first=await rpc(generator,'accounting_bank_adjustment_capture',[bank.id,'Ajuste sintético explícitamente clasificado']);
  const retry=await rpc(generator,'accounting_bank_adjustment_capture',[bank.id,'Ajuste sintético explícitamente clasificado']);assert.equal(first.accounting_event_id,retry.accounting_event_id);
  assert.equal(Number(await scalar("select count(*)from public.accounting_events where source_type='bank_adjustment'and source_id=$1",[first.id])),1);
  await assert.rejects(()=>rpc(generator,'accounting_bank_adjustment_capture',[bank.id,'Razón distinta']),/immutable/);
  await assert.rejects(()=>asUser(generator,"insert into public.bank_accounting_adjustments(company_id,bank_transaction_id,reason,created_by)values($1,$2,'Forged',$3)",[c,bank.id,generator]),/permission denied/);
 });
 await test('F8B disabling DEMO prevents generation but preserves controlled reversal of posted evidence',async()=>{
  await rpc(generator,'accounting_demo_configure',[c,false,'Deshabilitar nuevas operaciones DEMO']);
  const inverse=await rpc(validator,'journal_reverse',[journal.id,{entry_date:'2026-09-22',accounting_period_id:accountingPeriod.id,entry_type_id:accountingType.id,reason:'Reversión controlada de fixture DEMO'},randomUUID()]);
  assert.equal(inverse.status,'posted');
  assert.equal(await scalar('select status from public.journal_entries where id=$1',[journal.id]),'reversed');
  assert.equal((await asUser(generator,'select status from public.accounting_event_queue where id=$1',[e.id])).rows[0].status,'posted');
 });
 return{generator,validator,poster,event:e,rule,journal};
}
