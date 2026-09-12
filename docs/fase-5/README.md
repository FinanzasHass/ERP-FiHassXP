# Fase 5 — Tesorería y conciliación

Implementación sobre Fases 1–4. [Reporte final y matriz de verificación](resultado-dev.md). Sólo DEV y fixtures sintéticos; no integra ni envía órdenes a bancos. `executed` registra una salida externa respaldada por voucher. No se habilitan contabilidad productiva, cierre contable, depreciación, COG, SUNAT automático, cobranzas ni viáticos. No iniciar Fase 6.

## 1. Tablas y migraciones

- 017: versión de clave de adjuntos, algoritmo y compatibilidad V1.
- 018: `banks`, `company_bank_accounts`, `payment_methods`, `payment_orders`, `payment_order_items`, `payments`, `payment_allocations`, `payment_batches`, `payment_batch_items`, `bank_transactions`, `bank_import_batches`, `bank_reconciliation_periods`, `bank_reconciliation_matches`.
- 019: RPC, controles, conciliación, Storage de vouchers, reportes y compatibilidad de dashboard F4 con saldos pagados.
- 020: código de moneda, prioridad y métricas de CxP en reportes autorizados.
- 021: validación monetaria también en RPC directo, sin NaN ni redondeo silencioso; núcleo interno sin EXECUTE para clientes.

Todas las entidades nuevas llevan `company_id`, incluso el catálogo bancario operativo y medios de pago: cada empresa configura sus bancos y medios sin modificar el catálogo de otra empresa. Las FK empresariales son compuestas. No se permite cambiar identidad/moneda/número de una cuenta ya creada; crear una cuenta de reemplazo y desactivar la anterior conserva historia.

`payables` conserva `status` de revisión/aprobación independiente; recibe `allocated_paid_amount` y `payment_status` generado. `outstanding_amount = original_amount - allocated_paid_amount`. No se convierte `status` en un campo que mezcle revisión, contabilidad y pago. Saldo y estado de OP/lote se recalculan desde pagos ejecutados; los reversados no cuentan.

[Compatibilidad revisada antes de esquema](compatibilidad.md). [Historial CLI DEV](migraciones-dev.json). No se utiliza la conexión SQL directa como evidencia si falla: la CLI verifica el mismo project-ref de SUPABASE_URL.

## 2. RLS, RPC y API

REST permite sólo lecturas sujetas a permisos vigentes y RLS. No permite INSERT/UPDATE/DELETE a roles anon/authenticated/service_role en estas tablas. Mutaciones mediante funciones SECURITY DEFINER de allowlist, `search_path=''`, perfil/sesión activa, membership, empresa persistida y permisos. Las RPC toman el bloqueo de seguridad existente y un bloqueo transaccional de Tesorería para serializar reservas, aplicaciones y matching. No cambian el evaluador de permisos ni conceden permisos de migración.

| RPC pública | Uso |
|---|---|
| `attachment_prepare_versioned` | Crear metadata de adjunto con versión; no recibe claves |
| `treasury_save(kind,target_id,target_company,payload)` | Crear maestros, OP, borrador de pago, lote, movimiento manual, período; editar sólo metadata permitida |
| `treasury_action(kind,target_id,action,payload)` | Transiciones, programación, ejecución, reverso, conciliación, cierre/reapertura |
| `treasury_match(target_company,period_id,transaction_id,payment_id,match_amount)` | Confirmar vínculo explícito, con límites de ambos lados |
| `treasury_import(target_company,account_id,source_filename,column_mapping,rows,confirm)` | Preview y confirmación idempotente/transaccional |
| `treasury_candidates(target_company,transaction_id)` | Sugerencias de misma cuenta/moneda y proximidad temporal; nunca ejecución automática |
| `treasury_options(target_company)` | Referencias mínimas, cuentas enmascaradas |
| `treasury_dashboard(target_company)` | Cola y métricas con permisos por recurso |
| `treasury_cashflow(target_company)` | Actual/comprometido/posición con permiso explícito cashflow.view |

API autenticada sobre `/api`: `banks`, `bank-accounts`, `payment-methods`, `payment-orders`, `payments`, `payment-batches`, `bank-transactions`, `reconciliation-periods`, `reconciliation-matches`. GET lista/detalle; POST creación, PATCH permitido según entidad, POST `/:id/actions`. Coincidencias se crean sólo mediante `/treasury/match`. GET `/treasury/options`, `/treasury/dashboard`, `/treasury/cashflow`, `/treasury/candidates/:id`. POST `/treasury/import`.

