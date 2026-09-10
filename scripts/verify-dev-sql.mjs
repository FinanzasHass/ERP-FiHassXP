import {Client} from 'pg';
import {writeFile,readFile} from 'node:fs/promises';
const out={status:'BLOCKED_EXTERNAL',evidence:'Conexión SQL no disponible.'};let db;
try{
 if(!process.env.SUPABASE_DB_URL)throw new Error('missing');
 const direct=new URL(process.env.SUPABASE_DB_URL);
 let ca;try{ca=await readFile('.tools/supabase-ca.crt','utf8');}catch{}
 const connect=async url=>{for(const k of ['sslmode','sslcert','sslkey','sslrootcert'])url.searchParams.delete(k);const client=new Client({connectionString:url.toString(),ssl:{rejectUnauthorized:true,...(ca?{ca}:{})},connectionTimeoutMillis:15000,query_timeout:15000});try{await client.connect();return client;}catch(e){await client.end().catch(()=>{});throw e;}};
 let route='directa';
 try{db=await connect(new URL(direct));}catch(e){
   if(!['ENOTFOUND','ENETUNREACH','ETIMEDOUT','EAI_AGAIN'].includes(e.code))throw e;
   const ref=(await readFile('supabase/.temp/project-ref','utf8')).trim();
   const pooler=new URL((await readFile('supabase/.temp/pooler-url','utf8')).trim());
   if(direct.hostname!=='db.'+ref+'.supabase.co'||!pooler.hostname.endsWith('.pooler.supabase.com')||decodeURIComponent(pooler.username)!=='postgres.'+ref)throw new Error('Unverified pooler context');
   pooler.password=direct.password;db=await connect(pooler);route='pooler del mismo proyecto, identificado por CLI';
 }
 const versions=(await db.query('select version from supabase_migrations.schema_migrations order by version')).rows.map(r=>String(r.version));
 const expected=Array.from({length:11},(_,i)=>'20260909'+String(i+1).padStart(4,'0'));
 const missing=expected.filter(v=>!versions.includes(v));
 const tables=(await db.query("select tablename,rowsecurity from pg_tables where schemaname='public'")).rows;
 const names=['areas','positions','profiles','roles','permissions','user_roles','role_permissions','user_permission_overrides','companies','user_companies','audit_logs','system_settings','cost_center_categories','cost_centers','projects','subprojects','currencies','exchange_rates'];
 const unprotected=names.filter(n=>!tables.some(t=>t.tablename===n&&t.rowsecurity));
 out.status=missing.length||unprotected.length?'FAIL':'PASS';out.evidence=`Nueva consulta SQL de sólo lectura (${route}, TLS verificado): ${expected.length-missing.length}/11 migraciones acreditadas; ${names.length-unprotected.length}/18 tablas esperadas con RLS. No se repitió DDL ni bootstrap.`;
 if(missing.length)out.evidence+=' Versiones faltantes: '+missing.join(', ')+'.';
 if(unprotected.length)out.evidence+=' Tablas sin RLS verificable: '+unprotected.join(', ')+'.';
}catch(e){out.evidence='Conexión/historial SQL no verificable; diagnóstico sanitizado: '+(/^[A-Z0-9_]{2,25}$/.test(e.code||'')?e.code:'TRANSPORT_OR_CONFIGURATION')+'.';}
finally{if(db)await db.end().catch(()=>{});out.executedAt=new Date().toISOString();await writeFile('docs/fase-3.1/evidencia-sql.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out));}
