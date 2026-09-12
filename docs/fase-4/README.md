# Fase 4 — Gestión operativa financiera

Circuito: solicitud → revisión/aprobación → proveedor → orden opcional → conformidad cuando corresponde → comprobante → CxP. El resultado de la ejecución contra DEV está en [el reporte final](resultado-dev.md) y [resultado-dev.json](resultado-dev.json); el historial de migraciones está en [migraciones-dev.json](migraciones-dev.json). Ningún fixture representa una operación real.

## 1. Tablas nuevas

| Dominio | Tablas |
|---|---|
| Solicitudes | `financial_requests`, `financial_request_items`, `financial_request_history` |
| Aprobaciones | `approval_policies`, `approval_instances`, `approval_steps`, `approval_actions` |
| Proveedores | `suppliers`, `supplier_companies`, `supplier_contacts`, `supplier_bank_accounts`, `supplier_bank_account_changes` |
| Compras/servicios | `purchase_orders`, `purchase_order_items`, `service_acceptances` |
| Documentación | `tax_documents`, `tax_document_amounts`, `attachments` |
| Obligaciones | `payment_terms`, `payables` |
| Historia dimensional | `dimension_versions` |
| Numeración privada | `private.document_counters` |

Son 21 tablas públicas nuevas y una privada. Proyectos y subproyectos reciben `first_used_at` y protección de identidad. CxP tiene un vencimiento por obligación; no se implementaron cuotas múltiples en esta fase. La identidad legal de proveedor es compartida; la relación comercial, contactos y bancos están separados por empresa.

## 2. Migraciones y compatibilidad

| Versión | Contenido |
|---|---|
| `202609100012` | Modelo aditivo, catálogo sin grants, FK empresariales, RLS, auditoría, historia dimensional |
| `202609100013` | RPC de operaciones, transiciones, opciones, bandeja y reportes |
| `202609100014` | Bucket privado, metadata de archivos y políticas Storage |
| `202609100015` | Tamaño exacto en preflight de Storage (`contentLength`) y objeto persistido (`size`) |
| `202609100016` | Adjuntos cifrados AES-256-GCM; caché de Storage sólo contiene ciphertext |

[Revisión previa y decisiones de compatibilidad](compatibilidad.md). Las migraciones 001–011 y bootstrap se conservan; no se ejecutaron reset ni escrituras de esquema en producción.

## 3. RLS y autorización

Las tablas empresariales llevan `company_id`, incluidas las hijas. Las relaciones usan FK compuestas; las RPC comprueban adicionalmente el mismo expediente, proveedor y moneda. REST directo permite sólo SELECT sujeto a RLS. Authenticated no puede insertar/editar/borrar filas directamente. Las mutaciones RPC utilizan allowlists, `auth.uid()`, perfil/sesión activos, membership y permiso efectivo; la empresa de una transición se obtiene de la fila persistida.

Solicitudes: propio, área, empresa o todas las empresas autorizadas según permisos. El cargo no autoriza. La bandeja exige también el rol que quedó configurado en el paso. No hay grants financieros implícitos al System Administrator. Su capacidad de asignar sigue separada de ejecutar. Revocar membership, rol o bloquear perfil invalida la capacidad con el mismo JWT.

## 4. RPC públicas

| RPC | Responsabilidad |
|---|---|
| `financial_save(kind,target_id,target_company,payload)` | Crear/editar contenido permitido; importes y campos internos calculados en SQL |
| `financial_transition(kind,target_id,action,comment)` | Transición válida, permiso, segregación, historia y auditoría |
| `financial_inbox(target_company)` | Pendientes para el rol configurado del usuario; máximo 200 |
| `financial_options(target_company)` | Opciones mínimas de maestros para los formularios empresariales |
| `financial_reports(target_company)` | Agregados con SECURITY INVOKER y las mismas RLS |
| `payable_change_due_date(target_id,new_date,reason)` | Cambio de vencimiento en revisión, motivo y snapshot previo |
| `attachment_prepare(...)` | Reservar metadata/ruta para expediente autorizado |
| `attachment_finish(target_id)` | Comprobar objeto persistido, tamaño y MIME; marcar disponible |

Las funciones internas de captura dimensional, numeración, validación y auditoría no son endpoints de negocio. Las RPC no aceptan un actor arbitrario.

## 5. API y validadores

Base `/api`, Bearer JWT obligatorio. Listas y creación usan `?company_id=<UUID>`; listas aceptan `page`, `limit` (máximo 100) y filtros tipados. La API valida con Zod y la RPC vuelve a validar campos/reglas. No se aceptan `requester_id`, estado aprobado, saldo o totales calculados desde el cliente.

