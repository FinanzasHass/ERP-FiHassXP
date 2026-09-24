# Fase 3 — Interfaz, administración y maestros

Implementación local de React/Vite/TypeScript sobre Express y Supabase. Se conserva la seguridad de Fase 2. **No se inició Fase 4 ni se implementaron operaciones financieras productivas.**

## Interfaz entregada

La interfaz usa una barra lateral verde profundo, encabezado blanco con contexto empresarial, formularios y tablas de administración. El dashboard muestra empresa, colaborador, área y cargo y seis tarjetas sin importes ni conteos ficticios. La identidad visual provisional se denomina NEXO; el proyecto continúa siendo Mini ERP Financiero.

- `/login`: correo o username, contraseña y recuperación, sin registro público.
- `/auth/callback`: verificación explícita del enlace y nueva contraseña; el token del enlace se retira de la URL antes de enviarlo al backend.
- `/app/dashboard`: contexto y tarjetas “No hay datos disponibles todavía”.
- Empresas, áreas, cargos globales/específicos y usuarios: creación/edición/desactivación según permisos existentes. Sin DELETE físico.
- Usuarios: filtros empresariales, área, cargo y estado; información, seguridad, roles, permisos especiales, empresas y actividad. Seguridad permite fijar una contraseña provisional sin persistirla fuera de Supabase Auth, revoca sesiones y exige un único cambio al siguiente ingreso. Cambio de correo permanece separado por su impacto en Auth. La vista de empresas por usuario respeta también el RLS existente.
- Roles: metadata y matriz agrupada con etiquetas legibles, selección/retiro por grupo y marca de permiso sensible. `is_system` no se edita.
- CECO: árbol de profundidad arbitraria, tabla, filtros globales de código/nombre/categoría/estado, categorías configurables, subcentros, vigencias, desactivación e historial auditado.
- Importación CSV UTF-8 o XLSX: lectura en worker, validación, vista previa, errores y confirmación. Componente desacoplado mediante adaptador para futuros maestros.
- Proyectos y subproyectos: tablas, formularios y vista jerárquica. Estados active/inactive/completed/cancelled.
- Monedas: catálogo global PEN/USD inicial, ampliable. Tipo de cambio preparado sólo en base de datos.
- Auditoría: filtros por fecha UTC, actor, empresa, categoría, acción y entidad; detalle antes/después. La categoría financiera exige permiso y empresa.
- Menú y rutas de módulos futuros condicionados por permisos; página “Módulo en preparación”. Los códigos aún no existentes o no asignados no habilitan acceso.
- Sidebar colapsable en escritorio y drawer móvil; tablas con desplazamiento horizontal. Diálogos con foco contenido y cierre por Escape.

Capturas: [login](capturas/login.png), [dashboard](capturas/dashboard-prueba.png), [tablet](capturas/tablet-prueba.png). Las dos últimas muestran **identidades y empresas de un fixture de pruebas**, no datos reales ni un entorno Supabase configurado.

## Estructura añadida y modificada

| Archivos | Responsabilidad |
|---|---|
| `src/client/main.tsx`, `styles.css` | Login, callback, shell, navegación, contexto, dashboard y composición. |
| `src/client/api.ts` | Cliente Express, sesión de pestaña, renovación coordinada y errores legibles. |
| `src/client/catalog.ts` | Campos, columnas, etiquetas, rutas futuras y permisos de navegación. |
| `src/client/components.tsx` | Formularios, tablas, diálogos, filtros y jerarquía de proyectos. |
| `src/client/admin.tsx` | Usuario y accesos, matriz de permisos, auditoría. |
| `src/client/imports.tsx`, `import-parser.ts`, `import-worker.ts` | Adaptador de importación, CSV/XLSX y límites de procesamiento. |
| `src/server/routes/masters.ts` | Validadores estrictos, consulta de maestros y escrituras mediante RPC. |
| Rutas, repositorio y validadores existentes | Login por username, workspace, filtros y paginación. |
| `supabase/migrations/202609090010_phase3_masters.sql` | Seis tablas, permisos, metadata sensible, RLS, reglas CECO y RPC de maestros/workspace/login. |
| `supabase/migrations/202609090011_cost_center_import.sql` | Importación transaccional con previsualización reversible. |
| `supabase/tests/phase3-checks.mjs` | Comprobaciones SQL integradas con regresión Fase 2. |
| `tests/import.test.ts`, ampliación `tests/app.test.ts` | Parser, límites, rutas y autenticación por username. |
| `tests/e2e/`, `playwright.config.ts`, `scripts/e2e.mjs` | Navegador Edge headless, fixtures aislados y capturas. |

