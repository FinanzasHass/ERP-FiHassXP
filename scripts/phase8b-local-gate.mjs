import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const run=promisify(execFile),dir='docs/fase-8b';
await mkdir(dir+'/capturas',{recursive:true});await mkdir(dir+'/historico',{recursive:true});
try{await copyFile(dir+'/puerta-local.json',dir+'/historico/puerta-local-'+Date.now()+'.json');}catch(e){if(e.code!=='ENOENT')throw e;}
const report={executedAt:new Date().toISOString(),status:'RUNNING',checks:[],migrationHashes:{},supabaseDevModified:false};
const commands=[['backend types',['node_modules/typescript/bin/tsc','--noEmit','-p','tsconfig.json']],['client types',['node_modules/typescript/bin/tsc','-p','tsconfig.client.json']],['application tests',['--import','tsx','--test','tests/*.test.ts']],['client build',['node_modules/vite/bin/vite.js','build']],['secret boundary',['--env-file=.env','scripts/check-client-boundary.mjs']],...['interface','employee-expenses','receivables','accounting','accounting-events'].map(name=>['browser '+name,['scripts/e2e.mjs',name+'.spec.ts']])];
const oldImages=new Map();
for(const file of ['docs/fase-5/capturas/login-regresion.png','docs/fase-5/capturas/dashboard-regresion.png','docs/fase-5/capturas/tablet-regresion.png','docs/fase-6/capturas/rendicion-regresion.png'])oldImages.set(file,await readFile(file));
try{
 const pg=JSON.parse(await readFile(dir+'/resultado-postgres-local.json','utf8'));
 if(pg.status!=='PASS'||Date.now()-Date.parse(pg.executedAt)>3600000)throw new Error('FRESH_LOCAL_POSTGRES_EVIDENCE_REQUIRED');
 for(const [name,hash]of Object.entries(pg.migrationHashes))if(createHash('sha256').update(await readFile('supabase/migrations/'+name)).digest('hex')!==hash)throw new Error('SQL_CHANGED');
 report.migrationHashes=pg.migrationHashes;
 report.checks.push({name:'PostgreSQL including concurrency',status:'PASS',evidence:pg.cases.filter(x=>x.startsWith('PASS '))});
 for(const [name,args]of commands){
  try{const result=await run(process.execPath,args,{windowsHide:true,timeout:120000,maxBuffer:4*1024*1024});const evidence=result.stdout.split(/\r?\n/).filter(x=>/^PASS |^ℹ (tests|pass|fail)|\d+ passed/.test(x));report.checks.push({name,status:'PASS',evidence});console.log('PASS '+name,...evidence);}
  catch(e){report.checks.push({name,status:'FAIL',diagnostic:e.killed?'TIMEOUT':'PROCESS_EXIT'});process.exitCode=1;console.log('FAIL '+name);break;}
 }
 for(const file of oldImages.keys())await copyFile(file,dir+'/capturas/'+file.split('/').at(-1));
 report.status=report.checks.length===commands.length+1&&report.checks.every(c=>c.status==='PASS')?'PASS':'FAIL';
}catch(e){report.status='FAIL';report.diagnostic=e.message;process.exitCode=1;console.log('FAIL local gate');}
finally{for(const [file,bytes]of oldImages)await writeFile(file,bytes);await writeFile(dir+'/puerta-local.json',JSON.stringify(report,null,2));}