| Recursos | Métodos |
|---|---|
| `/financial-requests`, `/suppliers`, `/supplier-contacts`, `/bank-changes`, `/payment-terms`, `/approval-policies`, `/purchase-orders`, `/service-acceptances`, `/tax-documents`, `/payables` | GET colección, GET `/:id`, POST, PATCH `/:id`; SQL rechaza editar entidades de transición exclusiva |
| Recursos con workflow | POST `/:id/actions` con `action` y `comment` |
| `/supplier-bank-accounts` | GET; creación sólo por aprobación de propuesta |
| `/approvals` | GET bandeja |
| `/finance/options`, `/finance/reports` | GET con empresa |
| `/payables/:id/due-date` | PATCH con `new_date`, `reason` |
| `/attachments/upload` | POST JSON base64; máximo binario 5 MB |
| `/attachments/:id/download` | GET autenticado; contenido base64 para descarga |

Archivos de implementación: `src/server/routes/finance.ts`, `src/server/validators/finance.ts`, `src/server/services/attachments.ts`. Se reutilizan autenticación, errores, protección de origen, rate limiting y repositorio request-scoped. `/health` sigue público. El fallback SPA sólo acepta rutas conocidas y no captura errores de API/archivos.

## 6. UI

Páginas reales en `src/client/finance.tsx`, integradas con el estilo y selector de Fase 3:

- Operaciones: `/app/requests`, formularios de ítems, borrador/observación, envío y versiones.
- Bandeja: `/app/approvals`, datos del solicitante, área, CECO, proyecto, moneda e importe.
- Maestros: `/app/suppliers`, `/app/supplier-contacts`, `/app/bank-changes`, `/app/payment-terms`, `/app/approval-policies`.
- Compras: `/app/purchase-orders`, `/app/service-acceptances`.
- Documentos: `/app/tax-documents`, desglose tributario configurable y evidencias.
- Finanzas: `/app/payables`, cambio justificado de vencimiento y retención/cancelación.
- `/app/reports`: solicitudes por estado/área, CxP por vencimiento y obligaciones por CECO/proyecto. No se presentan como EEFF ni se suman monedas distintas.

Dashboard con datos de RLS: solicitudes pendientes, pendientes de aprobación, comprobantes observados y CxP vencidas/próximos siete días. Sin permiso muestra “Sin acceso”, no una cifra inventada.

## 7. Storage

Bucket actual `financial-encrypted`, privado. La API acepta PDF, XML, PNG y JPEG hasta 5 MB, compara extensión/MIME/firma y rechaza ejecutables disfrazados y contenido activo conocido. Cifra con AES-256-GCM y AAD por empresa/adjunto antes de Storage. El objeto remoto es `application/octet-stream`, tamaño original + 32 bytes. No existen rutas de sobrescritura/borrado. La descarga revalida sesión, RLS y membership, autentica/descifra los bytes y vuelve a comprobar su contenido. No entrega enlaces públicos ni la clave de cifrado.

El cliente de Storage usa publishable + JWT, nunca secret. La clave `ATTACHMENT_ENCRYPTION_KEY` es independiente y sólo backend; no se reutiliza la secret de Supabase. Una carga fallida puede dejar metadata `pending`; no se muestra como disponible. El control de firma no sustituye antivirus/CDR. Una escritura directa que logre introducir un blob arbitrario bajo sus propios permisos no produce un documento descifrable porque carece de autenticación AES-GCM válida.

La prueba DEV demostró que la CDN puede devolver un HIT de un objeto previamente descargado después de revocar membership, incluso con max-age=0. Por eso **no se afirma que cada petición CDN vuelva a ejecutar RLS**. Ahora sólo almacena ciphertext: la API deniega la entrega legible con acceso revocado. No es posible revocar copias que el usuario ya descargó. Los archivos anteriores de `financial-private` eran sólo fixtures, quedaron `legacy` y no tienen acceso de origen ni descarga normal; se conserva el diagnóstico.

## 8. Workflows y CECO

Solicitud: `draft → submitted → under_review → approved/observed/rejected`. Observada admite edición y nuevo envío con versión nueva. Reapertura de aprobada exige solicitante autorizado, motivo y ausencia de operaciones posteriores; vuelve a borrador y exige nueva aprobación. Cada creación/edición/transición guarda history y snapshot. No se edita una aprobada silenciosamente.

