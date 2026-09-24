# Fase 8B técnica — estado verificado

Estado: **PASS técnico en Supabase DEV**. Esta entrega demuestra infraestructura y workflow con datos sintéticos; no certifica contabilización productiva.

## Evidencia vigente

- Migraciones `044–051`: aplicadas al mismo project-ref DEV usado por la aplicación y verificadas local/remoto. Ver [migraciones-dev.json](migraciones-dev.json).
- Matriz Supabase DEV: **16 PASS, 0 FAIL**. Ver [resultado-dev.md](resultado-dev.md).
- PostgreSQL desechable: **123 PASS**, incluidas carreras de doble generación y revocación de membership.
- Aplicación: **47 PASS**; navegadores de Fases 1–8B y comprobación de bundle sin secretos en la puerta local.
- Captura DEV: [operaciones-contables-dev.png](capturas/operaciones-contables-dev.png).

## Alcance entregado

- `accounting_events` con evidencia inmutable, enlaces a fuentes y constraint de idempotencia por empresa, evento, origen y revisión.
- Captura transaccional desde CxP, pagos, CxC, aplicaciones de cobranza, liquidaciones y devoluciones. La falta de regla deja `pending_mapping` y no revierte la operación financiera.
- Resolución configurada por empresa, vigencia, moneda, tercero, condiciones, dimensiones y prioridad. Las cuentas no están codificadas en TypeScript.
- Preview no persistente, generación manual idempotente y segregación entre operador financiero, generador, validador y posteador.
- Feature flags productivos bloqueados en backend y base: auto-generación, auto-post y reglas productivas permanecen deshabilitados.
- Bandeja contable, filtros, drilldown y trazabilidad bidireccional desde operaciones y asientos.
- AFE configurable, mappings legacy versionados e importadores preview/confirmación sin inferir jerarquías ni significados.
- Dashboard DEMO calculado por API/BD y separado por moneda.
- Empresa DEMO con designación explícita e inmutable; una bandera por sí sola no habilita agregados sobre una empresa no designada.
- Blueprint Render de un solo servicio, banner de entorno, healthcheck, proxy explícito y secretos sólo como variables del servicio.

## Operación

```powershell
npm run test:phase8b:postgres
npm run verify:phase8b:local
npm run db:phase8b:dev:preflight
npm run db:phase8b:dev:apply
npm run verify:phase8b:dev
```

`db:phase8b:dev:apply` exige puerta local PASS, hashes exactos de 044–051, mismo project-ref y ausencia de deriva ajena. El verificador DEV usa secret únicamente mediante Auth Admin para identidades sintéticas; todo CRUD de negocio usa JWT publishable y RPC/RLS.

## Límites vigentes

- No existe servicio Render creado por esta entrega; el despliegue quedó preparado.
- SMTP mantiene la excepción externa no bloqueante previamente aceptada.
- Las cuentas y reglas presentes son `DEMO`/`TEST`; no representan el plan real.
- Auto-generación y auto-post permanecen deshabilitados.
- El dataset integral de presentación debe conservar sólo entidades sintéticas. Su manifiesto y procedimiento están en `docs/demo`; las contraseñas nunca se versionan.
- Las definiciones pendientes de Richard/Luisa siguen listadas en [decisiones-pendientes.md](../demo/decisiones-pendientes.md).

No se inicia Fase 9 y no se declara Fase 8B productiva.
