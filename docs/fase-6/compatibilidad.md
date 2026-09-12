# Fase 6 — compatibilidad y decisiones de implementación

Estado: EN IMPLEMENTACIÓN. Este documento no acredita aprobación ni pruebas DEV.

## Identidad y empresa

`employees` es una entidad empresarial propia con nombre legal, documento, área y cargo. `profile_id` es nullable: no se crea Auth, profile ni membership para un colaborador sin acceso ERP. Un profile puede existir sin employee. El documento es único por empresa (ignorando mayúsculas y espacios exteriores), no globalmente.

Un vínculo opcional con profile requiere membership activo de esa empresa al establecerlo. La revocación posterior bloquea al usuario ERP, pero no elimina ni desactiva al colaborador ni impide que otro operador autorizado atienda sus obligaciones. El vínculo no concede permisos. Un vínculo existente no puede sustituirse ni retirarse mediante la edición normal; cualquier futura reasignación requiere un proceso auditado que preserve el historial de acceso.

Las operaciones en nombre de un colaborador requieren `travel_expense.create_for_employee` además de create/submit/cancel según la acción. No hay grants automáticos. El usuario actor mantiene profile activo, sesión válida, membership y permiso por empresa; el beneficiario no necesita cuenta ERP. Área y cargo no autorizan operaciones.

## Integración de Tesorería implementada localmente

024–026 extienden OP y pagos con tipo `employee` explícito. Columnas generadas tipadas mantienen FKs empresariales para proveedor o colaborador, incluyendo cuentas beneficiarias. No se crean proveedores ficticios. Las cuentas de colaboradores requieren propuesta y aprobación independiente; REST no entrega números completos y las RPC/auditoría excluyen account_number y CCI.

La primera aprobación de una VIA con anticipo positivo crea un único employee_advance y su payable aprobado. Una restricción única por VIA y una única identidad de origen en payables impiden duplicación. Repetir approve sobre una VIA ya aprobada devuelve la solicitud sin duplicar efectos y sigue verificando autorización y segregación. Si el importe es cero, no se crea anticipo.

El payable pasa por OP, aprobación financiera independiente de la aprobación VIA, programación, pago ejecutado y conciliación existentes. paid_amount procede de allocations ejecutadas; el reverso restaura el saldo sin alterar approved_amount. Se conserva el voucher cifrado obligatorio de pagos. La ejecución está separada de solicitante, beneficiario ERP, aprobador VIA y aprobador de OP. No se incorpora un segundo motor de pagos.

La generación de obligaciones de reembolso y las liquidaciones de rendición siguen pendientes; no están habilitadas por estas migraciones.

La conciliación de devoluciones debe admitir un destino alternativo a payment con exclusividad de destino. Un registro de devolución no acredita por sí mismo un movimiento bancario conciliado. Los cierres y reversos deben compartir el bloqueo transaccional de Tesorería para impedir liquidaciones concurrentes del mismo saldo.

## Liquidación y moneda

Los importes originales son inmutables tras aprobación. La diferencia se deriva de dinero efectivamente entregado menos gastos aceptados. No pueden coexistir saldo a devolver y a reembolsar. Las devoluciones y reembolsos confirmados reducen únicamente su saldo correspondiente; se rechazan excesos y mezclas de moneda. No se implementa conversión implícita.

Una liquidación no cierra mientras existan partidas sin revisión, documentación pendiente, saldos o anticipos adicionales no incluidos. La reapertura exige permiso específico, motivo e historia; no autoriza editar silenciosamente montos ya pagados.

## Política configurable

No se inventan topes legales, categorías autorizadas para DJ ni plazos de rendición. Hasta configuración expresa, las DJ y la aceptación parcial están deshabilitadas. Los topes se expresan en la moneda configurada. Una política debe quedar versionada/snapshot al someter una operación para que cambiarla no reinterprete retrospectivamente una aprobación.

## Historia, archivos y controles

Se reutilizan capture_dimensions y dimension_versions para CECO, proyecto y subproyecto. Se reutiliza tax_documents para identidad y duplicidad del comprobante. Los adjuntos conservan Storage privado, AES-256-GCM y key_version; ninguna nueva ruta puede entregar texto plano sin autorización actual.

Las migraciones 001–021 no se editan. Cada migración adicional debe superar las regresiones locales antes de aplicarse únicamente al DEV vinculado. El catálogo de permisos no concede permisos a roles o usuarios automáticamente. SMTP continúa como excepción externa y queda fuera de este trabajo.