Política activa por empresa/tipo: rol aprobador y segregación propia activada por defecto. La instancia congela la política en el envío; la asignación efectiva del rol y permisos se verifica de nuevo al actuar. Estructura de pasos preparada para posteriores reglas de importe/jefe, sin nombres personales hardcodeados.

Orden: borrador → pendiente → aprobada → enviada → en curso → recepción parcial/recibida → cerrada; cancelación controlada. Prefijos `OC`/`OS`; solicitudes `SOL`, correlativos transaccionales por empresa y año. Una sola estructura para compra y servicio.

Banco: propuesta pendiente → aprobación por otro usuario → nueva cuenta vigente; sustituir cuenta conserva la anterior como superseded. Rechazo/cancelación no modifica la cuenta vigente.

Comprobante: borrador/observado → revisado o cancelado. Identidad única por empresa, proveedor legal, tipo, serie y número normalizado. RUC se valida estructuralmente; no se simula validación SUNAT. `sunat_status` y `sunat_validated_at` permanecen NULL.

CxP: borrador → revisión → aprobada; retención y cancelación auditadas. Si requiere conformidad, aprobar falla hasta existir una aceptada del mismo expediente/proveedor/orden. Saldo igual al importe original: no existe PAID manual. Factura 10/09 + 30 días sobre emisión → 10/10. Bases alternativas: recepción, conformidad y fecha explícita. La regla se congela en el payable. Un anticipado a proveedor aprobado puede crear obligación sin factura; sigue pendiente de futura ejecución, sin representar pago.

CECO: primer uso transaccional de centro y ancestros, proyecto/subproyecto. Código/empresa/relaciones históricas quedan protegidos. Nombres, descripción y categoría pueden evolucionar; snapshots preservan el significado en solicitudes, órdenes y CxP existentes.

## 9. Permisos

Catálogo activado por migración sin asignaciones a usuarios. Solicitudes: `request.view_own/view_area/view_company`, `create/edit_own/submit/approve/observe/reject/cancel`. Proveedores: `supplier.view/create/edit/disable/bank_view/bank_change/bank_change_approve`. Órdenes: `purchase_order.view/create/edit/approve/cancel`. Conformidades: `service_acceptance.view/create/accept/observe`. Documentos: `tax_document.view/create/edit/review/cancel`. CxP: `payable.view/create/review/approve/hold/cancel`. Configuración: `payment_term.view/create/edit`, `approval_policy.view/manage`.

Para operar, el administrador configura roles y los asigna por empresa con membership activo. Las pruebas asignan permisos únicamente a roles y usuarios sintéticos identificados en el informe. No se entregan permisos operativos al administrador inicial.

## 10. Pruebas y ejecución local

Node exactamente **24.18.0**. Dependencias sin cambios funcionales adicionales. Usar el Node configurado antes de ejecutar npm:

```powershell
node --version
npm ci
npm run typecheck
npm test
npm run test:db
npm run build
npm run test:e2e
```

`test:db` aplica todas las migraciones en PGlite con Auth/Storage sintéticos: no apunta a DEV por defecto. No configurar TEST_DATABASE_URL contra DEV porque el harness prepara una base desechable. Las pruebas de Storage real se realizan con el verificador DEV, no se acreditan sólo por el shim local.

Para servir API y frontend juntos localmente, construir y ejecutar:

```powershell
npm run build
node --env-file=.env dist/server/index.js
```

El verificador levanta su propio servidor local en PORT; detener la instancia de desarrollo antes de ejecutarlo:

```powershell
npm run verify:phase4:dev
```

Usa exclusivamente fixtures DEV; crea empresas/roles nuevos y conserva los registros para revisión. Los errores y resultados se sanitizan. No imprime JWT, claves, contraseñas ni enlaces de Auth. Las sesiones de verificación se cierran localmente al terminar.

## 11. Configuración Supabase y recorrido manual

