# Fase 2.5 — Arquitectura funcional financiera, contable y ERP

**Entrega de diseño · 9 de septiembre de 2026.** Objetivo: sustituir progresivamente Ábasoft con una plataforma ERP multiempresa, preservando la arquitectura de seguridad aprobada. Esta entrega no implementa finanzas, no modifica migraciones ni activa permisos. Fase 3 no iniciada.

## Lectura del diseño

1. [Mapa ERP, contextos, dependencias y fuentes de verdad](01-mapa-y-principios.md).
2. [Modelo operativo y workflows: compras, CxP, tesorería, bancos, CxC, cobranza y gastos de personal](02-modelo-operativo-y-workflows.md).
3. [Contabilidad, CECO, dimensiones, proyectos, AFE, presupuesto y monedas](03-contabilidad-centros-y-dimensiones.md).
4. [Cierre, activos, EEFF, cubos, consolidación, SUNAT e inventario condicional](04-cierre-reporting-y-dominios-condicionales.md).
5. [Migración, exportaciones, fases posteriores y retiro de Ábasoft](05-migracion-roadmap-y-aceptacion.md).
6. [Catálogo futuro de permisos, segregación, riesgos y preguntas pendientes](06-permisos-riesgos-y-pendientes.md).

El modelo es conceptual: los nombres de entidades permiten discutir responsabilidades e integridad, pero no son todavía un esquema SQL definitivo. Los modelos y diagramas se complementan; todas las entidades financieras relevantes requieren empresa aunque los diagramas omitan aristas repetidas.

## Decisiones estructurales

- Mantener monolito modular React/Vite + Express + Supabase/PostgreSQL. Reutilizar autenticación, autorización empresarial y auditoría existentes.
- Separar documento, obligación, orden de pago, ejecución, conciliación y asiento. Relacionarlos por origen e idempotencia, sin copiar saldos como fuentes independientes.
- Crear CECO como maestro explícito, jerárquico, configurable por UI autorizada y enlazado a dimensiones tipadas; preservar historia al cambiar jerarquías.
- Preparar partida doble inmutable después de posteo, planes/tasas/reportes versionados y cierre/reapertura auditados.
- Migrar por empresa y dominio con un único sistema escritor; comparar cierres antes del retiro.

La sustitución contable requiere información real del plan de cuentas y políticas. AFE, COG, depreciación, inventario, consolidación y SUNAT permanecen condicionados a las definiciones enumeradas en el documento 06. No se proponen fórmulas contables como si ya estuvieran aprobadas.

## Cobertura de los 24 entregables solicitados

| N.º | Entregable | Ubicación |
|---|---|---|
| 1 | Mapa ERP completo | [01](01-mapa-y-principios.md) |
| 2 | Contextos delimitados / módulos | [01](01-mapa-y-principios.md) |
| 3 | Dependencias entre módulos | [01](01-mapa-y-principios.md), diagrama de dependencias |
| 4 | Modelo conceptual de todos los dominios | [02](02-modelo-operativo-y-workflows.md), [03](03-contabilidad-centros-y-dimensiones.md), [04](04-cierre-reporting-y-dominios-condicionales.md) |
| 5 | Modelo específico de centros de costo | [03](03-contabilidad-centros-y-dimensiones.md), maestro, jerarquía, UI, permisos, auditoría y dimensiones |
| 6 | ER conceptual actualizado | [03](03-contabilidad-centros-y-dimensiones.md), núcleo; [04](04-cierre-reporting-y-dominios-condicionales.md), operación y reporting |
| 7 | Estrategia multiempresa | [01](01-mapa-y-principios.md), [06](06-permisos-riesgos-y-pendientes.md) |
| 8 | Estrategia multimoneda | [03](03-contabilidad-centros-y-dimensiones.md) |
| 9 | Estados y workflows | [02](02-modelo-operativo-y-workflows.md), [03](03-contabilidad-centros-y-dimensiones.md), [04](04-cierre-reporting-y-dominios-condicionales.md) |
| 10 | Invariantes contables | [03](03-contabilidad-centros-y-dimensiones.md) |
| 11 | Dimensiones financieras | [03](03-contabilidad-centros-y-dimensiones.md) |
| 12 | Reporting y cubos | [04](04-cierre-reporting-y-dominios-condicionales.md) |
| 13 | Drill-down financiero | [04](04-cierre-reporting-y-dominios-condicionales.md), diagrama y controles |
| 14 | Cierre mensual | [04](04-cierre-reporting-y-dominios-condicionales.md) |
| 15 | Consolidación futura | [04](04-cierre-reporting-y-dominios-condicionales.md) |
| 16 | Migración desde Ábasoft | [05](05-migracion-roadmap-y-aceptacion.md), quince etapas |
| 17 | Exportaciones necesarias | [05](05-migracion-roadmap-y-aceptacion.md), checklist |
| 18 | Permisos adicionales | [06](06-permisos-riesgos-y-pendientes.md), catálogo sin grants |
| 19 | Riesgos técnicos y contables | [06](06-permisos-riesgos-y-pendientes.md) |
| 20 | Riesgos de duplicidad | [01](01-mapa-y-principios.md), [05](05-migracion-roadmap-y-aceptacion.md), [06](06-permisos-riesgos-y-pendientes.md) |
| 21 | Fuente de verdad por dominio | [01](01-mapa-y-principios.md), matriz de transición |
| 22 | Fases posteriores revisadas | [05](05-migracion-roadmap-y-aceptacion.md) |
| 23 | Orden recomendado | [05](05-migracion-roadmap-y-aceptacion.md), dependencias y puertas de salida |
| 24 | Aceptación para retirar Ábasoft | [05](05-migracion-roadmap-y-aceptacion.md), criterios y contingencia |

## Decisión de seguridad antes de finanzas productivas

Administrar asignaciones no concede ejecución financiera. Sin embargo, hay que definir cómo impedir auto-beneficio indirecto y asignaciones recíprocas entre administradores antes de activar permisos financieros. Se propone aprobación independiente de cambios sensibles y segregación por registro. El documento 06 expone esta decisión sin modificar la delegación administrativa aprobada.

## Evidencia y límites

El diseño parte del requerimiento adjunto y de la arquitectura local de Fases 1–2. No se ha inspeccionado una instalación ni exportación real de Ábasoft. Las referencias oficiales sobre PCGE y SUNAT se citan junto a las afirmaciones en los documentos 03 y 04; deberán revisarse nuevamente al implementar los módulos afectados.

La verificación de esta fase cubre estructura de documentos, enlaces locales, catálogo solicitado y conservación de los archivos de implementación. No constituye validación de reglas contables ni pruebas de módulos financieros: éstos aún no existen.
