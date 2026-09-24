import {createHash} from 'node:crypto';
import {readdir} from 'node:fs/promises';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,access,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {Client} from 'pg';
const run=promisify(execFile),bin='C:/Program Files/PostgreSQL/18/bin';
const control=(args)=>new Promise((resolve,reject)=>{
 const child=spawn(path.join(bin,'pg_ctl.exe'),args,{windowsHide:true,stdio:'ignore'});
 child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('LOCAL_PG_CONTROL_FAILED')));
});
const root=path.resolve('.tools/phase6-disposable-postgres'),port=55466;
await mkdir(root,{recursive:true});
const data=path.join(root,'data');let initialized=true;
try{await access(path.join(data,'PG_VERSION'));}catch{initialized=false;}
if(!initialized)await run(path.join(bin,'initdb.exe'),['-D',data,'-U','postgres','--auth=trust','--encoding=UTF8','--locale=C'],{windowsHide:true});
let started=false;
try{
 await control(['start','-D',data,'-l',path.join(root,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w']);started=true;
 const admin=new Client({host:'127.0.0.1',port,user:'postgres',database:'postgres'});await admin.connect();
 const actual=(await admin.query('show data_directory')).rows[0].data_directory;
 if(path.resolve(actual).toLowerCase()!==data.toLowerCase())throw new Error('DISPOSABLE_CLUSTER_MISMATCH');
 const name='phase6_fixture_'+Date.now();await admin.query(`create database "${name}"`);await admin.end();
 const connection=`postgresql://postgres@127.0.0.1:${port}/${name}`;
 const child=spawn(process.execPath,['supabase/tests/phase2.test.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,TEST_DATABASE_URL:connection}});
 let output='';child.stdout.on('data',b=>{output+=String(b);process.stdout.write(b);});
 child.stderr.on('data',b=>{output+=String(b);process.stderr.write(b);});
 const code=await new Promise(resolve=>child.on('exit',resolve));
 await mkdir('docs/fase-8b',{recursive:true});
 const migrationHashes={};for(const name of (await readdir('supabase/migrations')).filter(n=>/^202609(2200(44|45|46|47|48)|2300(49|50|51)|240052)_/.test(n)))migrationHashes[name]=createHash('sha256').update(await readFile('supabase/migrations/'+name)).digest('hex');
 const resultPath='docs/fase-8b/resultado-postgres-local.json';
 await mkdir('docs/fase-8b/historico',{recursive:true});
 try{const previous=await readFile(resultPath,'utf8');await writeFile('docs/fase-8b/historico/postgres-'+Date.now()+'.json',previous);}catch(error){if(error.code!=='ENOENT')throw error;}
 await writeFile(resultPath,JSON.stringify({executedAt:new Date().toISOString(),environment:'disposable_loopback_postgresql',migrationHashes,status:code===0?'PASS':'FAIL',cases:output.split(/\r?\n/).filter(x=>x.startsWith('OK ')||x.startsWith('PASS ')),supabaseDevModified:false},null,2));
 process.exitCode=code??1;
}catch(error){console.error({error:typeof error.code==='string'?error.code:'LOCAL_POSTGRES_FAILED'});process.exitCode=1;}
finally{if(started)await control(['stop','-D',data,'-m','fast','-w']);}


