# API y RPC de Fase 2

Contratos base conservados. Los endpoints y RPC adicionales de maestros, importación y workspace están documentados en [Fase 3](fase-3/README.md).

Base `/api`. Bearer access token de Supabase, salvo login/refresh/recover/verify. No cookies de autenticación ni registro público. Respuestas JSON, mutaciones sin contenido 204, creación 201. `Cache-Control: no-store`. Validación estricta rechaza propiedades desconocidas.

## Autenticación

| Método y ruta | Entrada / comportamiento |
|---|---|
| GET /health | Público, `{"status":"ok"}`; disponibilidad del proceso, no prueba conexión a Supabase |
| POST /api/auth/login | email, password; devuelve access_token, refresh_token, expires_in tras verificar profile activo y registrar éxito |
| POST /api/auth/refresh | refresh_token; renueva tokens y revalida profile |
| POST /api/auth/recover | email; respuesta uniforme 202, envío por Supabase Auth/SMTP |
| POST /api/auth/verify | token_hash, type invite/recovery; intercambio OTP y profile activo |
| POST /api/auth/password | Bearer; password de 12–128 caracteres; actualiza en Supabase Auth |
| POST /api/auth/logout | Bearer; cierre global de sesiones del usuario |
| GET /api/auth/me | Bearer; company_id opcional; devuelve profile y permisos efectivos para ese contexto |
| GET /api/auth/companies | Bearer; membresías activas propias, paginadas |

El access token no basta si la sesión fue revocada, el profile se bloqueó o la membresía dejó de estar activa. El éxito se audita una vez por sesión Auth, desde backend, con IP derivada del proxy configurado. user_agent se deja NULL: no se presenta un header del cliente como dato confiable. Fallos de login permanecen en logs de Supabase Auth. No hay endpoint de libre escritura de auditoría.

## Administración

| Método y ruta | Permiso / entrada |
|---|---|
| GET /users, GET /users/:id | user.view |
| POST /users | user.create; header Idempotency-Key UUID; email, username, full_name, status opcional (inactive), area_id/position_id/manager_id opcionales |
| PATCH /users/:id | user.edit; campos de profile excepto email; status además requiere user.disable; cambios organizacionales propios prohibidos |
| PUT /users/:id/status | user.disable; status active/inactive/blocked; nunca sobre sí mismo |
| PATCH /users/:id/email | user.edit; email; cambio ajeno preparado en DB, aplicado con Auth Admin y sincronizado por trigger |
| GET /users/:id/roles | user.view |
| PUT /users/:id/roles | role.assign; role_id, company_id UUID o NULL explícito, assign boolean |
| GET /users/:id/companies | company.assign |
| PUT /users/:id/companies | company.assign; company_id, active boolean; sin autoasignación |
| GET /users/:id/overrides | permission.assign |
| PUT /users/:id/overrides | permission.assign; permission_id, company_id UUID o NULL explícito, effect allow/deny/inherit, reason obligatorio |
| GET /areas, /positions, /companies, /roles | area.view / position.view / company.view / role.view |
| POST /areas, /positions, /companies, /roles | permiso .create correspondiente; metadata de entidad |
| PATCH /areas/:id, /positions/:id, /companies/:id, /roles/:id | permiso .edit; cambio active en maestros requiere también .disable; active de roles requiere permission.assign |
| GET /permissions | role.view; sólo catálogo, sin POST/PATCH/DELETE |
| GET /roles/:id/permissions | role.view |
| PUT /roles/:id/permissions | permission.assign; permission_ids UUID[] reemplaza los grants; arreglo vacío retira todos |
| GET /audit | audit.view para categorías técnicas; category=finance exige company_id y audit.finance_view en esa empresa |
| GET /settings, PATCH /settings | settings.manage; sólo system_name y timezone |

Las rutas de esta tabla son relativas a `/api`. Listados: page >=1, limit 1–100 (default 25), company_id/user_id cuando corresponda; auditoría permite category. La DB vuelve a filtrar mediante RLS. No hay eliminación física de usuarios/áreas/cargos/empresas/roles por API. Retiro de rol elimina únicamente el vínculo y audita; retiro de membership marca active=false y conserva las asignaciones, que quedan sin efecto hasta reactivar membership.

Metadata permitida:
- Área: name, code, description, active.
- Cargo: name, area_id nullable, description, hierarchy_level nullable, active.
- Empresa: legal_name, code, tax_id, country_code de dos letras, active.
- Rol: name, code, description, active. Nunca is_system; el código de un rol sistema está protegido.

## RPC

Ejecutables sólo por authenticated, siempre revalidan actor y permiso dentro de DB:

| RPC | Responsabilidad |
|---|---|
| has_permission(permission_code,company_id) | Resolver empresa y permisos; variante de un argumento sólo para contexto global |
| has_company_access(target_company) | Profile, sesión, membership y empresa activos |
| effective_permissions(company_id) | Catálogo efectivo del actor |
| session_is_active() | Booleano de la sesión propia; no expone auth.sessions |
| admin_save_entity(entity_kind,entity_id,payload) | Metadata de área/cargo/empresa/rol; entity_id NULL crea |
| admin_update_profile(target_user,payload) | Edición organizacional/profile |
| admin_set_profile_status(target_user,new_status) | Estado de acceso |
| admin_set_user_role(target_user,target_role,target_company,assign) | Asignar/retirar rol configurado, sólo role.assign |
| admin_set_role_permissions(target_role,permission_ids) | Configurar grants, sólo permission.assign |
| admin_set_override(target_user,target_permission,target_company,new_effect,change_reason) | Excepción scoped/global con motivo |
| admin_set_membership(target_user,target_company,is_active) | Membresía activa/inactiva |
| admin_update_settings(payload) | Configuración permitida |
| begin_user_provisioning(idempotency_key,payload) | Reserva idempotente ligada a actor y payload |
| finish_user_provisioning(idempotency_key) | Crea profile sólo para UUID/correo Auth reservados |
| prepare_email_change(target_user,new_email) | Autoriza cambio Auth de correo por diez minutos |

`record_authentication_success(verified_user,verified_session,remote_ip)` es una excepción privilegiada estrecha: **sin EXECUTE para anon/authenticated**, sólo rol PostgreSQL service_role usado internamente por la nueva secret key. Verifica sesión Auth real y profile activo; fija acción/categoría y no acepta resultado ni texto libre. El nombre de ese rol PostgreSQL no implica usar una API key legacy.

No se expone el esquema private. No conceder permisos directos de escritura a tablas para resolver errores del cliente.

## Errores

401: credenciales/token inválidos; 403: profile inactivo, permiso o empresa denegados; 400: payload inválido; 404: entidad/ruta inexistente; 409: integridad, conflicto idempotente o bloqueo que exige reintento; 413: payload excedido; 429: límite de solicitudes; 503: proveedor/DB/auditoría no disponible. Sin stack, consultas SQL ni respuestas SDK crudas.