No se modificaron las migraciones 001–009. Las dependencias añadidas son ExcelJS y herramientas de prueba/formato. Se fija `uuid` 11.1.1 dentro de ExcelJS mediante override para evitar la versión vulnerable transitiva; se prueba lectura XLSX real en el navegador.

## Tablas y decisiones de modelo

| Tabla | Alcance y controles |
|---|---|
| `cost_center_categories` | Empresa obligatoria, código único por empresa, nombre, descripción, activo y timestamps. Se eligieron categorías empresariales para evitar que un operador cambie categorías de otra empresa. |
| `cost_centers` | Empresa, código, nombre, descripción, categoría/padre nullable, nivel calculado, vigencias, estado, actores y timestamps. FK compuestas y protección de ciclos. |
| `projects` | Empresa, código único, nombre, descripción, estado y fechas coherentes. |
| `subprojects` | FK empresa/proyecto, código único dentro del proyecto, nombre, descripción, estado y timestamps. |
| `currencies` | Catálogo global con código ISO, símbolo, decimales y estado. PEN/USD como datos iniciales. |
| `exchange_rates` | Fecha, par de monedas, compra/venta/contable NUMERIC(24,12), fuente, empresa opcional, timestamp y unicidad incluyendo empresa NULL. Sin integración ni endpoint de escritura. |

`permissions.is_sensitive` es metadata administrada por desarrollo. Los permisos existentes que coinciden con los ejemplos se marcan sensibles; códigos de módulos aún no implementados se marcarán al crearse.

CECO: desactivar un padre con hijos activos falla; primero se desactivan los hijos. Mover un centro recalcula niveles de descendientes bajo bloqueo transaccional. El campo protegido `first_used_at` prepara la inmutabilidad de código/parentesco desde el uso financiero. Ninguna API permite editar ese campo. El futuro módulo financiero deberá marcarlo en la misma transacción del primer uso y añadir la estrategia de versiones históricas aprobada en Fase 2.5 antes de permitir reorganización de centros utilizados. Hoy no existen usos financieros que deban marcarse.

No hay eliminación física expuesta para estos maestros. Los códigos de proyectos, subproyectos y monedas se mantienen estables desde su creación. Los códigos CECO pueden corregirse antes de su primer uso, mediante edición explícita y auditada. Importar nunca renombra códigos: los utiliza como clave de correspondencia exacta.

## Endpoints adicionales

Todos se encuentran bajo `/api`. Las lecturas usan bearer, RLS y permisos; las escrituras de maestros se autorizan nuevamente dentro de la RPC.

| Método/ruta | Contrato |
|---|---|
| GET `/auth/workspace` | Empresas activas con membresía activa del actor, nombre de área y cargo. No lista empresas por rol global. |
| POST `/auth/login` | Se conserva `{email,password}`; `email` admite también username. No devuelve el correo resuelto. |
| GET/POST `/cost-centers?company_id=UUID` | Lista paginada / creación CECO. |
| PATCH `/cost-centers/:id?company_id=UUID` | Edición y estado; empresa contrastada con el registro persistido. |
| GET/POST/PATCH `/cost-center-categories[/:id]?company_id=UUID` | Categorías de la empresa, con permisos cost_center correspondientes. |
| GET/POST/PATCH `/projects[/:id]?company_id=UUID` | Proyectos. |
| GET/POST/PATCH `/subprojects[/:id]?company_id=UUID` | Subproyectos del mismo ámbito empresarial que su proyecto. |
| GET/POST/PATCH `/currencies[/:id]` | Catálogo global, sin contexto empresarial. |
| POST `/cost-centers/import` | `{company_id, rows, commit, update_existing}`. Máximo 200 filas y 256 KB JSON. |

