# Fase 7 · Supabase DEV

Ejecución: F7_20260913181951. Estado: PASS. Mismo proyecto que la aplicación: verificado. Sólo fixtures sintéticos.

| N.º | Verificación | Resultado |
|---|---|---|
| 1 | Cliente A no visible en B | PASS |
| 2 | Crear cliente independiente de Auth | PASS |
| 3 | Documento duplicado rechazado | PASS |
| 4 | Crear CxC autorizada | PASS |
| 5 | Generar cronograma | PASS |
| 6 | Cobro parcial | PASS |
| 7 | Cobro completo | PASS |
| 8 | Varios cobros sobre una CxC | PASS |
| 9 | Un cobro aplicado a varias CxC | PASS |
| 10 | Saldo pendiente derivado | PASS |
| 11 | Estado collected no editable | PASS |
| 12 | Depósito sin identificar | PASS |
| 13 | Identificar cliente | PASS |
| 14 | Identificar no concilia banco | PASS |
| 15 | Aplicar depósito | PASS |
| 16 | Candidatos sugeridos sin asignación automática | PASS |
| 17 | Saldo a favor preservado | PASS |
| 18 | Aplicar saldo a favor posteriormente | PASS |
| 19 | Reverso restaura CxC | PASS |
| 20 | Moneda distinta rechazada | PASS |
| 21 | Empresa distinta rechazada | PASS |
| 22 | Cuota vencida derivada | PASS |
| 23 | Aging por vencimiento | PASS |
| 24 | Membresía respeta configuración | PASS |
| 25 | Contrato de lote y cronograma | PASS |
| 26 | Cash Flow sin doble conteo | PASS |
| 27 | Conciliación bancaria de cobro | PASS |
| 28 | Revocación de membership inmediata | PASS |
| 29 | REST directo no evade controles | PASS |
| 30 | Auditoría con empresa y actor | PASS |
| 31 | Dashboard Cobranzas | PASS |
| 32 | Dashboard Finanzas y Cash Flow | PASS |
| 33 | UI DEV real sin mocks | PASS |
| 34 | Secretos fuera del bundle y logs | PASS |

Concurrencia adicional: [{"name":"Dos cobros sobre el mismo pendiente","status":"PASS"},{"name":"Dos aplicaciones del mismo saldo a favor","status":"PASS"},{"name":"Reintento identificar y aplicar","status":"PASS"},{"name":"Reverso concurrente","status":"PASS"}]
