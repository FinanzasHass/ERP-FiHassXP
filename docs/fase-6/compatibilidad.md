# Fase 6 — compatibilidad y decisiones de implementación

Estado: migraciones 022–032 aplicadas únicamente a DEV después de la puerta local. El resultado de aceptación procede de resultado-dev.json, no de este documento.

## Identidad y empresa

`employees` es una entidad empresarial propia con nombre legal, documento, área y cargo. `profile_id` es nullable: no se crea Auth, profile ni membership para un colaborador sin acceso ERP. Un profile puede existir sin employee. El documento es único por empresa (ignorando mayúsculas y espacios exteriores), no globalmente.

Un vínculo opcional con profile requiere membership activo de esa empresa al establecerlo. La revocación posterior bloquea al usuario ERP, pero no elimina ni desactiva al colaborador ni impide que otro operador autorizado atienda sus obligaciones. El vínculo no concede permisos. Un vínculo existente no puede sustituirse ni retirarse mediante la edición normal; cualquier futura reasignación requiere un proceso auditado que preserve el historial de acceso.

Las operaciones en nombre de un colaborador requieren `travel_expense.create_for_employee` además de create/submit/cancel según la acción. No hay grants automáticos. El usuario actor mantiene profile activo, sesión válida, membership y permiso por empresa; el beneficiario no necesita cuenta ERP. Área y cargo no autorizan operaciones.

## Integración de Tesorería

024–026 extienden OP y pagos con tipo `employee` explícito. Columnas generadas tipadas mantienen FKs empresariales para proveedor o colaborador, incluyendo cuentas beneficiarias. No se crean proveedores ficticios. Las cuentas de colaboradores requieren propuesta y aprobación independiente; REST no entrega números completos y las RPC/auditoría excluyen account_number y CCI.

La primera aprobación de una VIA con anticipo positivo crea un único employee_advance y su payable aprobado. Una restricción única por VIA y una única identidad de origen en payables impiden duplicación. Repetir approve sobre una VIA ya aprobada devuelve la solicitud sin duplicar efectos y sigue verificando autorización y segregación. Si el importe es cero, no se crea anticipo.

El payable pasa por OP, aprobación financiera independiente de la aprobación VIA, programación, pago ejecutado y conciliación existentes. paid_amount procede de allocations ejecutadas; el reverso restaura el saldo sin alterar approved_amount. Se conserva el voucher cifrado obligatorio de pagos. La ejecución está separada de solicitante, beneficiario ERP, aprobador VIA y aprobador de OP. No se incorpora un segundo motor de pagos.

029 integra la liquidación, el reembolso idempotente por versión y la obligación employee_reimbursement con Tesorería. No existe endpoint para asignar paid.

031 incorpora employee_return_id como destino alternativo a payment con constraint XOR y FKs empresariales en la conciliación existente. Un registro de devolución no acredita por sí mismo un movimiento bancario conciliado. Los cierres y reversos comparten el bloqueo transaccional de Tesorería para impedir liquidaciones concurrentes del mismo saldo.

## Liquidación y moneda

Los importes originales son inmutables tras aprobación. La diferencia se deriva de dinero efectivamente entregado menos gastos aceptados. No pueden coexistir saldo a devolver y a reembolsar. Las devoluciones y reembolsos confirmados reducen únicamente su saldo correspondiente; se rechazan excesos y mezclas de moneda. No se implementa conversión implícita.

Una liquidación no cierra mientras existan partidas sin revisión, documentación pendiente, saldos o anticipos adicionales no incluidos. La reapertura exige permiso específico, motivo e historia; no autoriza editar silenciosamente montos ya pagados.

## Política configurable

No se inventan topes legales, categorías autorizadas para DJ ni plazos de rendición. Hasta configuración expresa, las DJ y la aceptación parcial están deshabilitadas. Los topes se expresan en la moneda configurada. Una política debe quedar versionada/snapshot al someter una operación para que cambiarla no reinterprete retrospectivamente una aprobación.

## Historia, archivos y controles

Se reutilizan capture_dimensions y dimension_versions para CECO, proyecto y subproyecto. Se reutiliza tax_documents para identidad y duplicidad del comprobante. Los adjuntos conservan Storage privado, AES-256-GCM y key_version; ninguna nueva ruta puede entregar texto plano sin autorización actual.

Las migraciones 001–021 no se editan. Cada migración adicional debe superar las regresiones locales antes de aplicarse únicamente al DEV vinculado. El catálogo de permisos no concede permisos a roles o usuarios automáticamente. SMTP continúa como excepción externa y queda fuera de este trabajo.


## Resoluciones de rendición

Se admite una rendición consolidada activa por VIA/anticipo. Si está vinculada a un anticipo, debe estar completamente desembolsado para aprobar la liquidación; así no se genera un reembolso que duplique un desembolso pendiente. Una rendición sin anticipo genera obligación por el gasto aceptado.

La aprobación de la rendición exige expense_report.approve; si genera reembolso, también employee_reimbursement.create y employee_reimbursement.approve. La OP conserva una aprobación separada y la ejecución se separa de los actores del expediente.

Cada versión tiene una liquidación inmutable. El cierre aplica el anticipo a outstanding_to_render transaccionalmente. La reapertura requiere permiso, política y motivo. Los retornos deben quedar desvinculados/cancelados y los reembolsos sin pagos ni OP activas antes de sustituir una liquidación. Se conserva la anterior como superseded. Revertir el pago del anticipo mientras hay una liquidación válida se rechaza; requiere resolver primero el expediente.

Un reverso de reembolso o una desvinculación de devolución restaura el saldo y mueve un expediente cerrado a settlement_pending, con historial. Una DJ aprobada no equivale a gasto aceptado. Las revisiones individuales preservan motivo, revisor, fecha y montos exactos. Los documentos que sustentan partidas aceptadas quedan protegidos también frente a las RPC antiguas de Fase 4.

La DJ conserva sus datos originales y no se sobrescribe; una partida con DJ/documento asociado no permite modificar su fuente silenciosamente. La corrección de una decisión se realiza mediante nueva revisión autorizada y registrada. Una fuente nueva se agrega como otra partida, conservando la anterior rechazada. No hay borrado de partidas ni de declaraciones históricas.

## Límites expresos

No se implementa conversión de divisas, transferencia bancaria externa, firma digital legal, SUNAT automático ni Fase 7. Una OP employee se ejecuta en el registro de Tesorería existente con evidencia; no llama a un banco. El reporte mantiene el detalle dimensional por partida; el payable agregado de reembolso toma las dimensiones de la primera partida aceptada y no sustituye al reporte de gastos para distribución por CECO/proyecto.

Las representaciones se imprimen desde el expediente autorizado y pueden guardarse como PDF en el navegador. No sustituyen a la BD ni constituyen una firma legal. Historial paginado en ambos expedientes; partidas de rendición cargadas por páginas cuando superan 100.
