import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionRepository } from '../src/server/repositories/session-repository.js';

test('profile listing pins the membership foreign key for PostgREST', async () => {
  const original=globalThis.fetch;
  const requests:string[]=[];
  globalThis.fetch=async(input)=>{
    requests.push(String(input));
    return new Response('[]',{status:200,headers:{'Content-Type':'application/json','Content-Range':'*/0'}});
  };
  try {
    const repository=createSessionRepository({SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture'},'verified-token');
    await repository.list('profiles',{page:1,limit:25});
    await repository.list('profiles',{page:1,limit:25,company_id:'10000000-0000-4000-8000-000000000001'});
    const selects=requests.map((request)=>new URL(request).searchParams.get('select') || '');
    assert.match(selects[0],/user_companies!user_companies_user_id_fkey\(company_id,active\)/);
    assert.match(selects[1],/user_companies!user_companies_user_id_fkey!inner\(company_id,active\)/);
  } finally { globalThis.fetch=original; }
});
