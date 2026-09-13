# Incidencias locales observadas y corregidas

Este registro conserva fallos anteriores. No es el estado vigente de aprobación ni evidencia de Supabase DEV.

1. `initdb` no pudo crear un token restringido dentro del sandbox de Windows (errores 87/3). El mismo clúster desechable dentro de `.tools/phase6-disposable-postgres` se inicializó mediante la ejecución local autorizada fuera del sandbox. Se mantuvo escucha exclusivamente en 127.0.0.1.
2. `execFile(pg_ctl start)` retenía los pipes heredados por el servidor. Se detuvo únicamente ese clúster y se cambió el control a `spawn` con `windowsHide`, `stdio: ignore` y espera del evento exit. El intento interrumpido registró ECONNREFUSED al avanzar después de la detención; no fue una prueba funcional de la aplicación.
3. La primera regresión contra PostgreSQL real falló con `22P02` en el importador CECO: node-postgres serializaba un array JSONB como array PostgreSQL. Se corrigió el harness identificando los tipos de parámetros de la RPC y serializando explícitamente los parámetros JSON/JSONB. Los uuid[] conservan su representación nativa.
4. Al extender Storage, la política attachment_read seguía vinculada al OID anterior tras renombrar el predicado. La regresión Fase 5 detectó permission denied en attachment_access_before_expense. Se recreó la política apuntando al nuevo predicado; no se concedió ejecución al helper anterior.

Después de estas correcciones, la ejecución PostgreSQL local completó 76 grupos PASS, incluidos cinco concurrentes. El resultado vigente se conserva en `../resultado-postgres-local.json`. Las ejecuciones siguientes archivan automáticamente el resultado anterior.


5. La primera prueba del nuevo trigger de protección documental intentó un UPDATE de fixture sin identidad Auth: fue rechazada por Active profile required. La prueba se corrigió para invocar la RPC antigua financial_transition con actor autenticado y verificar el rechazo documental esperado. No se eliminó el control de identidad.
6. Los primeros selectores Playwright nuevos usaban textos de botones incorrectos (Nueva solicitud VIA, Ver/Abrir). Se ajustaron a la UI real: Nueva solicitud y Ver expediente. Las ocho pruebas de interfaz finalizaron PASS.
7. Verificación final de esta iteración: 77 casos PostgreSQL real local PASS, incluidos cinco concurrentes. Estado vigente en resultado-postgres-local.json; el reporte de 76 casos anterior permanece archivado.
8. La matriz DEV guardó 30 PASS y cuatro concurrentes PASS, pero la limpieza browser.close quedó bloqueada. Se detuvo sólo el verificador propio después de guardar resultados. El harness usa ahora launchServer y cierre explícito del proceso hijo, como en Fase 5. Una ejecución complementaria sobre fixtures existentes verificó historia e impresión sin mocks y finalizó con código 0. No se modificaron migraciones publicadas ni se rebajaron permisos.
