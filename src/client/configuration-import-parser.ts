const fields: Record<string, string[]> = {
  afe: ["code", "name", "active", "valid_from", "valid_to"],
  project: ["code", "name", "description", "status"],
  subproject: ["code", "name", "description", "status", "project_code"],
  entry_type: ["code", "name", "active"],
  legacy_mapping: [
    "dictionary",
    "legacy_code",
    "description",
    "erp_mapping",
    "valid_from",
    "valid_to",
    "notes",
  ],
};
export const configurationTemplates: Record<string, string> = {
  afe: "code,name,active,valid_from,valid_to\n",
  project: "code,name,description,status\n",
  subproject: "code,name,description,status,project_code\n",
  entry_type: "code,name,active\n",
  legacy_mapping:
    "dictionary,legacy_code,description,erp_mapping,valid_from,valid_to,notes\n",
  rule: JSON.stringify(
    [
      {
        code: "DEMO_EXPLICIT",
        name: "DEMO configuración pendiente",
        source_event: "PAYABLE_RECOGNIZED",
        valid_from: "YYYY-MM-DD",
        lines: [
          {
            account_id: "UUID_CUENTA_DEMO_DEBE",
            side: "debit",
            description: "DEMO",
            amount_key: "amount",
          },
          {
            account_id: "UUID_CUENTA_DEMO_HABER",
            side: "credit",
            description: "DEMO",
            amount_key: "amount",
          },
        ],
      },
    ],
    null,
    2,
  ),
};
export function configurationImportRows(kind: string, rows: string[][]) {
  const allowed = fields[kind],
    header = rows[0]?.map((v) => v.replace(/^\uFEFF/, "").trim());
  if (
    !allowed ||
    !header?.length ||
    new Set(header).size !== header.length ||
    header.some((v) => !allowed.includes(v))
  )
    throw new Error(
      "Columnas desconocidas o duplicadas. Use la plantilla del catálogo seleccionado.",
    );
  if (rows.length < 2 || rows.length > 2001)
    throw new Error("El lote debe contener entre 1 y 2.000 registros.");
  return rows.slice(1).map((row, i) => {
    if (row.length > header.length)
      throw new Error(`Fila ${i + 2}: columnas adicionales.`);
    const record: Record<string, unknown> = {};
    header.forEach((key, j) => {
      const value = (row[j] || "").trim();
      if (!value) return;
      if (/^[=+@]/.test(value))
        throw new Error(`Fila ${i + 2}: no se admiten expresiones.`);
      if (key === "active") {
        if (!["true", "false"].includes(value))
          throw new Error(`Fila ${i + 2}: active debe ser true o false.`);
        record[key] = value === "true";
      } else if (key === "erp_mapping") {
        const mapping = JSON.parse(value);
        if (!mapping || Array.isArray(mapping) || typeof mapping !== "object")
          throw new Error("erp_mapping requiere un objeto JSON explícito.");
        record[key] = mapping;
      } else record[key] = value;
    });
    return record;
  });
}
