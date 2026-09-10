import { parseCsv } from "./import-parser";
self.onmessage = async (
  event: MessageEvent<{ name: string; buffer: ArrayBuffer }>,
) => {
  try {
    let rows: string[][];
    if (event.data.name.toLowerCase().endsWith(".csv"))
      rows = parseCsv(
        new TextDecoder("utf-8", { fatal: true }).decode(event.data.buffer),
      );
    else {
      const { default: ExcelJS } = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(event.data.buffer);
      const sheet = workbook.worksheets[0];
      if (!sheet || sheet.rowCount > 201 || sheet.columnCount > 20)
        throw new Error(
          "La hoja excede 200 filas o contiene columnas adicionales",
        );
      rows = [];
      sheet.eachRow((row) => {
        const values: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell) => {
          if (cell.formula)
            throw new Error("No se admiten fórmulas en importaciones");
          values.push(cell.text);
        });
        rows.push(values);
      });
    }
    self.postMessage({ rows });
  } catch (error) {
    self.postMessage({ error: (error as Error).message });
  }
};
