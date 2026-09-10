# Migración desde Ábasoft y fases posteriores

## Principio de transición

Ábasoft permanece operativo durante la transición. La unidad de corte es empresa + dominio + fecha efectiva. Un registro de responsabilidad debe indicar qué sistema puede crear/modificar cada tipo de hecho y cuál es sólo réplica. El trabajo paralelo significa comparar resultados, no ejecutar dos veces pagos, cobranzas o envíos tributarios.

Preparar conceptualmente `migration_runs`, `migration_files`, `migration_mappings`, `migration_rows`, `migration_exceptions` y `migration_reconciliations`. Cada ejecución conserva origen, corte, hash, versión de reglas, claves externas, conteos, totales por empresa/moneda, aprobador y resultado. Primero staging, luego validación y finalmente importación autorizada. Los identificadores de Ábasoft se conservan como referencias únicas por empresa/origen/tipo; no como claves primarias del ERP.

## Secuencia de migración: quince etapas

| Etapa | Trabajo | Evidencia de salida |
|---|---|---|
| 1. Extraer maestros | Obtener exportaciones y diccionario de Ábasoft, con corte consistente. | Archivos identificados, hashes, conteos y responsables. |
| 2. Limpiar y mapear | Resolver duplicados, códigos, jerarquías, monedas y contrapartes. | Equivalencias aprobadas; excepciones sin resolución bloquean los datos afectados. |
| 3. Importar maestros | Empresas, cuentas, CECO, proyectos, terceros y bancos. | Integridad, unicidad, jerarquías y muestras verificadas por usuarios. |
| 4. Importar saldos iniciales | Balance de apertura por cuenta, moneda y dimensiones disponibles. | Debe/haber y saldos reconciliados con el cierre de origen. |
| 5. Importar CxP abiertas | Documentos, cuotas, vencimientos, anticipos y aplicaciones parciales. | Auxiliar por proveedor concilia con cuentas de control y corte. |
| 6. Importar CxC abiertas | Clientes, membresías, lotes, cuotas y cobranzas aplicadas/no identificadas. | Auxiliar por cliente concilia con control contable. |
| 7. Importar bancos | Saldos, movimientos pendientes y conciliación al corte. | Saldo libro, extracto y partidas pendientes explicados. |
| 8. Importar activos | Costo, acumulados, libros, vida remanente y soportes. | Registro de activos y depreciación conciliados con contabilidad. |
| 9. Operar en paralelo | Capturar o replicar una sola ejecución económica y comparar su tratamiento. | Matriz de único escritor y eventos sin duplicados. |
| 10. Comparar resultados | Saldos, auxiliares, Cashflow, dimensiones y reportes. | Diferencias clasificadas y resueltas o aceptadas expresamente cuando proceda. |
| 11. Cerrar meses en paralelo | Ejecutar tareas, provisiones, depreciación y reportes según políticas validadas. | Cierres reproducibles y comparables por empresa. |
| 12. Validar funcionalmente | Obtener conformidad de Contabilidad, Tesorería, Cobranzas, Finanzas y TI. | Acta con alcance, pendientes y criterios cumplidos. |
| 13. Activar nueva producción | Congelar escrituras del dominio origen, aplicar delta y habilitar ERP. | Corte firmado, conciliación final, usuarios y contingencia preparados. |
| 14. Ábasoft de sólo lectura | Consultar historia y evidencias, sin nuevas operaciones del dominio migrado. | Accesos restringidos, archivo verificable y soporte de consultas. |
| 15. Retirar Ábasoft | Cerrar dependencias restantes después de validación integral. | Aprobación formal y conservación/restauración comprobadas. |

No contabilizar dos veces la apertura: importar los documentos abiertos como auxiliares asociados al saldo inicial, o reconstruirlo desde detalle, según una estrategia aprobada; nunca ambas sin eliminación explícita. Las cuentas de control deben reconciliar. Si se importa historia además de apertura, definir períodos excluyentes. Los pagos posteriores al snapshot entran como delta con su identificador original.

Los archivos deben venir de un corte coordinado; exportar cuentas el lunes y aplicaciones el miércoles sin reconciliar el intervalo no produce una apertura fiable. Congelar y registrar modificaciones tardías. Los saldos sin dimensión no se distribuyen por intuición: preservar “sin información de origen” y resolver con responsable.

