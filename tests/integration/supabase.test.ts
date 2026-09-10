import { test } from 'node:test';
import assert from 'node:assert/strict';
const url=process.env.SUPABASE_URL;
const key=process.env.SUPABASE_PUBLISHABLE_KEY;
const token=process.env.TEST_USER_ACCESS_TOKEN;
const companyA=process.env.TEST_COMPANY_A;
const companyB=process.env.TEST_COMPANY_B;
const enabled=Boolean(url&&key&&token&&companyA&&companyB);
test('real Supabase: Treasury A cannot execute in B and REST table writes are denied',{skip:!enabled},async()=>{
  const call=(path:string,body:unknown)=>fetch(`${url}/rest/v1/${path}`,{method:'POST',headers:{apikey:key!,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const allowed=await call('rpc/has_permission',{permission_code:'payment.execute',company_id:companyA});
  assert.equal(allowed.status,200);assert.equal(await allowed.json(),true);
  const denied=await call('rpc/has_permission',{permission_code:'payment.execute',company_id:companyB});
  assert.equal(denied.status,200);assert.equal(await denied.json(),false);
  // Invalid IDs additionally prevent accidental mutation if privileges regress.
  const direct=await call('user_roles',{user_id:'00000000-0000-0000-0000-000000000000',role_id:'00000000-0000-0000-0000-000000000000',company_id:companyB});
  assert.equal(direct.status,403);
  const forged=await call('rpc/record_authentication_success',{verified_user:'00000000-0000-0000-0000-000000000000',verified_session:'00000000-0000-0000-0000-000000000000',remote_ip:'127.0.0.1'});
  assert.ok([401,403,404].includes(forged.status));
});
