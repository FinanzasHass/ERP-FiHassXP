import {readFile,writeFile} from 'node:fs/promises';
const dir='docs/fase-3.1';const report=JSON.parse(await readFile(dir+'/resultado-dev.json','utf8'));
const sql=JSON.parse(await readFile(dir+'/evidencia-sql.json','utf8'));
const cli=JSON.parse(await readFile(dir+'/evidencia-cli.json','utf8'));
if(cli.status!=='PASS'||cli.sameProjectAsApplication!==true)throw new Error('Evidencia CLI no válida para el criterio 1');
report.results[0]={...report.results[0],status:cli.status,evidence:cli.evidence,evidenceSource:cli.source,reviewedAt:cli.reviewedAt};
delete report.results[0].executedAt;
report.diagnostics=[{name:'Conexión SQL mediante SUPABASE_DB_URL',classification:'DIAGNOSTIC',...sql}];
report.generatedAt=new Date().toISOString();report.summary={criticalPass:report.results.filter(r=>r.critical&&r.status==='PASS').length,criticalFail:report.results.filter(r=>r.critical&&r.status==='FAIL').length,blockedExternal:report.results.filter(r=>r.status==='BLOCKED_EXTERNAL').length,pass:report.results.filter(r=>r.status==='PASS').length,fail:report.results.filter(r=>r.status==='FAIL').length};
report.approval=report.summary.criticalFail?'NOT_APPROVED_CRITICAL_FAIL':report.results.some(r=>r.critical&&r.status==='BLOCKED_EXTERNAL')?'PENDING_CRITICAL_EXTERNAL':report.summary.fail?'PENDING_FAILURES':report.summary.blockedExternal?'PASSED_WITH_NON_BLOCKING_EXTERNAL_EXCEPTION':'PASSED';
await writeFile(dir+'/resultado-dev.json',JSON.stringify(report,null,2));
await writeFile(dir+'/resultado-dev.md',[
'# Fase 3.1 — Resultado actual contra Supabase DEV','',`Ejecución de datos: ${report.run}. Informe actualizado: ${report.generatedAt}. Nueva comprobación SQL: ${sql.executedAt}.`,'',
`**Critical PASS: ${report.summary.criticalPass} · Critical FAIL: ${report.summary.criticalFail} · BLOCKED_EXTERNAL: ${report.summary.blockedExternal}.**`,'',
`Total: ${report.summary.pass} PASS, ${report.summary.fail} FAIL. Estado: ${report.approval}. **Fase 4 no iniciada.**`,'',
'Este informe sustituye el preflight histórico como fuente del estado actual. PASS se basa en llamadas reales a Supabase y, cuando corresponde, navegador sin mocks. BLOCKED_EXTERNAL no equivale a PASS ni a una vulnerabilidad demostrada.','',
'| N.º | Verificación | Crítico | Resultado | Evidencia |','|---|---|---|---|---|',...report.results.map(r=>`| ${r.id} | ${r.name} | ${r.critical?'Sí':'No'} | ${r.status} | ${r.evidence.replaceAll('|','/')} |`),'',
'## Incidencias y correcciones de verificación','',
'El primer intento de subproyecto devolvió 403 correctamente porque el verificador había leído sólo la primera página del catálogo de permisos. Se corrigió la paginación, se completó el rol exclusivo de pruebas y se repitió el caso: PASS. No se relajó RLS ni se modificó el producto para obtener ese resultado. La incidencia anterior permanece en el historial JSON.','',
'El criterio 1 acredita la aplicación de migraciones con la evidencia histórica CLI comunicada por el propietario: `supabase migration list` mostró 202609090001–202609090011 en LOCAL y REMOTE y `supabase db push` finalizó con "Finished supabase db push". Se verificó localmente que el project-ref vinculado por CLI coincide con el hostname SUPABASE_URL de la aplicación DEV, sin revelar valores. No se afirma haber vuelto a ejecutar esos comandos en esta revisión. Evidencia y procedencia: [evidencia-cli.json](evidencia-cli.json).','',
`Diagnóstico independiente, fuera de las 23 verificaciones: conexión SQL mediante SUPABASE_DB_URL — ${sql.status}. ${sql.evidence} Último intento: ${sql.executedAt}. El intento llegó al pooler del mismo proyecto con TLS validado y recibió PostgreSQL 28P01. No se declara que la conexión SQL funciona; este diagnóstico no invalida el historial remoto acreditado por CLI.`,'',
'SMTP permanece BLOCKED_EXTERNAL: no se dispone de buzón verificable y no se enviaron mensajes a direcciones ajenas. Generar un enlace de sesión con Auth Admin no se consideró evidencia de entrega SMTP ni de callback por correo.','',
'## Alcance y evidencia','',
'- Se conservaron las migraciones y bootstrap existentes; no se ejecutó DDL ni se reinicializó el administrador.',
'- Dos empresas y tres usuarios sintéticos, además del administrador existente; identificadores en [fixtures-dev.json](fixtures-dev.json). Datos de prueba retenidos para revisión, sin limpieza destructiva.',
'- CSV/XLSX confirmados desde la UI y consultados después en DEV. [Captura CECO real de prueba](capturas/ceco-dev-real.png).',
'- Credenciales y contraseñas sintéticas se usaron en memoria; no se incluyen en informes. Se escanearon valores reales contra el bundle y logs locales disponibles. No se afirma haber inspeccionado logs de proveedores a los que no se tuvo acceso.',
'- Estado actual legible por herramientas: [resultado-dev.json](resultado-dev.json). El preflight [verificacion.md](verificacion.md) es sólo histórico.','',
'## Repetición','',
'Con las credenciales guardadas localmente, ejecutar Node 24.18.0 con `--env-file=.env.verification.local scripts/verify-dev-sql.mjs`, seguido de `scripts/finalize-phase31.mjs` para actualizar el diagnóstico SQL independiente. Este diagnóstico no sobrescribe el criterio funcional de migraciones acreditado por CLI. El verificador SQL realiza consultas de lectura. La CA local se conserva en `.tools/supabase-ca.crt`; no es una clave privada.','',
'`verify-phase31.ts` ejecuta el circuito completo y crea un nuevo conjunto de fixtures DEV; no utilizarlo contra producción ni para repetir únicamente una consulta SQL pendiente. `verify-phase31-followup.ts` registra la corrección de paginación y la confirmación de archivos sobre los fixtures existentes. Fase 4 autorizada por el propietario después de emitir este reporte y confirmar ausencia de FAIL crítico; SMTP queda fuera de su alcance.',
'',report.approval==='PASSED_WITH_NON_BLOCKING_EXTERNAL_EXCEPTION'?'**FASE 3.1 SUPERADA CON EXCEPCIÓN EXTERNA NO BLOQUEANTE.** La única excepción entre los 23 criterios es SMTP/callback.':''
].join('\n'));
console.log(JSON.stringify(report.summary));
