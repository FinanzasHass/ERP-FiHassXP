import {test} from 'node:test';
import assert from 'node:assert/strict';
import {financeSchemas,transitionSchema,uploadSchema} from '../src/server/validators/finance.js';
import {validateAttachment} from '../src/server/services/attachments.js';
import {encryptAttachment,decryptAttachment} from '../src/server/services/attachment-crypto.js';
import {randomBytes} from 'node:crypto';
const id='00000000-0000-4000-8000-000000000001';
test('authenticated encryption keeps CDN bytes opaque and rejects wrong company, key or modification',()=>{
 const key=randomBytes(32).toString('hex'),bytes=Buffer.from('%PDF-1.4 synthetic private document');
 const encrypted=encryptAttachment(key,bytes,'company-A',id);assert.equal(encrypted.length,bytes.length+32);assert.equal(encrypted.includes(bytes),false);
 assert.deepEqual(decryptAttachment(key,encrypted,'company-A',id),bytes);
 assert.throws(()=>decryptAttachment(key,encrypted,'company-B',id));assert.throws(()=>decryptAttachment(key,encrypted,'company-A','different-id'));
 assert.throws(()=>decryptAttachment(randomBytes(32).toString('hex'),encrypted,'company-A',id));
 encrypted[encrypted.length-1]^=1;assert.throws(()=>decryptAttachment(key,encrypted,'company-A',id));
 assert.throws(()=>encryptAttachment(undefined,bytes,'company-A',id));
});
test('financial validators reject client ownership, company, state and calculated totals',()=>{
 const valid={request_type:'service',cost_center_id:id,currency_id:id,description:'Synthetic',justification:'Test',required_date:'2026-09-10',payment_modality:'credit',items:[{description:'Item',quantity:1,unit_price:100}]};
 assert.ok(financeSchemas.request.safeParse(valid).success);
 for(const extra of [{company_id:id},{requester_id:id},{status:'approved'},{estimated_amount:1},{first_used_at:'2026-01-01'}])assert.equal(financeSchemas.request.safeParse({...valid,...extra}).success,false);
 assert.equal(financeSchemas.request.safeParse({...valid,request_type:'reimbursement'}).success,false);
 assert.equal(transitionSchema.safeParse({action:'paid',comment:'Not phase 4'}).success,false);
 assert.equal(financeSchemas.payable.safeParse({request_id:id,supplier_id:id,payment_term_id:id,issue_date:'2026-09-10',outstanding_amount:0}).success,false);
});
test('file checks reject disguised executables, mismatched MIME, active PDF/XML and oversized content',()=>{
 validateAttachment('test.pdf','application/pdf',Buffer.from('%PDF-1.4\nsynthetic'));
 validateAttachment('test.xml','application/xml',Buffer.from('<?xml version="1.0"?><Invoice>test</Invoice>'));
 for(const [name,mime,body] of [['test.pdf','application/pdf','MZ executable'],['test.exe','application/pdf','%PDF-1.4'],['test.pdf','application/pdf','%PDF-1.4 /JavaScript ()'],['test.xml','application/xml','<!DOCTYPE x [<!ENTITY t SYSTEM "file:///etc/passwd">]><x/>'],['test.xml','application/xml','<script>alert(1)</script>'],['test.png','application/pdf','fake']])assert.throws(()=>validateAttachment(name!,mime!,Buffer.from(body!)));
 assert.throws(()=>validateAttachment('big.pdf','application/pdf',Buffer.alloc(5242881)));
 assert.equal(uploadSchema.safeParse({company_id:id,entity_type:'request',entity_id:id,filename:'../escape.pdf',mime_type:'application/pdf',base64:'AAAA'}).success,false);
});
