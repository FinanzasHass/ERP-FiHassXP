import {readFile,writeFile} from 'node:fs/promises';import {randomBytes} from 'node:crypto';
const env=await readFile('.env','utf8');
if(/^NODE_ENV\s*=\s*production\s*$/m.test(env))throw new Error('DEV only');
if(!/^ATTACHMENT_ENCRYPTION_KEY=/m.test(env)){await writeFile('.env',env.replace(/\s*$/,'')+'\nATTACHMENT_ENCRYPTION_KEY='+randomBytes(32).toString('hex')+'\n');console.log('Clave de cifrado DEV creada en .env; valor no mostrado. Conservar copia segura.');}
else console.log('Clave existente conservada.');
