# Fase 3.1 — Resultado actual contra Supabase DEV

Ejecución de datos: V31_20260910165903. Informe actualizado: 2026-09-10T17:21:07.114Z. Nueva comprobación SQL: 2026-09-10T17:06:52.670Z.

**Critical PASS: 16 · Critical FAIL: 0 · BLOCKED_EXTERNAL: 1.**

Total: 22 PASS, 0 FAIL. Estado: PASSED_WITH_NON_BLOCKING_EXTERNAL_EXCEPTION. **Fase 4 no iniciada.**

Este informe sustituye el preflight histórico como fuente del estado actual. PASS se basa en llamadas reales a Supabase y, cuando corresponde, navegador sin mocks. BLOCKED_EXTERNAL no equivale a PASS ni a una vulnerabilidad demostrada.

| N.º | Verificación | Crítico | Resultado | Evidencia |
|---|---|---|---|---|
| 1 | Migraciones 001–011 | Sí | PASS | Supabase CLI vinculada al mismo project-ref DEV utilizado por la aplicación mostró 202609090001–202609090011 en LOCAL y REMOTE; db push previo terminó con Finished supabase db push. Ejecuciones históricas confirmadas por el propietario; correspondencia CLI/aplicación verificada localmente en esta revisión. La conexión SQL mediante SUPABASE_DB_URL permanece como diagnóstico separado BLOCKED_EXTERNAL (28P01). |
| 2 | Variables backend | Sí | PASS | Variables backend válidas, cargadas localmente sin imprimir valores. Entorno confirmado DEV por el propietario. |
| 3 | Separación publishable/secret | Sí | PASS | Auth Admin acepta secret; publishable sin sesión no ejecuta lookup privilegiado. CRUD de pruebas usa API request-scoped. |
| 4 | Administrador inicial | Sí | PASS | Administrador existente activo y efectivo, autenticado con sesión real. Bootstrap no repetido; contraseña no modificada. |
| 5 | Dos empresas de prueba | No | PASS | Dos empresas sintéticas creadas por Express/RPC; identificadas en el manifiesto. |
| 6 | Usuarios solicitante/aprobador/Finanzas/administrador | No | PASS | Tres usuarios sintéticos provisionados por API y login por username real; administrador inicial conservado. |
| 7 | Memberships empresariales | Sí | PASS | Solicitante/aprobador en A; Finanzas en A/B. Workspace del solicitante excluye B. |
| 8 | Roles por empresa | Sí | PASS | Roles nuevos configurados y asignados por empresa; permiso A no concede B. Sin grants financieros nuevos. |
| 9 | Selector multiempresa | Sí | PASS | Navegador real sin mocks: login y cambio B→A confirmados visualmente contra API DEV. |
| 10 | CECO raíz e hijo | No | PASS | Raíz e hijo persistidos en DEV; nivel derivado 0/1. |
| 11 | Rechazo de ciclo CECO | Sí | PASS | Ciclo rechazado HTTP 409; padre original conserva NULL. |
| 12 | Rechazo de padre de otra empresa | Sí | PASS | Referencia A→B rechazada HTTP 409 por la regla persistida. |
| 13 | Proyecto/subproyecto | No | PASS | Proyecto/subproyecto creados en DEV con misma empresa. Repetición aprobada tras corregir paginación del verificador y completar grants sólo del rol sintético. |
| 14 | CSV y XLSX contra API real | No | PASS | CSV y XLSX cargados desde navegador real, previsualizados y confirmados por UI/Express/RPC; cada archivo persistió 1 centro en DEV. Sin mocks. |
| 15 | Preview sin persistencia | Sí | PASS | Preview de hijo antes de padre: 2 previstos, 0 escrituras y 0 eventos persistidos (comparación antes/después). |
| 16 | Confirmación de importación | No | PASS | Lote confirmado: 2 creados y 0 errores en Supabase DEV. |
| 17 | Idempotencia al repetir lote | Sí | PASS | Mismo lote: 0 creados, 2 ignorados, 0 errores. |
| 18 | Bloqueo con sesión existente | Sí | PASS | Mismo JWT: API 403 y REST sin filas tras bloqueo. Usuario sintético reactivado al concluir. |
| 19 | Revocación de membership con sesión existente | Sí | PASS | Mismo JWT: API 403 y REST sin filas tras revocación; membresía de prueba restaurada. |
| 20 | REST directo a tablas | Sí | PASS | REST: B devuelve 0 filas; INSERT directo de maestro y auditoría devuelve 403. |
| 21 | Auditoría | Sí | PASS | Auditoría consultada por API: actor Finanzas sintético, empresa A, entidad CECO y new_values correctos. |
| 22 | SMTP y callback | No | BLOCKED_EXTERNAL | No hay buzón SMTP verificable en esta sesión. No se envió correo a direcciones ajenas; respuesta HTTP o token generado por Auth Admin no acreditan entrega SMTP/callback. |
| 23 | Ausencia de secret en bundle/logs | Sí | PASS | Valores reales comparados en memoria: ausentes en src/client, shared, bundle y logs locales disponibles. No se exportaron valores ni respuestas Auth. |

