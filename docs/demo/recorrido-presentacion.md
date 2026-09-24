# Recorrido de presentación DEMO (15–20 minutos)

Este recorrido usa únicamente Empresa DEMO, usuarios sintéticos y reglas con prefijo `DEMO`. El banner `ENTORNO DEMO` y la leyenda `CONFIGURACIÓN DEMO - NO PRODUCTIVA` deben estar visibles cuando corresponda. No se debe presentar ningún saldo, cuenta, tercero o documento como productivo.

## Antes de iniciar

1. Confirmar `/health`, banner DEMO, selección Empresa DEMO y flags `ACCOUNTING_AUTO_GENERATE=false`, `ACCOUNTING_AUTO_POST=false`, `PRODUCTION_ACCOUNTING_RULES=false`.
2. Usar las cuentas DEMO controladas por el administrador del entorno. Las contraseñas no pertenecen a esta guía ni al repositorio.
3. Confirmar que el dataset fue creado por el procedimiento de fixtures y que no contiene entidades reales.
4. Abrir `manifiesto-dev.json`: usar la empresa A del lote indicado para cada bloque operativo y `presentation_company_id` para Contabilidad 8B. El cambio de empresa forma parte de la demostración multiempresa.

## Recorrido

| Min. | Pantalla | Qué mostrar | Control que explica |
|---:|---|---|---|
| 0–1 | Login | Autenticación y callback; seleccionar Empresa DEMO | Identidad, perfil activo y membership se verifican en cada petición |
| 1–2 | Inicio | Panel ejecutivo DEMO; métricas agrupadas por moneda | No hay números hardcodeados ni totales de monedas mezcladas |
| 2–3 | Solicitudes | Solicitud DEMO creada, enviada y aprobada | Historial, segregación solicitante/aprobador y empresa persistida |
| 3–4 | Finanzas / CxP | Obligación DEMO y vencimiento | La CxP conserva documento/origen y saldo derivado |
| 4–5 | Tesorería / OP | Orden aprobada y pago ejecutado | Programar, aprobar y ejecutar son pasos separados |
| 5–6 | Banco | Movimiento confirmado y conciliación | Confirmar banco no implica clasificar ajuste ni postear contabilidad |
| 6–7 | Gastos y viáticos | VIA, anticipo y rendición DEMO | Empleado puede existir sin usuario ERP; pago depende de Tesorería |
| 7–8 | Liquidación | Anticipo, gasto aceptado, devolución/reembolso y estado actual | Diferencia original y saldo actual aparecen separados |
| 8–9 | Cobranzas | Cliente, CxC, depósito identificado y aplicación | Identificación, cobranza y conciliación no son la misma acción |
| 9–10 | Cash flow | Posición bancaria registrada y compromisos | Efectivo confirmado no se duplica por asignaciones |
| 10–11 | Contabilidad / Operaciones pendientes | Evento capturado desde una operación | Operación válida sin regla queda `Pendiente de regla`, no falla |
| 11–12 | Regla DEMO | Regla designada y sus condiciones/dimensiones explícitas | Ninguna cuenta ni significado contable está hardcodeado |
| 12–13 | Preview | Líneas, debe/haber, tercero, CECO/proyecto/AFE y versión | Preview conserva evidencia; no postea |
| 13–14 | Generar borrador | Generación manual con usuario independiente | Idempotencia, un borrador por evento/revisión, sin auto-generación |
| 14–15 | Asientos | Validar y postear con actores distintos | Operación ≠ generación ≠ validación ≠ posteo |
| 15–16 | Mayor y balance | Asiento posteado y drilldown hacia el evento/origen | Trazabilidad bidireccional y snapshots históricos |
| 16–17 | Auditoría | Captura, resolución, preview, borrador y posteo | Actor, empresa y transición auditados; no hay secretos ni números de cuenta |
| 17–18 | Administración / importación | Plantilla, preview y confirmación | No se adivinan padres, códigos o significados legacy |

## Demostraciones de seguridad

- Cambiar de empresa: la bandeja y los agregados cambian con el contexto autorizado.
- Retirar una membership de prueba: el siguiente acceso a la empresa queda denegado.
- Abrir REST directo o intentar escribir en una tabla: RLS y revocación de DML lo rechazan.
- Intentar generar dos veces el mismo evento: devuelve el mismo borrador; no duplica el asiento.
- Crear un ajuste desde un movimiento bancario: requiere clasificar explícitamente una transacción confirmada manual/importada y un motivo; no se infiere desde la descripción.

## Límites que se deben decir en la presentación

La demo ilustra arquitectura y workflow. No certifica el plan de cuentas, COGS, depreciación, vouchers productivos, EEFF ni las reglas empresariales de Richard/Luisa. No hay auto-post, ejecución bancaria real ni reglas productivas activadas.