## Checklist de exportación de Ábasoft

| Grupo | Información a solicitar |
|---|---|
| Empresas | Razón social, identificadores, configuración, monedas y períodos. Confirmar la razón social del Country Club y datos de Inmobiliaria y Construcciones Cincinnati S.A.C.; no inventar RUC. |
| Plan contable | Todas las cuentas/subcuentas, jerarquía, naturaleza, cuentas de movimiento, vigencias, equivalencias y controles de moneda. |
| Organización analítica | CECO y categorías, jerarquía, áreas, unidades estratégicas, proyectos/subproyectos, AFE y dimensiones utilizadas. |
| Terceros | Proveedores, clientes, empleados, identificadores, estado y relaciones; cuentas bancarias y evidencia de validación por canal seguro. |
| Bancos | Entidades, cuentas, monedas, saldos, extractos disponibles, movimientos y partidas conciliadas/pendientes. |
| Contabilidad | Cabeceras y líneas de asientos, tipos/series, fechas, estado, moneda/tasa, dimensiones, referencias y soportes; balance de comprobación y mayores. |
| CxP | Facturas/notas, cuotas, vencimientos, saldos, aplicaciones, anticipos, pagos parciales, retenciones u otros tratamientos realmente usados. |
| CxC | Documentos, clientes, membresías, contratos de lotes, cronogramas, cuotas, cobranzas, aplicaciones, abonos no identificados y notas. |
| Compras y servicios | OC/OS abiertas, líneas, recepciones/conformidades, compromisos y contratos recurrentes. |
| Personal y recuperaciones | Viáticos, anticipos, rendiciones, DJ, saldos por devolver/reembolsar y reembolsos de proveedores con acuerdos y cobros. |
| Activos | Inventario, categorías, adquisiciones, altas/bajas/mejoras, libros, métodos, vidas, residuales, depreciación mensual/acumulada y dimensiones. |
| Presupuesto y AFE | Versiones, autorizaciones, compromisos, ejecuciones, liberaciones y aprobaciones; fórmulas operativas actuales. |
| Reportes | Modelos de balance/resultados, rubros, mapeos, fórmulas, reportes mensuales aprobados, cubos y filtros habituales. |
| Cierre y COG | Checklist, evidencia, ajustes, proceso de COG, responsables y archivos de trabajo usados por Contabilidad. |
| Monedas | Tasas, tipo, fecha, fuente, orientación de conversión y reglas de redondeo vigentes. |
| Tributación | Registros y conciliaciones pertinentes, XML/CDR y referencias de envíos si están disponibles; canal y obligaciones confirmadas. |
| Inventario, si existe | Productos, almacenes, unidades, movimientos, costos y saldos; confirmar primero su alcance. |
| Técnica y archivo | Diccionario, relaciones, claves estables, encoding, separadores, formatos de fecha/decimal, zona horaria, volumen, adjuntos, auditoría disponible y restricciones de exportación/licencia. |

Preferir formatos estructurados que conserven claves, no sólo reportes PDF. No asumir que Ábasoft dispone de una API o de exportación completa: comprobar con su administrador/proveedor. No extraer contraseñas ni secretos. Proteger exportaciones con acceso por necesidad, cifrado y registro de transferencias.

## Roadmap revisado y orden recomendado

Esta numeración es una propuesta de trabajo posterior; no inicia ninguna fase ni altera la aprobación de Fases 1–2.

