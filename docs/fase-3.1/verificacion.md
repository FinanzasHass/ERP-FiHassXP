# Fase 3.1 — Puerta de verificación Supabase real

**Estado: BLOQUEADA / NO SUPERADA. Fase 4 no iniciada.**

La comprobación inicial encontró las migraciones 001–011 y el bundle local. No existe `.env` y no están definidas SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, SUPABASE_DB_URL ni APP_ORIGIN en el entorno del proceso. No hay un conector Supabase disponible en esta sesión. No se conectó, creó ni modificó ningún proyecto remoto.

## Interpretación de resultados

La columna PASS/FAIL expresa **aceptación del criterio**, no un diagnóstico supuesto del software. FAIL por bloqueo significa que falta la evidencia obligatoria y que la prueba remota no se ejecutó. No significa que se haya demostrado una vulnerabilidad. No se convierten pruebas locales, mocks o PGlite de fases anteriores en PASS de Supabase real.

| N.º | Verificación requerida | PASS/FAIL | Ejecución y evidencia |
|---|---|---|---|
| 1 | Aplicar migraciones 001–011 | FAIL | Bloqueada: archivos presentes; proyecto y acceso propietario no disponibles. Primero inspeccionar historial remoto; no repetir migraciones ya aplicadas. |
| 2 | Configurar variables backend | FAIL | No hay `.env` ni variables Supabase en el proceso. Se inspeccionó presencia, sin imprimir valores. |
| 3 | Separación publishable/secret | FAIL | Comprobación local del límite cliente/backend aprobada; uso de claves reales aún no verificado. |
| 4 | Administrador inicial | FAIL | No ejecutada. Inspeccionar bootstrap remoto antes de inicializarlo. |
| 5 | Dos empresas de prueba | FAIL | No ejecutada por falta de entorno de desarrollo confirmado. |
| 6 | Solicitante, aprobador, Finanzas y administrador | FAIL | No ejecutada; faltan identidades/correos de prueba. |
| 7 | Memberships empresariales | FAIL | No ejecutada en Supabase real. |
| 8 | Roles por empresa | FAIL | No ejecutada en Supabase real. |
| 9 | Selector multiempresa | FAIL | Sin sesión real; pruebas UI anteriores con fixtures no satisfacen esta puerta. |
| 10 | CECO raíz e hijo | FAIL | No ejecutada en Supabase real. |
| 11 | Rechazo de ciclo CECO | FAIL | No ejecutada en Supabase real. |
| 12 | Rechazo de padre de otra empresa | FAIL | No ejecutada en Supabase real. |
| 13 | Proyecto/subproyecto | FAIL | No ejecutada en Supabase real. |
| 14 | Importación CSV/XLSX de prueba | FAIL | No ejecutada contra la API conectada al proyecto real. |
| 15 | Preview sin persistencia | FAIL | Pendiente comparar registros y auditoría antes/después en el proyecto real. |
| 16 | Confirmación de importación | FAIL | No ejecutada en Supabase real. |
| 17 | Repetición e idempotencia | FAIL | No ejecutada en Supabase real. |
| 18 | Bloquear usuario con sesión existente | FAIL | Requiere JWT real emitido antes del bloqueo y prueba posterior con el mismo JWT. |
| 19 | Revocar membership con sesión existente | FAIL | Requiere sesión real y comprobación posterior sin renovar JWT. |
| 20 | REST directo a tablas | FAIL | No ejecutada; probar con publishable + JWT de usuario, nunca con secret como sustituto. |
| 21 | Auditoría | FAIL | Pendiente verificar actor, empresa, acción, before/after y ausencia de inserción arbitraria. |
| 22 | SMTP / callback | FAIL | Sin proyecto, SMTP ni buzón de prueba accesible. Requiere entrega real y cambio de contraseña, no sólo respuesta HTTP de recuperación. |
| 23 | Secret ausente en bundle/logs | FAIL | `scripts/check-client-boundary.mjs` terminó correctamente en el bundle local. Falta comparación con la secret real y revisión de logs del entorno de desarrollo. |

## Configuración necesaria para continuar

Usar exclusivamente un proyecto Supabase de **DESARROLLO**, vacío o dedicado a pruebas, confirmado por su propietario. No usar datos de producción. No enviar claves, contraseñas ni enlaces de recuperación en el chat.

1. Crear `.env` local a partir de `.env.example`, completando SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY y APP_ORIGIN; conservar NODE_ENV=development y TRUST_PROXY_HOPS=0 para ejecución local.
2. Para aplicar/verificar migraciones, proporcionar acceso propietario mediante conexión PostgreSQL del proyecto de desarrollo (`SUPABASE_DB_URL` local) o un acceso de gestión equivalente. La secret key de Supabase no sustituye una conexión SQL propietaria ni debe usarse para CRUD corriente.
3. Si se necesita conexión propietaria local, puede guardarse separadamente en `.env.verification.local`, ignorado por Git mediante las reglas `.env.*`. Es una credencial de verificación/migración, no una nueva dependencia del servidor productivo. No imprimirla ni incluirla en reportes.
4. Disponer de un buzón de pruebas con entrega SMTP verificable y definir los correos de las identidades de prueba. Configurar Site URL y el callback de recuperación conforme a [Fase 3](../fase-3/README.md). Confirmar cómo se podrá observar la entrega sin compartir tokens en el chat.
5. Confirmar qué proyecto es exclusivamente de desarrollo y si contiene una instalación previa. Antes de escribir, inspeccionar migraciones/tablas/bootstrap y evitar reinicializaciones destructivas.

La documentación de Fase 3 contiene las instrucciones completas de configuración. No se añadieron claves ni se cambiaron variables del servidor durante este preflight.

## Evidencia a registrar al ejecutar

Para cada prueba: fecha/hora, identificador del caso, entorno de desarrollo, actor de prueba, empresa, resultado esperado/obtenido, códigos HTTP/SQL y referencias a capturas o consultas sanitizadas. Nunca registrar tokens, claves, contraseñas, cadenas de conexión ni enlaces firmados.

En casos negativos, PASS significa rechazo correcto y ausencia de mutación. Ante un fallo inesperado, registrar FAIL real, causa y corrección; repetir el caso y las regresiones afectadas antes de aprobar la puerta. Para revocación/bloqueo, comprobar backend y REST con el mismo JWT previamente emitido.

No asignar todavía permisos nuevos de Fase 4 ni crear sus tablas, RPC, Storage o pantallas. La solicitud de Fase 4 permanece autorizada **condicionada a superar esta puerta**. No se requiere otra aprobación conceptual una vez cumplida; sí se necesita resolver el acceso técnico descrito arriba.
