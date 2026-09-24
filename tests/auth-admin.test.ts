import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPrivilegedAuth } from '../src/server/integrations/supabase/auth-admin.js';

test('admin temporary password confirms the provisioned Auth identity in the same mutation',async()=>{
  const original=globalThis.fetch;
  let body:Record<string,unknown>={};
  globalThis.fetch=async(_input,init)=>{
    body=JSON.parse(String(init?.body || '{}'));
    return new Response(JSON.stringify({id:'00000000-0000-4000-8000-000000000002',email:'new@example.test'}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  try {
    const auth=createPrivilegedAuth({SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_fixture'});
    await auth.updatePassword('00000000-0000-4000-8000-000000000002','Temporary-2026!');
    assert.equal(body.email_confirm,true);
    assert.equal(body.password,'Temporary-2026!');
  } finally { globalThis.fetch=original; }
});
