import { mkdir, readFile, writeFile } from "node:fs/promises";

const phases = ["fase-4", "fase-5", "fase-6", "fase-7", "fase-8a", "fase-8b"];
const descriptions = {
  "fase-4": "Solicitud, proveedor, compra/servicio, comprobante y CxP",
  "fase-5": "OP, pago, banco, cash flow y conciliación",
  "fase-6": "Empleado, VIA, anticipo, rendición y liquidación",
  "fase-7": "Cliente, CxC, depósito, cobranza y conciliación",
  "fase-8a": "Plan DEMO, período, asiento, mayor y balance",
  "fase-8b": "Evento contable, preview, draft, posteo y dashboard DEMO",
};
const datasets = [];
for (const phase of phases) {
  const report = JSON.parse(await readFile(`docs/${phase}/resultado-dev.json`, "utf8"));
  if (report.status !== "PASS") throw new Error(`${phase} DEV evidence is not PASS`);
  const fixtures = report.fixtures ?? {};
  datasets.push({
    phase,
    purpose: descriptions[phase],
    run: report.run ?? null,
    status: report.status,
    company_ids: fixtures.companies?.map((item) => item.id) ?? [fixtures.companyA, fixtures.companyB].filter(Boolean),
    company_codes: fixtures.companies?.map((item) => item.code) ?? [],
    user_ids: fixtures.users?.map((item) => typeof item === "string" ? item : item.id) ?? [],
    entity_ids: Object.fromEntries(
      Object.entries(fixtures).filter(([key]) => !["companies", "companyA", "companyB", "roles", "users"].includes(key)),
    ),
  });
}
const current = datasets.at(-1);
const manifest = {
  generated_at: new Date().toISOString(),
  environment: "DEV",
  data_classification: "SYNTHETIC_ONLY",
  production_accounting: false,
  credentials_included: false,
  presentation_company_id: current.company_ids[0],
  presentation_run: current.run,
  datasets,
  notes: [
    "Los lotes son evidencia sintética inmutable por fase; no se deben renombrar ni convertir en datos reales.",
    "El recorrido contable Fase 8B usa presentation_company_id. Los recorridos operativos previos usan la empresa A de su fase.",
    "Las contraseñas y tokens nunca forman parte de este manifiesto.",
  ],
};
await mkdir("docs/demo", { recursive: true });
await writeFile("docs/demo/manifiesto-dev.json", JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ status: "PASS", datasets: datasets.length, presentationRun: current.run }));
