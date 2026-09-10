# Permisos, riesgos y decisiones pendientes

## Catálogo propuesto, sin activación

Estos códigos son un inventario para fases futuras. No se crean seeds ni grants en Fase 2.5. Los códigos ya existentes conservan su significado e inmutabilidad; antes de implementar cada módulo se revisará su contrato y se añadirá sólo lo necesario mediante migración/seed de desarrollo. La UI asigna permisos existentes, no inventa códigos.

| Dominio | Códigos requeridos |
|---|---|
| Centros de costo | `cost_center.view`, `cost_center.create`, `cost_center.edit`, `cost_center.disable` |
| Proyectos | `project.view`, `project.create`, `project.edit`, `project.disable` |
| Subproyectos | `subproject.view`, `subproject.create`, `subproject.edit`, `subproject.disable` |
| Cashflow | `cashflow.view`, `cashflow.manage` |
| Bancos | `bank.view`, `bank_transaction.view`, `bank_transaction.register` |
| Conciliación | `bank_reconciliation.view`, `bank_reconciliation.create`, `bank_reconciliation.manage`, `bank_reconciliation.close` |
| Órdenes de pago | `payment_order.view`, `payment_order.create`, `payment_order.approve` |
| Pagos | `payment.view`, `payment.schedule`, `payment.execute` |
| CxC | `receivable.view`, `receivable.create`, `receivable.edit` |
| Cobranza | `collection.view`, `collection.identify`, `collection.allocate`, `collection.reverse` |
| Asientos | `journal.view`, `journal.create`, `journal.validate`, `journal.post`, `journal.reverse` |
| Períodos | `accounting_period.view`, `accounting_period.close`, `accounting_period.reopen` |
| Cierre | `accounting_close.view`, `accounting_close.manage` |
| Depreciación | `depreciation.view`, `depreciation.prepare`, `depreciation.post` |
| COG | `cog.view`, `cog.manage` |
| Plan contable | `account.view`, `account.create`, `account.edit`, `account.disable` |
| EEFF | `financial_statement.view`, `financial_statement.prepare`, `financial_statement.configure`, `financial_statement.approve` |
| Proyecciones | `projection.view`, `projection.create`, `projection.edit`, `projection.approve` |
| AFE | `afe.view`, `afe.create`, `afe.submit`, `afe.approve`, `afe.observe`, `afe.close` |
| Presupuestos | `budget.view`, `budget.create`, `budget.edit`, `budget.approve` |
| Análisis y cubos | `account_analysis.view`, `cube.view`, `cube.export` |
| Activos | `fixed_asset.view`, `fixed_asset.create`, `fixed_asset.edit`, `fixed_asset.depreciate` |
| SUNAT | `sunat.view`, `sunat.prepare`, `sunat.submit`, `sunat.reconcile` |

Los permisos reservados existentes para solicitudes, proveedores, compras, rendiciones, `company`, `employee_return`, `employee_reimbursement`, `service_acceptance` y `payment_batch` se mantienen. No sustituir automáticamente `reconciliation.*` por `bank_reconciliation.*`, ni asumir que un `budget.manage` existente equivale a todas las operaciones nuevas. Resolver solapamientos mediante contrato documentado y transición compatible, sin renombrar códigos utilizados.

Candidatos adicionales que deberán especificarse antes del módulo correspondiente: aprobación de cuenta bancaria de proveedor, reapertura de conciliación, aprobación de cierre parcial de devolución de proveedor, administración de tasas, importación/aprobación de migración, consulta/preparación/aprobación de consolidación y gestión de plantillas de aprobación. No inventar grants amplios con `manage` para saltar una separación sensible.

Los permisos financieros requieren contexto de empresa. `has_permission(code, company_id)` evalúa identidad/sesión, profile activo, permiso activo, membership activo y asignaciones/overrides aplicables. Se conserva DENY de usuario > ALLOW de usuario > grants de roles > DENY por defecto. Un DENY global aplicable no debe ser vencido por un ALLOW empresarial.

