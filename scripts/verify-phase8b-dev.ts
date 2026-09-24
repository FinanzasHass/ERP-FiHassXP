import { createClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createApp } from "../src/server/app.js";
import { readConfig } from "../src/server/config/env.js";
import { createPrivilegedAuth } from "../src/server/integrations/supabase/auth-admin.js";
import { createSessionRepository } from "../src/server/repositories/session-repository.js";
import { createAuthentication } from "../src/server/services/authentication.js";
import { checkClientBoundary } from "./check-client-boundary.mjs";

const cfg = readConfig(process.env);
const dir = "docs/fase-8b";
const tag = `F8B_${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
if (cfg.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(new URL(cfg.APP_ORIGIN).hostname)) {
  throw new Error("DEV only");
}
const projectRef = (await readFile("supabase/.temp/project-ref", "utf8")).trim();
if (new URL(cfg.SUPABASE_URL).hostname !== `${projectRef}.supabase.co`) throw new Error("DEV project mismatch");
const migration = JSON.parse(await readFile(`${dir}/migraciones-dev.json`, "utf8"));
if (migration.status !== "PASS") throw new Error("Verified DEV migrations required");
const initial = JSON.parse(await readFile("docs/fase-3.1/fixtures-dev.json", "utf8"));

// This object exposes Supabase Auth Admin only. Business data always uses a publishable request-scoped client.
const authAdmin = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
}).auth.admin;
const publicAuth = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
}).auth;
const sessions: Session[] = [];
let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;
let browserServer: Awaited<ReturnType<typeof chromium.launchServer>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.connect>> | undefined;

type Session = { id: string; token: string; refresh: string; db: ReturnType<typeof createClient> };
class ProofError extends Error {}
const assert = (condition: unknown, message: string): asserts condition => {
  if (!condition) throw new ProofError(message);
};
const names = [
  "Migraciones 044–051 y mismo proyecto DEV",
  "Operación financiera válida sin regla contable",
  "Evento contable idempotente y no forjable por REST",
  "Empresa DEMO requiere designación explícita",
  "Regla y cuentas exclusivamente DEMO",
  "Resolución y preview no persisten asiento",
  "Generación concurrente produce un solo draft",
  "Segregación generación, validación y posteo",
  "Trazabilidad bidireccional operación-evento-asiento",
  "Aislamiento de empresa y revocación inmediata",
  "Dashboard DEMO deriva datos persistidos",
  "Importación AFE preview y confirmación idempotente",
  "Diccionario legacy conserva significado no definido",
  "Feature flags productivos permanecen deshabilitados",
  "Auditoría financiera y de configuración",
  "Secret boundary y UI DEMO real",
];
const report: any = {
  run: tag,
  environment: "DEV",
  sameProjectAsApplication: true,
  projectFingerprint: migration.projectFingerprint,
  startedAt: new Date().toISOString(),
  status: "RUNNING",
  results: names.map((name, index) => ({ id: index + 1, name, status: "NOT_RUN" })),
  fixtures: {},
};

await mkdir(`${dir}/historico`, { recursive: true });
await mkdir(`${dir}/capturas`, { recursive: true });
try {
  await copyFile(`${dir}/resultado-dev.json`, `${dir}/historico/resultado-dev-${Date.now()}.json`);
} catch (error: any) {
  if (error.code !== "ENOENT") throw error;
}
async function persist() {
  report.updatedAt = new Date().toISOString();
  report.summary = {
    pass: report.results.filter((item: any) => item.status === "PASS").length,
    fail: report.results.filter((item: any) => item.status === "FAIL").length,
    notRun: report.results.filter((item: any) => item.status === "NOT_RUN").length,
  };
  await writeFile(`${dir}/resultado-dev.json`, JSON.stringify(report, null, 2));
  await writeFile(
    `${dir}/resultado-dev.md`,
    `# Fase 8B técnica · Supabase DEV\n\nEjecución: ${tag}. Estado: ${report.status}. Mismo project-ref que la aplicación: verificado. Sólo fixtures sintéticos. Contabilización productiva deshabilitada.\n\n| N.º | Verificación | Resultado |\n|---|---|---|\n${report.results.map((item: any) => `| ${item.id} | ${item.name} | ${item.status} |`).join("\n")}\n`,
  );
}
async function test(index: number, proof: () => Promise<void>) {
  try {
    await proof();
    report.results[index - 1].status = "PASS";
    console.log(`PASS ${index} ${names[index - 1]}`);
  } catch (error) {
    report.results[index - 1].status = "FAIL";
    report.results[index - 1].evidence = error instanceof ProofError ? error.message : "Detalle sensible omitido";
    throw error;
  } finally {
    await persist();
  }
}
async function session(id: string): Promise<Session> {
  const user = await authAdmin.getUserById(id);
  assert(!user.error && user.data.user?.email, "Auth identity unavailable");
  const link = await authAdmin.generateLink({ type: "magiclink", email: user.data.user.email });
  assert(!link.error && link.data.properties?.hashed_token, "Auth link unavailable");
  const verified = await publicAuth.verifyOtp({ type: "magiclink", token_hash: link.data.properties.hashed_token });
  assert(!verified.error && verified.data.session, "Auth session unavailable");
  const token = verified.data.session.access_token;
  const value: Session = {
    id,
    token,
    refresh: verified.data.session.refresh_token,
    db: createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
  sessions.push(value);
  return value;
}
async function call(actor: Session, path: string, method = "GET", body?: unknown, expected?: number, key?: string) {
  await new Promise((resolve) => setTimeout(resolve, 530));
  const response = await fetch(`${cfg.APP_ORIGIN}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${actor.token}`,
      "Content-Type": "application/json",
      ...(method === "POST" ? { "Idempotency-Key": key ?? randomUUID() } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = response.status === 204 ? null : await response.json();
  assert(
    expected === undefined ? response.ok : response.status === expected,
    `${method} ${path.split("?")[0]} status ${response.status}${typeof data?.error === "string" ? ` ${data.error}` : ""}`,
  );
  return data;
}
async function list(actor: Session, path: string) {
  const rows: any[] = [];
  for (let page = 1; page <= 100; page++) {
    const result = await call(actor, `${path}${path.includes("?") ? "&" : "?"}page=${page}&limit=100`);
    rows.push(...result.data);
    if (rows.length >= result.count) return rows;
  }
  throw new ProofError("Pagination limit");
}
async function rows(actor: Session, table: string, filters: Record<string, unknown> = {}) {
  let query = actor.db.from(table).select("*");
  for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
  const result = await query;
  assert(!result.error, `REST read denied unexpectedly for ${table}`);
  return result.data as any[];
}

try {
  server = createApp(cfg, {
    auth: createAuthentication(cfg),
    privileged: createPrivilegedAuth(cfg),
    repository: (token) => createSessionRepository(cfg, token),
  }).listen(cfg.PORT, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server!.once("listening", resolve);
    server!.once("error", () => reject(new ProofError("Local API port unavailable")));
  });

  await test(1, async () => {
    const versions = migration.steps.at(-1)?.versions ?? [];
    for (const version of ["202609220044", "202609220045", "202609220046", "202609220047", "202609220048", "202609230049", "202609230050", "202609230051"]) {
      assert(versions.some((row: any) => row.local === version && row.remote === version), `Migration ${version} missing`);
    }
  });

  const admin = await session(initial.initialAdministrator);
  const operators: Session[] = [];
  for (const kind of ["operator", "generator", "validator", "poster", "foreign"]) {
    const user = await call(admin, "/users", "POST", {
      email: `${tag.toLowerCase()}_${kind}@example.test`,
      username: `${tag.toLowerCase()}_${kind}`,
      full_name: `PRUEBA DEV ${kind} ${tag}`,
      status: "active",
    });
    operators.push(await session(user.id));
  }
  const [operator, generator, validator, poster, foreign] = operators;
  const companies = [];
  for (const suffix of ["A", "B"]) {
    companies.push(await call(admin, "/companies", "POST", {
      code: `${tag}_${suffix}`,
      legal_name: `EMPRESA DEMO SINTÉTICA ${tag} ${suffix}`,
      tax_id: `${tag}${suffix}`,
      country_code: "PE",
    }));
  }
  const [company, otherCompany] = companies;
  report.fixtures = { companyA: company.id, companyB: otherCompany.id, users: operators.map((item) => item.id) };
  await persist();
  const permissions = await list(admin, "/permissions");
  const resources = new Set([
    "accounting_account", "accounting_period", "journal", "accounting_rule", "general_ledger", "trial_balance",
    "accounting_event", "accounting_configuration", "afe", "legacy_mapping", "demo_dashboard", "customer", "receivable",
  ]);
  const role = await call(admin, "/roles", "POST", { code: `${tag.toLowerCase()}_accounting`, name: `Contabilidad DEMO ${tag}` });
  await call(admin, `/roles/${role.id}/permissions`, "PUT", {
    permission_ids: permissions.filter((item: any) => item.active && (resources.has(item.resource) || item.code === "audit.finance_view")).map((item: any) => item.id),
  });
  for (const actor of operators) {
    const assignedCompany = actor === foreign ? otherCompany.id : company.id;
    await call(admin, `/users/${actor.id}/companies`, "PUT", { company_id: assignedCompany, active: true });
    await call(admin, `/users/${actor.id}/roles`, "PUT", { role_id: role.id, company_id: assignedCompany, assign: true });
  }

  const options = await call(generator, `/accounting/options?company_id=${company.id}`);
  const currency = options.currencies.find((item: any) => item.name === "PEN")?.id ?? options.currencies[0]?.id;
  assert(currency, "Currency unavailable");
  const customer = await call(operator, `/customers?company_id=${company.id}`, "POST", {
    customer_type: "legal", document_type: "TEST", document_number: tag, legal_name: `CLIENTE DEMO ${tag}`,
  });
  const receivable = await call(operator, `/receivables?company_id=${company.id}`, "POST", {
    customer_id: customer.id, source_type: "manual_authorized", currency_id: currency,
    issue_date: "2026-09-23", due_date: "2026-10-23", original_amount: 125, description: `OBLIGACIÓN SINTÉTICA ${tag}`,
  });
  let events = await rows(generator, "accounting_events", { company_id: company.id, source_type: "receivable", source_id: receivable.id });
  const event = events[0];
  await test(2, async () => {
    assert(receivable.id && event?.workflow_status === "pending_mapping", "Financial source or pending event missing");
  });
  await test(3, async () => {
    assert(events.length === 1, "Logical event duplicated");
    const forged = await generator.db.from("accounting_events").insert({ company_id: company.id });
    assert(!!forged.error, "Direct event insert accepted");
  });
  await test(4, async () => {
    await call(generator, "/accounting/demo/configure", "POST", { company_id: company.id, enabled: true, reason: "Prueba sin designación" }, 403);
    await call(generator, "/accounting/demo/designate-company", "POST", { company_id: company.id, reason: "Empresa creada únicamente para demostración sintética Fase 8B" });
    await call(generator, "/accounting/demo/configure", "POST", { company_id: company.id, enabled: true, reason: "Activar exclusivamente configuración DEMO" });
  });

  const postAccounting = (actor: Session, path: string, body: unknown, key?: string) => call(actor, `/accounting/${path}`, "POST", { company_id: company.id, ...(body as object) }, undefined, key);
  await postAccounting(generator, "settings", { functional_currency_id: currency, number_prefix: "DEMO", number_digits: 6 });
  const accountBase = { account_type: "asset", normal_balance: "debit", allows_posting: true, valid_from: "2026-01-01" };
  const debit = await postAccounting(generator, "accounts", { ...accountBase, code: `DEMO_D_${tag.slice(-6)}`, name: `DEMO débito ficticio ${tag}` });
  const credit = await postAccounting(generator, "accounts", { ...accountBase, code: `DEMO_C_${tag.slice(-6)}`, name: `DEMO crédito ficticio ${tag}` });
  const period = await postAccounting(generator, "periods", { year: 2026, month: 9, start_date: "2026-09-01", end_date: "2026-09-30" });
  const entryType = await postAccounting(generator, "entry-types", { code: `demo_${tag.slice(-6).toLowerCase()}`, name: `DEMO tipo ${tag}` });
  const rule = await postAccounting(generator, "rules", {
    code: `DEMO_RULE_${tag.slice(-6)}`, name: `DEMO regla ficticia ${tag}`, source_event: "RECEIVABLE_RECOGNIZED", valid_from: "2026-01-01",
    lines: [
      { account_id: debit.id, side: "debit", description: "DEMO", amount_key: "amount" },
      { account_id: credit.id, side: "credit", description: "DEMO", amount_key: "amount" },
    ],
  });
  await call(validator, `/accounting/rules/${rule.id}/action`, "POST", { action: "activate_simulation", reason: "Activación de regla sintética" });
  await call(validator, `/accounting/rules/${rule.id}/designate-demo`, "POST", { reason: "Regla y cuentas ficticias verificadas por actor independiente" });
  await test(5, async () => {
    assert(/^DEMO/.test(rule.code) && /^DEMO/.test(debit.code) && /^DEMO/.test(credit.code), "Synthetic labels missing");
  });
  const resolved = await call(generator, `/accounting/events/${event.id}/resolve`, "POST", {});
  const journalCountBefore = (await rows(generator, "journal_entries", { company_id: company.id })).length;
  const preview = await call(generator, `/accounting/events/${event.id}/preview`, "POST", {});
  await test(6, async () => {
    assert(resolved.workflow_status === "ready" && preview.valid === true && preview.persisted === false, "Resolve/preview invalid");
    assert((await rows(generator, "journal_entries", { company_id: company.id })).length === journalCountBefore, "Preview persisted journal");
  });
  const generate = () => call(generator, `/accounting/events/${event.id}/generate`, "POST", { period_id: period.id, entry_type_id: entryType.id });
  const drafts = await Promise.all([generate(), generate()]);
  const journal = drafts[0];
  await test(7, async () => {
    assert(drafts[0].id === drafts[1].id, "Concurrent generation duplicated draft");
    assert((await rows(generator, "journal_entries", { accounting_event_id: event.id })).length === 1, "More than one active draft");
  });
  await test(8, async () => {
    await call(generator, `/accounting/journals/${journal.id}/validate`, "POST", {}, 403);
    await call(validator, `/accounting/journals/${journal.id}/validate`, "POST", {});
    await call(validator, `/accounting/journals/${journal.id}/post`, "POST", {}, 403);
    const posted = await call(poster, `/accounting/journals/${journal.id}/post`, "POST", {});
    assert(posted.status === "posted", "Independent posting failed");
  });
  await test(9, async () => {
    const trace = await call(generator, `/accounting/trace?company_id=${company.id}&entity_type=receivable&entity_id=${receivable.id}&page=1&limit=20`);
    const eventDetail = await call(generator, `/accounting/events/${event.id}`);
    const journalDetail = await call(generator, `/accounting/journals/${journal.id}`);
    assert(trace.data.some((item: any) => item.id === event.id) && eventDetail.record.journal_entry_id === journal.id && journalDetail.record.accounting_event_id === event.id, "Bidirectional trace missing");
  });
  await test(10, async () => {
    await call(foreign, `/accounting/events?company_id=${company.id}&page=1&limit=20`, "GET", undefined, 403);
    await call(admin, `/users/${generator.id}/companies`, "PUT", { company_id: company.id, active: false });
    await call(generator, `/accounting/events?company_id=${company.id}&page=1&limit=20`, "GET", undefined, 403);
    assert((await rows(generator, "accounting_events", { company_id: company.id })).length === 0, "Revoked membership leaked REST rows");
    await call(admin, `/users/${generator.id}/companies`, "PUT", { company_id: company.id, active: true });
  });
  await test(11, async () => {
    const dashboard = await call(generator, `/accounting/demo-dashboard?company_id=${company.id}`);
    assert(Array.isArray(dashboard.receivables_outstanding) && typeof dashboard.accounting_pending === "number", "Persisted dashboard unavailable");
  });
  await test(12, async () => {
    const importedRows = [{ code: `DEMO_AFE_${tag.slice(-6)}`, name: `DEMO AFE sin significado ${tag}`, valid_from: "2026-01-01" }];
    const key = randomUUID();
    const before = (await rows(generator, "afes", { company_id: company.id })).length;
    const previewImport = await call(generator, "/accounting/configuration-import/afe", "POST", { company_id: company.id, rows: importedRows, confirm: false }, undefined, key);
    assert(previewImport.status === "preview" && (await rows(generator, "afes", { company_id: company.id })).length === before, "AFE preview persisted");
    await call(generator, "/accounting/configuration-import/afe", "POST", { company_id: company.id, rows: importedRows, confirm: true }, undefined, key);
    await call(generator, "/accounting/configuration-import/afe", "POST", { company_id: company.id, rows: importedRows, confirm: true }, undefined, key);
    assert((await rows(generator, "afes", { company_id: company.id })).filter((item) => item.code === importedRows[0].code).length === 1, "AFE confirmation not idempotent");
  });
  await test(13, async () => {
    const mapping = await call(generator, "/accounting/legacy-mappings", "POST", {
      company_id: company.id, dictionary: "SUBDIARIO", legacy_code: `DEMO_${tag.slice(-6)}`, description: "Significado pendiente de definición empresarial", erp_mapping: {}, valid_from: "2026-01-01", notes: "No inferir significado",
    });
    assert(mapping.version === 1 && Object.keys(mapping.erp_mapping).length === 0, "Legacy meaning was inferred");
  });
  await test(14, async () => {
    const runtime = await fetch(`${cfg.APP_ORIGIN}/api/runtime`).then((response) => response.json());
    assert(runtime.accounting.auto_generate === false && runtime.accounting.auto_post === false && runtime.accounting.production_rules === false, "Productive flag enabled");
    const flags = await rows(generator, "accounting_feature_flags", { company_id: company.id });
    assert(flags[0] && !flags[0].auto_generate && !flags[0].auto_post && !flags[0].production_rules, "Database flags unsafe");
  });
  await test(15, async () => {
    const audit = await rows(generator, "audit_logs", { company_id: company.id });
    const actions = new Set(audit.map((item) => item.action));
    for (const action of ["accounting.captured", "accounting.resolved", "accounting.previewed", "accounting.draft_generated", "accounting.post"]) assert(actions.has(action), `Audit ${action} missing`);
  });
  await test(16, async () => {
    await checkClientBoundary();
    browserServer = await chromium.launchServer({ channel: "msedge", headless: true });
    browser = await chromium.connect(browserServer.wsEndpoint());
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    await page.addInitScript(({ access, refresh, user, companyId }) => {
      sessionStorage.setItem("erp.session", JSON.stringify({ access_token: access, refresh_token: refresh, expires_in: 3600 }));
      localStorage.setItem(`erp.company.${user}`, companyId);
    }, { access: generator.token, refresh: generator.refresh, user: generator.id, companyId: company.id });
    await page.goto(`${cfg.APP_ORIGIN}/app/accounting-events`);
    await page.getByRole("heading", { name: "Operaciones pendientes", exact: true }).waitFor();
    await page.getByRole("button", { name: "Ver trazabilidad", exact: true }).first().click();
    await page.getByText("CONFIGURACIÓN DEMO - NO PRODUCTIVA", { exact: false }).first().waitFor();
    await page.screenshot({ path: `${dir}/capturas/operaciones-contables-dev.png`, fullPage: true });
    const bundleFiles = await readFile("dist/client/index.html", "utf8");
    assert(!bundleFiles.includes(cfg.SUPABASE_SECRET_KEY), "Secret found in client output");
  });
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.incident = error instanceof ProofError ? error.message : "Detalle sensible omitido";
  process.exitCode = 1;
} finally {
  if (browserServer) browserServer.process()?.kill();
  for (const active of sessions) await authAdmin.signOut(active.token, "local").catch(() => {});
  for (const active of sessions.filter((item) => report.fixtures.users?.includes(item.id))) await authAdmin.signOut(active.token, "global").catch(() => {});
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
  await persist();
  console.log(JSON.stringify({ status: report.status, summary: report.summary, incident: report.incident }));
}