Las rutas de Fase 2 permanecen en [endpoints existentes](../endpoints.md). `/users` añade filtros company_id/area_id/position_id/status; `/audit` añade from/to/action/entity_type/entity_id. Maestros soportan paginación y filtros específicos. El filtro rápido identificado “en esta página” es local; “Aplicar filtros globales” consulta al servidor.

### RPC y funciones

- `master_save(kind,target_id,target_company,payload)`: allowlist de entidad/campos, permiso create/edit y disable para cambios de estado, persistencia y auditoría atómicas. No acepta una tabla arbitraria.
- `import_cost_centers(target_company,rows,commit_batch,update_existing)`: misma autorización y reglas que edición individual; ordena dependencias padre/hijo y devuelve resultados por lote.
- `my_workspace()`: sólo contexto del actor autenticado y activo.
- `resolve_login_username(login_name)`: **únicamente rol backend privilegiado**, nunca anon/authenticated. Uso estrecho en login, bajo rate limit. No es una consulta pública de correos ni cliente CRUD genérico.
- Funciones privadas `guard_cost_center()` y `refresh_center_levels()`: restricciones de jerarquía y niveles.

## Seguridad conservada

`auth.uid()`, sesión vigente, profile activo, membership y permisos siguen resolviéndose en BD. Una empresa seleccionada es sólo preferencia UI; cambiarla retira la vista y vuelve a obtener capacidades. El contexto también se revalida al enfocar la ventana y periódicamente. Las operaciones siempre vuelven a verificar autorización aunque la pantalla aún muestre un botón antiguo.

La sesión usa memoria y `sessionStorage` de la pestaña para soportar recarga; no se guardan roles ni permisos como autoridad. `localStorage` contiene únicamente la preferencia de empresa por usuario. Mantener CSP y evitar scripts de terceros sigue siendo necesario, dado que las credenciales de una SPA son accesibles al JavaScript del mismo origen.

La secret key permanece aislada en backend. La excepción nueva es exclusivamente resolver username para el flujo de autenticación; los maestros utilizan el cliente request-scoped con publishable key y JWT. No hay claves en frontend/shared/bundle. No se abrió escritura anónima a auditoría.

Se mantienen bloqueo de autoasignación, modificación de grants de rol propio, códigos de sistema y último administrador. La aprobación independiente de accesos sensibles continúa pendiente de fase posterior, tal como se solicitó.

No se asignan automáticamente permisos nuevos a System Administrator ni a roles financieros. Para operar maestros empresariales, el administrador configura un rol de operador y lo asigna a **otro usuario** con membership en la empresa. Monedas usa permisos globales; un rol exclusivamente empresarial no concede administración del catálogo global.

## Importación CECO

1. Crear previamente las categorías necesarias para la empresa; la columna `category` contiene su **código**, no texto libre.
2. Descargar plantilla CSV y completar company_code, code, name, parent_code, category, description, active. Usar la primera hoja para XLSX.
3. Seleccionar el archivo: máximo 2 MB, 200 filas de datos. Se rechazan fórmulas XLSX, encabezados desconocidos y estados inválidos. La lectura ocurre en un worker que se termina si excede 15 segundos.
4. Validar y previsualizar. La BD ensaya las mismas escrituras dentro de una subtransacción y las revierte, incluyendo auditoría. No persisten cambios en preview.
5. Revisar errores por fila y cantidades previstas. Padres pueden aparecer después de hijos; ciclos, padres inexistentes, empresas incorrectas y duplicados bloquean el lote.
6. Códigos existentes idénticos se ignoran. Diferencias requieren marcar explícitamente actualización; se exigen los permisos de edición/estado correspondientes.
7. Confirmar. La BD vuelve a validar contra el estado vigente. Un error revierte **todo** el lote; en ese caso los contadores describen el intento, no filas persistidas. Un reintento idéntico ignora filas ya existentes.

