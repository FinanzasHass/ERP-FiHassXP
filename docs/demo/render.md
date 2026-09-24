# Render DEMO / staging

El Blueprint `render.yaml` prepara **un único Web Service DEMO**: build React/Vite, API Express y frontend estático. No se ha creado un servicio remoto ni se declara un despliegue completado.

1. Crear el servicio desde el repositorio usando el Blueprint. Nombre: `mini-erp-financiero-demo`.
2. Mantener Node **24.18.0**, `npm ci && npm run build`, `npm start`, healthcheck `/health`.
3. `NODE_ENV=production` selecciona optimizaciones de ejecución; **no identifica el entorno empresarial**. `APP_ENV=demo` muestra `ENTORNO DEMO`. Para staging usar `APP_ENV=staging`.
4. Configurar `APP_ORIGIN=https://<dominio-render>` sin ruta ni slash final; Express usa `PORT` de Render y escucha `0.0.0.0`.
5. `TRUST_PROXY_HOPS=1` corresponde al único proxy de entrada previsto. Si se agrega otro proxy/CDN, revisar explícitamente esta topología antes de usar IP en auditoría/rate limiting; no usar `trust proxy=true` indiscriminadamente.
6. Guardar solamente en variables del servicio: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `ATTACHMENT_ENCRYPTION_KEY_V1`, versión activa y futuras claves necesarias para descifrar archivos históricos. Si se conserva el alias `ATTACHMENT_ENCRYPTION_KEY`, debe coincidir con V1. No subir `.env` ni poner secretos en `VITE_*`.
7. Mantener `ACCOUNTING_AUTO_GENERATE=false`, `ACCOUNTING_AUTO_POST=false`, `PRODUCTION_ACCOUNTING_RULES=false`. El backend rechaza arrancar con estos indicadores habilitados; la base también impide su activación. El toggle DEMO empresarial solamente permite generación manual explícita con reglas sintéticas designadas.
8. Supabase → Authentication → URL Configuration: agregar exactamente `https://<dominio-render>/auth/callback`. Mantener las URLs localhost ya existentes. Usar Site URL del entorno DEMO como URL por defecto si ese proyecto se dedica a la demo; no borrar la configuración DEV. No usar comodines amplios para sustituir la URL conocida.
9. Configurar las nuevas migraciones únicamente en el proyecto DEV/staging autorizado y después de pruebas locales. No importar datos reales.
10. Comprobar `/health`, login, banner, callback, selección empresarial, revocación de sesión/membership, descifrado de adjuntos existentes y ausencia de secretos en bundle/respuestas/logs. SMTP conserva la excepción externa previamente aceptada hasta su configuración por separado.

No hay contraseña DEMO dentro del repositorio. La provisión de usuarios sintéticos conserva Auth Admin aislado; las credenciales se administran por un canal controlado, no se imprimen en scripts de fixtures ni se incrustan en el frontend.

Referencias oficiales consultadas: [puerto y host de Web Services](https://render.com/docs/web-services), [versión de Node](https://render.com/docs/node-version), [Blueprint](https://render.com/docs/blueprint-spec) y [redirect URLs de Supabase Auth](https://supabase.com/docs/guides/auth/redirect-urls).
