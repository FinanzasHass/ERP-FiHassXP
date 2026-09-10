# Mini ERP Financiero — Fase 3

**Puerta 3.1:** [resultados actuales contra Supabase DEV real](docs/fase-3.1/resultado-dev.md). La matriz vigente distingue PASS, FAIL y BLOCKED_EXTERNAL; Fase 4 no iniciada. El preflight anterior se conserva sólo como histórico.

**Interfaz y maestros implementados.** [Entrega de Fase 3, capturas, endpoints, migraciones, pruebas e instrucciones Supabase/Render](docs/fase-3/README.md).

[Fase 2.5: diseño del ERP y sustitución progresiva de Ábasoft](docs/fase-2.5/README.md). Incluye modelos, diagramas, workflows, migración y roadmap; no implementa módulos financieros.

API de autenticación, autorización y administración, frontend React/Vite, selector de empresa, CECO/importación, proyectos/subproyectos, monedas y auditoría. Sin módulos financieros operativos ni contabilidad. **Fase 4 no iniciada.** La base de seguridad de Fase 2 se mantiene; para instalar o actualizar use las instrucciones de Fase 3 enlazadas arriba.

## Implementación

- Express + TypeScript, Supabase Auth/PostgreSQL, un Web Service Render.
- Node exactamente **24.18.0**, .node-version, engines y control de runtime.
- Nuevas claves SUPABASE_PUBLISHABLE_KEY y SUPABASE_SECRET_KEY; sin nombres legacy en configuración ejecutable.
- JWT validado con Supabase getUser; profile activo y sesión Auth vigente; RLS y RPC vuelven a comprobar permisos.
- Roles/overrides globales o por empresa; membership activo obligatorio para contexto empresarial.
- Asignación de rol existente requiere role.assign; configurar grants/overrides requiere permission.assign. Asignar no concede capacidad de ejecutar al administrador.
- Auditoría de cambios atómica; login exitoso mediante función exclusiva del backend, sin RPC anónima de auditoría.
- Provisión idempotente con UUID reservado y recuperación por reintento; sincronización controlada de correo Auth/profile.

[Modelo y decisiones de seguridad](docs/arquitectura.md) · [Endpoints y RPC](docs/endpoints.md) · [Verificación y límites](docs/fase-2.md).

## Archivos

```text
src/server/
  app.ts, index.ts
  config/env.ts
  routes/api.ts
  controllers/admin.ts
  middleware/auth.ts, errors.ts
  repositories/session-repository.ts
  services/authentication.ts, permissions.ts, provisioning.ts
  integrations/supabase/auth-admin.ts
  validators/index.ts
src/shared/contracts.ts
src/client/                          # login, layout, paneles, maestros e importaciones
supabase/migrations/                 # 001–009
supabase/bootstrap.sql
supabase/tests/phase2.test.mjs, concurrency.test.mjs
supabase/tests/foundation.test.mjs    # regresión histórica de Fase 1
scripts/check-runtime.mjs, check-client-boundary.mjs
tests/app.test.ts, integration/supabase.test.ts
package.json, package-lock.json, tsconfig*.json, vite.config.ts
.node-version, .env.example, render.yaml
```

## Variables necesarias

| Variable | Uso |
|---|---|
| SUPABASE_URL | URL HTTPS del proyecto |
| SUPABASE_PUBLISHABLE_KEY | sb_publishable_...; clientes por request y Auth normal |
| SUPABASE_SECRET_KEY | sb_secret_...; sólo módulo privilegiado backend |
| APP_ORIGIN | Origen exacto, sin slash final; http://localhost:3000 local, HTTPS en Render |
| PORT | Puerto local 3000; en Render lo suministra la plataforma |
| NODE_ENV | development / production |
| TRUST_PROXY_HOPS | 0 local; 1 para un único ingreso Render, sin otro proxy intermedio |

La secret key nunca se envía a cliente, shared, respuestas, logs ni auditoría. No crear variables VITE_* con secretos. El build no carga .env para frontend y verifica la separación del bundle. Los tokens Auth se conservan en memoria/sessionStorage de la pestaña, nunca en logs. La preferencia de empresa en localStorage no autoriza operaciones.

## Configuración exacta de Supabase

