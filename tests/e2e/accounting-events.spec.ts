import {test,expect} from '@playwright/test';
test('AFE master saves an explicit synthetic dimension without client-controlled first use',async({page})=>{
 const company='10000000-0000-4000-8000-000000000001',writes:any[]=[];
 await page.addInitScript(()=>sessionStorage.setItem('erp.session',JSON.stringify({access_token:'synthetic',refresh_token:'synthetic',expires_in:3600})));
 await page.route('**/api/**',async route=>{const req=route.request(),path=new URL(req.url()).pathname;let body:any={data:[],count:0};
  if(path==='/api/auth/workspace')body={companies:[{id:company,code:'DEMO',legal_name:'Empresa DEMO'}]};
  else if(path==='/api/auth/me')body={profile:{id:company,full_name:'Configurador DEMO',status:'active'},permissions:['afe.view','afe.manage'].map(code=>({code}))};
  else if(path==='/api/accounting/afes'&&req.method()==='POST'){writes.push(req.postDataJSON());body={id:company,...writes[0]};}
  await route.fulfill({json:body});});
 await page.goto('/app/accounting-afes');await page.getByRole('button',{name:'Nuevo AFE'}).click();
 await page.getByLabel('Código').fill('DEMO-AFE');await page.getByLabel('Nombre').fill('Dimensión DEMO');await page.getByRole('button',{name:'Guardar'}).click();
 expect(writes).toHaveLength(1);expect(writes[0]).toMatchObject({company_id:company,code:'DEMO-AFE',name:'Dimensión DEMO'});expect(writes[0].first_used_at).toBeUndefined();
});
test('configurable import requires server preview before confirmation and preserves codes',async({page})=>{
 const company='10000000-0000-4000-8000-000000000001',writes:any[]=[];
 await page.addInitScript(()=>sessionStorage.setItem('erp.session',JSON.stringify({access_token:'synthetic',refresh_token:'synthetic',expires_in:3600})));
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let body:any={data:[],count:0};
  if(path==='/api/auth/workspace')body={companies:[{id:company,code:'DEMO',legal_name:'Empresa DEMO'}]};
  if(path==='/api/auth/me')body={profile:{id:company,full_name:'Configurador DEMO',status:'active'},permissions:['accounting_configuration.view','afe.import','afe.manage'].map(code=>({code}))};
  if(path==='/api/accounting/configuration-import/afe'){const b=req.postDataJSON();writes.push(b);body={status:b.confirm?'imported':'preview',persisted:b.confirm,validated_rows:b.rows.length};}
  await route.fulfill({json:body});
 });
 await page.goto('/app/accounting-configuration');
 await expect(page.getByRole('button',{name:/Confirmar importación/})).toHaveCount(0);
 await page.locator('input[type=file]').setInputFiles({name:'afe.csv',mimeType:'text/csv',buffer:Buffer.from('code,name,active,valid_from\n00001,Dimensión TEST,true,2026-09-22\n')});
 await page.getByRole('button',{name:'Preview sin persistencia'}).click();
 await expect(page.getByText('Validación correcta. Ninguna fila persistida.')).toBeVisible();
 expect(writes).toHaveLength(1);expect(writes[0].confirm).toBe(false);expect(writes[0].rows[0].code).toBe('00001');
 await page.getByRole('button',{name:'Confirmar importación de 1 registros'}).click();
 await expect(page.getByText('Importación confirmada.')).toBeVisible();
 expect(writes[1].confirm).toBe(true);
});
test('DEMO event workflow uses persisted preview and an idempotent manual generation request',async({page})=>{
 const company='10000000-0000-4000-8000-000000000001',id='20000000-0000-4000-8000-000000000001';
 const record:any={id,company_id:company,event_type:'PAYABLE_RECOGNIZED',source_type:'payable',source_id:id,source_revision:'1',event_date:'2026-09-22',amount:180,currency_id:id,status:'pending_mapping',source_snapshot:{currency_code:'PEN'},dimensions:{}};
 const writes:{path:string;body:any;key:string|undefined}[]=[];
 await page.addInitScript(()=>sessionStorage.setItem('erp.session',JSON.stringify({access_token:'synthetic',refresh_token:'synthetic',expires_in:3600})));
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;let body:any={data:[],count:0};
  if(path==='/api/runtime')body={environment:'demo'};
  else if(path==='/api/auth/workspace')body={companies:[{id:company,code:'DEMO',legal_name:'Empresa DEMO sintética'}]};
  else if(path==='/api/auth/me')body={profile:{id,full_name:'Contabilidad DEMO',status:'active'},permissions:['accounting_event.view','accounting_event.resolve','accounting_event.preview','accounting_event.generate','journal.create'].map(code=>({code}))};
  else if(path==='/api/accounting/options')body={periods:[{id,name:'2026-09',status:'open'}],entry_types:[{id,name:'Tipo DEMO'}]};
  else if(path==='/api/accounting/events')body={data:[record],count:1};
  else if(path===`/api/accounting/events/${id}`)body={record,sources:[],sources_count:0};
  else if(request.method()==='POST'){
   writes.push({path,body:request.postDataJSON(),key:request.headers()['idempotency-key']});
   if(path.endsWith('/resolve'))Object.assign(record,{status:'ready',rule_id:id,demo_configuration:true});
   if(path.endsWith('/preview'))Object.assign(record,{status:'previewed',preview_result:{lines:[{account_code:'DEMO-DEBIT',debit:180,credit:0,dimensions:[]},{account_code:'DEMO-CREDIT',debit:0,credit:180,dimensions:[]}]}});
   if(path.endsWith('/generate'))Object.assign(record,{status:'draft_generated',journal_entry_id:id});
   body=record;
  }
  await route.fulfill({json:body});
 });
 await page.goto('/app/accounting-events');
 await expect(page.getByText(/ENTORNO DEMO/)).toBeVisible();
 await page.getByRole('button',{name:'Ver trazabilidad'}).click();
 await page.getByRole('button',{name:'Resolver regla'}).click();
 await expect(page.getByText('CONFIGURACIÓN DEMO - NO PRODUCTIVA',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Previsualizar',exact:true}).click();
 await expect(page.getByText('DEMO-DEBIT',{exact:true})).toBeVisible();
 await page.getByLabel('Período',{exact:true}).selectOption(id);
 await page.getByLabel('Tipo de asiento',{exact:true}).selectOption(id);
 await page.getByRole('button',{name:'Generar borrador DEMO'}).click();
 await expect(page.getByText('Asiento vinculado:')).toBeVisible();
 expect(writes.map(w=>w.path.split('/').at(-1))).toEqual(['resolve','preview','generate']);
 expect(writes[2]?.body).toEqual({period_id:id,entry_type_id:id});
 expect(writes[2]?.key).toMatch(/^[\da-f-]{36}$/);
});