## Incidencias y correcciones de verificación

El primer intento de subproyecto devolvió 403 correctamente porque el verificador había leído sólo la primera página del catálogo de permisos. Se corrigió la paginación, se completó el rol exclusivo de pruebas y se repitió el caso: PASS. No se relajó RLS ni se modificó el producto para obtener ese resultado. La incidencia anterior permanece en el historial JSON.

El criterio 1 acredita la aplicación de migraciones con la evidencia histórica CLI comunicada por el propietario: `supabase migration list` mostró 202609090001–202609090011 en LOCAL y REMOTE y `supabase db push` finalizó con "Finished supabase db push". Se verificó localmente que el project-ref vinculado por CLI coincide con el hostname SUPABASE_URL de la aplicación DEV, sin revelar valores. No se afirma haber vuelto a ejecutar esos comandos en esta revisión. Evidencia y procedencia: [evidencia-cli.json](evidencia-cli.json).

Diagnóstico independiente, fuera de las 23 verificaciones: conexión SQL mediante SUPABASE_DB_URL — BLOCKED_EXTERNAL. Conexión/historial SQL no verificable; diagnóstico sanitizado: 28P01. Último intento: 2026-09-10T17:06:52.670Z. El intento llegó al pooler del mismo proyecto con TLS validado y recibió PostgreSQL 28P01. No se declara que la conexión SQL funciona; este diagnóstico no invalida el historial remoto acreditado por CLI.

SMTP permanece BLOCKED_EXTERNAL: no se dispone de buzón verificable y no se enviaron mensajes a direcciones ajenas. Generar un enlace de sesión con Auth Admin no se consideró evidencia de entrega SMTP ni de callback por correo.

## Alcance y evidencia

- Se conservaron las migraciones y bootstrap existentes; no se ejecutó DDL ni se reinicializó el administrador.
- Dos empresas y tres usuarios sintéticos, además del administrador existente; identificadores en [fixtures-dev.json](fixtures-dev.json). Datos de prueba retenidos para revisión, sin limpieza destructiva.
- CSV/XLSX confirmados desde la UI y consultados después en DEV. [Captura CECO real de prueba](capturas/ceco-dev-real.png).
- Credenciales y contraseñas sintéticas se usaron en memoria; no se incluyen en informes. Se escanearon valores reales contra el bundle y logs locales disponibles. No se afirma haber inspeccionado logs de proveedores a los que no se tuvo acceso.
- Estado actual legible por herramientas: [resultado-dev.json](resultado-dev.json). El preflight [verificacion.md](verificacion.md) es sólo histórico.

## Repetición

Con las credenciales guardadas localmente, ejecutar Node 24.18.0 con `--env-file=.env.verification.local scripts/verify-dev-sql.mjs`, seguido de `scripts/finalize-phase31.mjs` para actualizar el diagnóstico SQL independiente. Este diagnóstico no sobrescribe el criterio funcional de migraciones acreditado por CLI. El verificador SQL realiza consultas de lectura. La CA local se conserva en `.tools/supabase-ca.crt`; no es una clave privada.

`verify-phase31.ts` ejecuta el circuito completo y crea un nuevo conjunto de fixtures DEV; no utilizarlo contra producción ni para repetir únicamente una consulta SQL pendiente. `verify-phase31-followup.ts` registra la corrección de paginación y la confirmación de archivos sobre los fixtures existentes. Fase 4 autorizada por el propietario después de emitir este reporte y confirmar ausencia de FAIL crítico; SMTP queda fuera de su alcance.

**FASE 3.1 SUPERADA CON EXCEPCIÓN EXTERNA NO BLOQUEANTE.** La única excepción entre los 23 criterios es SMTP/callback.