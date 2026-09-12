import {createClient} from '@supabase/supabase-js';import{readFile}from'node:fs/promises';
const report=JSON.parse(await readFile('docs/fase-4/resultado-dev.json','utf8'));
const a=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
const user=report.fixtures.users.find((x:any)=>x.kind==='solicitante');const u=await a.auth.admin.getUserById(user.id);const l=await a.auth.admin.generateLink({type:'magiclink',email:u.data.user!.email!});
const n=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
const s=await n.auth.verifyOtp({type:'magiclink',token_hash:l.data.properties.hashed_token});
try{const rows=await n.from('attachments').select('id,storage_path,size,mime_type').eq('company_id',report.fixtures.companies[0].id).eq('status','pending');
if(rows.error)throw new Error('Read blocked');const row=rows.data!.at(-1);if(!row)throw new Error('No pending metadata');
const r=await n.storage.from('financial-private').upload(row.storage_path,Buffer.from('%PDF-1.4\nEvidencia sintetica DEV\n%%EOF'),{contentType:'application/pdf'});
console.log(JSON.stringify({upload:!r.error,errorCode:r.error&&'statusCode'in r.error?r.error.statusCode:null,rlsRejected:/row.level security/i.test(r.error?.message||''),bucketMissing:/bucket.*not found/i.test(r.error?.message||''),invalidJwt:/jwt|token/i.test(r.error?.message||''),sizeMatches:row.size===Buffer.byteLength('%PDF-1.4\nEvidencia sintetica DEV\n%%EOF')}));
}catch{console.log('DIAGNOSTIC_UNAVAILABLE');}finally{if(s.data.session)await a.auth.admin.signOut(s.data.session.access_token,'local');}