Colecciones usan `?company_id=UUID`, paginación con límite 100; listas UI recorren páginas. La empresa recibida es contexto, no autorización. Validadores estrictos en `src/server/validators/treasury.ts` rechazan actor, saldo, status y campos calculados; SQL repite reglas para impedir bypass REST/RPC directo. JWT usa publishable; secret continúa aislada en Auth Admin. Se conservan middleware de origen, rate limiting, cabeceras y fallback SPA explícito.

## 3. Órdenes, pagos, allocations y lotes

OP visible `OP-YYYY-XXXXXX`, ítems de una misma empresa/proveedor/moneda. Total se calcula en SQL. Enviar/aprobar reserva saldo pendiente y rechaza reservas incompatibles. Crear borrador no consume saldo. Después de aprobación no se edita contenido: reapertura con motivo, nueva versión y sin pagos/batches activos; requiere nueva aprobación. Programación usa fecha independiente y cuenta empresarial válida, no modifica due_date.

Pagos `PAG-YYYY-XXXXXX`: esta fase exige OP aprobada, incluso para anticipos a proveedor sin factura. Se crea borrador con allocations, se adjunta voucher y se registra ejecución. Importe igual a suma de aplicaciones. Cuenta, proveedor y moneda derivan de la OP. Validación de saldo y remanente de OP se repite al ejecutar; un borrador anterior no garantiza capacidad futura. Cuenta beneficiaria debe estar aprobada/activa si el medio lo exige. Yape/Plin u otros medios se crean explícitamente con política empresarial; no están habilitados automáticamente.

Segregación: creador OP distinto de aprobador; ejecutor distinto de ambos y del aprobador del lote; conciliador distinto del creador/aprobador/ejecutor. Se decide por identidad y permisos, sin nombres personales. Registrar pago no autoriza aprobar ni conciliar.

Reverso exige permiso y motivo, conserva pago/allocations originales y crea un crédito **esperado** separado. Restaura saldos derivados. Si tiene vínculos de conciliación activos, primero se exige reapertura y retiro auditado de esos vínculos. No implica que el banco haya devuelto realmente dinero; la evidencia del extracto conserva su propia identidad. No hay DELETE de pagos.

Lote `LOTE-YYYY-XXXXXX`: misma empresa/moneda; conserva cada OP/pago. Por defecto requiere aprobaciones individuales. El campo explícito `individual_approval_required=false` permite política sustitutiva únicamente si el aprobador de lote también posee `payment_order.approve`, verifica cada OP enviada y no es su creador. El ejecutor no puede ser aprobador del lote. Un lote cancelado no borra las OP.

## 4. Vouchers y claves

[Respaldo, versión, rotación, recuperación y recifrado futuro](cifrado.md). El bucket sigue siendo `financial-encrypted`, privado, cifrado AES-GCM y acceso backend con JWT vigente. Nonce/tag están en el sobre binario, ninguna clave en SQL/Storage. Se admiten PDF/XML/PNG/JPEG con límites y controles F4; no se almacenan binarios en PostgreSQL. Se comprueba voucher disponible antes de ejecutar. La evidencia técnica no sustituye revisión de autenticidad bancaria.

## 5. Extractos y conciliación

CSV/XLSX de una sola hoja, máximo 2 MB/2000 filas/40 columnas. Parser en worker con tiempo límite; XLSX rechaza fórmulas. Mapeo explícito de columnas; fechas ISO YYYY-MM-DD, importes positivos con punto decimal sin separadores de miles, `debit/credit`, moneda ISO. No se supone un formato universal. API/RPC vuelven a validar y verifican moneda/cuenta/empresa.

Preview no escribe. Confirmación registra filename, mapping, hash de filas normalizadas, batch y movimientos de origen import. Mismo lote retorna `already_imported`; filas duplicadas de otro lote se informan como duplicates y no se insertan. Se usa external_id cuando viene informado, o huella de fecha/tipo/importe/moneda/referencia: si el banco repite realmente esa combinación, configurar su identificador único. Se conserva metadata de fuente y datos normalizados; no se afirma archivo original binario archivado automáticamente.

