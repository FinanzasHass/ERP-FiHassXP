import {readFile,writeFile} from 'node:fs/promises';import {parseEnv} from 'node:util';
const text=await readFile('.env','utf8'),env=parseEnv(text),v1=env.ATTACHMENT_ENCRYPTION_KEY_V1??env.ATTACHMENT_ENCRYPTION_KEY;
if(!v1||!/^[a-fA-F0-9]{64}$/.test(v1))throw new Error('Existing V1 key required; values omitted.');
if(env.ATTACHMENT_ENCRYPTION_KEY_V1&&env.ATTACHMENT_ENCRYPTION_KEY&&env.ATTACHMENT_ENCRYPTION_KEY_V1!==env.ATTACHMENT_ENCRYPTION_KEY)throw new Error('V1 alias mismatch; values omitted.');
let next=text;if(!env.ATTACHMENT_ENCRYPTION_KEY_V1)next+='\nATTACHMENT_ENCRYPTION_KEY_V1='+v1+'\n';if(!env.ATTACHMENT_ENCRYPTION_ACTIVE_VERSION)next+='ATTACHMENT_ENCRYPTION_ACTIVE_VERSION=V1\n';if(next!==text)await writeFile('.env',next);console.log('V1 configured from existing key; no key generated or printed.');
