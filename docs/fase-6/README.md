# Fase 6 — avance de implementación

Estado: **EN IMPLEMENTACIÓN; no habilitada ni verificada en Supabase DEV**.

La aprobación de Fase 5 se conserva. Las cifras siguientes son pruebas locales y no sustituyen la matriz DEV de 30 casos solicitada.

## Implementado localmente

- Migración 022: `employees`, `expense_categories`, `employee_expense_policies`, `expense_policy_categories`. Alta explícita de colaboradores con profile opcional y nombre/documento propios, sin exigir cuenta ERP ni membership al beneficiario; identidad empresarial protegida; políticas inmutables por versión; catálogo de permisos sin grants.
- Migración 023: `travel_expense_requests`, `travel_expense_request_items`, `travel_expense_history`. Numeración VIA, estimación derivada de partidas, CECO/proyecto/subproyecto con captura histórica, borrador/observación editable con historial, envío y aprobación independiente, edición bloqueada tras envío/aprobación.
- Migraciones 024–026: anticipo único por VIA, obligación con origen employee_advance, beneficiario employee explícito en OP/pagos, cuentas propuestas/aprobadas con salida enmascarada y segregación. Importe pagado derivado de Tesorería y reversos; VIA sin anticipo no crea obligación.
- UI de OP: selector de tipo proveedor/colaborador con beneficiarios y cuentas contextualizados.
- RLS de lectura propia/empresarial. Escritura directa denegada a clientes. Mutaciones RPC con identidad actual, company scope, permiso, membership y auditoría transaccional.
- RPC: `employee_foundation_save`, `travel_expense_save`, `travel_expense_transition`.
- API autenticada y validadores estrictos; ningún cliente privilegiado agregado.
- Servicio de aritmética de liquidación con centavos enteros: anticipo original, aceptado, devolución, reembolso, saldos y condiciones documentales. **Todavía no está conectado a una RPC de liquidación ni habilita cierres financieros.**

## Endpoints agregados

| Método | Ruta | Operación |
|---|---|---|
| GET / POST | `/api/employees?company_id=UUID` | Listar / habilitar colaborador |
| PATCH | `/api/employees/:id?company_id=UUID` | Datos organizativos / activación |
| GET / POST | `/api/expense-categories?company_id=UUID` | Categorías |
| PATCH | `/api/expense-categories/:id?company_id=UUID` | Nombre / activación |
| GET | `/api/employee-advances?company_id=UUID` | Anticipos autorizados por RLS |
| GET / POST | `/api/employee-bank-accounts?company_id=UUID` | Cuentas enmascaradas / propuesta |
| POST | `/api/employee-bank-accounts/:id/decision` | Aprobar/rechazar con segregación |
| GET / POST | `/api/expense-policies?company_id=UUID` | Leer / crear versión de política |
| GET / POST | `/api/travel-expenses?company_id=UUID` | Listar / crear solicitud |
| GET | `/api/travel-expenses/:id` | Solicitud, partidas e historia |
| PUT | `/api/travel-expenses/:id?company_id=UUID` | Reemplazar versión editable completa |
| POST | `/api/travel-expenses/:id/actions` | submit / approve / observe / reject / cancel |

GET de listados acepta page y limit (máximo 100). PUT recibe todas las partidas y preserva la versión anterior en historia. La consulta de detalle entrega hasta 100 eventos y el total; la paginación completa de historia está pendiente. No hay endpoint de paid ni de cierre manual.

## Validación local realizada

Node utilizado: 24.18.0.

- 64 grupos PASS de PostgreSQL local/PGlite: 52 regresiones de Fases 2–5 y 12 grupos de fundamento/viajes/Tesorería Fase 6.
- 35 pruebas PASS de aplicación: incluye 6 de liquidación y una adicional de seguridad HTTP de viajes.
- Typecheck backend PASS.
- Typecheck frontend, build Vite y comprobación de separación del bundle PASS.
- 6 regresiones locales de interfaz PASS. Estas pruebas no son la matriz funcional de Fase 6 contra DEV; las capturas nuevas están en `capturas/`, conservando las evidencias aprobadas de Fase 5.

Comandos desde la raíz:

```powershell
& '.tools/node_modules/node-win-x64/bin/node.exe' supabase/tests/phase2.test.mjs
& '.tools/node_modules/node-win-x64/bin/node.exe' --import tsx --test tests/*.test.ts
& '.tools/node_modules/node-win-x64/bin/node.exe' node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
```

Estos tests no usan datos productivos ni aplican migraciones en DEV. No configurar TEST_DATABASE_URL hacia un entorno compartido: el harness crea esquemas y fixtures.

## Pendiente para completar Fase 6

1. Completar obligaciones de reembolso y su integración con la extensión employee ya implementada; ampliar pruebas de concurrencia y conciliación.
2. Rendiciones, revisión por partida, DJ estructuradas y aplicación efectiva de políticas; vincular su liquidación al outstanding_to_render del anticipo.
3. Devoluciones, conciliación de entradas, obligaciones de reembolso, cierres/reaperturas y prueba concurrente del mismo saldo.
4. Integrar tax_documents y adjuntos cifrados por partida; no se han agregado todavía tipos Storage de Fase 6.
5. Interfaz, dashboards, reportes, representaciones imprimibles/PDF y recorrido manual.
6. Aplicar nuevas migraciones exclusivamente al DEV verificado y ejecutar las 30 verificaciones y concurrencia con fixtures sintéticos. **Sin resultado DEV de Fase 6 todavía.**

## Decisiones y límites actuales

Ver [compatibilidad](compatibilidad.md). El fundamento permite colaboradores sin profile; requiere membership sólo del operador ERP. No concede elegibilidad ni permisos automáticamente. Las DJ y aceptación parcial requieren configuración explícita; no se han inventado topes ni plazos. Se rechaza mezcla de moneda.

La aprobación VIA ahora genera un anticipo y obligación sólo si el importe solicitado es positivo. Falta el circuito de rendición/liquidación/reembolso; no utilizar este avance como Fase 6 terminada.

SMTP permanece fuera del alcance. No se inicia Fase 7.
