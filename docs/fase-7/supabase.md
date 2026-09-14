# Configuración y verificación DEV

Node debe ser exactamente **24.18.0**. Mantener las variables existentes: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `APP_ORIGIN`, `PORT`, `NODE_ENV`, `TRUST_PROXY_HOPS` y claves de cifrado versionadas `ATTACHMENT_ENCRYPTION_KEY_V1`/versiones posteriores con `ATTACHMENT_ENCRYPTION_ACTIVE_VERSION`. No crear variables `VITE_*` con secretos ni publicar `.env`.

1. Usar el proyecto Supabase DEV ya vinculado. No repetir bootstrap ni sustituir 001–032 publicadas. Mantener buckets privados, Auth y callback existentes; no corregir SMTP dentro de esta fase.
2. Confirmar que el hostname de `SUPABASE_URL` coincide con `supabase/.temp/project-ref`. El helper registra únicamente una huella del proyecto, nunca credenciales.
3. Ejecutar `npm ci`, `npm run typecheck` y `npm test` con Node requerido. El harness SQL es destructivo para su base de fixtures: **nunca** apuntar `TEST_DATABASE_URL` a Supabase ni a una base compartida.
4. En Windows con PostgreSQL 18 instalado en su ruta estándar, ejecutar `npm run test:phase7:postgres`. Usa exclusivamente un clúster loopback desechable. Conserva resultado, casos y hashes de migraciones. En el entorno Codex esa operación requiere el permiso de ejecución local concedido al proceso PostgreSQL.
5. Ejecutar `npm run verify:phase7:local`. Exige evidencia PostgreSQL reciente con hashes idénticos; verifica tipos, aplicación, build, secretos y las tres suites de navegador sin reducir cobertura. Cada suite finaliza su servidor antes de iniciar otra.
6. Ejecutar `npm run db:phase7:dev:apply`. Exige puerta local PASS y hashes idénticos; comprueba historial remoto y rechaza migraciones pendientes ajenas a la fase. Aplica únicamente al proyecto DEV coincidente. Conserva evidencia CLI antes/después.
7. Ejecutar `npm run verify:phase7:dev`. Levanta Express localmente, crea únicamente empresas/usuarios/roles/operaciones sintéticos y ejecuta 34 casos más concurrencia HTTP real. Usa secret exclusivamente para Auth Admin; las operaciones financieras usan JWT y publishable. Revoca las sesiones de prueba al terminar.
8. Revisar `resultado-dev.md`, `resultado-dev.json`, `migraciones-dev.json` y capturas. Los intentos anteriores permanecen en `historico`; no sustituir un FAIL por una declaración manual de PASS.
9. Para trabajo local usar `npm run dev` y, cuando corresponda, `npm run dev:client`; para el artefacto completo `npm run build` y `npm start`. Render sigue usando un único Web Service Express que sirve el build Vite y `/health`, escucha `PORT` y conserva `trust proxy` explícito.

La conexión SQL directa mediante `SUPABASE_DB_URL` no es requisito del verificador remoto: se utilizan CLI vinculada, API, RPC y REST autenticado. Su diagnóstico histórico 28P01 no se declara corregido. SMTP/callback continúa como excepción externa previamente aceptada.

Los fixtures quedan identificados en el reporte para revisión. No borrar historial financiero como limpieza. Ninguna instrucción autoriza desplegar en producción ni iniciar Fase 8.