Pago ejecutado genera débito esperado; import/manual produce movimiento confirmado independiente. Matching usa importes/moneda/fecha/referencia de la misma cuenta. Las sugerencias sólo orientan: un usuario autorizado confirma vínculo y luego concilia. Soporta matching parcial y múltiples relaciones, sin exceder remanentes. Campos matched_by/at y reconciled_by/at quedan auditados.

Períodos no se solapan por cuenta. Cerrar exige movimientos confirmados conciliados o excluidos justificadamente y pagos ejecutados conciliados en el período. Cerrar es permiso separado; modificaciones exigen reapertura con motivo. La exclusión de matching sirve para conceptos fuera del circuito de pagos actual; **el movimiento confirmado sigue contando en Cash Flow**, no desaparece del saldo por excluirlo de matching. No es cierre contable.

## 6. Cash Flow, programación y dashboards

Actual: suma de movimientos confirmados/importados (conciliados o aún pendientes), nunca movimientos esperados de pagos/reversos. Comprometido: saldo de CxP aprobadas, una vez; no se suman OP nuevamente. Forecast: vacío mientras no existan otras fuentes, sin proyecciones inventadas.

Posición registrada = apertura + movimientos confirmados desde apertura. Si no hay apertura, se muestra “Sin saldo de apertura”. Siempre se etiqueta cobertura de extracto no garantizada: no se declara saldo disponible. PEN/USD separados; FX requiere módulo explícito.

Panel de Tesorería/programación: hoy, 7/15/30 días y vencidos, cola con proveedor, OP, vencimiento, programación, importe por moneda, banco y estado; pendientes de conciliar/movimientos/lotes según permisos. Cola acotada a 500 OP activas y límite indicado en UI. Cash Flow ofrece vista gerencial por fuente/moneda y posición de cuentas. No hay datos simulados en dashboards: sólo fixtures DEV cuando son los registros existentes.

## 7. UI y permisos

Nuevas páginas `/app/payment-orders`, `/app/schedule`, `/app/treasury`, `/app/payments`, `/app/payment-batches`, `/app/banks`, `/app/bank-accounts`, `/app/payment-methods`, `/app/bank-transactions`, `/app/reconciliation-periods`, `/app/reconciliation-matches`, `/app/cashflow`. Cuentas enmascaradas en las vistas; formularios de OP/allocations/lote, vouchers cifrados, confirmaciones y motivos, preview/importación y vínculo manual.

Catálogo solicitado activado mediante migración, sin grants. Se marcaron sensibles OP approve, payment execute/reverse, batch approve, reconciliation close/reopen. `cashflow.manage_projection` queda reservado sin endpoint de proyecciones ficticias. System Administrator administra asignaciones sin obtener ejecución financiera.

## 8. Auditoría

Triggers empresariales capturan actor, acción/estado anterior/nuevo, entidad y company_id en OP/ítems/pagos/allocations/batches/cuentas/movimientos/importaciones/matching/períodos/adjuntos. Cuenta completa/CCI se excluyen de auditoría bancaria. Reaperturas, cancelaciones, reversos y exclusiones registran motivo. No se auditan claves, JWT ni binarios.

## 9. Comandos y verificación

Node exactamente 24.18.0. Backend `.env` conserva SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, APP_ORIGIN, PORT y TRUST_PROXY_HOPS. Versiones de clave según cifrado.md. `.env`/`.env.verification.local` ignorados por Git.

```powershell
npm ci
npm run typecheck
npm test
npm run test:db
npm run build
npm run test:e2e
node --env-file=.env scripts/phase5-dev-migrations.mjs --apply
node --env-file=.env --import tsx scripts/verify-phase5-dev.ts
node --env-file=.env dist/server/index.js
```

No configurar el harness local contra DEV: prepara base desechable PGlite. La CLI comprueba project-ref con la aplicación antes de aplicar; no usar db reset. Detener servidor local antes del verificador porque usa PORT. Ejecutar los verificadores DEV uno por uno, nunca simultáneamente sobre el mismo PORT. El verificador crea sólo empresas/roles/perfiles/registros sintéticos y revoca sus sesiones al terminar. Se conservan fixtures para revisión; no borrarlos como supuestas operaciones reales.

## 10. Recorrido manual

