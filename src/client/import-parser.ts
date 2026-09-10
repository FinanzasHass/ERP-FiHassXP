export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  const first = text.split(/\r?\n/, 1)[0] || "";
  const separator = first.includes(";") ? ";" : ",";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (!quoted && cell !== "") throw new Error("Comillas inválidas");
      else quoted = !quoted;
    } else if (ch === separator && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (quoted) throw new Error("Comillas sin cerrar");
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
export function recordsFromRows(
  rows: string[][],
): Record<string, string | boolean>[] {
  const header = rows[0]?.map((v) => v.replace(/^\uFEFF/, "").trim());
  if (!header?.length || new Set(header).size !== header.length)
    throw new Error("Encabezados vacíos o duplicados");
  const allowed = [
    "company_code",
    "code",
    "name",
    "parent_code",
    "category",
    "description",
    "active",
  ];
  if (
    header.some((h) => !allowed.includes(h)) ||
    ["company_code", "code", "name"].some((h) => !header.includes(h))
  )
    throw new Error("Use las columnas de la plantilla CECO");
  if (rows.length < 2 || rows.length > 201)
    throw new Error("Cada lote debe tener entre 1 y 200 filas");
  return rows.slice(1).map((row, i) => {
    if (row.length > header.length)
      throw new Error(`Fila ${i + 2}: columnas adicionales`);
    const result: Record<string, string | boolean> = {};
    header.forEach((h, j) => {
      const value = (row[j] || "").trim();
      if (h === "active") {
        if (
          !["", "true", "false", "1", "0", "sí", "si", "no"].includes(
            value.toLowerCase(),
          )
        )
          throw new Error(`Fila ${i + 2}: estado inválido`);
        result[h] = !["false", "0", "no"].includes(value.toLowerCase());
      } else result[h] = value;
    });
    return result;
  });
}
