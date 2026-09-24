import test from 'node:test';
import assert from 'node:assert/strict';
import {configurationImportRows} from '../src/client/configuration-import-parser.js';
import {afe,legacy} from '../src/server/validators/accounting-configuration.js';
test('configuration imports preserve textual identity and never infer legacy meaning',()=>{
 assert.deepEqual(configurationImportRows('afe',[['code','name','active','valid_from'],['00001','Dimensión TEST','true','2026-09-22']]),[{code:'00001',name:'Dimensión TEST',active:true,valid_from:'2026-09-22'}]);
 const rows=configurationImportRows('legacy_mapping',[['dictionary','legacy_code','valid_from'],['SUBDIARIO','0003','2026-09-22']]);
 assert.equal(rows[0]?.erp_mapping,undefined);assert.equal(legacy.safeParse(rows[0]).success,true);
 assert.throws(()=>configurationImportRows('afe',[['code','code'],['A','B']]));
 assert.throws(()=>configurationImportRows('afe',[['code','active'],['A','sí']]));
 assert.throws(()=>configurationImportRows('project',[['code','name'],['A','=SUM(1)']]));
 assert.throws(()=>configurationImportRows('legacy_mapping',[['erp_mapping'],['[]']]));
});
test('AFE and legacy schemas reject client-controlled company, first-use and version metadata',()=>{
 const base={code:'TEST',name:'Dimensión',valid_from:'2026-09-22'};
 assert.equal(afe.safeParse(base).success,true);
 assert.equal(afe.safeParse({...base,first_used_at:'2026-09-22'}).success,false);
 assert.equal(afe.safeParse({...base,company_id:'forged'}).success,false);
 assert.equal(legacy.safeParse({dictionary:'ACCOUNT',legacy_code:'01',valid_from:'2026-09-22'}).success,false);
 assert.equal(legacy.safeParse({dictionary:'MONEDA',legacy_code:'01',valid_from:'2026-09-22',version:3}).success,false);
});
