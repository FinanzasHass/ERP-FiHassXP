import assert from 'node:assert/strict';
export async function phase3Checks({db,rpc,asUser,scalar,test,admin,gianella,a,b}){
 const save=(kind,id,company,payload)=>rpc(gianella,'master_save',[kind,id,company,payload]);
 const imp=(rows,commit=false,update=false)=>rpc(gianella,'import_cost_centers',[a,rows,commit,update]);
 let root,child,project;
 await test('masters require assigned capabilities; administrator gets no implicit grants',async()=>{
   await assert.rejects(()=>save('cost_center',null,a,{code:'CC',name:'Denied'}),/Access denied/);
   assert.equal(await rpc(admin,'has_permission',['cost_center.create',a]),false);
   const role=await rpc(admin,'admin_save_entity',['role',null,{code:'master_operator',name:'Operador maestros'}]);
   const ids=(await db.query("select id from public.permissions where resource in ('cost_center','project','subproject','currency')")).rows.map(r=>r.id);
   await rpc(admin,'admin_set_role_permissions',[role.id,ids]);
   await rpc(admin,'admin_set_user_role',[gianella,role.id,a,true]);
 });
 await test('CECO creation, subcenter levels, cycle and company FK checks',async()=>{
   root=await save('cost_center',null,a,{code:'ROOT',name:'Raíz'});
   child=await save('cost_center',null,a,{code:'CHILD',name:'Hijo',parent_id:root.id});assert.equal(child.level,1);
   await assert.rejects(()=>save('cost_center',root.id,a,{parent_id:child.id}),/cycle/);
   await assert.rejects(()=>save('cost_center',root.id,b,{name:'Cross company'}),/Access denied|Company mismatch/);
   const other=(await db.query("insert into public.cost_centers(company_id,code,name) values($1,'OTHER','Other') returning id",[b])).rows[0].id;
   await assert.rejects(()=>save('cost_center',child.id,a,{parent_id:other}),/same company/);
   await assert.rejects(()=>asUser(gianella,"update public.cost_centers set name='Bypass'"),/permission denied/);
   assert.equal((await asUser(gianella,'select * from public.cost_centers where company_id=$1',[b])).rows.length,0);
 });
 await test('CECO deactivation, audit history and future-use identity protection',async()=>{
   await assert.rejects(()=>save('cost_center',root.id,a,{active:false}),/children/);
   await save('cost_center',child.id,a,{active:false});await save('cost_center',root.id,a,{active:false});
   assert.ok(Number(await scalar("select count(*) from public.audit_logs where entity_type='cost_centers' and company_id=$1 and user_id=$2",[a,gianella]))>=4);
   await db.query('update public.cost_centers set first_used_at=now() where id=$1',[root.id]);
   await assert.rejects(()=>save('cost_center',root.id,a,{code:'NEW'}),/protected/);
 });
 const row=(code,parent='')=>({company_code:'CA',code,name:code,parent_code:parent,active:true});
 await test('import preview rolls back, accepts unordered hierarchy and commits atomically',async()=>{
   const rows=[row('I_CHILD','I_ROOT'),row('I_ROOT')];const before=await scalar('select count(*) from public.audit_logs');
   const preview=await imp(rows);assert.equal(preview.created,2);assert.equal(preview.committed,false);
   assert.equal(await scalar("select count(*)::int from public.cost_centers where code='I_ROOT'"),0);assert.equal(await scalar('select count(*) from public.audit_logs'),before);
   const committed=await imp(rows,true);assert.equal(committed.committed,true);assert.equal(committed.created,2);
   const replay=await imp(rows,true);assert.equal(replay.ignored,2);assert.equal(replay.created,0);
 });
 await test('import rejects duplicates, missing parents, cycles, unauthorized company and rolls back good rows',async()=>{
   assert.ok((await imp([row('DUP'),row('DUP')],true)).errors.length);
   const invalid=await imp([row('ROLLBACK'),row('ORPHAN','MISSING')],true);assert.equal(invalid.committed,false);assert.ok(invalid.errors.length);
   assert.equal(await scalar("select count(*)::int from public.cost_centers where code='ROLLBACK'"),0);
   assert.ok((await imp([row('CYCLE1','CYCLE2'),row('CYCLE2','CYCLE1')],true)).errors.length);
   assert.ok((await imp([{...row('WRONG'),company_code:'CB'}],true)).errors.length);
   assert.ok((await imp([{...row('I_ROOT'),name:'Changed'}],true)).errors.length);
   assert.equal((await imp([{...row('I_ROOT'),name:'Changed'}],true,true)).updated,1);
 });
 await test('project and subproject must share company; inactive parent blocked',async()=>{
   project=await save('project',null,a,{code:'PROJ',name:'Proyecto'});
   const foreign=(await db.query("insert into public.projects(company_id,code,name) values($1,'PB','B') returning id",[b])).rows[0].id;
   await assert.rejects(()=>save('subproject',null,a,{code:'SUB',name:'Sub',project_id:foreign}),/same company/);
   const sub=await save('subproject',null,a,{code:'SUB',name:'Sub',project_id:project.id});assert.equal(sub.company_id,a);
   await assert.rejects(()=>save('project',project.id,a,{status:'completed'}),/subprojects/);
 });
 await test('workspace excludes revoked memberships and inactive companies; permissions revoked live',async()=>{
   assert.ok((await rpc(gianella,'my_workspace',[])).companies.some(c=>c.id===a));
   await rpc(admin,'admin_set_membership',[gianella,a,false]);
   assert.equal((await rpc(gianella,'my_workspace',[])).companies.some(c=>c.id===a),false);
   await assert.rejects(()=>save('cost_center',null,a,{code:'AFTER',name:'After revoke'}),/Access denied/);
   await rpc(admin,'admin_set_membership',[gianella,a,true]);
 });
 await test('username lookup is server-only; currency seed and sensitive metadata present',async()=>{
   await assert.rejects(()=>rpc(gianella,'resolve_login_username',['admin']),/permission denied/);
   await db.exec('set role service_role');try{assert.ok(await scalar("select public.resolve_login_username('admin')"));}finally{await db.exec('reset role');}
   assert.equal(await scalar("select count(*)::int from public.currencies where code in ('PEN','USD')"),2);
   assert.equal(await scalar("select is_sensitive from public.permissions where code='payment.execute'"),true);
 });
}
