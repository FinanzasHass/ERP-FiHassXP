# Dataset DEMO sintético

Estado DEV: el lote técnico vigente se identifica en `docs/fase-8b/resultado-dev.json`; contiene empresa, usuarios y operaciones exclusivamente sintéticos y fue validado con 16 PASS. [manifiesto-dev.json](manifiesto-dev.json) agrupa los lotes PASS de Fases 4–8B sin credenciales y fija la empresa de presentación contable. Los lotes históricos permanecen separados como evidencia de regresión y no se presentan como datos reales.

El dataset DEMO se crea exclusivamente en un proyecto DEV/staging dedicado y después de aplicar las migraciones Fase 8B y designar explícitamente la empresa como DEMO y pasar la puerta local. No se mezcla con el entorno productivo ni sustituye datos de validación existentes.

Su contenido mínimo es:

- Empresa DEMO, moneda y CECO/proyecto/subproyecto DEMO explícitos.
- Roles asignados por empresa: Administrador, Finanzas, Tesorería, Cobranzas, Contabilidad y Colaborador. Cada usuario es sintético y su contraseña se entrega fuera del repositorio.
- Proveedor → solicitud aprobada → CxP → OP → pago → movimiento de banco → conciliación.
- Empleado → VIA → anticipo pagado → rendición → liquidación, devolución o reembolso según el caso.
- Cliente → CxC → cuota → depósito → identificación → cobranza → conciliación.
- Cuentas y reglas de demostración con prefijo `DEMO`; eventos → preview → borrador → validación → posteo → mayor/balance.

La provisión de identidades puede utilizar la secret key exclusivamente mediante Auth Admin. Todas las operaciones de negocio deben usar clientes de sesión autenticados y sus RPC/RLS habituales. El script de fixtures nunca debe usar un cliente secret/service como CRUD de tablas.

Antes de repetir el seed, validar el manifiesto de identificadores de `resultado-dev.json` y usar claves de idempotencia. Si el manifiesto no coincide, detenerse: no borrar ni sobrescribir datos para “reparar” una demo. `npm run verify:phase8b:dev` crea un lote nuevo y auditado; no reutiliza contraseñas ni usa la secret para CRUD financiero.

El recorrido contable verificado en el lote Fase 8B es: cliente sintético → CxC → evento sin regla → designación DEMO → regla → preview → borrador concurrente idempotente → validación → posteo → trazabilidad y dashboard. Los recorridos operativos de proveedor, Tesorería y viáticos conservan sus fixtures DEV de fases anteriores, identificados en el manifiesto. Para una presentación estable se debe seleccionar y conservar un lote conocido; no ejecutar verificadores durante la presentación. Regenerar el manifiesto con `npm run demo:manifest` después de una nueva matriz PASS.

