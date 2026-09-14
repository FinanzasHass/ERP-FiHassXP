const booleanFields = [
  "allows_posting",
  "requires_cost_center",
  "requires_project",
  "requires_third_party",
  "active",
];
export function accountingImportRows(
  rows: string[][],
): Record<string, string | boolean>[] {
  const header = rows[0]?.map((x) => x.replace(/^\uFEFF/, "").trim());
  const required = [
    "code",
    "name",
    "account_type",
    "normal_balance",
    "allows_posting",
    "valid_from",
  ];
  const allowed = [
    ...required,
    "parent_code",
    "valid_to",
    "pcge_reference_code",
    ...booleanFields,
  ];
  if (
    !header?.length ||
    new Set(header).size !== header.length ||
    header.some((x) => !allowed.includes(x)) ||
    required.some((x) => !header.includes(x))
  )
    throw new Error(
      "Encabezados inválidos. Use las columnas de la plantilla contable.",
    );
  if (rows.length < 2 || rows.length > 2001)
    throw new Error("El lote debe contener entre 1 y 2.000 cuentas.");
  return rows.slice(1).map((row, i) => {
    if (row.length > header.length)
      throw new Error(`Fila ${i + 2}: columnas adicionales.`);
    const result: Record<string, string | boolean> = {};
    header.forEach((key, j) => {
      const value = (row[j] || "").trim();
      if (!value) {
        if (required.includes(key))
          throw new Error(`Fila ${i + 2}: falta ${key}.`);
        return;
      }
      if (booleanFields.includes(key)) {
        if (!["true", "false"].includes(value))
          throw new Error(`Fila ${i + 2}: ${key} requiere true o false.`);
        result[key] = value === "true";
      } else result[key] = value;
    });
    return result;
  });
}
