# Revisión previa de esquema — Fase 4

La Fase 3.1 está aprobada: 16 Critical PASS, 0 Critical FAIL, 22 PASS y SMTP/callback como única excepción no bloqueante. No se modifica su evidencia.

## Migración 012 — modelo

Revisión: aditiva respecto de 001–011. Conserva `profiles`, roles, overrides y memberships; no sustituye `private.has_permission`, `private.is_active` ni los bloqueos de seguridad. Catálogo de permisos activado sin nuevos grants a roles o usuarios. Todas las tablas operativas y tablas hijas tienen `company_id`, RLS y auditoría financiera. Identidad legal de proveedor es global; operación, contactos y cuentas bancarias pertenecen a relaciones empresariales. Ningún operador puede modificar la identidad compartida de otra empresa.

Las FK de relaciones operativas incluyen `(company_id, id)` o `(company_id, supplier_id)`. Las RPC verifican también que orden, solicitud, proveedor, moneda y conformidad correspondan al mismo expediente. UUID enviados por el cliente son identificadores, no prueba de autorización.

CECO conserva las restricciones de 010. El primer uso marca transaccionalmente centro y ancestros, proyecto y subproyecto. Se guarda el contenido histórico completo en la solicitud y `dimension_versions`; órdenes y CxP heredan ese snapshot. Cambios de nombre/descripción/categoría afectan sólo usos futuros. Código, empresa y jerarquía usada quedan protegidos. Las dimensiones se desactivan; no se eliminan. Proyecto/subproyecto utilizados conservan identidad y relación padre.

## Migración 013 — operaciones

Revisión: RPC nuevas con `search_path` vacío, allowlists de campos y `private.lock_security` antes de mutar. Resolución RBAC existente, identidad `auth.uid()` y empresa persistida. Tablas nuevas no permiten escrituras directas de authenticated, anon ni service_role. Las RPC son para authenticated; no usan secret.

Las transiciones se serializan con los cambios de seguridad existentes. Totales proceden de ítems o documento revisado; no se acepta saldo pagado. Solicitudes aprobadas sólo se reabren por su propietario autorizado, con motivo, nueva versión y aprobación nueva; se impide reabrir cuando hay operaciones posteriores.

Una configuración activa por empresa/tipo elige un rol aprobador. Cada envío conserva configuración y versión en una instancia/paso. Se exige iniciar revisión antes de aprobar, observar o rechazar. La segregación de solicitud es configurable y activa por defecto. Cuentas bancarias y órdenes exigen revisor distinto de su creador. Aprobar una cuenta genera una versión nueva; la propuesta pendiente no modifica la cuenta vigente.

OC y OS usan una tabla con `order_type` y prefijos diferentes. No se exige orden para conformidad, documento o CxP. Un vencimiento deriva de la condición congelada y su fecha base; una base ausente produce error. Crédito se mide en días calendario. Cuotas múltiples, importes por umbral y resolutores de jefe quedan para ampliaciones; el motor conserva entidad de instancia/pasos/acciones.

Una obligación anticipada a proveedor puede nacer sin factura desde solicitud aprobada con modalidad `advance`; no representa desembolso. Comprobantes posteriores se vinculan al mismo expediente. No se crean pagos ni aplicaciones de anticipos. Las solicitudes de viáticos/reembolsos productivos permanecen deshabilitadas.

## Migración 014 — archivos

Revisión: bucket nuevo `financial-private`, privado, 5 MB máximo y allowlist MIME. Políticas de objetos exigen metadata preparada, usuario, permiso y empresa del expediente persistido. Sin políticas de sobrescritura o eliminación. El backend usa publishable y JWT del solicitante para Storage, valida extensión, firma y contenido activo conocido. Descarga autenticada por backend; vuelve a validar los bytes y entrega descarga, sin URLs públicas permanentes. La revocación se comprueba en cada petición.

La API de Storage es un servicio separado: un cliente que llame directamente a Storage puede omitir las comprobaciones de contenido del backend, pero no las políticas de acceso, tamaño y MIME. Por ello el proxy vuelve a validar al descargar. Estas comprobaciones no sustituyen un antivirus/CDR; no se afirma que un PDF arbitrario sea inocuo. El límite y RLS del bucket permanecen activos.

Referencia: [Supabase Storage Access Control](https://supabase.com/docs/guides/storage/security/access-control).

## Aplicación

Revisión 016: la prueba real detectó HIT de CDN para un archivo privado ya descargado, incluso con max-age=0, después de revocar membership. No había políticas adicionales; la API y la consulta RLS sí denegaban. Se agrega un formato cifrado a metadata y un bucket privado `financial-encrypted`. Cifrado AES-256-GCM antes de Storage, AAD por empresa/adjunto y clave backend independiente `ATTACHMENT_ENCRYPTION_KEY`. Storage nunca recibe los bytes legibles nuevos; un HIT posterior entrega sólo ciphertext. La API revalida RLS antes de descifrar; la clave nunca llega al cliente ni a Storage. No se reutiliza SUPABASE_SECRET_KEY para criptografía. El tamaño cifrado debe coincidir exactamente con original + 32 bytes. Los archivos sintéticos previos quedan como legacy, sin políticas de lectura de origen y fuera de descargas normales; no se eliminan ni se consideran datos productivos. La caché no permite revocar copias que un usuario ya descargó; este diseño impide nuevas entregas legibles desde caché tras revocación.

Revisión 015: la prueba real detectó que el preflight de Supabase Storage envía `contentLength`, mientras que el objeto persistido usa `size`. La política exige igualdad exacta con el tamaño autorizado usando uno u otro campo; ausencia de ambos sigue denegada. No se eliminan restricciones de identidad, empresa, expediente, MIME ni tamaño. `attachment_finish` sigue comparando el tamaño persistido real antes de marcar disponible. [Implementación primaria de Storage](https://github.com/supabase/storage/blob/master/src/storage/uploader.ts).

Únicamente DEV, tras comprobar que el project-ref de CLI coincide con SUPABASE_URL. No se ejecuta bootstrap ni reset. `scripts/phase4-dev-migrations.mjs --apply` registra el historial anterior, aplicación y presencia remota de las versiones nuevas; no imprime claves ni cadenas PostgreSQL. SQL directo 28P01 y SMTP no se corrigen dentro de esta fase.