| Fase propuesta | Alcance | Dependencias y puerta de salida |
|---|---|---|
| 3. Maestros y especificación | UI administrativa necesaria, terceros, bancos, CECO, proyectos/subproyectos, monedas; relevamiento contable y muestra de exportación. | Reutilizar seguridad de Fase 2. Maestros sin ciclos, controles multiempresa y mapeos aprobados. |
| 4. Solicitudes y compras | Aprobaciones, OC/OS, conformidades, contratos y documentos; CxP operativa. AFE/presupuesto sólo tras definir su política. | Maestros y segregación probados; idempotencia y trazabilidad documental. |
| 5. Tesorería y gastos de personal | Órdenes, lotes, ejecución controlada, bancos, conciliación, viáticos, DJ, devoluciones y reembolsos. | CxP y flujos aprobados; pruebas de resultado bancario desconocido y no duplicación. |
| 6. CxC y cobranzas | Clientes, membresías comerciales, contratos/lotes, cuotas, identificación y aplicación. | Definir generación y tratamiento de obligaciones; conciliación integrada. Puede diseñarse junto a 4–5 sin duplicar bancos. |
| 7. Contabilidad | Plan real, períodos, asientos, reglas por evento, dimensiones y multimoneda; importación de prueba. | Políticas contables explícitas y auxiliares estables; balances e idempotencia verificados. Diseñar contratos contables desde 3 para evitar retrabajo. |
| 8. Activos y cierre | Depreciación, COG confirmado, cierre y reapertura controlada. | Política de activos/COG y ledger aceptados; cierre paralelo satisfactorio. |
| 9. EEFF y gestión | Modelos, análisis, cubos, Cashflow integrado, presupuestos/proyecciones y comparación. | Datos reconciliados, mapeos aprobados y drill-down que suma al total. Cashflow operativo básico puede acompañar 5. |
| 10. Integraciones y consolidación | SUNAT según canal/obligaciones; consolidación según política. Inventario sólo si se confirma. | Especificaciones oficiales vigentes, políticas y pruebas propias por dominio. No bloquear todo el ERP por un módulo opcional. |
| 11. Sustitución definitiva | Corte por dominio/empresa, nuevos cierres y archivo histórico. | Criterios de retiro satisfechos y aceptación de responsables. |

La preparación de migración comienza en Fase 3, no en la última fase. Ábasoft puede seguir siendo fuente contable/tributaria mientras el ERP gestiona operación; los intercambios deben conservar un origen único y conciliación. No duplicar contabilización mediante carga manual e integración del mismo evento.

## Criterios de aceptación para retirar Ábasoft

1. Alcance acordado por empresa y dominio cubierto, incluidos procesos menos frecuentes: reversos, devoluciones, cambios de período, ajustes y recuperaciones parciales.
2. Maestros y aperturas aprobados; CxP/CxC, bancos, activos y libro concilian por empresa, moneda, cuenta y dimensiones disponibles. Cero diferencias sin explicación y aprobación; no esconder discrepancias bajo una tolerancia global.
3. Como recomendación inicial, completar al menos dos cierres mensuales consecutivos en paralelo, incluyendo un caso representativo de ajustes. La cantidad y los casos finales se acordarán con Finanzas/Contabilidad; dos meses no prueban por sí solos el cierre anual.
4. EEFF reproducibles y comparables, con diferencias de política/mapeo documentadas; drill-down hasta soporte. Cubos y exportaciones mantienen totales y autorización.
5. Seguridad probada: aislamiento de empresas, revocación inmediata, perfiles inactivos, REST directo, segregación por registro, auditoría inmutable y ausencia de secretos en cliente.
6. Sin doble ejecución bancaria ni fiscal; fallos/reintentos y estados desconocidos resueltos con evidencia. Integraciones requeridas aceptadas en sus ambientes correspondientes.
7. Usuarios capacitados y responsables titulares/suplentes asignados por función, no hardcodeados. Procedimientos de cierre, soporte y contingencia ensayados.
8. Copias y restauración verificadas; rendimiento medido con volumen representativo y objetivos acordados. Monitoreo y respuesta a incidentes operativos.
9. Historia y evidencias accesibles con integridad comprobable, exportación y búsqueda. Retención y obligaciones legales confirmadas, sin inventar un plazo de conservación.
10. Cada dependencia externa está reemplazada o tiene una continuidad explícita. Si Ábasoft sigue siendo necesario para obligaciones tributarias o historia no recuperable, su retiro completo aún no está aceptado.

## Corte y contingencia

Antes del corte: respaldo restaurable, ensayo, freeze de escrituras, delta final, conciliación y decisión formal. Después: vigilancia de saldos e integraciones y registro de incidencias.

Un rollback antes de ejecutar operaciones externas puede restaurar la ruta anterior con conciliación. Después de pagos o envíos reales no basta restaurar una base: esos efectos externos persisten. Registrar qué ocurrió, bloquear reejecuciones, reconciliar y aplicar correcciones autorizadas. No reactivar ambos sistemas como escritores. Definir responsables y ventana de decisión antes de cada corte.
