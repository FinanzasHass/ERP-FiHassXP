import { parseCsv } from "./import-parser";
export async function bankFileRows(
  name: string,
  bytes: ArrayBuffer,
): Promise<string[][]> {
  if (bytes.byteLength > 2 * 1024 * 1024)
    throw new Error("Máximo 2 MB por archivo de extracto");
  let rows: string[][] = [];
  if (/\.csv$/i.test(name))
    rows = parseCsv(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  else if (/\.xlsx$/i.test(name)) {
    const ExcelJS = await import("exceljs");
    const book = new ExcelJS.default.Workbook();
    await book.xlsx.load(bytes);
    if (book.worksheets.length !== 1)
      throw new Error("Use un archivo con una sola hoja");
    book.worksheets[0]!.eachRow((row) => {
      if (rows.length > 2000 || row.cellCount > 40)
        throw new Error("Máximo 2000 filas y 40 columnas");
      const values: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        if (cell.formula || cell.type === 6)
          throw new Error("No se admiten fórmulas");
        values.push(
          cell.value instanceof Date
            ? cell.value.toISOString().slice(0, 10)
            : String(cell.value ?? ""),
        );
      });
      rows.push(values);
    });
  } else throw new Error("Use CSV o XLSX");
  if (rows.length < 2 || rows.length > 2001 || rows.some((r) => r.length > 40))
    throw new Error("Archivo vacío o demasiado grande");
  const headers = rows[0]!.map((v) => v.replace(/^\uFEFF/, "").trim());
  if (headers.some((v) => !v) || new Set(headers).size !== headers.length)
    throw new Error("Encabezados vacíos o duplicados");
  rows[0] = headers;
  return rows;
}
export function mapBankRows(rows: string[][], mapping: Record<string, string>) {
  const header = rows[0]!;
  return rows.slice(1).map((row) =>
    Object.fromEntries(
      Object.entries(mapping)
        .filter(([, v]) => v)
        .map(([key, col]) => {
          const value = (row[header.indexOf(col)] ?? "").trim();
          if (key === "amount" && !/^\d+(\.\d{1,2})?$/.test(value))
            throw new Error(
              "Importe positivo con punto decimal, sin separador de miles",
            );
          return [key, key === "amount" ? Number(value) : value];
        }),
    ),
  );
}