## Ejecución local

Requiere **Node 24.18.0** activo en PATH, npm y un proyecto Supabase configurado. La clave se introduce sólo en `.env`, nunca en archivos compartidos.

```powershell
node --version
npm ci
Copy-Item .env.example .env
# Completar .env con las variables descritas abajo.
npm run build
npm run dev
```

Abrir `http://localhost:3000/login`. Express sirve el frontend compilado y `/api`; `/health` permanece público. Para probar el servidor compilado: `npm start` después de build.

Opcionalmente, con API local en puerto 3000 y APP_ORIGIN=http://localhost:3000, ejecutar en otra terminal `npm run dev:client`; Vite ofrece recarga del frontend y proxy local a la API. La recuperación de correo vuelve al origen Express configurado.

Variables: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `PORT=3000`, `NODE_ENV=development`, `APP_ORIGIN=http://localhost:3000`, `TRUST_PROXY_HOPS=0`. No se necesitan variables VITE ni credenciales Supabase en el cliente.

## Configurar Supabase

1. En el proyecto Supabase, confirmar que están aplicadas las migraciones 001–009 de Fase 2. **No volver a ejecutar bootstrap en un proyecto ya inicializado.**
2. Aplicar, en orden, `202609090010_phase3_masters.sql` y `202609090011_cost_center_import.sql` como propietario mediante SQL Editor o el flujo de migraciones existente. Cada archivo contiene transacción. En un proyecto nuevo se aplican 001–011, en orden, antes del bootstrap.
3. Verificar RLS en las seis tablas nuevas; authenticated tiene SELECT protegido y ejecución de las RPC, no INSERT/UPDATE/DELETE directo. La función resolve_login_username no está concedida a anon/authenticated.
4. En Project Settings → API Keys, obtener publishable y secret actuales. Completar `.env` backend; nunca copiar la secret a Vite ni al navegador.
5. En Auth, mantener deshabilitado registro público, proveedor email habilitado y SMTP configurado. Configurar Site URL como origen de la aplicación y permitir exactamente su `/auth/callback` en Redirect URLs, tanto local como producción cuando corresponda.
6. Configurar plantilla Recovery con enlace `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery`. Para invitación, si se utiliza ese flujo, `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite`. El usuario confirma la verificación desde la página; no se consume el enlace automáticamente al cargarlo. Referencia: [plantillas oficiales Supabase](https://supabase.com/docs/guides/auth/auth-email-templates).
7. Sólo en instalación nueva: crear la primera identidad administradora en Auth, copiar su UUID y completar los tres marcadores de `supabase/bootstrap.sql`. No incluir contraseñas en SQL. El bootstrap tiene protección contra repetición.
8. Ingresar con administrador. Crear empresas y usuario operador desde UI; activar su profile después de revisar sus datos. Completar contraseña mediante recuperación de correo según la configuración Auth. La provisión existente no equivale a envío automático de una invitación.
9. Asignar al operador membership de empresa; crear rol de maestros, configurar permisos cost_center/project/subproject necesarios y asignarlo con alcance de esa empresa. Para monedas, usar asignación global con currency.view/create/edit/disable a un usuario autorizado. Respetar las prohibiciones de autoasignación.
10. Entrar con el operador y realizar el recorrido de verificación. Si un administrador necesita membership o permisos para sí mismo, otro administrador debe asignarlos; no se introduce una excepción desde UI.

## Render

Se mantiene un solo Web Service y `render.yaml`:

1. Conectar el repositorio al servicio Node o aplicar el blueprint existente.
2. Node: 24.18.0. Build: `npm ci && npm run build`. Start: `npm start`. Health Check: `/health`.
3. Establecer APP_ORIGIN al origen HTTPS exacto del servicio; NODE_ENV=production y TRUST_PROXY_HOPS=1 para la topología prevista de un único ingress Render.
4. Añadir las tres variables Supabase en configuración backend del servicio. Las claves no deben aparecer en build output ni logs.
5. Aplicar migraciones en Supabase **antes** de desplegar el frontend que las usa. Configurar SMTP/callback para el dominio de Render.
6. Express usa PORT suministrado por Render y bind 0.0.0.0. Comprobar `/health`, `/login`, recarga de `/app/cost-centers` y callback.
7. `/api/inexistente`, `/health/inexistente` y `/assets/inexistente.js` deben responder 404; el fallback SPA tiene rutas conocidas explícitas.

No se desplegó un servicio ni se modificó un proyecto Supabase remoto durante esta entrega.

## Pruebas y verificación

```powershell
npm run typecheck
npm run build
npm test
npm run test:db
npm run test:e2e
npm run test:integration
```

`test:db` usa PGlite con roles/sesiones Auth simulados; puede usar TEST_DATABASE_URL apuntando **exclusivamente a una BD de prueba vacía**. `test:e2e` necesita Microsoft Edge instalado y puerto 3100 libre; usa fixtures de API en el navegador, sin credenciales ni datos productivos. Puede seleccionarse otro canal Playwright instalado mediante E2E_BROWSER_CHANNEL. `test:integration` requiere las variables de prueba Supabase de Fase 2; no se considera aprobado si está omitido por falta de configuración.

Verificado en esta implementación:

- Compilación servidor/cliente, Vite y separación de secretos del bundle.
- 20 pruebas HTTP/servicios/parser: incluye username, perfil bloqueado, contratos maestros, contexto, validación, CSV y seguridad de Fase 2.
- 26 comprobaciones SQL: regresión Fase 2 más maestros, CECO, subcentros, ciclos, empresa ajena, desactivación, historial, preview reversible, lotes duplicados/padres ausentes, proyectos/subproyectos y revocación.
- 6 pruebas de navegador: login, empresa/guards, bloqueo, subcentro/importación CSV, matriz/auditoría, responsive y XLSX con rechazo de fórmulas.
- Auditoría de paquetes sin vulnerabilidades reportadas al revisar esta entrega.

Recorrido manual con Supabase real: crear CECO raíz/hijo; intentar ciclo y padre de otra empresa; comprobar permisos de editar/desactivar; importar preview y verificar que no persiste; confirmar y repetir; probar lote mixto inválido; crear proyecto/subproyecto; revisar auditoría antes/después; cambiar empresa; revocar membership con sesión abierta y comprobar rechazo inmediato en backend; comprobar perfil blocked y recuperación SMTP; intentar REST directo sobre tablas y verificar denegación.

## Pendientes y límites explícitos

- Falta ejecutar el recorrido contra las credenciales/proyecto Supabase real y verificar entrega SMTP. Las pruebas UI usan mocks y las SQL simulan Auth; no sustituyen esa integración.
- Configurar razones sociales, usuarios, categorías y grants reales. No se inventaron datos empresariales ni financieros para seeds.
- Tipos de cambio sólo tienen estructura. No existe consulta externa, cálculo financiero ni escritura de tasas desde UI.
- Versionado histórico completo de jerarquías/dimensiones y marca de primer uso deben integrarse antes del primer módulo financiero productivo.
- Doble aprobación de asignaciones sensibles permanece posterior. La protección de autoasignación actual no elimina por sí sola la posibilidad de colusión entre administradores.
- Nuevos adaptadores de importación (cuentas, terceros, activos), módulos financieros y Fase 4 no iniciados.
