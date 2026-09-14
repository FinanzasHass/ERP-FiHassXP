# Fase 7 — CxC y cobranzas

Implementada y verificada exclusivamente en Supabase DEV: **34/34 casos PASS, 4/4 concurrencia PASS y 3/3 comprobaciones adicionales de Storage/cuotas PASS**. Migraciones 033–037 aplicadas; CLI confirmó 001–037 Local/Remote en el mismo proyecto de la aplicación. No se inicia Fase 8.

Modelo implementado: customers empresariales independientes de Auth; receivable_sources como contrato/origen tipado (membership, lot_sale, manual_authorized, other); membership_accounts y lot_finance_contracts como especializaciones; schedules/installments versionados; receivables; collections y allocations. Los saldos y aging son derivados. El saldo a favor es el importe válido de una collection identificada menos allocations válidas; no se crea deuda ficticia.

Configuración comercial explícita: importe, fechas y cuotas introducidos por usuario autorizado. No se inventa interés, tarifa, mora, reajuste ni renovación automática. Una membresía permite sucesivos periodos explícitos idempotentes. Un lote representa sólo el contrato financiero y el identificador externo del lote.

El crédito bancario se registra una vez como collection activa, inicialmente sin cliente. Identificar asigna cliente; aplicar consume saldo; conciliar usa bank_reconciliation y un permiso distinto. Los mismos fondos no pueden respaldar simultáneamente una devolución de empleado y una cobranza. ACTUAL permanece basado únicamente en bank_transactions confirmados. Las CxC se agregan como entrada esperada separada.

Reverso de collection: conserva original y allocations revertidas, restaura CxC y deja el cobro sin fondos aplicables. Desaplicar una allocation restaura crédito no aplicado sin simular salida bancaria. Para corregir identificación de un cobro con efectos, primero se resuelven allocations/conciliación mediante acciones auditadas. Una conciliación cerrada exige reapertura anterior.

Los documentos comerciales se mantienen como referencias emitidas, sin reutilizar incorrectamente los tax_documents de compra y sin generar comprobantes electrónicos legales. Storage conserva el mecanismo cifrado existente.

Todas las operaciones usan bloqueo transaccional de seguridad/Tesorería, empresa persistida, membresía, permiso y auditoría. No se editan 001–032 publicadas. No hay grants automáticos, DELETE financiero, ejecución bancaria externa ni Fase 8.

## Evidencia y documentación

La puerta local pasó **91 verificaciones PostgreSQL** (regresión Fases 1–6 y concurrencia incluidas), **39 pruebas de aplicación** y **12 pruebas de interfaz**, además de tipos, build y aislamiento de secretos.

- [Matriz de 34 casos DEV](resultado-dev.md) y [resultado estructurado, fixtures y concurrencia](resultado-dev.json).
- [Storage cifrado y consulta de cuotas DEV](resultado-storage-dev.json), y [UI final: 2 comprobaciones PASS](resultado-ui-dev.json).
- [Migraciones antes/después](migraciones-dev.json), [puerta local](puerta-local.json), [PostgreSQL local](resultado-postgres-local.json).
- [Modelo y diagrama](modelo.md), [API/RPC/permisos](api-permisos.md), [configuración Supabase y comandos](supabase.md), [recorrido manual](recorrido-manual.md).
- [Panel de Cobranzas DEV](capturas/cobranzas-dev.png) y [aplicaciones de cobros DEV](capturas/cobros-dev.png).

## Archivos entregados

