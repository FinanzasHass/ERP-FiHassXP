import assert from 'node:assert/strict';
import {randomUUID}from 'node:crypto';
export async function phase8aChecks({db,rpc,asUser,scalar,test,admin,c,b,owner,reviewer,outsider,currency}){
 const role=await rpc(admin,'admin_save_entity',['role',null,{code:'phase8a_synthetic',name:'Contabilidad sintética'}]);
 const ids=(await db.query("select id from public.permissions where active and resource in('accounting_account','accounting_period','journal','accounting_rule','general_ledger','trial_balance')")).rows.map(r=>r.id);
 await rpc(admin,'admin_set_role_permissions',[role.id,ids]);for(const u of [owner,reviewer])await rpc(admin,'admin_set_user_role',[u,role.id,c,true]);
 const save=(kind,payload,id=null)=>rpc(owner,'accounting_master_save',[kind,id,c,payload]);
 let parent,debit,credit,period,type,settings,posted;
 const account={name:'Cuenta exclusivamente sintética',account_type:'asset',normal_balance:'debit',allows_posting:true,valid_from:'2026-01-01'};
 await test('F8A no invented accounts; explicit settings and hierarchical accounts are company scoped',async()=>{
  assert.equal(Number(await scalar('select count(*)from public.accounting_accounts')),0);
  settings=await save('settings',{functional_currency_id:currency,number_prefix:'TEST',number_digits:6});
  parent=await save('account',{...account,code:'SYNTH',allows_posting:false});debit=await save('account',{...account,code:'SYNTH-D',parent_id:parent.id});credit=await save('account',{...account,code:'SYNTH-C',account_type:'liability',normal_balance:'credit',parent_id:parent.id});
  assert.equal(debit.level,2);await assert.rejects(()=>save('account',{...account,code:'SYNTH-D'}),/duplicate|unique/i);
  await assert.rejects(()=>save('account',{parent_id:debit.id},parent.id),/cycle/);
  assert.equal((await asUser(outsider,'select * from public.accounting_accounts')).rows.length,0);
  await assert.rejects(()=>rpc(owner,'accounting_master_save',['account',null,b,{...account,code:'CROSS'}]));
  const root=await save('account',{...account,code:'DEPTH-R'}),child=await save('account',{...account,code:'DEPTH-C',parent_id:root.id}),grand=await save('account',{...account,code:'DEPTH-G',parent_id:child.id});
  await save('account',{parent_id:debit.id},root.id);assert.equal(Number(await scalar('select level from public.accounting_accounts where id=$1',[grand.id])),5);
 });
 await test('F8A account import previews roll back; confirmation is idempotent and never renames',async()=>{
  const input=[{...account,code:'IMPORT-CHILD',parent_code:'IMPORT-ROOT'},{...account,code:'IMPORT-ROOT',allows_posting:false}],key=randomUUID();
  const before=Number(await scalar('select count(*)from public.accounting_accounts'));const preview=await rpc(owner,'accounting_account_import',[c,input,false,key]);assert.equal(preview.status,'preview');assert.equal(Number(await scalar('select count(*)from public.accounting_accounts')),before);
  await assert.rejects(()=>rpc(owner,'accounting_account_import',[c,input,null,key]),/confirmation boolean/);assert.equal(Number(await scalar('select count(*)from public.accounting_accounts')),before);
  const result=await rpc(owner,'accounting_account_import',[c,input,true,key]);assert.equal(result.validated_rows,2);assert.deepEqual(await rpc(owner,'accounting_account_import',[c,input,true,key]),result);
  await assert.rejects(()=>rpc(owner,'accounting_account_import',[c,input,true,randomUUID()]),/Duplicate/);
  const invalid=await rpc(owner,'accounting_account_import',[c,input,false,randomUUID()]);assert.equal(invalid.status,'invalid');assert.equal(invalid.errors.length,2);assert.equal(invalid.persisted,false);
 });
 await test('F8A explicit periods and voucher types; closed periods reject creation',async()=>{
  period=await save('period',{year:2026,month:9,start_date:'2026-09-01',end_date:'2026-09-30'});type=await save('entry_type',{code:'manual',name:'Manual sintético'});
  assert.equal(period.status,'open');await assert.rejects(()=>save('period',{year:2026,month:9,start_date:'2026-09-15',end_date:'2026-09-30'}),/Overlapping/);
 });
 const payload=(lines,extra={})=>({entry_date:'2026-09-13',accounting_period_id:period.id,entry_type_id:type.id,description:'Asiento de prueba sintético',currency_id:currency,lines,...extra});
 const lines=(n=100)=>[{account_id:debit.id,description:'Debe sintético',debit:n,credit:0},{account_id:credit.id,description:'Haber sintético',debit:0,credit:n}];
 const draft=(input=lines(),extra={})=>rpc(owner,'journal_save',[null,c,payload(input,extra),randomUUID()]);
 await test('F8A validation rejects imbalance, dual-sided line and nonpostable account',async()=>{
  const unbalanced=lines();unbalanced[1].credit=99;const e=await draft(unbalanced);await assert.rejects(()=>rpc(owner,'journal_validate',[e.id]),/balance exactly/);
  const dual=lines();dual[0].credit=1;await assert.rejects(()=>draft(dual),/check constraint/);
  const nonpost=lines();nonpost[0].account_id=parent.id;const r=await draft(nonpost);await assert.rejects(()=>rpc(owner,'journal_validate',[r.id]),/postable/);
  const rounded=lines(.001);await assert.rejects(()=>draft(rounded),/precision/);
 });
 await test('F8A validate then post independently; retry idempotent and posted lines immutable',async()=>{
  posted=await draft();assert.match(posted.entry_number,/TEST-2026-\d{6}/);await rpc(owner,'journal_validate',[posted.id]);
  await assert.rejects(()=>rpc(owner,'journal_post',[posted.id,randomUUID()]),/independent/);
  const key=randomUUID();const result=await rpc(reviewer,'journal_post',[posted.id,key]);assert.equal(result.status,'posted');assert.equal((await rpc(reviewer,'journal_post',[posted.id,key])).id,posted.id);
  assert.equal(Number(await scalar('select count(*)from public.journal_postings where journal_entry_id=$1',[posted.id])),1);
  await assert.rejects(()=>rpc(owner,'journal_save',[posted.id,c,payload(lines()),randomUUID()]),/draft|unposted/);
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[owner,JSON.stringify({sub:owner,session_id:owner})]);
  await assert.rejects(()=>db.query('update public.journal_entry_lines set description=$1 where journal_entry_id=$2',['Tamper',posted.id]),/immutable/);
  await assert.rejects(()=>db.query('delete from public.accounting_accounts where id=$1',[debit.id]),/deletion/);
  await assert.rejects(()=>save('account',{code:'MUTATED'},debit.id),/immutable/);
 });
 await test('F8A closed/soft-closed period blocks posting and reopening is audited',async()=>{
  const e=await draft();await rpc(owner,'journal_validate',[e.id]);await rpc(reviewer,'accounting_period_action',[period.id,'soft_close','Cierre sintético']);await assert.rejects(()=>rpc(reviewer,'journal_post',[e.id,randomUUID()]),/Open matching/);
  await rpc(reviewer,'accounting_period_action',[period.id,'close','Cierre sintético']);await assert.rejects(()=>rpc(reviewer,'journal_post',[e.id,randomUUID()]),/Open matching/);await rpc(reviewer,'accounting_period_action',[period.id,'reopen','Reapertura sintética']);
  assert.equal(Number(await scalar("select count(*)from public.accounting_history where entity_id=$1 and action='reopen'",[period.id])),1);
 });
 await test('F8A reversal keeps original lines and creates one inverse posted journal',async()=>{
  const reversePayload={entry_date:'2026-09-13',accounting_period_id:period.id,entry_type_id:type.id,reason:'Reverso sintético'},key=randomUUID();
  const inverse=await rpc(owner,'journal_reverse',[posted.id,reversePayload,key]);assert.equal(inverse.status,'posted');assert.equal(inverse.original_entry_id,posted.id);assert.equal((await rpc(owner,'journal_reverse',[posted.id,reversePayload,key])).id,inverse.id);
  await assert.rejects(()=>rpc(owner,'journal_reverse',[posted.id,reversePayload,randomUUID()]),/unreversed/);
  const rows=(await db.query('select journal_entry_id,account_id,debit,credit from public.journal_entry_lines where journal_entry_id in($1,$2)',[posted.id,inverse.id])).rows;
  for(const id of [debit.id,credit.id])assert.equal(rows.filter(r=>r.account_id===id).reduce((a,r)=>a+Number(r.debit)-Number(r.credit),0),0);
  assert.equal(Number(await scalar('select count(*)from public.journal_postings where journal_entry_id in($1,$2)',[posted.id,inverse.id])),2);
 });
 await test('F8A missing mandatory dimensions/third party and wrong conversion are rejected',async()=>{
  const a=await save('account',{...account,code:'DIM',requires_cost_center:true,requires_third_party:true});const l=lines();l[0].account_id=a.id;const e=await draft(l);await assert.rejects(()=>rpc(owner,'journal_validate',[e.id]),/Third party/);
  const usd=await scalar("select id from public.currencies where code='USD'");await assert.rejects(()=>draft(lines(),{currency_id:usd}),/exchange rate/);
  const fx=await rpc(owner,'accounting_exchange_rate_save',[c,{date:'2026-09-13',currency_from:usd,currency_to:currency,buy_rate:3.7,sell_rate:3.8,accounting_rate:3.75,source:'Fuente exclusivamente sintética'}]);
  const wrong=await draft(lines(),{currency_id:usd,exchange_rate_id:fx.id});await assert.rejects(()=>rpc(owner,'journal_validate',[wrong.id]),/conversion/);
  const exact=lines(375).map(x=>({...x,foreign_amount:100}));const valid=await draft(exact,{currency_id:usd,exchange_rate_id:fx.id});await rpc(owner,'journal_validate',[valid.id]);await rpc(reviewer,'journal_post',[valid.id,randomUUID()]);
 });
 await test('F8A ledger and trial balance include original plus reversal, excluding unposted drafts',async()=>{
  const ledger=await rpc(owner,'accounting_report',['general_ledger',c,{accounting_period_id:period.id}]);assert.equal(ledger.count,6);
  const trial=await rpc(owner,'accounting_report',['trial_balance',c,{accounting_period_id:period.id}]);assert.equal(trial.count,2);
  assert.equal(Number(trial.data.find(x=>x.account_id===debit.id).closing_balance),375);assert.equal(Number(trial.data.find(x=>x.account_id===credit.id).closing_balance),-375);
  assert.equal(trial.data.reduce((sum,x)=>sum+Number(x.closing_balance),0),0);
  await assert.rejects(()=>rpc(owner,'accounting_report',['general_ledger',b,{}]));
  assert.equal((await asUser(outsider,'select * from public.accounting_ledger_lines')).rows.length,0);
  const options=await rpc(owner,'accounting_options',[c]);assert.equal(options.settings.functional_currency_id,currency);
 });
 await test('F8A configured rules are versioned and simulation never persists journals',async()=>{
  const input={code:'SYNTH-RULE',name:'Regla exclusivamente sintética',source_event:'manual',valid_from:'2026-01-01',lines:[{account_id:debit.id,side:'debit',amount_key:'amount'},{account_id:credit.id,side:'credit',amount_key:'amount'}]};
  input.lines=input.lines.map(x=>({...x,description:'Línea sintética'}));
  const rule=await rpc(owner,'accounting_rule_save',[null,c,input,randomUUID()]);assert.equal(rule.version,1);
  await assert.rejects(()=>rpc(owner,'accounting_rule_action',[rule.id,'activate_simulation','Prueba']),/independent/);
  await rpc(reviewer,'accounting_rule_action',[rule.id,'activate_simulation','Activación sintética']);
  const before=await scalar('select count(*)from public.journal_entries');const preview=await rpc(owner,'accounting_preview',[rule.id,{source_event:'manual',entry_date:'2026-09-13',currency_id:currency,amounts:{amount:75}}]);
  assert.equal(preview.valid,true);assert.equal(preview.persisted,false);assert.equal(preview.posted,false);assert.equal(Number(preview.debits),75);assert.equal(await scalar('select count(*)from public.journal_entries'),before);
  const version=await rpc(owner,'accounting_rule_save',[rule.id,c,{...input,name:'Segunda versión sintética'},randomUUID()]);assert.equal(version.version,2);assert.equal(version.previous_version_id,rule.id);
  await rpc(reviewer,'accounting_rule_action',[version.id,'activate_simulation','Nueva versión sintética']);
  assert.equal(await scalar('select status from public.accounting_rules where id=$1',[rule.id]),'disabled');
  assert.equal(Number(await scalar('select count(*)from public.accounting_rules where production_enabled')),0);
 });
 await test('F8A posting freezes CECO/project interpretation and accepts an employee without Auth',async()=>{
  const center=await rpc(owner,'master_save',['cost_center',null,c,{code:'ACCT-CECO',name:'Nombre original contable',valid_from:'2026-01-01'}]);
  const project=await rpc(owner,'master_save',['project',null,c,{code:'ACCT-PRJ',name:'Proyecto original contable'}]);
  const employee=await scalar('select id from public.employees where company_id=$1 and profile_id is null and active limit 1',[c]);assert.ok(employee);
  const a=await save('account',{...account,code:'HISTORY',requires_cost_center:true,requires_project:true,requires_third_party:true});
  const input=lines(12);input[0]={...input[0],account_id:a.id,third_party_type:'employee',third_party_id:employee,dimensions:[{dimension_type:'cost_center',dimension_id:center.id},{dimension_type:'project',dimension_id:project.id}]};
  const entry=await draft(input);assert.equal(await scalar('select first_used_at from public.cost_centers where id=$1',[center.id]),null);await rpc(owner,'journal_validate',[entry.id]);await rpc(reviewer,'journal_post',[entry.id,randomUUID()]);
  assert.ok(await scalar('select first_used_at from public.cost_centers where id=$1',[center.id]));assert.ok(await scalar('select first_used_at from public.projects where id=$1',[project.id]));
  await rpc(owner,'master_save',['cost_center',center.id,c,{name:'Nuevo nombre contable'}]);await assert.rejects(()=>rpc(owner,'master_save',['cost_center',center.id,c,{code:'CHANGED'}]),/protected/);
  assert.equal(await scalar("select d.snapshot_name from public.journal_line_dimensions d join public.journal_entry_lines l on l.id=d.journal_line_id where l.journal_entry_id=$1 and d.dimension_type='cost_center'",[entry.id]),'Nombre original contable');
 });
 await test('F8A direct REST writes and revoked membership cannot bypass posting or reports',async()=>{
  await assert.rejects(()=>asUser(owner,'update public.journal_entries set status=$1',['posted']),/permission denied/);
  await assert.rejects(()=>asUser(owner,"insert into public.accounting_rules(company_id)values($1)",[c]),/permission denied/);
  const e=await draft();await rpc(owner,'journal_validate',[e.id]);await rpc(admin,'admin_set_membership',[reviewer,c,false]);
  await assert.rejects(()=>rpc(reviewer,'journal_post',[e.id,randomUUID()]));assert.equal((await asUser(reviewer,'select * from public.accounting_ledger_lines')).rows.length,0);await rpc(admin,'admin_set_membership',[reviewer,c,true]);
  assert.ok(Number(await scalar("select count(*)from public.audit_logs where company_id=$1 and category='finance' and action like 'accounting.%' and user_id is not null",[c]))>0);
 });
 return {accountingRole:role,accountingPeriod:period,accountingType:type,accountingDebit:debit,accountingCredit:credit,accountingDraft:draft,accountingLines:lines,accountingPayload:payload};
}
