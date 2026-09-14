# API, RPC y permisos

Todas las rutas están bajo `/api`, requieren sesión verificada y profile activo. El backend usa cliente publishable asociado al JWT. La empresa recibida es contexto, nunca autorización; las RPC vuelven a comprobar membership, permiso y empresa persistida. Validadores estrictos rechazan campos adicionales, estado financiero, actor, saldo inventado y precisión monetaria excesiva.

## Consultas

GET con `company_id`, `page` y `limit` (máximo 100): `/customers`, `/receivables`, `/collections`, `/receivable-sources`, `/receivable-schedules`, `/receivable-installments`, `/membership-accounts`, `/lot-contracts`, `/issued-documents`. Admiten GET `/:id`; RLS oculta filas inaccesibles y el backend devuelve 404. Fuentes permiten filtro `source_type`; CxC, `customer_id`.

| Ruta GET | Propósito |
|---|---|
| `/collection-deposits` | Créditos confirmados sin cliente, paginados |
| `/receivable-context/options` | Etiquetas mínimas para selectores del contexto autorizado |
| `/receivable-context/dashboard` | Cartera, aging, cobros diarios, créditos y obligaciones por cliente/origen |
| `/collections/:id/candidates` | Sugerencias sin modificación; requieren confirmación |
| `/collections/:id/allocations` | Aplicaciones vigentes y revertidas, paginadas |
| `/receivable-schedules/:id/installments` | Cuotas con saldo y estado financiero derivados, paginadas |
| `/receivables/:id/history` | Historial de CxC |
| `/collections/:id/history` | Historial de cobro |
| `/receivable-sources/:id/history` | Historial del origen |
| `/receivable-schedules/:id/history` | Historial del cronograma |
| `/receivable-attachments` | Metadata de adjuntos autorizados por entidad |
| `/treasury/cashflow` | Posición/ACTUAL existente más `expected_receivables` separado |

## Mutaciones

| Ruta | RPC | Permiso |
|---|---|---|
| POST `/customers`, PATCH `/customers/:id` | `customer_save` | `customer.create/edit` |
| POST `/customers/:id/disable` | `customer_disable` | `customer.disable` |
| POST `/receivable-sources` | `receivable_source_create` | `membership.manage`, `lot_receivable.manage` o `receivable.create`, según origen |
| POST `/receivable-sources/:id/close` | `receivable_source_close` | Gestión del origen; motivo obligatorio |
| POST `/receivables` | `receivable_create` | `receivable.create` |
| POST `/receivables/:id/actions` | `receivable_change` | `receivable.adjust/cancel`; motivo |
| POST `/receivable-sources/:id/schedules` | `receivable_schedule_generate` | `receivable_schedule.create/modify` y gestión del origen |
| POST `/collections` | `collection_register` | `collection.identify` para crédito persistido; `collection.create` para cobro no bancario |
| POST `/collections/:id/identify` | `collection_identify` | `collection.identify`; motivo |
| POST `/collections/:id/apply` | `collection_apply` | `collection.apply` |
| POST `/collections/:id/reverse` | `collection_reverse` | `collection.reverse`; motivo |
| POST `/collection-allocations/:id/unapply` | `collection_unapply` | `collection.reverse`; motivo |
| POST `/collections/:id/matches` | `collection_match` | `bank_reconciliation.match` + `collection.view`, con segregación |
| POST `/issued-documents` | `issued_document_create` | `receivable.create` |
| POST `/reconciliation-matches/:id/actions` | `treasury_action` | Permisos bancarios existentes; conserva segregación del cobro |

Creación de origen/CxC/cobro/cronograma, identificación, aplicación y reversos exigen `Idempotency-Key` UUID en HTTP. Las RPC reciben `operation_key`. Reintentar con la misma clave y payload devuelve el resultado previo sin duplicar efectos. Cambiar el payload exige una nueva intención/clave; no reusar una clave para otra operación.

RPC de consulta: `receivable_options`, `collection_candidates`, `collection_deposit_queue`, `receivable_dashboard`, `receivable_schedule_installments`, `treasury_cashflow`. Wrappers de compatibilidad: `employee_return_match`, `treasury_action`; sus implementaciones anteriores quedan sin EXECUTE público. Funciones auxiliares permanecen en `private`, sin cliente privilegiado genérico.

## Catálogo de permisos

- `customer`: view, create, edit, disable.
- `receivable`: view, create, adjust, cancel.
- `collection`: view, create, identify, apply, reverse.
- `receivable_schedule`: view, create, modify.
- `membership`: view, manage.
- `lot_receivable`: view, manage.
- `receivable_report.view`, `collection_report.view`.

`collection.create` se añade explícitamente para distinguir la entrada manual de fondos de la identificación de un crédito bancario ya confirmado. No otorga conciliación. Los permisos se activan mediante migración sin asignación automática a usuarios ni roles. La administración puede configurar/asignar roles de terceros sin ejecutar esos permisos.

## Storage y auditoría

Se reutilizan POST `/attachments/upload` y GET `/attachments/:id/download`, con `entity_type=collection_support/issued_document`. No se añaden buckets públicos ni binarios PostgreSQL. Cifrado autenticado y claves versionadas del backend existentes; verificación de contenido, MIME, extensión, 5 MB y permisos en cada lectura/escritura. La secret key continúa confinada a Auth Admin.

Cada escritura de negocio activa `private.audit_finance`; las acciones además conservan `receivable_history`. Eventos de identificación/aplicación/reverso/conciliación incluyen empresa, actor y motivo cuando corresponde. No se registra contenido binario, claves ni cuentas completas innecesarias.
