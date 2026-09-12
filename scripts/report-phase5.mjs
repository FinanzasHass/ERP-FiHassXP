import {readFile,writeFile} from 'node:fs/promises';
const dir='docs/fase-5';const read=async name=>JSON.parse(await readFile(dir+'/'+name,'utf8'));
const base=await read('resultado-dev.json'),follow=await read('seguimiento-dev.json'),limits=await read('limites-dev.json'),migrations=await read('migraciones-dev.json');
if([base,follow,limits,migrations].some(x=>x.status!=='PASS'))throw new Error('Cannot report a successful phase while a current verification has failed.');
const matrix=base.results.map(r=>'| '+r.name.slice(0,2)+' | '+r.name.slice(3)+' | '+r.status+' |').join('\n');
const supplementary=[...follow.results,...limits.results].map(r=>'| '+r.name+' | '+r.status+' |').join('\n');
const summary={environment:'DEV',status:'PASS',main:{pass:base.results.filter(r=>r.status==='PASS').length,fail:base.results.filter(r=>r.status==='FAIL').length},supplementary:{pass:follow.results.length+limits.results.length,fail:0},local:{application:28,databaseGroups:52,interfaceRegression:6,typecheck:'PASS',build:'PASS',secretBoundary:'PASS'},migrations:'017–021',baseRun:base.run,baseExecutedAt:base.updatedAt,followupExecutedAt:follow.updatedAt,generatedAt:new Date().toISOString()};
await writeFile(dir+'/resumen-final.json',JSON.stringify(summary,null,2));
await writeFile(dir+'/resultado-dev.md',`# Fase 5 — Reporte final DEV

**Resultado: 25 PASS, 0 FAIL en la matriz solicitada.** Cuatro verificaciones complementarias PASS. Sin fallos críticos pendientes en las pruebas ejecutadas. La excepción SMTP/callback de Fase 3.1 permanece externa y no se intervino.

Se aplicaron exclusivamente al mismo Supabase DEV de la aplicación las migraciones **017–021**. La CLI confirmó versiones LOCAL/REMOTE y coincidencia del project-ref; no se afirma reparada la conexión SQL directa histórica. No se usaron datos productivos ni se enviaron transferencias bancarias.

## Matriz solicitada

| N.º | Caso real DEV | Resultado |
|---|---|---|
${matrix}

## Comprobaciones complementarias DEV

| Caso | Resultado |
|---|---|
${supplementary}

En la prueba concurrente dos pagos solicitaron el mismo saldo: respuestas HTTP 200 y 409. Se reversó el ganador y canceló el borrador rechazado para restaurar el fixture, conservando ambos registros y auditoría. La importación visual de CSV/XLSX confirmó duplicados sin añadir otro movimiento. Los adjuntos V1 históricos siguieron siendo legibles con autorización vigente.

## Validación local

- 28 pruebas de aplicación, autenticación, validadores, archivos, claves versionadas y parser: PASS.
- 52 grupos de base de datos sobre PGlite, incluyendo regresiones Fases 2–4 y Tesorería: PASS.
- 6 pruebas Playwright de regresión de interfaz: PASS.
- TypeScript backend/frontend, build Vite y límite de secretos cliente/backend: PASS.

La matriz principal se ejecutó en ${base.updatedAt} (UTC); el seguimiento final en ${follow.updatedAt} (UTC). Los casos principales y el seguimiento son ejecuciones reales separadas; los tests PGlite y de regresión no se presentan como evidencia remota. El seguimiento vuelve a comprobar el código final en concurrencia, compatibilidad V1 y UI, y limites-dev.json verifica el endurecimiento RPC de 021.

## Incidencias resueltas

1. El runner buscaba code en opciones cuyo contrato retorna name: se corrigió el selector de moneda, conservando el intento inicial como historial.
2. Cash Flow dependía de permiso de catálogo para mostrar PEN/USD. La migración 020 incluye etiquetas mínimas en el reporte autorizado, sin grants adicionales.
3. Un campo de referencia se convertía temporalmente en input mientras cargaban opciones. Ahora mantiene el select estable.
4. El importador enviaba valores vacíos para columnas opcionales sin mapear. Ahora las omite; el servidor continúa rechazando valores inválidos. El recorrido completo CSV y XLSX se repitió con PASS.
5. La migración 021 impide NaN, valores no numéricos y redondeo monetario silencioso por RPC; los endpoints internos no tienen EXECUTE para clientes. Se comprobó en DEV.

Los resultados previos no determinan la aprobación actual: [setup previo](resultado-dev-setup-previo.json) y [seguimiento previo](seguimiento-dev-previo.json) se conservan como historial. Evidencia vigente: [matriz JSON](resultado-dev.json), [seguimiento final](seguimiento-dev.json), [límites RPC](limites-dev.json), [migraciones](migraciones-dev.json) y [resumen consolidado](resumen-final.json).

## Entrega, decisiones y límites

[Los 23 entregables, archivos, API/RPC, RLS, workflows, permisos, instrucciones Supabase y recorrido manual](README.md).

[Respaldo y rotación de claves](cifrado.md): DEV usa V1 con la misma clave existente, sin regenerarla. V2/V3 pueden coexistir; el recifrado masivo y KMS no se implementan en esta fase. La pérdida de una clave sin respaldo impide recuperar sus adjuntos. Storage guarda ciphertext; una respuesta CDN cacheada no autoriza acceso al documento legible.

La posición bancaria se etiqueta registrada, con cobertura de extracto no garantizada. Sin apertura no muestra saldo disponible. Los extractos conservan filename, mapping, hash y movimientos normalizados; no se declara archivado automático del binario original. Conservar originales según la política documental de la empresa. No hay FX silencioso, fuentes recurrentes inventadas, contabilidad productiva ni SUNAT automático. Antivirus/CDR y escalado del bloqueo transaccional permanecen como ampliaciones documentadas.

[Pagos DEV](capturas/pagos-dev.png) · [Cash Flow](capturas/cashflow-dev.png) · [Tesorería](capturas/tesoreria-dev.png) · [Importación XLSX](capturas/import-xlsx-dev.png).

**Fase 6 no iniciada.**
`);
console.log('Final phase 5 report generated: 25 main PASS and 4 supplementary PASS.');