El alcance global es una decisión explícita, no el valor por defecto para roles financieros. El System Administrator global no recibe ejecución financiera por administrar permisos. El backend obtiene la empresa del registro persistido cuando existe y comprueba coherencia de todas sus relaciones; el `company_id` recibido no constituye autorización. Reportes multiempresa requieren autorización para cada empresa incluida.

## Segregación y delegación

| Operación | Separación requerida o política a confirmar |
|---|---|
| Solicitud | Crear ≠ aprobar la propia solicitud. Sustituciones y excepciones deben ser explícitas y auditadas. |
| Pago | Crear ≠ aprobar ≠ ejecutar. Revalidar aprobación de versión, beneficiario, cuenta e importe al ejecutar. |
| Datos bancarios de proveedor | Modificar ≠ aprobar. Una modificación posterior invalida la aprobación de pago afectada o exige revisión de la versión vigente. |
| Cobranza | Identificar ≠ conciliar banco. Aplicación y reverso conservan evidencia y no alteran el extracto. |
| Asiento | Crear ≠ postear cuando la política lo requiera; validación y posteo verifican la versión revisada. |
| Período | Cerrar ≠ reabrir; reapertura con motivo y control reforzado. |
| Devolución de proveedor | Registrar acuerdo/cobro ≠ aprobar cierre parcial. Un saldo desconocido no equivale a cero. |
| Configuración financiera | Cambiar mapeos, tasas o reglas ≠ aprobar su entrada en vigencia cuando impactan resultados. |

La matriz es una política por operación, no sólo una lista de roles. Dos roles en un mismo usuario no satisfacen una exigencia de dos personas. La base de datos/RPC deberá comparar actores, versión y estado dentro de la transacción; esconder botones no protege el flujo.

`role.assign` permite asignar un rol configurado a terceros sin exigir `permission.assign`. Este último permite configurar permisos/overrides. Ninguno concede ejecución implícita. Se conserva la prohibición de autoasignación y las protecciones de roles de sistema de Fase 2.

**Conflicto de seguridad a resolver antes de activar finanzas:** la delegación autorizada puede permitir que dos administradores se asignen recíprocamente capacidades financieras o que un administrador configure un rol que ya posee. La auditoría permite detectar, pero no impide por sí sola esta vía. Para finanzas productivas, definir aprobación independiente de altas/cambios sensibles, verificación de auto-beneficio indirecto y revisión de accesos. No se cambia ahora el modelo aprobado ni se elimina la capacidad solicitada de administrar permisos de terceros; esta política necesita una decisión explícita antes de conceder permisos operativos reales.

## Auditoría

Extender el uso de la auditoría existente por eventos: actor autenticado, fecha de servidor, empresa, acción, registro, old_values/new_values pertinentes, motivo, origen y referencia/correlación. Categorías existentes: authentication, security, administration, finance, system. No incluir secretos, tokens, payloads bancarios completos ni documentos personales indiscriminadamente. Evidencias sensibles van a almacenamiento protegido con referencia.

Cubrir altas/desactivaciones CECO, cuentas contables, cambios de reglas, asientos/reversos, reaperturas, pagos, conciliaciones, cuentas bancarias, AFE, presupuestos, cierres y reembolsos. Auditoría inmutable y atómica con la operación interna; eventos externos requieren estados de intento/resultado y reconciliación. Mantener login fallido en mecanismo de servidor/Supabase Auth, sin abrir inserción anónima en audit_logs.

## Riesgos y controles

