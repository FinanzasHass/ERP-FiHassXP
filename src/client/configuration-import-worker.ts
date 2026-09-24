import { parseCsv } from "./import-parser";
import { configurationImportRows } from "./configuration-import-parser";
self.onmessage = async (
  event: MessageEvent<{ kind: string; name: string; buffer: ArrayBuffer }>,
) => {
  try {
    const { kind, name, buffer } = event.data;
    if (buffer.byteLength > 2 * 1024 * 1024)
      throw new Error("Máximo 2 MB por archivo.");
    if (name.toLowerCase().endsWith(".json")) {
      const rows = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(buffer),
      );
      if (!Array.isArray(rows) || rows.length < 1 || rows.length > 2000)
        throw new Error("Se requiere un array de 1 a 2.000 registros.");
      self.postMessage({ rows });
      return;
    }
    if (kind === "rule")
      throw new Error(
        "Las reglas requieren JSON estructurado con cuentas y líneas explícitas.",
      );
    let rows: string[][] = [];
    if (name.toLowerCase().endsWith(".csv"))
      rows = parseCsv(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
    else if (name.toLowerCase().endsWith(".xlsx")) {
      const { default: ExcelJS } = await import("exceljs");
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(buffer);
      if (book.worksheets.length !== 1)
        throw new Error("Se requiere exactamente una hoja.");
      const sheet = book.worksheets[0]!;
      if (sheet.rowCount > 2001 || sheet.columnCount > 7)
        throw new Error("Máximo 2.000 registros y 7 columnas.");
      const header = sheet.getRow(1).values as unknown[];
      sheet.eachRow((row, i) => {
        const values: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell, j) => {
          if (cell.formula)
            throw new Error(`Fila ${i}: no se admiten fórmulas.`);
          if (
            i > 1 &&
            ["code", "legacy_code", "project_code"].includes(
              String(header[j]),
            ) &&
            typeof cell.value === "number"
          )
            throw new Error(`Fila ${i}: conserve los códigos como texto.`);
          values[j - 1] =
            cell.value instanceof Date
              ? cell.value.toISOString().slice(0, 10)
              : cell.text;
        });
        rows.push(values);
      });
    } else throw new Error("Use CSV, XLSX o JSON.");
    self.postMessage({ rows: configurationImportRows(kind, rows) });
  } catch (e) {
    self.postMessage({ error: (e as Error).message });
  }
};
