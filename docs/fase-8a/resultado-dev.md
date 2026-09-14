# Fase 8A · Supabase DEV

Ejecución: F8A_20260914000108. Estado: PASS. Mismo proyecto que la aplicación: verificado. Sólo fixtures sintéticos.

| N.º | Verificación | Resultado |
|---|---|---|
| 1 | Empresa A no lee B | PASS |
| 2 | Crear cuenta raíz e hija | PASS |
| 3 | Código duplicado rechazado | PASS |
| 4 | Ciclo jerárquico rechazado | PASS |
| 5 | Cuenta usada no se elimina | PASS |
| 6 | Importación preview sin persistencia | PASS |
| 7 | Confirmación idempotente | PASS |
| 8 | Crear período abierto | PASS |
| 9 | Período cerrado rechaza posteo | PASS |
| 10 | Crear asiento borrador | PASS |
| 11 | Descuadre rechazado | PASS |
| 12 | Debe y haber simultáneos rechazados | PASS |
| 13 | Cuenta no imputable rechazada | PASS |
| 14 | Validar asiento balanceado | PASS |
| 15 | Posteo independiente | PASS |
| 16 | Posteo idempotente | PASS |
| 17 | Asiento posteado inmutable | PASS |
| 18 | Reverso conserva original | PASS |
| 19 | Doble reverso rechazado | PASS |
| 20 | Dimensiones e identidad histórica | PASS |
| 21 | Tercero obligatorio y empleado sin Auth | PASS |
| 22 | Moneda y tipo de cambio explícito | PASS |
| 23 | Simulación no persiste asientos | PASS |
| 24 | Regla versionada inmutable | PASS |
| 25 | Cuentas configuradas sin hardcode ni seed | PASS |
| 26 | Mayor contable | PASS |
| 27 | Balance de comprobación | PASS |
| 28 | Solo posteados afectan balances | PASS |
| 29 | Reapertura auditada | PASS |
| 30 | REST directo no evade controles | PASS |
| 31 | Revocación de membership inmediata | PASS |
| 32 | Auditoría con actor y empresa | PASS |
| 33 | UI DEV real sin mocks | PASS |
| 34 | Secretos fuera del bundle y logs | PASS |

Concurrencia adicional: [{"name":"Dos posteos del mismo asiento","status":"PASS"},{"name":"Dos reversos del mismo asiento","status":"PASS"},{"name":"Cierre de período contra posteo","status":"PASS"},{"name":"Dos versiones activadas simultáneamente","status":"PASS"}]
