# Fase 4 — Reporte final DEV

Estado funcional: **PASS — 15 verificaciones PASS, 0 FAIL**.

Ejecución `F4_20260910202312`. Último seguimiento concluido: `2026-09-11T02:04:40.749Z` (UTC), proceso finalizado con código 0. Evidencia actual: [resultado-dev.json](resultado-dev.json), con repetición de Storage, revocación, auditoría e interfaz tras las correcciones. Se usaron exclusivamente fixtures sintéticos en el mismo proyecto DEV de la aplicación. La Fase 3.1 permanece aprobada con su excepción SMTP/callback no bloqueante; no se intervino SMTP.

## Matriz de verificación real

| N.º | Caso | Resultado |
|---|---|---|
| 1 | Setup sintético por API; sin grants de migración ni ejecución financiera del administrador | PASS |
| 2 | A no lee B y REST directo no permite crear ni aprobar solicitudes | PASS |
| 3 | CECO/proyecto/subproyecto y primer uso transaccional | PASS |
| 4 | Solicitud e historial; CECO usado no permite cambio de código | PASS |
| 5 | Aprobación configurada, autoaprobación prohibida, transición inválida y observación versionada | PASS |
| 6 | Proveedor compartible por identidad y duplicado rechazado | PASS |
| 7 | Cuenta bancaria pendiente no activa; aprobación independiente | PASS |
| 8 | Orden de servicio, separación de aprobación y prohibición de edición posterior | PASS |
| 9 | Comprobante duplicado protegido en base de datos | PASS |
| 10 | CxP a 30 días y conformidad obligatoria | PASS |
| 11 | Anticipado sin factura, fecha explícita y ausencia de estado PAID | PASS |
| 12 | Storage privado, upload y download reales; empresa y extensión incorrectas rechazadas | PASS |
| 13 | Bloqueo y revocación invalidan sesión existente, REST y archivos | PASS |
| 14 | Reportes y auditoría real preservan actor/empresa y no incluyen cuentas bancarias | PASS |
| 15 | UI real: creación de solicitud y dashboard sin mocks | PASS |

## Comprobaciones complementarias

| Comprobación | Resultado |
|---|---|
| Migraciones 012–016 aplicadas sólo a DEV; 001–016 presentes LOCAL y REMOTE | PASS |
| Coincidencia del proyecto CLI con SUPABASE_URL de la aplicación | PASS |
| TypeScript backend/frontend y build Vite | PASS |
| API, autenticación, validadores, cifrado y archivos | 24 PASS, 0 FAIL |
| Base de datos desechable PGlite: regresiones Fases 2–3 y Fase 4 | 39 grupos PASS, 0 FAIL |
| Playwright: regresión de interfaz Fase 3 | 6 PASS, 0 FAIL |
| Límite cliente/backend y ausencia de claves en bundle | PASS |
| Escaneo adicional de 23 archivos de cliente, bundle y evidencias contra valores secretos configurados | PASS |

Las pruebas locales no sustituyen evidencia remota: la matriz superior sí utiliza Auth, PostgREST, RPC y Storage DEV reales. El recorrido de UI real crea una solicitud desde el formulario y muestra el dashboard; las seis pruebas adicionales de regresión usan el servidor de pruebas. No se declara cobertura visual exhaustiva de todas las combinaciones de formularios.

## Incidencias resueltas y límites

1. Storage realiza preflight con `contentLength` y persiste `size`. La migración 015 admite ambas representaciones manteniendo el tamaño exacto; la confirmación exige el objeto persistido.
2. La CDN devolvió un objeto privado cacheado después de revocar membership. La migración 016 y el cifrado backend AES-256-GCM impiden obtener el documento legible desde Storage: sólo almacena ciphertext autenticado por empresa/adjunto. En la prueba, la CDN devolvió HTTP 200/HIT de bytes cifrados; la API denegó la descarga legible con HTTP 404. **No se afirma que la CDN reevalúe RLS en cada HIT.**
3. El cierre del navegador de verificación en Windows retuvo el proceso después de guardar los resultados. El verificador revoca sus sesiones antes de terminar los recursos de navegador. También se corrigió un selector que coincidía con nombres repetidos de fixtures: cada repetición usa un nombre único. El seguimiento final terminó con código 0. Estos problemas del runner no se trataron como aprobaciones funcionales.

El fallo previo y el resultado anterior se conservan en el historial JSON y en [resultado-dev-previo-storage.json](resultado-dev-previo-storage.json). No se relajaron RLS, RBAC, auditoría ni los controles de sesión/membership para conseguir PASS. Los adjuntos anteriores eran sintéticos; quedaron retirados del flujo normal como `legacy`.

**Resguardar ATTACHMENT_ENCRYPTION_KEY**: está configurada únicamente en backend DEV. No regenerarla ni reemplazarla sin una estrategia de recifrado; su pérdida impide recuperar los adjuntos existentes. Rotación/versiones de clave, antivirus/CDR y depuración de cargas pendientes quedan documentados como ampliaciones pendientes. Ningún sistema puede revocar copias que un usuario ya descargó legítimamente.

La evidencia de migraciones procede de la CLI; no se declara resuelto el diagnóstico histórico PostgreSQL 28P01 de conexión SQL directa.

## Entrega y recorrido

[Entrega completa: tablas, migraciones, RLS, RPC, API, UI, Storage, workflows, permisos, pruebas, recorrido manual e incidencias](README.md).

[Compatibilidad de esquema](compatibilidad.md) · [Migraciones DEV](migraciones-dev.json) · [Solicitudes reales de prueba](capturas/solicitudes-dev.png) · [Dashboard DEV](capturas/dashboard-dev.png).

Fase 4 implementada y verificada en DEV. No se desplegó a producción ni se inició Fase 5. No existen ejecución bancaria real, conciliación, journal entries productivos, SUNAT automático, viáticos ni cobranzas productivas.
