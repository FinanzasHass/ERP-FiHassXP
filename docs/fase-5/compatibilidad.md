# Revisión previa Fase 5

017: aditiva sobre attachments. Todos los cifrados existentes se etiquetan V1 sin cambiar bytes, rutas, RLS, AAD V1 ni clave. Nonce y tag permanecen en el sobre ERP1; la clave nunca entra en SQL. La variable legacy se acepta exclusivamente como alias V1. V2 y siguientes requieren claves independientes reteniendo V1.

018–019: tablas empresariales nuevas con FK compuestas, sin grants automáticos ni cambios al evaluador RBAC. CxP conserva su estado de revisión independiente; allocated_paid_amount/outstanding y payment_status se derivan de allocations ejecutadas. Se reemplaza sólo la restricción F4 de saldo siempre igual al original. La numeración usa el contador existente. Auditoría excluye cuentas y CCI.

La ejecución registra evidencia de una salida externa, no llama a bancos. Se exige OP aprobada, creador/aprobador/ejecutor diferentes y conciliador diferente del ejecutor. Los lotes exigen por defecto aprobación individual; cualquier política sustitutiva debe ser explícita. FX, clientes/cobranzas y contabilidad quedan fuera. Los movimientos esperados no se suman como saldo bancario confirmado.

020: sólo reportes autorizados, incluye código de moneda y prioridad de las OP; no amplía permisos de catálogo. CxP aprobadas se agrega sólo si el actor posee payable.view. Conserva company_id, RLS y el permiso explícito cashflow.view.

021: valida también en RPC importes JSON numéricos, finitos, positivos (salvo apertura negativa) y con dos decimales. Rechaza NaN y redondeo silencioso antes de las funciones operativas. Los puntos de entrada internos renombrados pierden EXECUTE para authenticated/anon/service_role; no existe bypass de validación por REST directo. No cambia modelo ni grants financieros.
