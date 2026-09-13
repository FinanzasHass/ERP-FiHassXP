# Fase 7 — CxC y cobranzas

EN IMPLEMENTACIÓN. No aplicada a DEV ni aprobada. Fase 6 conserva su aceptación.

Modelo propuesto: customers empresariales independientes de Auth; receivable_sources como contrato/origen tipado (membership, lot_sale, manual_authorized, other); membership_accounts y lot_finance_contracts como especializaciones; schedules/installments versionados; receivables; collections y allocations. Los saldos y aging son derivados. El saldo a favor es el importe válido de una collection identificada menos allocations válidas; no se crea deuda ficticia.

Configuración comercial explícita: importe, fechas y cuotas introducidos por usuario autorizado. No se inventa interés, tarifa, mora, reajuste ni renovación automática. Una membresía permite sucesivos periodos explícitos idempotentes. Un lote representa sólo el contrato financiero y el identificador externo del lote.

El crédito bancario se registra una vez como collection activa, inicialmente sin cliente. Identificar asigna cliente; aplicar consume saldo; conciliar usa bank_reconciliation y un permiso distinto. Los mismos fondos no pueden respaldar simultáneamente una devolución de empleado y una cobranza. ACTUAL permanece basado únicamente en bank_transactions confirmados. Las CxC se agregan como entrada esperada separada.

Reverso de collection: conserva original y allocations revertidas, restaura CxC y deja el cobro sin fondos aplicables. Desaplicar una allocation restaura crédito no aplicado sin simular salida bancaria. Para corregir identificación de un cobro con efectos, primero se resuelven allocations/conciliación mediante acciones auditadas. Una conciliación cerrada exige reapertura anterior.

Los documentos comerciales se mantendrán como referencias emitidas, sin reutilizar incorrectamente los tax_documents de compra y sin generar comprobantes electrónicos legales. Storage conserva el mecanismo cifrado existente.

Todas las operaciones usan bloqueo transaccional de seguridad/Tesorería, empresa persistida, membresía, permiso y auditoría. No se editan 001–032 publicadas. No hay grants automáticos, DELETE financiero, ejecución bancaria externa ni Fase 8.

Pendiente: implementación y matriz de 34 verificaciones DEV más concurrencia. No usar este documento como evidencia PASS.
