import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const run=promisify(execFile),folder='docs/fase-5';
await mkdir(folder,{recursive:true});
const ref=(await readFile('supabase/.temp/project-ref','utf8')).trim();
if(process.env.NODE_ENV==='production'||new URL(process.env.SUPABASE_URL).hostname!==ref+'.supabase.co')throw new Error('DEV project mismatch');
const cli='node_modules/@supabase/cli-windows-x64/bin/supabase.exe';
const report={executedAt:new Date().toISOString(),sameProjectAsApplication:true,projectFingerprint:createHash('sha256').update(ref).digest('hex').slice(0,16),status:'BLOCKED_EXTERNAL',steps:[]};
async function command(args){try{const r=await run(cli,args,{timeout:60000,windowsHide:true,maxBuffer:1024*1024});return{ok:true,text:r.stdout+'\n'+r.stderr};}catch(e){const text=String(e.stdout||'')+'\n'+String(e.stderr||'');return{ok:false,text,code:/28P01/.test(text)?'28P01':/access token|supabase login|not logged/i.test(text)?'CLI_LOGIN_REQUIRED':/password/i.test(text)?'DATABASE_AUTHENTICATION_REQUIRED':/denied|forbidden/i.test(text)?'ACCESS_DENIED':/network|connect|resolve|dial tcp/i.test(text)?'NETWORK_CONNECTION':e.killed?'TIMEOUT':typeof e.code==='string'&&/^[A-Z_]+$/.test(e.code)?e.code:'CLI_FAILED'};}}
const before=await command(['migration','list','--linked']);
function migrations(text){try{return JSON.parse(text.slice(0,text.lastIndexOf('}')+1)).migrations.map(r=>({local:/^\d{12}$/.test(r.local)?r.local:null,remote:/^\d{12}$/.test(r.remote)?r.remote:null}));}catch{return [];}}
report.steps.push({operation:'migration list before',status:before.ok?'PASS':'BLOCKED_EXTERNAL',diagnostic:before.code,versions:before.ok?migrations(before.text):[]});
if(before.ok&&process.argv.includes('--apply')){
 const pushed=await command(['db','push','--linked','--yes']);report.steps.push({operation:'db push DEV',status:pushed.ok?'PASS':'BLOCKED_EXTERNAL',diagnostic:pushed.code});
 if(pushed.ok){const after=await command(['migration','list','--linked']);const versions=['202609110017','202609110018','202609110019','202609110020','202609110021'];const all=after.ok&&versions.every(v=>migrations(after.text).some(r=>r.local===v&&r.remote===v));report.steps.push({operation:'migration list after',status:all?'PASS':'FAIL',versions:migrations(after.text)});report.status=all?'PASS':'FAIL';}
}else if(before.ok)report.status='PREFLIGHT_PASS';
await writeFile(folder+'/migraciones-dev.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