1. Mantener `.env` backend con `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `APP_ORIGIN`, `PORT`, `NODE_ENV=development`, `TRUST_PROXY_HOPS=0` para localhost. Nueva variable exclusivamente backend: `ATTACHMENT_ENCRYPTION_KEY`, 32 bytes aleatorios en 64 caracteres hex. Ya se generó en el `.env` DEV sin imprimirla. Para una instalación DEV nueva, `node scripts/configure-dev-attachment-key.mjs` la crea sólo si no existe. **Conservar copia segura: perderla o reemplazarla impide descifrar adjuntos existentes.** No utilizar VITE ni guardar el valor en Git/logs. Render requiere configurar esta misma clave del entorno correspondiente; no se desplegó a producción.
2. CLI autenticada y vinculada al mismo proyecto DEV de la aplicación. Verificar con `npx supabase migration list`; no usar producción. Las 001–011/bootstrap ya existen; no repetir bootstrap.
3. Ejecutar `npm run db:dev:apply`: verifica contexto y aplica 012–016, incluyendo bucket privado cifrado. Confirmar LOCAL/REMOTE en `docs/fase-4/migraciones-dev.json`.
4. En UI de administración asignar memberships y configurar roles empresariales de solicitante, aprobador y operador. Permisos de creación no sustituyen permisos de lectura; asignar ambos cuando correspondan. El aprobador debe tener el rol seleccionado en la política y las acciones de aprobación.
5. Configurar una política activa para cada tipo utilizado. Crear condición a 30 días basada en factura y otra de fecha explícita.
6. Crear proveedor sintético, opcionalmente contacto. Proponer cuenta bancaria; comprobar que no queda vigente hasta aprobación de otro usuario.
7. Crear solicitud de servicio con CECO, proyecto/subproyecto, moneda e ítems. Adjuntar evidencia antes de enviar. Comprobar primer uso del CECO y conservación del nombre original tras renombrarlo.
8. Enviar; con aprobador iniciar revisión, observar, responder con solicitante, reenviar y aprobar. Revisar historia y versiones. Intentar autoaprobación y editar después de aprobada: deben fallar.
9. Crear OS desde la solicitud, enviar a aprobación y aprobar con otro usuario. Registrar envío/inicio/recepción/cierre según operación.
10. Crear comprobante asociado al mismo expediente/proveedor/orden. Intentar serie/número duplicado y comprobar rechazo. Revisar el documento.
11. Crear CxP con condición de 30 días. Antes de conformidad, aprobar debe fallar cuando es obligatoria. Crear y aceptar conformidad; volver a revisar/aprobar CxP. No hay acción de pago.
12. Crear otra solicitud con modalidad anticipado a proveedor, aprobar y generar obligación con fecha explícita sin factura. No se produce movimiento bancario.
13. Revisar dashboard, reportes por moneda y auditoría financiera con usuario autorizado. Cambiar a otra empresa sin datos y verificar aislamiento.
14. Bloquear un usuario o revocar membership mientras conserva sesión: API/REST de metadata y descarga legible deben denegar. Una respuesta previamente cacheada por Storage sólo debe contener ciphertext, sin clave. Restaurar sólo el fixture de prueba al terminar.

Render mantiene un Web Service: build React/Vite + Express + static, escucha `process.env.PORT`, bind de servidor existente y trust proxy explícito. Esta fase no despliega a producción.

## 12. Incidencias

El primer recorrido DEV falló en Storage por exigir `size` durante un preflight que usa `contentLength`. Se conservó el [resultado anterior](resultado-dev-previo-storage.json); la migración 015 corrige la compatibilidad manteniendo igualdad exacta de tamaño. El estado actual procede exclusivamente de [resultado-dev.json](resultado-dev.json). Un reintento de CLI resolvió un fallo transitorio de conexión.

El segundo hallazgo fue la caché CDN tras revocación. Se confirmó ausencia de políticas adicionales y el rechazo correcto de API/RLS. La migración 016 y cifrado backend eliminan entrega legible desde esa caché; se conserva el fallo previo en el historial del resultado. No se cambiaron las políticas de Fases 1–3 para conseguir PASS.

## 13. Riesgos y pendientes

- SMTP/callback sigue como excepción externa de Fase 3.1; no se intentó corregir.
- No se implementan ejecución bancaria, conciliación, journal entries, SUNAT automático, viáticos o cobranzas productivas. No se inicia Fase 5.
- Multiaprobación por umbral/moneda, resolución por jefe, cuotas, asignaciones de anticipos y aplicación de notas de crédito requieren extensión explícita. Una nota de crédito no crea una CxP positiva por sí misma.
- El análisis antivirus/CDR, retención/depuración de cargas pendientes y límites operativos superiores requieren configuración adicional. No se declara que el filtro de firmas sea un escáner completo.
- La clave de cifrado requiere respaldo y gestión segura. La rotación con recifrado/versiones de clave es una ampliación pendiente; no regenerar la clave existente.
- Pruebas DEV son sintéticas y no sustituyen aceptación de formatos y políticas por Finanzas antes de uso productivo. Los fixtures se conservan y no se mezclan con operaciones reales.