| Riesgo | Control propuesto / evidencia antes de producción |
|---|---|
| Fuga entre empresas | FK compuestas, RLS/RPC y pruebas de empresas distintas; reportes/exportaciones también. |
| Membresía revocada con sesión válida | Verificación de estado efectivo al ejecutar, sin usar sólo claims o caché antigua. |
| Secreto usado como cliente CRUD | Mantener aislamiento backend de secret key y API privilegiada estrecha; análisis de bundle y revisión de dependencias. |
| Doble clic, reintento o webhook repetido | Claves de idempotencia y transacción; resultado externo desconocido bloquea reejecución ciega. |
| Dos ejecuciones consumen el mismo saldo | Bloqueo/serialización y restricciones en BD, pruebas concurrentes de aplicaciones y cierre. |
| Cambio después de aprobación | Snapshot/versionado, invalidación de aprobación y comprobación al ejecutar. |
| Importe contable confundido con caja | Eventos distintos de devengo, pago y conciliación; mapeos aprobados. |
| Recalcular historia por tasa o jerarquía nueva | Versiones y snapshots de tasas, dimensiones y modelos. |
| Totales inflados por dimensiones | Grano definido, distribución que conserva importes y pruebas de agregación. |
| Interpretar COG/AFE por su sigla | Relevamiento y validación del proceso real antes de fórmulas/tablas definitivas. |
| Duplicar apertura e histórico/auxiliar | Corte excluyente y conciliación de cuentas de control. |
| Reglas tributarias supuestas | Confirmar régimen y canal por empresa; revisar documentación oficial al implementar. |
| Documentos o exportaciones exponen información | Almacenamiento privado, autorización al descargar, enlaces breves y auditoría de acceso sensible. |
| Crecimiento prematuro de infraestructura | Monolito modular; medir antes de introducir colas externas, microservicios o DW. |
| Falta de historia recuperable de Ábasoft | Ensayo de exportación/restauración antes de decidir retiro o plazos. |

## Preguntas obligatorias antes de implementación productiva afectada

Solicitar estas respuestas a los responsables y documentar ejemplos/aprobación. No son una autorización para empezar módulos en esta fase.

| Tema | Información faltante | Qué queda condicionado |
|---|---|---|
| Plan y políticas | Plan real por empresa, mapeos, política de reconocimiento, ajustes, numeración, adopción de versiones y moneda funcional. | Reglas de posteo, aperturas y EEFF. |
| Depreciación | Inventario real, métodos, vidas, residuales, mejoras/bajas, inicio y libros contable/tributario. | Cálculo y contabilización de depreciación. |
| COG | Qué significa internamente, entradas, cálculos, salidas, archivos, responsables y ejemplos cerrados. | Modelo detallado y automatización de COG. |
| Inventario | Si existe necesidad, bienes/terrenos incluidos, unidades, almacenes, costeo y stock negativo. | Activación del módulo y tratamiento de lotes. |
| Consolidación | Perímetro, control/participación, métodos, moneda, intercompany y eliminaciones. | EEFF consolidados; agregado no se etiqueta como consolidación. |
| AFE/presupuesto | Proceso real, jerarquías, vigencia, impuestos, fórmula disponible, reservas/liberaciones, sobregiro y aprobadores. | Consumo, límites y bloqueo presupuestario. |
| Tributación/SUNAT | Régimen/obligaciones por empresa, canales actuales, proveedor, comprobantes, SIRE y conciliación. | Integración tributaria y fórmulas/impuestos. |
| CxC comercial | Reglas de membresías, contratos de lotes, cronogramas, mora, notas/anulaciones y reconocimiento. | Generación de deuda e ingreso; no asumir por cobro. |
| Tesorería | Canales bancarios, evidencia de ejecución, cutoffs, comisiones, pagos parciales, tasas y aprobaciones. | Ejecución real e integración bancaria. |
| Organización y acceso | Razones sociales completas, usuarios por empresa, suplencias, segregación y doble aprobación de grants sensibles. | Configuración productiva de roles y workflows. |
| Migración | Exportabilidad, volumen, calidad, corte, conservación, períodos comparables y responsables. | Fecha de corte y retiro definitivo. |

Las personas mencionadas orientan entrevistas y validación: Gianella (Finanzas, aprobaciones/AFE/cierre parcial), Sandra (Tesorería), Richard (EEFF y proyecciones), Luisa (Contabilidad, depreciación y COG), Jahiro (Cobranzas). No se codifican nombres ni se derivan permisos del cargo. TI administra plataforma sin capacidad financiera implícita.