1. Crear un proyecto de **desarrollo**. En Settings > API Keys crear/obtener publishable y secret keys nuevas. Copiarlas sólo al entorno local/Render correspondiente. No pegar claves en conversaciones.
2. En Authentication > configuración de registro desactivar **Allow new users to sign up** y acceso anónimo. Mantener sólo el proveedor email necesario. No crear registro público en la aplicación ni activar proveedores que creen usuarios fuera del flujo administrativo.
3. En Authentication > URL Configuration definir Site URL igual a APP_ORIGIN y permitir exactamente `http://localhost:3000/auth/callback` en desarrollo y el callback HTTPS de producción cuando exista. No usar comodines en producción.
4. Configurar SMTP propio y verificar remitente/entrega. Configurar política de contraseña compatible con mínimo 12 caracteres. Usar access tokens de duración corta, por ejemplo 15 minutos; la aplicación además verifica revocación de sesión y profile actual.
5. Ejecutar SQL versionado en orden desde Supabase SQL Editor como propietario, o mediante Supabase CLI con historial de migraciones. Nueva instalación: **001 a 011**. Si Fase 2 ya se aplicó: ejecutar sólo **010 y 011**. No repetir migraciones ni bootstrap de una instalación existente.
6. En Data API mantener public expuesto y **private fuera de los esquemas expuestos**. No agregar grants de escritura a authenticated/anon y no abrir RLS para corregir errores de aplicación.
7. Crear/invitar el primer usuario desde Authentication > Users. Completar confirmación normalmente. Copiar su UUID y sustituir los tres marcadores en `supabase/bootstrap.sql` (UUID, username, nombre). Ejecutar como propietario. El correo se obtiene de auth.users; no se insertan contraseñas en SQL. Bootstrap rechaza una segunda inicialización.
8. Copiar .env.example a .env y completar variables. El administrador inicial puede crear empresas por API y asignarlas a otros usuarios. Para asignarse una empresa a sí mismo se requiere otro administrador autorizado: no hay autoasignación de seguridad.
9. Para recuperación/activación, configurar la plantilla **Reset Password** con enlace `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery`. El callback de Fase 3 permite verificar el enlace explícitamente y fijar contraseña mediante los endpoints Auth existentes. No difundir ese enlace ni guardarlo en logs.
10. Verificar reglas usando el procedimiento de abajo antes de utilizar datos reales. La integración de Auth, SMTP y gateway Supabase requiere un proyecto real; no fue ejecutada en esta entrega porque no se proporcionaron sus credenciales.

**Actualización desde datos previos:** 005 rechaza asignaciones financieras heredadas cuyo alcance empresarial sea ambiguo; hay que preparar una migración explícita de esas asignaciones. No adivina ni amplía su alcance. Una instalación de fase 1 con sólo el seed y el administrador técnico migra directamente. 003 también rechaza ciclos previos de jefatura.

## Ejecución local

Con Node 24.18.0 instalado/seleccionado:

```powershell
node --version
npm ci
Copy-Item .env.example .env
# Completar .env localmente antes de iniciar.
npm run build
npm run dev
```

Servidor en `http://localhost:3000`; `GET /health` comprueba proceso activo. Para ejecutar el build local con .env:

```powershell
node --env-file=.env dist/server/index.js
```

`npm start` se usa en Render con variables ya inyectadas. El desarrollo de esta entrega utilizó un Node 24.18.0 aislado en `.tools` (ignorado por Git); no cambió Node global. Ese directorio es sólo una herramienta local, no dependencia de despliegue.

## Primer recorrido de API

Ejemplo PowerShell; las credenciales se piden interactivamente y los tokens se conservan en variables, sin imprimirlos:

```powershell
$erpEmail = Read-Host 'Correo del administrador'
$erpPassword = Read-Host 'Contraseña' -AsSecureString
$erpLoginBody = @{
  email = $erpEmail
  password = [System.Net.NetworkCredential]::new('', $erpPassword).Password
} | ConvertTo-Json
$erpSession = Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/api/auth/login' -ContentType 'application/json' -Body $erpLoginBody
$erpHeaders = @{ Authorization = 'Bearer ' + $erpSession.access_token }
Invoke-RestMethod -Uri 'http://localhost:3000/api/auth/me' -Headers $erpHeaders
```

Crear una empresa con POST /api/companies y body `{"legal_name":"Razón social real","code":"EMP_A","tax_id":"Identificador real","country_code":"PE"}`. No hay empresas ficticias en el seed.

Crear usuario con POST /api/users, Idempotency-Key UUID y body `{ "email":"correo real", "username":"usuario", "full_name":"Nombre completo", "status":"active" }`. No enviar contraseña. Por seguridad el estado por defecto es inactive; active debe ser explícito. Reintentar con **la misma clave y el mismo body** si falla Auth o la finalización DB. El alta crea Auth sin password/confirmación manual y después profile; nunca entrega contraseñas.

Después, usar POST /api/auth/recover con su correo para que reciba instrucciones de acceso. El envío depende de SMTP y no está ligado a una transacción DB; la respuesta 202 no acredita entrega. El interesado intercambia el token de correo en /auth/verify y establece su contraseña en /auth/password. No devolver ni imprimir enlaces de acceso desde el backend administrativo.

Asignar membership con PUT /api/users/:id/companies `{ "company_id":"UUID", "active":true }`. Configurar un rol mediante PUT /api/roles/:id/permissions `{ "permission_ids":["UUID permiso existente"] }`. Asignarlo con PUT /api/users/:id/roles `{ "role_id":"UUID", "company_id":"UUID empresa", "assign":true }`. El administrador técnico no necesita payment.execute para asignarlo a terceros.

