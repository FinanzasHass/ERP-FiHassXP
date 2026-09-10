import {createClient} from '@supabase/supabase-js';
const e=process.env;
const client=createClient(e.SUPABASE_URL,e.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(u,o)=>fetch(u,{...o,signal:AbortSignal.timeout(15000)})}});
try {
 const {data,error}=await client.auth.admin.listUsers({page:1,perPage:50});
 console.log(JSON.stringify({authAdminReachable:!error,userCount:data?.users?.length??0,errorStatus:error?.status??null}));
}catch {console.log(JSON.stringify({authAdminReachable:false,transportFailure:true}));process.exitCode=1;}
