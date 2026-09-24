# Entrega Fase 8B técnica + DEMO

Estado: **implementación técnica verificada en local y Supabase DEV**. No es aprobación contable productiva.

## 1. Migraciones y tablas

| Migración | Contenido principal |
|---|---|
| 044 | `accounting_feature_flags`, `afes`, `legacy_mappings`, `accounting_events`, `accounting_event_sources`, `accounting_demo_rules`, cola contable y permisos |
| 045 | Captura transaccional desde fuentes financieras persistidas |
| 046 | Resolver, preview, generación manual, ignore y segregación de asientos |
| 047 | Maestros/importadores configurables y primer uso AFE |
| 048 | AFE como dimensión del preview contable |
| 049 | Condiciones explícitas por dimensión y ajuste bancario clasificado |
| 050 | Dashboard ejecutivo DEMO derivado de BD |
| 051 | Designación inmutable de empresas DEMO |

Las ocho están aplicadas y verificadas en el mismo Supabase DEV de la aplicación. No se modificaron 001–043.

## 2. Seguridad, RLS y auditoría

- RLS de lectura exige permiso y empresa; DML directo permanece revocado.
- La captura contable ocurre desde triggers sobre fuentes persistidas y no acepta creación arbitraria del cliente.
- Un constraint único impide duplicar un evento por retry.
- Una operación sin regla conserva validez y genera `pending_mapping`.
- El estado `posted` se deriva del `journal_posting` inmutable.
- Operador financiero, generador, validador y posteador deben ser actores distintos.
- Revocar membership invalida inmediatamente lectura y reintentos.
- Designar empresa, configurar DEMO, resolver, previsualizar, generar e ignorar quedan auditados con actor y empresa.
- La secret se usa sólo mediante Auth Admin en provisión/verificación; el negocio usa JWT publishable.

## 3. RPC públicas controladas

- `accounting_demo_company_designate`
- `accounting_demo_configure`
- `accounting_demo_rule_designate`
- `accounting_event_resolve`
- `accounting_event_preview`
- `accounting_event_generate`
- `accounting_event_ignore`
- `accounting_afe_save`
- `accounting_legacy_save`
- `accounting_master_import`
- `accounting_rule_dimension_match_save`
- `accounting_bank_adjustment_capture`
- `accounting_demo_dashboard`

Los helpers de captura/resolución internos están en `private` y revocados para `anon`, `authenticated` y `service_role`.

## 4. API

| Método | Ruta | Uso |
|---|---|---|
| GET | `/api/runtime` | Entorno y flags públicos, sin secretos |
| GET | `/api/accounting/events` | Cola y filtros |
| GET | `/api/accounting/events/:id` | Evidencia y fuentes |
| GET | `/api/accounting/trace` | Operación → eventos |
| POST | `/api/accounting/events/:id/resolve` | Resolver regla única |
| POST | `/api/accounting/events/:id/preview` | Preview no persistente |
| POST | `/api/accounting/events/:id/generate` | Generar draft idempotente |
| POST | `/api/accounting/events/:id/ignore` | Exclusión autorizada |
| POST | `/api/accounting/demo/designate-company` | Designar empresa sintética |
| POST | `/api/accounting/demo/configure` | Activar/desactivar flujo DEMO |
| POST | `/api/accounting/rules/:id/designate-demo` | Designar regla sintética |
| POST | `/api/accounting/rules/:id/dimension-matches` | Condiciones por dimensión |
| POST | `/api/bank-transactions/:id/accounting-adjustment` | Clasificación explícita |
| GET | `/api/accounting/demo-dashboard` | Métricas persistidas por moneda |
| GET/POST | `/api/accounting/afes`, `/api/accounting/legacy-mappings` | Maestros/versiones |
| POST | `/api/accounting/configuration-import/:kind` | Preview/confirmación |

El middleware existente `requireAuth` crea un repositorio request-scoped con publishable key y JWT. Los validadores Zod de Fase 8B están en `src/server/validators/accounting-configuration.ts` y la ampliación AFE en `accounting.ts`.

## 5. UI y Storage

- Inicio con dashboard DEMO sin cifras hardcodeadas.
- Contabilidad → Operaciones pendientes, Configuración/importación y AFE.
- Filtros, loading, errores, empty states, badges, breadcrumbs y drilldown.
- Enlaces de trazabilidad desde CxP, pagos, CxC, cobranzas, rendiciones, anticipos, devoluciones y reembolsos.
- Banner `ENTORNO DEMO` y aviso `CONFIGURACIÓN DEMO - NO PRODUCTIVA`.
- No se creó un bucket nuevo: Fase 8B reutiliza el Storage privado y el cifrado de adjuntos ya verificado en fases anteriores.

## 6. Importadores y dataset

- Plan de cuentas y CECO conservan sus importadores existentes.
- Proyecto, subproyecto, AFE, tipo contable, mapping legacy y reglas usan archivo → preview → validación → confirmación.
- No se infieren padres ni significados.
- [manifiesto-dev.json](../demo/manifiesto-dev.json) agrupa seis lotes sintéticos PASS de Fases 4–8B, sin credenciales.
- [recorrido-presentacion.md](../demo/recorrido-presentacion.md) describe una sesión de 15–20 minutos.

## 7. Render y Auth

`render.yaml` define un solo Web Service con Node 24.18.0, build Vite, API Express, estáticos, `/health`, `APP_ENV=demo`, `TRUST_PROXY_HOPS=1` y los tres flags contables en `false`. Los secretos quedan como variables `sync: false`.

Agregar en Supabase Auth, sin retirar localhost:

```text
https://<dominio-render>/auth/callback
```

No se creó ni publicó un servicio Render en esta entrega.

## 8. Pruebas

- PostgreSQL desechable: **123 PASS** Fases 2–8B.
- Aplicación: **47 PASS**.
- Browser: interfaz 6, viáticos 3, cobranzas 3, contabilidad 4, eventos 3.
- Supabase DEV Fase 8B: **16 PASS, 0 FAIL**.
- Build, tipos, `git diff --check` y frontera de secretos: PASS.

Evidencia: [puerta-local.json](puerta-local.json), [resultado-dev.md](resultado-dev.md), [migraciones-dev.json](migraciones-dev.json) y [captura DEV](capturas/operaciones-contables-dev.png).

## 9. Riesgos y decisiones pendientes

- La demo usa lotes sintéticos por fase; no representa saldos reales ni una migración productiva consolidada.
- SMTP sigue como excepción externa no bloqueante.
- Rate limiting en memoria presupone una sola instancia Render.
- Plan contable, CECO, campos Ábasoft, AFE, vouchers, COGS, depreciación, EEFF y segregación Cobranzas/Tesorería esperan definición formal de Richard/Luisa.
- Los flags productivos permanecen falsos. No hay auto-generación ni auto-post.

No se inicia Fase 9.
