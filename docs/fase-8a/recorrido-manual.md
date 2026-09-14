# Recorrido funcional de Fase 8A

Usar una empresa de pruebas y datos inequívocamente sintéticos. Los permisos se asignan expresamente desde Administración; System Administrator no recibe capacidad contable por administrarlos.

1. Asignar membership y rol contable de la empresa a dos usuarios distintos. Otorgar al segundo `journal.post`, `journal.reverse`, cierre/reapertura y activación de reglas según corresponda. Confirmar que la empresa ajena no aparece y que revocar membership elimina el acceso con la sesión vigente.
2. Abrir **Contabilidad → Períodos contables → Configuración**. Elegir moneda funcional explícita, prefijo y longitud. Sin configuración no se crean asientos. No se cambia moneda funcional después del primer asiento.
3. Crear un tipo de asiento y un período con año, mes, inicio y fin coherentes. Para moneda extranjera registrar fecha, monedas, compra, venta, tasa contable y fuente; nunca inferir una tasa.
4. Abrir **Plan de cuentas**. Crear raíz no imputable e hijas imputables. Elegir naturaleza, tipo, vigencia y exigencias de CECO/proyecto/tercero. Intentar duplicado y ciclo; ambos deben fallar. No hay cuentas de catálogo suministradas por el sistema.
5. Importar un CSV/XLSX sintético con las columnas del README. El preview no guarda. Revisar inconsistencias; un lote inválido no habilita confirmar. Confirmar uno válido y repetir con la misma clave en la API: no duplica. Los códigos existentes nunca se renombran por importación.
6. Abrir **Asientos → Nuevo asiento**. Seleccionar fecha, período, tipo, moneda y descripción. Crear dos líneas explícitas con cuenta, debe/haber y, si corresponde, importe extranjero, tercero y dimensiones. No se crea ni postea automáticamente desde un pago, CxC o CxP.
7. Guardar el borrador. Modificarlo mediante **Editar borrador**: conserva las líneas de revisiones anteriores. Intentar validar un asiento descuadrado, una línea con ambos lados o una cuenta no imputable; deben rechazarse.
8. Validar el asiento correcto y entrar con el segundo usuario para **Contabilizar**. El creador no puede postearlo. El posteo registra actor y hora, fija snapshots y marca primer uso de CECO/proyecto/cuenta transaccionalmente. Reintentar no crea doble efecto.
9. Intentar editar el asiento contabilizado por API y REST directo. Debe fallar. Renombrar un CECO usado preserva su nombre histórico en el movimiento; cambiar su código queda bloqueado.
10. Consultar **Mayor** y **Balance de comprobación**. Verificar importes con los asientos realmente posteados. Crear otro borrador y comprobar que no cambia el balance. Saldo negativo representa haber neto bajo la convención debe menos haber.
11. Cerrar el período con motivo. El posteo pendiente falla. Reabrir con el permiso reservado y revisar motivo/actor en auditoría. La reapertura no modifica asientos existentes.
12. Reversar con fecha/período abiertos, tipo y motivo mediante un actor diferente al que posteó el original. El original permanece junto con su inverso. El saldo neto de la pareja es cero. El segundo reverso con otra clave falla; la misma clave devuelve el ya realizado.
13. Crear una **Regla contable** con cuentas existentes, evento, líneas, multiplicadores, condiciones y dimensiones explícitas. Otro usuario la activa exclusivamente para simulación. La versión previa se conserva al editar.
14. Abrir **Simulación**, proporcionar moneda, fecha, importes, tercero y dimensiones del origen sintético. Revisar propuesta y errores. El número de asientos y la evidencia de posteo no cambian. No existe activación productiva en esta fase.
15. Revisar los eventos financieros por empresa y actor, la matriz DEV y las cuatro carreras concurrentes. No iniciar Fase 8B.

## Supabase DEV

- Mantener el mismo proyecto vinculado en CLI y en `SUPABASE_URL`.
- Mantener las variables existentes y todas las claves fuera de Git y del bundle. No pegar credenciales en resultados.
- Ejecutar la puerta local completa; el script de migraciones exige PASS y compara hashes.
- Ejecutar `npm run db:phase8a:dev:apply`. El script valida el historial remoto y solo acepta las seis versiones nuevas previstas. Conserva 001–037.
- Ejecutar el verificador real. Crea empresas y usuarios sintéticos, grants explícitos y sesiones temporales; conserva historia financiera y revoca las sesiones de prueba al terminar.
- No cambiar SMTP ni utilizar la conexión SQL directa histórica como evidencia de éxito.

La fuente del estado actual es `resultado-dev.json`, no este recorrido ni resultados de ejecuciones locales.