## Migraciones adicionales

- **005_company_scoped_rbac:** membership activo, IDs y unicidad NULLS NOT DISTINCT en asignaciones, contexto empresarial de roles/overrides, resolver y helpers de seguridad.
- **006_administration_rpc:** RPC de metadata, perfiles, grants, roles, overrides, membresías y settings; auditoría con motivo.
- **007_provisioning_auth_audit:** reserva idempotente, finalización de profile, sincronización Auth y auditoría de éxito exclusiva de backend.
- **008_identity_change_guards:** preparación de cambio de email con actor y caducidad, sesión Auth vigente para RLS/permisos.
- **009_profile_status:** estado de usuario con user.disable sin exigir user.edit.

Todas se ejecutan en transacciones; no se aplican automáticamente durante el arranque del servidor.

## Pruebas

```powershell
npm run build
npm test
npm run test:db
npm run test:integration
```

- HTTP/servicios: 16 pruebas con proveedor Auth simulado; no se presentan como pruebas de firma JWT real.
- DB actual: 18 comprobaciones ejecutadas tanto en PostgreSQL embebido como en PostgreSQL 18.4 local real, bajo Node 24.18.0.
- Concurrencia real: dos comprobaciones aprobadas (jefatura y administradores).
- Build TypeScript/Vite y examen de bundle sin secret key.
- Integración Supabase alojado: se omite explícitamente sin variables de prueba; omisión no significa aprobación.

Para la prueba real contra Supabase, usar un usuario de prueba con payment.execute en Empresa A y sin ese permiso en B. Definir SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, TEST_USER_ACCESS_TOKEN, TEST_COMPANY_A y TEST_COMPANY_B en el entorno, y ejecutar npm run test:integration. Nunca versionar ni mostrar el token.

Pruebas locales PostgreSQL multiconexión: usar **sólo una base temporal vacía**, con rol propietario, definir TEST_DATABASE_URL y ejecutar `node supabase/tests/phase2.test.mjs`, luego `npm run test:concurrency`. El fixture crea roles/esquemas Auth simulados y datos de prueba: **no ejecutarlo contra el proyecto Supabase ni una base con datos**. El entorno local usado escuchó exclusivamente 127.0.0.1; se detiene tras las pruebas.

## Render

1. Subir este proyecto a un repositorio GitHub sin .env, .tools ni node_modules.
2. Crear un único Web Service mediante render.yaml o configurar manualmente: Node 24.18.0; build `npm ci && npm run build`; start `npm start`; health `/health`.
3. Completar claves y APP_ORIGIN HTTPS en Render. PORT lo suministra Render y Express escucha `0.0.0.0`.
4. TRUST_PROXY_HOPS=1 sólo para un ingreso Render. Verificar topología antes de añadir CDN/proxies; no usar trust proxy=true indiscriminadamente.
5. Aplicar migraciones antes del despliegue, configurar callback Supabase del dominio y verificar `/health`, `/api/auth/me`, archivos estáticos y 404 reales.

Fallback SPA limitado a `/` y `/auth/callback`. Nunca captura `/api/*`, subrutas `/health`, archivos inexistentes ni URLs desconocidas. El rate limiter es en memoria para una única instancia; para múltiples instancias se necesita almacenamiento compartido.

## Pendiente / límites

- Configurar y probar Supabase real, entrega SMTP, recuperación inicial y Render. No se desplegó ni se creó un repositorio remoto.
- Paneles, selector y callback están implementados en Fase 3. La integración remota/SMTP debe verificarse con las credenciales reales.
- Un rol global financiero o un ALLOW global, asignados explícitamente con company_id=NULL, abarcan todas las empresas activas autorizadas del usuario. Usar company_id para asignaciones financieras normales.
- React/Vite sólo verifica el empaquetado; el modelo no incluye pagos, facturas, órdenes, viáticos, DJ, reembolsos, cuentas por pagar ni contabilidad.
- Los delegadores pueden conceder poderes a terceros; los controles de autoedición no impiden colusión. No se añadió doble aprobación sin una decisión funcional.
- Una provisión interrumpida conserva un trabajo pending y quizá una identidad Auth sin profile; permanece sin acceso. Se recupera con el mismo Idempotency-Key. No se borra automáticamente una identidad ante errores ambiguos, porque otro reintento podría haber completado el alta. Limpieza excepcional de reservas abandonadas requiere revisión del operador.
- Cambio de email de profiles existentes pasa por la API administrativa; el trigger rechaza cambios Auth fuera de una intención autorizada reciente. La UI conserva el bloqueo de cambio propio de identidad.

Referencias: [API keys Supabase](https://supabase.com/docs/guides/getting-started/api-keys), [Auth Admin createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser), [Express y proxies](https://expressjs.com/en/guide/behind-proxies/), [Node 24.18.0 LTS](https://nodejs.org/en/blog/release/v24.18.0).