| Componente | Archivo / resultado |
|---|---|
| Modelo, 13 tablas y RLS | `202609130033_receivable_model.sql` |
| Clientes, CxC, orígenes, cronogramas y vistas de saldos | `202609130034_receivable_rpc.sql` |
| Cobros, identificación, aplicaciones, reversos y ajustes | `202609130035_collection_rpc.sql` |
| Conciliación, segregación histórica y Storage | `202609130036_collection_reconciliation.sql` |
| Opciones, candidatos, depósitos, reportes, Cash Flow y cuotas derivadas | `202609130037_receivable_reports.sql` |
| API y validadores | `src/server/routes/receivables.ts`, `src/server/validators/receivables.ts` |
| UI y navegación | `src/client/receivables.tsx`, `main.tsx`, integración en `treasury.tsx` |
| SQL y concurrencia | `supabase/tests/phase7-checks.mjs`, integrado al harness de regresión |
| API y navegador | `tests/app.test.ts`, `tests/e2e/receivables.spec.ts` |
| Verificación DEV | `scripts/verify-phase7-dev.ts`, `scripts/verify-phase7-storage-dev.ts` |
| Puerta local y publicación DEV | `scripts/phase7-local-postgres.mjs`, `scripts/phase7-local-gate.mjs`, `scripts/phase7-dev-migrations.mjs` |

Tablas nuevas: `customers`, `receivable_source_types`, `receivable_sources`, `membership_accounts`, `lot_finance_contracts`, `receivable_schedules`, `receivable_installments`, `issued_document_references`, `receivables`, `collections`, `collection_allocations`, `receivable_operation_keys`, `receivable_history`. Vistas: `receivable_balances` y `collection_balances`.

Páginas: Clientes, Cuentas por cobrar, Cobros, Depósitos sin identificar, Cuotas y cronogramas, Membresías comerciales, Contratos financieros de lotes, Referencias de documentos emitidos, Panel de Cobranzas y Saldos a favor. El panel ofrece cartera, vencidos, próximos vencimientos, aging, cobros diarios por estado, créditos y obligaciones por cliente/origen/moneda. Las cuotas muestran cobrado, pendiente y estado derivado.

## Seguridad e incidencias resueltas

RLS, RBAC empresarial, sesiones, memberships, auditoría e aislamiento de secret permanecen activos. Los permisos se activan sin grants automáticos; `collection.create` distingue cobro no bancario de identificación bancaria. Se impiden estados financieros manuales y DELETE financiero.

La revisión corrigió antes de DEV: sustitución del actor al reidentificar el mismo cliente, pérdida de segregación respecto de identificadores históricos, exclusión de un crédito que respaldaba un cobro activo y dos validaciones de payload vacío/referencia en acciones legítimas. Se añadieron regresiones específicas.

Dos ejecuciones locales tuvieron timeout de orquestación del navegador. Se conservaron como FAIL histórico, se aisló la ejecución por suite y se aseguró la finalización del servidor entre suites. La puerta vigente pasó completa, sin retirar pruebas ni relajar controles. PostgreSQL se ejecuta con el permiso local necesario y aporta evidencia reciente con hashes coincidentes.

## Límites y pendientes

- SMTP/callback continúa como excepción externa aceptada. No se declara corregida la conexión SQL directa con diagnóstico histórico 28P01; DEV se verificó con CLI, API, RPC, REST y UI.
- No hay contabilidad productiva, cierre contable, EEFF, SUNAT, inventario inmobiliario ni Fase 8.
- Periodicidad inicial en meses y cuotas explícitas. No se inventan tarifas, mora, intereses, reajustes ni renovaciones. Otras periodicidades requieren ampliación comercial.
- Aging clasifica saldos vigentes; no reconstruye cartera histórica a una fecha pasada. Próximos vencimientos muestra hasta 100 obligaciones; los listados paginan.
- El bloqueo compartido prioriza consistencia. Medir rendimiento antes de una implantación productiva amplia; no se hizo prueba de carga productiva.
- Los fixtures DEV se conservan para revisión con IDs en el reporte. Sus sesiones de verificación se revocaron. No borrar historial financiero como limpieza.

## PDF de Fase 6

[PDF actualizado y verificado visualmente](../fase-6/capturas/representacion-dev-sintetica.pdf): anticipo 180, gasto aceptado 160, devolución determinada 20, recibida y conciliada 20, pendiente 0. Cambia la presentación, no el cálculo financiero ni la aceptación de Fase 6.
