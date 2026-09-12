# Fase 5 — Reporte final DEV

**Resultado: 25 PASS, 0 FAIL en la matriz solicitada.** Cuatro verificaciones complementarias PASS. Sin fallos críticos pendientes en las pruebas ejecutadas. La excepción SMTP/callback de Fase 3.1 permanece externa y no se intervino.

Se aplicaron exclusivamente al mismo Supabase DEV de la aplicación las migraciones **017–021**. La CLI confirmó versiones LOCAL/REMOTE y coincidencia del project-ref; no se afirma reparada la conexión SQL directa histórica. No se usaron datos productivos ni se enviaron transferencias bancarias.

## Matriz solicitada

| N.º | Caso real DEV | Resultado |
|---|---|---|
| 01 | Banco empresa A no accesible desde B | PASS |
| 02 | Crear OP | PASS |
| 03 | OP varias CxP | PASS |
| 04 | Exceder outstanding rechazado | PASS |
| 05 | Monedas incompatibles rechazadas | PASS |
| 06 | Autoaprobación prohibida | PASS |
| 07 | OP aprobada inmutable | PASS |
| 08 | Pago parcial | PASS |
| 09 | Pago completo | PASS |
| 10 | Pago cubriendo varias CxP | PASS |
| 11 | CxP no puede marcarse paid manualmente | PASS |
| 12 | Reverso restaura outstanding | PASS |
| 13 | Voucher cifrado y metadatos V1 | PASS |
| 14 | Revocación membership bloquea voucher | PASS |
| 15 | Lote de pagos | PASS |
| 16 | Importación bancaria preview sin persistencia | PASS |
| 17 | Idempotencia importación | PASS |
| 18 | Suggested match sin conciliación automática | PASS |
| 19 | Conciliación, cierre y reapertura controlada | PASS |
| 20 | Movimiento empresa B rechazado | PASS |
| 21 | REST directo bloqueado | PASS |
| 22 | Auditoría empresarial sin cuentas completas | PASS |
| 23 | Cash Flow no duplica pagos | PASS |
| 24 | UI real sin mocks | PASS |
| 25 | Secretos ausentes del bundle | PASS |

## Comprobaciones complementarias DEV

| Caso | Resultado |
|---|---|
| Concurrencia DEV: sólo una ejecución puede consumir el mismo remanente | PASS |
| Compatibilidad: adjunto V1 de Fase 4 sigue descifrable | PASS |
| UI DEV: CSV/XLSX preview, duplicados, confirmación y moneda legible | PASS |
| RPC DEV: rechaza NaN, precisión excesiva y acceso al núcleo interno | PASS |

En la prueba concurrente dos pagos solicitaron el mismo saldo: respuestas HTTP 200 y 409. Se reversó el ganador y canceló el borrador rechazado para restaurar el fixture, conservando ambos registros y auditoría. La importación visual de CSV/XLSX confirmó duplicados sin añadir otro movimiento. Los adjuntos V1 históricos siguieron siendo legibles con autorización vigente.

## Validación local

- 28 pruebas de aplicación, autenticación, validadores, archivos, claves versionadas y parser: PASS.
- 52 grupos de base de datos sobre PGlite, incluyendo regresiones Fases 2–4 y Tesorería: PASS.
- 6 pruebas Playwright de regresión de interfaz: PASS.
- TypeScript backend/frontend, build Vite y límite de secretos cliente/backend: PASS.

La matriz principal se ejecutó en 2026-09-11T18:35:33.981Z (UTC); el seguimiento final en 2026-09-11T23:52:16.703Z (UTC). Los casos principales y el seguimiento son ejecuciones reales separadas; los tests PGlite y de regresión no se presentan como evidencia remota. El seguimiento vuelve a comprobar el código final en concurrencia, compatibilidad V1 y UI, y limites-dev.json verifica el endurecimiento RPC de 021.

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
