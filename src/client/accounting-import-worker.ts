import { parseCsv } from "./import-parser";
import { accountingImportRows } from "./accounting-import-parser";
self.onmessage = async (
  event: MessageEvent<{ name: string; buffer: ArrayBuffer }>,
) => {
  try {
    let rows: string[][] = [];
    if (event.data.name.toLowerCase().endsWith(".csv"))
      rows = parseCsv(
        new TextDecoder("utf-8", { fatal: true }).decode(event.data.buffer),
      );
    else {
      const { default: ExcelJS } = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(event.data.buffer);
      if (workbook.worksheets.length !== 1)
        throw new Error("El archivo debe tener exactamente una hoja.");
      const sheet = workbook.worksheets[0]!;
      if (sheet.rowCount > 2001 || sheet.columnCount > 14)
        throw new Error("Máximo 2.000 cuentas y las 14 columnas definidas.");
      const header = sheet.getRow(1).values as unknown[];
      sheet.eachRow((row, index) => {
        const values: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell, column) => {
          if (cell.formula)
            throw new Error(`Fila ${index}: no se admiten fórmulas.`);
          if (
            index > 1 &&
            ["code", "parent_code", "pcge_reference_code"].includes(
              String(header[column]),
            ) &&
            typeof cell.value === "number"
          )
            throw new Error(
              `Fila ${index}: los códigos deben almacenarse como texto para preservar ceros iniciales.`,
            );
          values[column - 1] =
            cell.value instanceof Date
              ? cell.value.toISOString().slice(0, 10)
              : cell.text;
        });
        rows.push(values);
      });
    }
    self.postMessage({ rows: accountingImportRows(rows) });
  } catch (e) {
    self.postMessage({ error: (e as Error).message });
  }
};
