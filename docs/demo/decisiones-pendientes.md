# Definiciones requeridas de Richard / Luisa

Estas decisiones no impiden la infraestructura técnica ni una demo sintética. Sí impiden certificar mappings y contabilización productiva.

| Definición | Evidencia requerida | Comportamiento provisional |
|---|---|---|
| Plan de cuentas completo | Catálogo aprobado, jerarquía, vigencias y cuentas imputables | Catálogo explícito; únicamente cuentas DEMO ficticias para demostración |
| CECO completo | Códigos, categorías, padres, empresa y vigencias | Importación sin inferencia de padres; historial existente protegido |
| ACCOUNT / ACCOUNT1 / CTACONS | Diccionario y ejemplos representativos | Sin interpretación automática |
| PRJNIV / PROYECTO / PROJECT / PARTIDA | Niveles, relaciones y reglas de identificación | Proyectos/subproyectos explícitos; no crear jerarquías supuestas |
| AFE | Significado, alcance, ciclo de vida y vínculos aprobados | Solo dimensión configurable; no presupuesto ni compromiso automático |
| SUBDIARIO / MONEDA / MODULO / TIPODOCUM / ELEMENTO / REPARABLE | Códigos, significados, equivalencias y vigencias | Mapping versionado vacío hasta configuración explícita |
| Vouchers representativos completos | Casos con todas las líneas, impuestos, moneda, tipo de cambio y dimensiones | Preview DEMO no certifica tratamiento contable |
| COGS | Fórmula, origen de costos, método y momento de reconocimiento | Sin cálculo productivo |
| Depreciación | Activos, bases, métodos, vidas útiles y fechas | Sin cálculo productivo |
| EEFF | Modelos reales, agrupaciones, comparativos y criterios aprobados | Mayor y balance de comprobación; no afirmar que sean EEFF aprobados |
| Segregación Cobranzas / Tesorería | Matriz definitiva de responsabilidades y excepciones | Preservar controles actuales; no ampliar permisos automáticamente |

También se requiere confirmar el momento contable de cada evento, sus reversos/regularizaciones y el reparto por partidas cuando una operación usa varios CECO/proyectos. El evento conserva evidencia; no decide por sí solo cómo reconocerla.

`ACCOUNTING_AUTO_GENERATE`, `ACCOUNTING_AUTO_POST` y `PRODUCTION_ACCOUNTING_RULES` permanecen en `false`. Una definición verbal incompleta no habilita estos flags.
