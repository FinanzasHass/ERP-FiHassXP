# Fase 2 — implementación y verificación

Registro histórico de la entrega de Fase 2. La implementación posterior de interfaz y maestros está en [Fase 3](fase-3/README.md).

Implementada localmente, sin iniciar paneles de Fase 3. El [README](../README.md) contiene archivos, variables, instalación Supabase, comandos y límites; [endpoints.md](endpoints.md) documenta contratos y permisos.

## Validación realizada

- Node 24.18.0 aislado y exactamente fijado; build TypeScript servidor/cliente y Vite.
- 16 pruebas HTTP/servicios/SDK y separación de secretos; Auth externo simulado.
- 18 comprobaciones del modelo actual en PostgreSQL embebido y PostgreSQL 18.4 real local.
- 2 pruebas multiconexión reales: jerarquía sin ciclos y preservación de administrador efectivo.
- Arranque del servidor compilado: /health y React static respondieron correctamente usando PORT y bind 0.0.0.0. Proceso y base temporal detenidos al concluir.
- npm audit --omit=dev: cero vulnerabilidades reportadas para dependencias de producción al verificar esta entrega.
- Suite real Supabase preparada, omitida si no se proveen variables. No se presenta como aprobada.

## Recorrido de aceptación con Supabase configurado

1. Aplicar migraciones 001–009 (o sólo 005–009 tras Fase 1) y bootstrap. Deshabilitar registro público y configurar SMTP/callback.
2. Iniciar API y verificar /health. Sin bearer, /api/users responde 401. Login con administrador devuelve sesión y evento authentication/login.success sin token en audit_logs.
3. Crear empresas A/B y usuarios de prueba Sandra/Gianella. Completar acceso por correo. Asignar membership Sandra-A; Gianella-A y Gianella-B.
4. Configurar Tesorería con payment.execute; Auditor con payment.view. Asignar Sandra-Tesorería-A; Gianella-Tesorería-A y Gianella-Auditor-B.
5. Con token de Sandra, has_permission(payment.execute,A)=true y B=false; sin company_id=false. Con Gianella, execute A=true/B=false y view B=true.
6. Retirar rol empresarial de Gianella: desaparece su grant en esa empresa. Revocar membership de Sandra: todas sus capacidades en A desaparecen sin renovar JWT. Asignar rol sin membership activo falla con 409.
7. Asignar a un usuario sólo role.assign: puede asignar roles configurados a terceros sin permission.assign, pero no cambiar grants. Con sólo permission.assign puede configurar grants/overrides, pero no asignar roles. Ninguno obtiene payment.execute automáticamente.
8. Crear DENY global y ALLOW A del mismo permiso: DENY vence. Retirar DENY con inherit y motivo restaura herencia. Ver actor, empresa, before/after y motivo en auditoría.
9. Intentar autoasignación, cambiar grants de rol propio, enviar is_system, renombrar código sistema, escribir permissions o audit_logs directamente: denegado. Acceso REST directo a RPC también vuelve a verificar actor y permisos.
10. Cambiar profile a inactive con un token aún válido: HTTP 403. Logout revoca sesión; RLS/permisos dejan de autorizar el token anterior.
11. Probar reintento de POST /users con mismo Idempotency-Key y payload: misma identidad. Cambiar payload conservando clave: 409. Si Auth/DB interrumpen el flujo, reintentar la misma reserva; no borrar identidades a ciegas.
12. Cambiar correo por endpoint administrativo y verificar Auth/profile y evento con actor. El trigger bloquea cambios externos sin intención autorizada reciente.
13. Probar /assets/inexistente.js, /api/inexistente y /health/inexistente: 404 auténticos, nunca SPA. Verificar trust proxy con la topología real Render antes de atribuir IP.
14. Ejecutar npm run test:integration con usuario de prueba y empresas. Verificar entrega de recuperación SMTP y aplicar contraseña; callback interactivo pendiente de Fase 3.

## Fase 3 no iniciada

No se desarrollaron login visual, paneles, menú dinámico, selector de empresas ni formularios. La página React mínima sólo verifica empaquetado/servicio static. No hay pagos, facturas, órdenes, viáticos, DJ, reembolsos ni cuentas por pagar.
