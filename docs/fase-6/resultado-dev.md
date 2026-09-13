# Fase 6 · verificación Supabase DEV

Estado: **PASS**. Matriz: **30 PASS, 0 FAIL, 0 pendientes**.

Ejecución: F6_20260913045729. Proyecto DEV coincidente con la aplicación. Migraciones 001–032 LOCAL/REMOTE verificadas. Sólo fixtures sintéticos.

| N.º | Verificación | Resultado |
|---|---|---|
| 1 | Empresa A no accede expediente B | PASS |
| 2 | Solicitud VIA y numeración | PASS |
| 3 | Autoaprobación rechazada | PASS |
| 4 | Anticipo aprobado no pagado | PASS |
| 5 | Tesorería entrega anticipo | PASS |
| 6 | Rendición menor al anticipo | PASS |
| 7 | Devolución calculada exacta | PASS |
| 8 | Devolución y conciliación | PASS |
| 9 | Rendición mayor al anticipo | PASS |
| 10 | Reembolso calculado exacto | PASS |
| 11 | Reembolso integrado con Tesorería | PASS |
| 12 | Rendición exacta | PASS |
| 13 | Comprobante duplicado rechazado | PASS |
| 14 | DJ vinculada al gasto | PASS |
| 15 | DJ respeta políticas | PASS |
| 16 | Ítem observado | PASS |
| 17 | Ítem rechazado | PASS |
| 18 | Aceptación parcial por política | PASS |
| 19 | Dimensiones históricas | PASS |
| 20 | Adjuntos cifrados | PASS |
| 21 | Revocación bloquea documentos | PASS |
| 22 | Cierre con saldo rechazado | PASS |
| 23 | Cierre correcto | PASS |
| 24 | Reapertura auditada | PASS |
| 25 | REST directo bloqueado | PASS |
| 26 | Auditoría financiera | PASS |
| 27 | Dashboard propio aislado | PASS |
| 28 | Dashboard Finanzas | PASS |
| 29 | UI DEV sin mocks | PASS |
| 30 | Secretos fuera del bundle | PASS |

## Concurrencia real DEV

| Verificación | Resultado |
|---|---|
| Dos aprobaciones RPC concurrentes generan una obligación | PASS |
| Dos cierres concurrentes aplican una liquidación | PASS |
| Retry concurrente VIA no duplica anticipo | PASS |
| Dos devoluciones concurrentes consumen una vez el mismo remanente | PASS |

## Verificación complementaria

[UI e impresión DEV](resultado-ui-dev.json): 2 PASS. Se comprobó el historial persistido visible y una representación imprimible basada en datos DEV, sin mocks. [PDF exclusivamente sintético](capturas/representacion-dev-sintetica.pdf).

[Puerta local](puerta-local.json): 77 PostgreSQL, 37 aplicación y 8 Playwright, todos PASS; typechecks, Vite y secret boundary PASS. Incluye cinco casos concurrentes PostgreSQL independientes y las regresiones Fases 2–5.

La limpieza inicial del navegador se bloqueó después de persistir todos los PASS. Se detuvo exclusivamente el verificador identificado; se corrigió el cierre mediante launchServer/terminación del hijo, se verificó nuevamente UI/impresión en lectura y la ejecución complementaria finalizó con código 0. Esta incidencia no alteró el esquema ni relaja ningún control. Los fixtures y su auditoría se conservan. No se afirma que todas las sesiones del primer proceso interrumpido fueran cerradas; la sesión sintética owner fue revocada explícitamente en la comprobación complementaria. Las demás siguen su expiración normal.

SMTP conserva la excepción externa previamente aprobada; no es una prueba PASS de esta fase. No se declara resuelta la conexión PostgreSQL directa 28P01. No se inicia Fase 7.
