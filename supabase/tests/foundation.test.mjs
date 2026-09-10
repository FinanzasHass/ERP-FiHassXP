import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const admin = '00000000-0000-0000-0000-000000000001';
const employee = '00000000-0000-0000-0000-000000000002';
const scalar = async (sql) => Object.values((await db.query(sql)).rows[0])[0];
let checks = 0;
async function check(label, fn) { await fn(); checks++; console.log(`OK ${label}`); }
async function asUser(id, sql) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${id}',false)`);
  try { return await db.query(sql); }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub','',false)"); }
}
async function can(id, permission) {
  return (await asUser(id,`select public.has_permission('${permission}') as allowed`)).rows[0].allowed;
}
try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `);
  // Historical Phase 1 regression suite. Phase 2 has its own current-schema suite.
  for (const file of (await readdir(new URL('../migrations/',import.meta.url))).filter(f => f.endsWith('.sql') && f <= '202609090004_reserved_permissions.sql').sort()) {
    await db.exec(await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
    if (file === '202609090002_seed.sql') {
      // Existing installation fixture: false grant must not become a grant on upgrade.
      await db.exec(`insert into public.role_permissions(role_id,permission_id,granted)
        select r.id,p.id,false from public.roles r,public.permissions p
        where r.code='solicitante' and p.code='payment.approve'`);
    }
  }
  await check('upgrade removes false grants without granting financial authority',async () => {
    assert.equal(await scalar(`select count(*)::int from public.role_permissions rp
      join public.roles r on r.id=rp.role_id join public.permissions p on p.id=rp.permission_id
      where r.code='solicitante' and p.code='payment.approve'`),0);
  });
  await check('migrations execute and all eleven tables have RLS',async () => {
    assert.equal(await scalar("select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity"),11);
  });
  await db.exec(`insert into auth.users values ('${admin}','admin@example.test'),('${employee}','employee@example.test')`);
  const bootstrap = (await readFile(new URL('../bootstrap.sql',import.meta.url),'utf8'))
    .replace('REPLACE_WITH_AUTH_USER_UUID',admin).replace('REPLACE_WITH_USERNAME','first.admin')
    .replace('REPLACE_WITH_FULL_NAME','Initial Administrator');
  await db.exec(bootstrap);
  await db.exec(`insert into public.profiles(id,email,username,full_name,status) values ('${employee}','employee@example.test','employee','Employee','active')`);
  await check('administrator has technical grants, no financial grants',async () => {
    assert.equal(await can(admin,'user.create'),true);
    assert.equal(await can(admin,'role.assign'),true);
    assert.equal(await can(admin,'permission.assign'),true);
    assert.equal(await can(admin,'permission.manage'),false);
    assert.equal(await can(admin,'audit.finance_view'),false);
    for (const code of ['payment.approve','payment.execute','vendor_refund.approve_closure','missing.permission']) assert.equal(await can(admin,code),false);
  });
  await check('default deny and own profile isolation',async () => {
    assert.equal(await can(employee,'dashboard.view'),false);
    const rows = (await asUser(employee,'select id from public.profiles')).rows;
    assert.deepEqual(rows,[{id:employee}]);
    assert.equal((await asUser(employee,'select * from public.audit_logs')).rows.length,0);
  });
  await db.exec(`
    insert into public.role_permissions(role_id,permission_id)
      select r.id,p.id from public.roles r,public.permissions p where r.code='tesoreria' and p.code='payment.execute';
    insert into public.user_roles(user_id,role_id) select '${employee}',id from public.roles where code='tesoreria';
  `);
  await check('role grants resolve without position',async () => assert.equal(await can(employee,'payment.execute'),true));
  await db.exec(`insert into public.user_permission_overrides(user_id,permission_id,effect) select '${employee}',id,'deny' from public.permissions where code='payment.execute'`);
  await check('explicit deny overrides role',async () => assert.equal(await can(employee,'payment.execute'),false));
  await db.exec(`update public.user_permission_overrides set effect='allow'; update public.roles set active=false where code='tesoreria'`);
  await check('explicit allow independent of role; inactive role grants ignored',async () => {
    assert.equal(await can(employee,'payment.execute'),true);
    await db.exec('delete from public.user_permission_overrides');
    assert.equal(await can(employee,'payment.execute'),false);
  });
  await db.exec(`update public.roles set active=true where code='tesoreria'; update public.permissions set active=false where code='payment.execute'`);
  await check('inactive permission is denied',async () => assert.equal(await can(employee,'payment.execute'),false));
  await db.exec(`update public.permissions set active=true where code='payment.execute'; update public.profiles set status='blocked' where id='${employee}'`);
  await check('blocked profile denies existing token and own reads',async () => {
    assert.equal(await can(employee,'payment.execute'),false);
    assert.equal((await asUser(employee,'select * from public.profiles')).rows.length,0);
  });
  await check('API cannot mutate profiles, RBAC or audit even as technical admin',async () => {
    for (const sql of [
      "update public.profiles set status='active'",
      'delete from public.user_roles',
      'delete from public.audit_logs',
      "insert into public.audit_logs(action,entity_type) values ('forged','test')",
    ]) await assert.rejects(() => asUser(admin,sql),/permission denied/);
  });
  await check('anonymous table access rejected',async () => {
    await db.exec('set role anon');
    try { await assert.rejects(() => db.query('select * from public.profiles'),/permission denied/); }
    finally { await db.exec('reset role'); }
  });
  await check('service role has no administrative table grants',async () => {
    await db.exec('set role service_role');
    try { await assert.rejects(() => db.query("update public.profiles set status='active'"),/permission denied/); }
    finally { await db.exec('reset role'); }
  });
  await check('system role protected',async () => {
    await assert.rejects(() => db.exec("delete from public.roles where is_system"),/cannot be deleted/);
    await assert.rejects(() => db.exec("update public.roles set active=false where is_system"),/protected/);
  });
  await check('foreign keys and username uniqueness',async () => {
    await assert.rejects(() => db.exec(`delete from auth.users where id='${employee}'`),/foreign key/);
    await assert.rejects(() => db.exec(`update public.profiles set username='FIRST.ADMIN' where id='${employee}'`),/unique/);
    await assert.rejects(() => db.exec(`update public.profiles set manager_id=id where id='${employee}'`),/check constraint/);
  });
  await check('audit records before/after and rolls back with mutation',async () => {
    const event = (await db.query(`select old_values,new_values from public.audit_logs where entity_id='${employee}' and action='disable'`)).rows[0];
    assert.equal(event.old_values.status,'active');
    assert.equal(event.new_values.status,'blocked');
    const count = await scalar('select count(*) from public.audit_logs');
    await db.exec("begin; update public.areas set description='rolled back'; rollback");
    assert.equal(await scalar('select count(*) from public.audit_logs'),count);
  });
  await check('bootstrap cannot be reused',async () => {
    await assert.rejects(() => db.exec(bootstrap),/Bootstrap already completed/);
    await db.exec('rollback');
  });
  await check('permission contracts immutable and catalog API writes denied',async () => {
    await assert.rejects(() => db.exec("update public.permissions set code='payment.other',action='other' where code='payment.execute'"),/immutable/);
    await assert.rejects(() => db.exec("update public.permissions set scope='company' where code='request.view_own'"),/immutable/);
    await assert.rejects(() => db.exec("delete from public.permissions where code='request.view_area'"),/retired/);
    await assert.rejects(() => asUser(admin,"insert into public.permissions(module,resource,action,code,description) values ('x','x','y','x.y','x')"),/permission denied/);
    assert.equal(await scalar("select count(*)::int from information_schema.columns where table_schema='public' and table_name='role_permissions' and column_name='granted'"),0);
  });
  await check('scopes and reserved module catalog present',async () => {
    for (const [action,scope] of [['view_own','own'],['view_area','area'],['view_company','company'],['view_all','all_authorized']]) {
      assert.equal(await scalar(`select scope from public.permissions where code='request.${action}'`),scope);
    }
    for (const resource of ['company','employee_return','employee_reimbursement','service_acceptance','payment_batch']) {
      assert.ok(await scalar(`select count(*)::int from public.permissions where resource='${resource}'`));
    }
  });
  const third = '00000000-0000-0000-0000-000000000003';
  await db.exec(`insert into auth.users values ('${third}','third@example.test');
    insert into public.profiles(id,email,username,full_name,status) values ('${third}','third@example.test','third','Third','active');
    update public.profiles set status='active' where id='${employee}';
    update public.profiles set manager_id='${employee}' where id='${admin}';
    update public.profiles set manager_id='${third}' where id='${employee}';`);
  await check('indirect manager cycles rejected and global positions accepted',async () => {
    await assert.rejects(() => db.exec(`update public.profiles set manager_id='${admin}' where id='${third}'`),/hierarchy cycle/);
    await db.exec('update public.profiles set manager_id=null');
    await assert.rejects(() => db.exec(`update public.profiles set manager_id=case when id='${admin}' then '${employee}'::uuid when id='${employee}' then '${admin}'::uuid end`),/hierarchy cycle/);
    await db.exec("insert into public.positions(name) values ('Cargo global')");
    assert.equal(await scalar("select area_id from public.positions where name='Cargo global'"),null);
    await db.exec('begin isolation level repeatable read');
    await assert.rejects(() => db.exec(`update public.profiles set manager_id=null where id='${admin}'`),/READ COMMITTED/);
    await db.exec('rollback');
  });
  const c1='10000000-0000-0000-0000-000000000001';
  const c2='10000000-0000-0000-0000-000000000002';
  const c3='10000000-0000-0000-0000-000000000003';
  await db.exec(`insert into public.companies(id,legal_name,code,tax_id,country_code) values
    ('${c1}','Company A','CA','TEST-A','PE'),('${c2}','Company B','CB','TEST-B','PE'),('${c3}','Company C','CC','TEST-C','PE');
    insert into public.user_companies(user_id,company_id,assigned_by) values ('${employee}','${c1}','${admin}'),('${employee}','${c2}','${admin}')`);
  await check('multiple companies per user and isolation of unauthorized company',async () => {
    assert.equal((await asUser(employee,'select * from public.companies')).rows.length,2);
    assert.equal((await asUser(employee,`select public.has_company_access('${c3}') as allowed`)).rows[0].allowed,false);
    assert.equal((await asUser(admin,`select public.has_company_access('${c1}') as allowed`)).rows[0].allowed,false);
    assert.equal((await asUser(admin,'select * from public.companies')).rows.length,3);
    assert.equal((await asUser(third,'select * from public.user_companies')).rows.length,0);
    await assert.rejects(() => asUser(employee,`insert into public.user_companies(user_id,company_id) values ('${employee}','${c3}')`),/permission denied/);
    await db.exec(`update public.companies set active=false where id='${c2}'`);
    assert.equal((await asUser(employee,`select public.has_company_access('${c2}') as allowed`)).rows[0].allowed,false);
    assert.equal((await asUser(employee,'select * from public.companies')).rows.length,1);
  });
  await check('assignment provenance unique overrides and categorized audit',async () => {
    await db.exec(`insert into public.user_permission_overrides(user_id,permission_id,effect,assigned_by,reason)
      select '${employee}',id,'allow','${admin}','Autorización de prueba' from public.permissions where code='audit.finance_view'`);
    await assert.rejects(() => db.exec(`insert into public.user_permission_overrides(user_id,permission_id,effect)
      select '${employee}',id,'deny' from public.permissions where code='audit.finance_view'`),/unique/);
    assert.equal(await scalar(`select assigned_by from public.user_permission_overrides where user_id='${employee}'`),admin);
    assert.ok(await scalar("select count(*)::int from public.audit_logs where category='security' and action='company.assign'"));
    await db.exec(`insert into public.audit_logs(action,category,entity_type,company_id) values
      ('future.test','finance','test','${c1}'),('future.test','finance','test','${c3}')`);
    assert.equal((await asUser(admin,"select * from public.audit_logs where category='finance'")).rows.length,0);
    assert.equal((await asUser(employee,"select * from public.audit_logs where category='finance'")).rows.length,1);
    await db.exec(`delete from public.user_companies where user_id='${employee}' and company_id='${c1}'`);
    assert.equal((await asUser(employee,"select * from public.audit_logs where category='finance'")).rows.length,0);
    assert.ok(await scalar("select count(*)::int from public.audit_logs where category='security' and action='company.remove'"));
    await assert.rejects(() => db.exec("insert into public.audit_logs(action,entity_type,category) values ('x','x','invalid')"),/check constraint/);
  });
  console.log(`PASS: ${checks} database checks (${process.version})`);
} finally { await db.close(); }
