import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,readdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const run=promisify(execFile),dir='docs/fase-7';await mkdir(dir+'/capturas',{recursive:true});
await mkdir(dir+'/historico',{recursive:true});try{await copyFile(dir+'/puerta-local.json',dir+'/historico/puerta-local-'+Date.now()+'.json');}catch(e){if(e.code!=='ENOENT')throw e;}
const report={executedAt:new Date().toISOString(),status:'RUNNING',checks:[],migrationHashes:{},supabaseDevModified:false};
const commands=[['backend types',['node_modules/typescript/bin/tsc','--noEmit','-p','tsconfig.json']],['client types',['node_modules/typescript/bin/tsc','-p','tsconfig.client.json']],['application tests',['--import','tsx','--test','tests/*.test.ts']],['production client build',['node_modules/vite/bin/vite.js','build']],['secret boundary',['--env-file=.env','scripts/check-client-boundary.mjs']],['browser base regressions',['scripts/e2e.mjs','interface.spec.ts']],['browser expense regressions',['scripts/e2e.mjs','employee-expenses.spec.ts']],['browser receivable regressions',['scripts/e2e.mjs','receivables.spec.ts']]];
const oldImages=new Map();for(const name of ['login-regresion.png','dashboard-regresion.png','tablet-regresion.png'])oldImages.set(name,await readFile('docs/fase-5/capturas/'+name));
try{
 const pg=JSON.parse(await readFile(dir+'/resultado-postgres-local.json','utf8'));
 if(pg.status!=='PASS'||!pg.migrationHashes||Date.now()-Date.parse(pg.executedAt)>3600000)throw new Error('Fresh PostgreSQL evidence required');
 for(const [name,hash]of Object.entries(pg.migrationHashes))if(createHash('sha256').update(await readFile('supabase/migrations/'+name)).digest('hex')!==hash)throw new Error('SQL changed since PostgreSQL regression');
 report.checks.push({name:'PostgreSQL regressions and concurrency',status:'PASS',evidence:pg.cases.filter(x=>x.startsWith('PASS '))});
 for(const [name,args]of commands){
  try{const pending=run(process.execPath,args,{windowsHide:true,timeout:90000,maxBuffer:4*1024*1024});if(name.startsWith('browser'))pending.child.stdout.on('data',b=>{for(const line of String(b).split(/\r?\n/))if(/ok \d|passed|failed/.test(line))console.log(line);});const result=await pending;const evidence=result.stdout.split(/\r?\n/).filter(x=>/^PASS |^ℹ (tests|pass|fail)|\d+ passed/.test(x));report.checks.push({name,status:'PASS',evidence});console.log('PASS '+name,...evidence);}
  catch(e){report.checks.push({name,status:'FAIL',diagnostic:e.killed?'TIMEOUT':'PROCESS_EXIT'});console.log('FAIL '+name);process.exitCode=1;break;}
 }
 for(const name of oldImages.keys())await copyFile('docs/fase-5/capturas/'+name,dir+'/capturas/'+name);
 const files=(await readdir('supabase/migrations')).filter(n=>/^2026091300(33|34|35|36|37)_/.test(n));
 if(files.length!==5)throw new Error('Unexpected migration set');
 for(const name of files)report.migrationHashes[name]=createHash('sha256').update(await readFile('supabase/migrations/'+name)).digest('hex');
 report.status=report.checks.length===commands.length+1&&report.checks.every(c=>c.status==='PASS')?'PASS':'FAIL';
}finally{
 for(const [name,bytes]of oldImages)await writeFile('docs/fase-5/capturas/'+name,bytes);
 if(report.status==='RUNNING')report.status='FAIL';await writeFile(dir+'/puerta-local.json',JSON.stringify(report,null,2));
}
