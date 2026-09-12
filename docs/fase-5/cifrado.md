# Claves versionadas de adjuntos

Los objetos siguen siendo ciphertext AES-256-GCM en Storage privado. La CDN puede devolver bytes cacheados después de revocar acceso: nunca se confía en ese HIT para autorizar el documento legible. El backend consulta metadata con JWT vigente antes de descifrar.

Cada attachment identifica `encryption_algorithm = AES-256-GCM` y `encryption_key_version = V1/V2/...`. `encryption_format = aes-256-gcm-v1` identifica el formato del sobre, no la versión de la clave. El objeto ERP1 contiene magic [0,4), nonce/IV de 12 bytes [4,16), tag de autenticación de 16 bytes [16,32) y ciphertext [32,...). No se duplican nonce/tag en columnas SQL. Pueden recuperarse del sobre sin revelar una clave. V1 conserva su AAD original empresa:adjunto; V2+ añade la versión al AAD.

## Configuración y respaldo

- Backend: `ATTACHMENT_ENCRYPTION_KEY_V1` (64 hex, 32 bytes aleatorios) y `ATTACHMENT_ENCRYPTION_ACTIVE_VERSION=V1`.
- El valor existente de `ATTACHMENT_ENCRYPTION_KEY` se admite sólo como alias V1 para compatibilidad con DEV. No se regenera. Si ambos nombres existen, deben contener exactamente el mismo valor o el servidor rechaza la configuración.
- Claves exclusivamente en secrets backend; jamás DB, auditoría, Storage, frontend ni variables VITE. Respaldar el conjunto versionado en un gestor de secretos/copia cifrada con acceso restringido y copia de recuperación separada. Respaldar también la metadata y los objetos cifrados.
- Antes de modificar secrets, comprobar recuperación de un archivo sintético de cada versión en un entorno aislado; nunca imprimir valores ni pasarlos en la línea de comandos.

## Rotación de nuevas cargas

1. Generar una nueva clave aleatoria independiente en el gestor de secretos como `ATTACHMENT_ENCRYPTION_KEY_V2`.
2. Mantener V1 disponible. Desplegar primero lectores que tengan V1 y V2.
3. Cambiar únicamente `ATTACHMENT_ENCRYPTION_ACTIVE_VERSION` a V2 en todos los escritores. Nuevas cargas quedan V2; descargas antiguas eligen V1 desde su metadata.
4. Verificar carga/descarga V2 y descarga V1. Para revertir el cambio de escritor basta volver a active=V1 sin retirar V2.

## Recifrado futuro

No se implementa una modificación destructiva de objetos existentes: Storage prohíbe overwrite/delete. Un futuro job autorizado debe leer V1 con su clave, verificar integridad, crear un nuevo adjunto/objeto V2 con nonce nuevo, registrar relación de reemplazo y auditoría, verificar bytes y cambiar referencias transaccionalmente. Conservar respaldo V1 hasta finalizar retención y verificación. No cambiar sólo `encryption_key_version` de una fila ya cifrada.

## Pérdida o recuperación

Restaurar la misma clave de su respaldo bajo la misma versión y probar el archivo sintético conocido. Si no existe copia de la clave, AES-GCM no admite recuperación del contenido: no generar otra clave bajo el mismo nombre para aparentar reparación. Una versión ausente falla cerrada con ATTACHMENT_KEY_REQUIRED; no intenta descifrar con otra versión.

La selección de claves está encapsulada en attachmentKey. Un proveedor KMS/HSM puede sustituir esta resolución/encriptación más adelante, conservando metadata y las versiones. No se afirma integración KMS actual.
