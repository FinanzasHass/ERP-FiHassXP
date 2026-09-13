# Recorrido manual con fixtures DEV

1. Confirmar `migraciones-dev.json` y `resultado-dev.json` de esta fase. No ejecutar el verificador en producción. Las credenciales permanecen en `.env` ignorado.
2. Asignar explícitamente los permisos de la fase a un rol empresarial y un usuario con membership activo. Para probar segregación, disponer de otro usuario conciliador. El verificador crea únicamente roles y usuarios sintéticos.
3. En el selector multiempresa elegir A. Abrir **Clientes**, crear una persona natural o jurídica sin usuario ERP. Intentar repetir documento; comprobar rechazo. Cambiar a B y comprobar aislamiento.
4. En **Cuentas por cobrar**, crear una obligación manual con moneda, vencimiento y sustento. No introducir estado cobrado ni saldo pendiente. Consultar su historial.
5. En **Membresías comerciales**, configurar importe periódico, inicio/primer vencimiento y meses por período. Generar cuotas explícitas compatibles. Repetir período/vencimiento y comprobar rechazo. En **Cuotas y cronogramas**, ver cuotas y sustituir una versión sin historial de cobros con motivo.
6. En **Contratos financieros de lotes**, registrar identificador externo, precio e inicial. Generar cuotas que sumen exactamente el precio. No crear inventario inmobiliario.
7. Importar un extracto sintético confirmado desde Movimientos bancarios. Abrir **Depósitos sin identificar**, capturar el crédito e identificar cliente. Las sugerencias en **Cobros** requieren confirmación humana.
8. Aplicar parcialmente el cobro a una CxC; comprobar importe cobrado y pendiente. Distribuir un cobro entre varias obligaciones del mismo cliente/moneda. Dejar saldo a favor y aplicarlo después a una obligación nueva.
9. Para cobros no bancarios, registrar medio, fecha y referencia, adjuntar PDF/XML/imagen permitido en **Archivos** y luego aplicar. Comprobar rechazo antes del sustento. Descargar exige autorización vigente.
10. Revertir una aplicación con motivo: reaparecen pendiente y saldo a favor. Revertir cobro no vinculado: las aplicaciones se revierten y las deudas reaparecen, sin borrar registros ni simular salida bancaria.
11. Con el conciliador independiente, vincular cobro al crédito y período abierto. Conciliar desde **Coincidencias de conciliación**. Identificar/aplicar no realiza ese paso automáticamente. Comprobar que el operador del cobro no pueda conciliarlo.
12. Consultar **Panel de Cobranzas**, aging, saldos a favor, obligaciones por cliente/origen y próximos vencimientos. En **Cash Flow**, comparar entradas esperadas y ACTUAL; aplicar no duplica ingresos bancarios.
13. Revisar auditoría financiera e historial. Revocar membership con una sesión existente y comprobar que tanto UI/API como REST directo pierdan acceso inmediato.
14. En una rendición sintética liquidada de Fase 6, **Imprimir / guardar PDF**: verificar anticipo 180, aceptado 160, devolución determinada 20, recibida y conciliada 20, pendiente 0.

No usar datos reales para estos pasos. No ejecutar contabilidad, SUNAT ni Fase 8.
