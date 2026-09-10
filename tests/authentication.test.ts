import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthentication } from '../src/server/services/authentication.js';
import { readConfig } from '../src/server/config/env.js';
const id='00000000-0000-4000-8000-000000000001';
const sid='00000000-0000-4000-8000-000000000002';
const publicConfig={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test_fixture',APP_ORIGIN:'http://localhost:3000'};
const token=(sub=id,exp=Math.floor(Date.now()/1000)+900)=>`eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({sub,session_id:sid,exp})).toString('base64url')}.fixture`;
test('JWT validation calls Supabase Auth with publishable key; claims used only after verified identity',async t=>{
  let called=false;
  const suppliedToken=token();
  t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
    called=true;assert.match(String(input),/\/auth\/v1\/user$/);
    const headers=new Headers(init?.headers);
    assert.equal(headers.get('apikey'),publicConfig.SUPABASE_PUBLISHABLE_KEY);
    assert.equal(headers.get('authorization'),`Bearer ${suppliedToken}`);
    return new Response(JSON.stringify({id,email:'test@example.test',aud:'authenticated',created_at:new Date().toISOString(),app_metadata:{},user_metadata:{}}),{status:200,headers:{'Content-Type':'application/json'}});
  });
  const result=await createAuthentication(publicConfig).verify(suppliedToken);
  assert.equal(called,true);assert.equal(result.id,id);assert.equal(result.sessionId,sid);
});
test('forged/expired token is rejected even if decoded claims name an administrator',async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({msg:'invalid JWT',code:'bad_jwt'}),{status:401,headers:{'Content-Type':'application/json'}}));
  await assert.rejects(()=>createAuthentication(publicConfig).verify(token()),/INVALID_TOKEN/);
});
test('environment never accepts legacy keys as replacements or a client-prefixed secret',()=>{
  assert.throws(()=>readConfig({...publicConfig,SUPABASE_SERVICE_ROLE_KEY:'legacy',NODE_ENV:'test'}),/Configuración inválida/);
  assert.throws(()=>readConfig({...publicConfig,SUPABASE_SECRET_KEY:'sb_secret_server_fixture',VITE_PRIVATE:'sb_secret_server_fixture',NODE_ENV:'test'}),/cliente/);
});