1. Administrador configura roles separados para creador, aprobador, ejecutor y conciliador; memberships/roles empresariales activos. No asignar ejecución al administrador por defecto.
2. Crear banco, cuenta empresarial PEN o USD y medio de pago; apertura opcional con fecha. Crear/proponer/aprobar cuenta beneficiaria por el flujo F4.
3. Crear y aprobar CxP de la misma empresa/proveedor/moneda (puede ser anticipo aprobado sin factura).
4. Crear OP con varias CxP/importes, enviar. Intentar autoaprobación y exceso de saldo; ambos deben rechazarse. Aprobar con segundo usuario.
5. Crear/enviar/aprobar lote cuando corresponda. Elegir explícitamente política individual o sustitutiva según permisos.
6. Programar fecha/cuenta con payment.schedule, sin cambiar vencimientos.
7. Ejecutor crea pago parcial, carga voucher cifrado, registra ejecución con operation_number. Revisar outstanding/payment_status. Completar con otro pago.
8. Intentar escritura REST de estado/saldo; debe denegar. Reversar con motivo y comprobar restauración del saldo y movimiento inverso esperado.
9. Importar extracto CSV/XLSX con mapeo. Preview sin filas persistidas; confirmar; repetir y comprobar idempotencia.
10. Conciliador crea período, abre sugerencias de movimiento, confirma vínculo e importe, luego concilia desde Coincidencias.
11. Cerrar período con permiso independiente. Intentar editar vínculo cerrado; rechaza. Reabrir con motivo para corregir.
12. Revisar Cash Flow: confirmar que pago esperado y movimiento importado no se suman dos veces. Sin apertura no debe mostrar saldo disponible. Cambiar empresa verifica aislamiento.
13. Revocar membership del ejecutor con sesión abierta: descarga legible del voucher y metadata deben denegar; no se confía en la CDN.

## 11. Incidencias y riesgos pendientes

- SMTP/callback conserva excepción externa F3.1, sin intentos de corrección.
- Incidencias resueltas: selector de moneda del runner adaptado al contrato de opciones; moneda del reporte entregada sin exigir permisos de catálogo; selector de cuenta estable mientras carga; columnas opcionales no mapeadas omitidas antes de validación. Se mantuvo el rechazo de inputs inválidos.
- DEV usa ahora ATTACHMENT_ENCRYPTION_KEY_V1 y active=V1 con la misma clave previamente existente. No se generó ni rotó ninguna clave histórica.
- No se transmite dinero ni se integra un API bancario. Operaciones de prueba son sintéticas y no equivalen a pagos bancarios reales.
- Recifrado masivo/KMS, antivirus/CDR, archivado binario automático de extractos, cuotas, FX y fuentes recurrentes necesitan ampliación explícita. Las limitaciones no se presentan como capacidades implementadas.
- Los formatos deben mapearse/validarse para cada banco real antes de uso productivo; huellas sin external_id pueden requerir intervención si hay movimientos legítimos idénticos.
- El bloqueo de Tesorería prioriza integridad; serializa operaciones. Si crece el volumen, optimizar por empresa conservando orden de bloqueos y pruebas de concurrencia.
- Los fixtures DEV permanecen identificados. Ningún reporte representa datos productivos y no se despliega automáticamente a producción.

## 12. Índice de los 23 entregables

| N.º | Entregable | Ubicación |
|---|---|---|
| 1 | Tablas/migraciones | `supabase/migrations/202609110017...021*.sql`, sección 1 |
| 2 | RLS | 018 y permisos heredados de Fases 1–4 |
| 3 | RPC | 017, 019–021; sección 2 |
| 4 | API | `src/server/routes/treasury.ts`; sección 2 |
| 5 | UI | `src/client/treasury.tsx`; sección 7 |
| 6 | Storage/vouchers | `attachment-crypto.ts`, rutas de adjuntos, [claves](cifrado.md) |
| 7–10 | OP, payments, allocations, batches | Sección 3 |
| 11–13 | Bancos, movimientos, conciliación | Secciones 1 y 5 |
| 14–15 | Cash Flow y dashboards | Sección 6 |
| 16 | Permisos | Catálogo 018; sección 7 |
| 17 | Auditoría | Triggers 018; sección 8 |
| 18 | Tests locales | `tests/treasury.test.ts`, `supabase/tests/phase5-checks.mjs` y regresiones |
| 19 | Matriz DEV real | [Reporte final](resultado-dev.md), JSON de ejecución/seguimiento |
| 20–21 | Incidencias y riesgos | Sección 11 y reporte final |
| 22 | README | Este documento |
| 23 | Instrucciones manuales | Secciones 9 y 10 |
