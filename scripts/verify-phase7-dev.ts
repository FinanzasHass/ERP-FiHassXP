import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { createApp } from "../src/server/app.js";
import { readConfig } from "../src/server/config/env.js";
import { createAuthentication } from "../src/server/services/authentication.js";
import { createPrivilegedAuth } from "../src/server/integrations/supabase/auth-admin.js";
import { createSessionRepository } from "../src/server/repositories/session-repository.js";
import { checkClientBoundary } from "./check-client-boundary.mjs";
const cfg = readConfig(process.env),
  dir = "docs/fase-7",
  tag = "F7_" + new Date().toISOString().replace(/\D/g, "").slice(0, 14);
if (
  cfg.NODE_ENV === "production" ||
  !["localhost", "127.0.0.1"].includes(new URL(cfg.APP_ORIGIN).hostname)
)
  throw new Error("DEV only");
const ref = (await readFile("supabase/.temp/project-ref", "utf8")).trim();
if (new URL(cfg.SUPABASE_URL).hostname !== ref + ".supabase.co")
  throw new Error("DEV project mismatch");
const migration = JSON.parse(
  await readFile(dir + "/migraciones-dev.json", "utf8"),
);
if (migration.status !== "PASS")
  throw new Error("DEV migrations must be verified first");
const initial = JSON.parse(
  await readFile("docs/fase-3.1/fixtures-dev.json", "utf8"),
);
// This verification-only adapter exposes Auth operations, never a privileged DB client.
const authAdmin = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
}).auth.admin;
const publicAuth = createClient(
  cfg.SUPABASE_URL,
  cfg.SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
).auth;
const sessions: any[] = [];
let server: any, browser: any, browserServer: any;
class ProofError extends Error {}
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new ProofError(message);
};
const names = [
  "Cliente A no visible en B",
  "Crear cliente independiente de Auth",
  "Documento duplicado rechazado",
  "Crear CxC autorizada",
  "Generar cronograma",
  "Cobro parcial",
  "Cobro completo",
  "Varios cobros sobre una CxC",
  "Un cobro aplicado a varias CxC",
  "Saldo pendiente derivado",
  "Estado collected no editable",
  "Depósito sin identificar",
  "Identificar cliente",
  "Identificar no concilia banco",
  "Aplicar depósito",
  "Candidatos sugeridos sin asignación automática",
  "Saldo a favor preservado",
  "Aplicar saldo a favor posteriormente",
  "Reverso restaura CxC",
  "Moneda distinta rechazada",
  "Empresa distinta rechazada",
  "Cuota vencida derivada",
  "Aging por vencimiento",
  "Membresía respeta configuración",
  "Contrato de lote y cronograma",
  "Cash Flow sin doble conteo",
  "Conciliación bancaria de cobro",
  "Revocación de membership inmediata",
  "REST directo no evade controles",
  "Auditoría con empresa y actor",
  "Dashboard Cobranzas",
  "Dashboard Finanzas y Cash Flow",
  "UI DEV real sin mocks",
  "Secretos fuera del bundle y logs",
];
const report: any = {
  run: tag,
  environment: "DEV",
  sameProjectAsApplication: true,
  startedAt: new Date().toISOString(),
  status: "RUNNING",
  results: names.map((name, i) => ({ id: i + 1, name, status: "NOT_RUN" })),
  additional: [],
  fixtures: {},
};
await mkdir(dir + "/historico", { recursive: true });
await mkdir(dir + "/capturas", { recursive: true });
try {
  await copyFile(
    dir + "/resultado-dev.json",
    dir + "/historico/resultado-dev-anterior-" + Date.now() + ".json",
  );
} catch (e: any) {
  if (e.code !== "ENOENT") throw e;
}
async function persist() {
  report.updatedAt = new Date().toISOString();
  report.summary = {
    pass: report.results.filter((x: any) => x.status === "PASS").length,
    fail: report.results.filter((x: any) => x.status === "FAIL").length,
    notRun: report.results.filter((x: any) => x.status === "NOT_RUN").length,
  };
  await writeFile(dir + "/resultado-dev.json", JSON.stringify(report, null, 2));
  await writeFile(
    dir + "/resultado-dev.md",
    `# Fase 7 · Supabase DEV\n\nEjecución: ${tag}. Estado: ${report.status}. Mismo proyecto que la aplicación: verificado. Sólo fixtures sintéticos.\n\n| N.º | Verificación | Resultado |\n|---|---|---|\n` +
      report.results
        .map((r: any) => `| ${r.id} | ${r.name} | ${r.status} |`)
        .join("\n") +
      "\n\nConcurrencia adicional: " +
      JSON.stringify(report.additional) +
      "\n",
  );
}
async function test(n: number, fn: () => Promise<void>) {
  try {
    await fn();
    report.results[n - 1].status = "PASS";
    console.log("PASS " + n + " " + names[n - 1]);
  } catch (e) {
    report.results[n - 1].status = "FAIL";
    report.results[n - 1].evidence =
      e instanceof ProofError ? e.message : "Detalle sensible omitido";
    throw e;
  } finally {
    await persist();
  }
}
async function session(id: string) {
  const u = await authAdmin.getUserById(id);
  assert(!u.error, "Auth identity unavailable");
  const l = await authAdmin.generateLink({
    type: "magiclink",
    email: u.data.user!.email!,
  });
  assert(!l.error, "Auth link unavailable");
  const r = await publicAuth.verifyOtp({
    type: "magiclink",
    token_hash: l.data!.properties!.hashed_token!,
  });
  assert(!r.error && r.data.session, "Auth session unavailable");
  const token = r.data.session!.access_token;
  const s = {
    id,
    token,
    refresh: r.data.session!.refresh_token,
    db: createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
      global: { headers: { Authorization: "Bearer " + token } },
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
  sessions.push(s);
  return s;
}
async function call(
  s: any,
  path: string,
  method = "GET",
  body?: any,
  expected?: number,
  operationKey?: string,
) {
  await new Promise((r) => setTimeout(r, 520));
  const response = await fetch(cfg.APP_ORIGIN + "/api" + path, {
    method,
    headers: {
      Authorization: "Bearer " + s.token,
      "Content-Type": "application/json",
      ...(method === "POST"
        ? { "Idempotency-Key": operationKey ?? randomUUID() }
        : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = response.status === 204 ? null : await response.json();
  assert(
    expected !== undefined ? response.status === expected : response.ok,
    `${method} ${path.split("?")[0]} status ${response.status}${data?.error ? " " + data.error : ""}`,
  );
  return data;
}
async function list(s: any, path: string) {
  let rows: any[] = [];
  for (let p = 1; p <= 100; p++) {
    const r = await call(
      s,
      path + (path.includes("?") ? "&" : "?") + "page=" + p + "&limit=100",
    );
    rows.push(...r.data);
    if (rows.length >= r.count) return rows;
  }
  throw new ProofError("Pagination limit");
}
async function rpc(s: any, name: string, args: any, denied = false) {
  const r = await s.db.rpc(name, args);
  assert(
    denied ? !!r.error : !r.error,
    `${name}: ${denied ? "expected rejection" : r.error?.code || "unexpected result"}`,
  );
  return r.data;
}
async function rows(s: any, table: string, filters: any = {}) {
  let q = s.db.from(table).select("*");
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  const r = await q;
  assert(!r.error, "REST read " + table + " " + (r.error?.code || ""));
  return r.data as any[];
}
try {
  server = createApp(cfg, {
    auth: createAuthentication(cfg),
    privileged: createPrivilegedAuth(cfg),
    repository: (t) => createSessionRepository(cfg, t),
  }).listen(cfg.PORT, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", () =>
      reject(new ProofError("Local API port unavailable")),
    );
  });
  const admin = await session(initial.initialAdministrator),
    operators: any[] = [];
  for (const kind of ["owner", "reconciler", "foreign"]) {
    const u = await call(admin, "/users", "POST", {
      email: tag.toLowerCase() + "_" + kind + "@example.test",
      username: tag.toLowerCase() + "_" + kind,
      full_name: "PRUEBA DEV " + kind + " " + tag,
      status: "active",
    });
    operators.push(await session(u.id));
  }
  const [owner, reconciler, foreign] = operators;
  const companies: any[] = [];
  for (const suffix of ["A", "B"])
    companies.push(
      await call(admin, "/companies", "POST", {
        code: tag + "_" + suffix,
        legal_name: "DEV sintético " + tag + " " + suffix,
        tax_id: tag + suffix,
        country_code: "PE",
      }),
    );
  const [A, B] = companies;
  report.fixtures = {
    companyA: A.id,
    companyB: B.id,
    users: operators.map((s) => s.id),
  };
  await persist();
  const perms = await list(admin, "/permissions"),
    resources = [
      "customer",
      "receivable",
      "collection",
      "receivable_schedule",
      "membership",
      "lot_receivable",
      "receivable_report",
      "collection_report",
      "bank",
      "bank_transaction",
      "bank_reconciliation",
      "cashflow",
    ];
  const role = await call(admin, "/roles", "POST", {
    code: tag.toLowerCase() + "_operator",
    name: "Operador sintético " + tag,
  });
  await call(admin, "/roles/" + role.id + "/permissions", "PUT", {
    permission_ids: perms
      .filter(
        (p) =>
          p.active &&
          (resources.includes(p.resource) || p.code === "audit.finance_view"),
      )
      .map((p) => p.id),
  });
  for (const s of operators) {
    const company = s === foreign ? B.id : A.id;
    await call(admin, "/users/" + s.id + "/companies", "PUT", {
      company_id: company,
      active: true,
    });
    await call(admin, "/users/" + s.id + "/roles", "PUT", {
      role_id: role.id,
      company_id: company,
      assign: true,
    });
  }
  const post = (path: string, body: any, s = owner, company = A.id) =>
    call(s, "/" + path + "?company_id=" + company, "POST", body);
  const options = await call(
      owner,
      "/receivable-context/options?company_id=" + A.id,
    ),
    currency = options.currencies.find((x: any) => x.name === "PEN").id,
    usd = options.currencies.find((x: any) => x.name === "USD").id;
  const bank = await post("banks", {
    code: "F7",
    name: "Banco sintético F7",
    country_code: "PE",
  });
  const account = await post("bank-accounts", {
    bank_id: bank.id,
    currency_id: currency,
    account_number: "123456789012",
    account_type: "checking",
    display_name: "Cuenta sintética F7",
    opening_balance: 0,
    opening_date: "2020-01-01",
    valid_from: "2020-01-01",
  });
  let customer: any, debt: any, collection: any, schedule: any, source: any;
  const customerPayload = {
    customer_type: "natural",
    document_type: "TEST",
    document_number: tag,
    legal_name: "Cliente sintético " + tag,
  };
  const obligation = (
    amount: number,
    extra: any = {},
    s = owner,
    company = A.id,
  ) =>
    post(
      "receivables",
      {
        customer_id: customer.id,
        source_type: "manual_authorized",
        currency_id: currency,
        issue_date: "2026-09-01",
        due_date: "2026-09-30",
        original_amount: amount,
        description: "Obligación sintética " + tag,
        ...extra,
      },
      s,
      company,
    );
  const identify = (id: string, cid = customer.id, key = randomUUID()) =>
    call(
      owner,
      "/collections/" + id + "/identify",
      "POST",
      { customer_id: cid, reason: "Identificación sintética " + tag },
      undefined,
      key,
    );
  const apply = (id: string, allocations: any[], key = randomUUID()) =>
    call(
      owner,
      "/collections/" + id + "/apply",
      "POST",
      { allocations },
      undefined,
      key,
    );
  const amount = (r: any, field: string) => Number(r[field]);
  const dbDebt = async (id: string) =>
    (await call(owner, "/receivables/" + id)).record;
  const dbCollection = async (id: string) =>
    (await call(owner, "/collections/" + id)).record;
  async function credit(n: number) {
    const external = randomUUID();
    await rpc(owner, "treasury_import", {
      target_company: A.id,
      account_id: account.id,
      source_filename: "synthetic-" + tag + ".csv",
      column_mapping: {},
      rows: [
        {
          transaction_date: "2026-09-13",
          transaction_type: "credit",
          amount: n,
          currency_code: "PEN",
          bank_reference: tag,
          description: "Depósito sintético",
          external_id: external,
        },
      ],
      confirm: true,
    });
    const txn = (
      await rows(owner, "bank_transactions", {
        company_id: A.id,
        external_id: external,
      })
    )[0];
    assert(txn, "Imported credit missing");
    const coll = await post("collections", { bank_transaction_id: txn.id });
    return coll;
  }
  await test(2, async () => {
    customer = await post("customers", customerPayload);
    assert(customer.id && !("profile_id" in customer), "Independent customer");
  });
  await test(1, async () => {
    assert(
      (await rows(foreign, "customers", { id: customer.id })).length === 0,
      "Foreign customer leaked",
    );
    await call(foreign, "/customers/" + customer.id, "GET", undefined, 404);
  });
  await test(3, async () => {
    await rpc(
      owner,
      "customer_save",
      {
        target_id: null,
        target_company: A.id,
        payload: { ...customerPayload, document_number: tag.toLowerCase() },
      },
      true,
    );
  });
  await test(4, async () => {
    debt = await obligation(100);
    assert(/^CXC-\d{4}-\d{6}$/.test(debt.receivable_number), "Visible number");
  });
  await test(5, async () => {
    source = await post("receivable-sources", {
      source_type: "membership",
      customer_id: customer.id,
      currency_id: currency,
      reference: "MEM-" + tag,
      description: "Membresía sintética",
      plan_name: "Plan de prueba",
      start_date: "2020-01-01",
      end_date: "2026-12-31",
      periodic_amount: 25,
      period_months: 1,
    });
    schedule = await call(
      owner,
      "/receivable-sources/" + source.id + "/schedules",
      "POST",
      {
        period_reference: "2020",
        issue_date: "2020-01-01",
        installments: [
          { due_date: "2020-01-01", amount: 25 },
          { due_date: "2020-02-01", amount: 25 },
        ],
      },
    );
    assert(amount(schedule, "total_amount") === 50, "Configured total");
  });
  await test(12, async () => {
    collection = await credit(180);
    assert(
      (await dbCollection(collection.id)).financial_status === "unidentified",
      "Initial unidentified state",
    );
    const q = await call(owner, "/collection-deposits?company_id=" + A.id);
    assert(
      q.data.some((r: any) => r.collection_id === collection.id),
      "Deposit absent from queue",
    );
  });
  await test(16, async () => {
    const candidates = await call(
      owner,
      "/collections/" + collection.id + "/candidates",
    );
    assert(
      candidates.some(
        (r: any) => r.customer_id === customer.id && r.score >= 100,
      ),
      "Document candidate",
    );
    assert(
      (await dbCollection(collection.id)).customer_id === null,
      "Suggestion identified automatically",
    );
  });
  await test(13, async () => {
    await identify(collection.id);
    assert(
      (await dbCollection(collection.id)).customer_id === customer.id,
      "Identification missing",
    );
  });
  await test(14, async () => {
    assert(
      (
        await rows(owner, "bank_reconciliation_matches", {
          collection_id: collection.id,
        })
      ).length === 0,
      "Identification reconciled bank",
    );
  });
  await test(6, async () => {
    await apply(collection.id, [{ receivable_id: debt.id, amount: 40 }]);
    assert(
      amount(await dbDebt(debt.id), "outstanding_amount") === 60,
      "Partial balance",
    );
  });
  await test(7, async () => {
    await apply(collection.id, [{ receivable_id: debt.id, amount: 60 }]);
    assert(
      (await dbDebt(debt.id)).financial_status === "collected",
      "Full collection",
    );
  });
  await test(15, async () => {
    assert(
      amount(await dbCollection(collection.id), "applied_amount") === 100,
      "Applied deposit amount",
    );
  });
  await test(8, async () => {
    const d = await obligation(40),
      a = await credit(20),
      b = await credit(20);
    await identify(a.id);
    await identify(b.id);
    await apply(a.id, [{ receivable_id: d.id, amount: 20 }]);
    await apply(b.id, [{ receivable_id: d.id, amount: 20 }]);
    assert(
      amount(await dbDebt(d.id), "outstanding_amount") === 0,
      "Multiple collections",
    );
  });
  await test(9, async () => {
    const left = await obligation(20),
      right = await obligation(30);
    await apply(collection.id, [
      { receivable_id: left.id, amount: 20 },
      { receivable_id: right.id, amount: 30 },
    ]);
    assert(
      amount(await dbDebt(left.id), "outstanding_amount") === 0 &&
        amount(await dbDebt(right.id), "outstanding_amount") === 0,
      "Multiple obligations",
    );
  });
  await test(10, async () => {
    const r = await dbDebt(debt.id);
    assert(
      amount(r, "original_amount") - amount(r, "collected_amount") ===
        amount(r, "outstanding_amount"),
      "Derived balance",
    );
  });
  await test(11, async () => {
    const r = await owner.db
      .from("receivables")
      .update({ status: "collected" })
      .eq("id", debt.id);
    assert(!!r.error, "Manual collected accepted");
  });
  await test(17, async () =>
    assert(
      amount(await dbCollection(collection.id), "unapplied_amount") === 30,
      "Customer credit lost",
    ),
  );
  await test(18, async () => {
    const later = await obligation(30);
    await apply(collection.id, [{ receivable_id: later.id, amount: 30 }]);
    assert(
      amount(await dbDebt(later.id), "outstanding_amount") === 0,
      "Later credit application",
    );
  });
  await test(19, async () => {
    await call(owner, "/collections/" + collection.id + "/reverse", "POST", {
      reason: "Corrección sintética",
    });
    assert(
      amount(await dbDebt(debt.id), "outstanding_amount") === 100,
      "Reversal did not restore receivable",
    );
  });
  let remaining: any;
  await test(20, async () => {
    remaining = await credit(10);
    await identify(remaining.id);
    const different = await obligation(10, { currency_id: usd });
    await rpc(
      owner,
      "collection_apply",
      {
        target_id: remaining.id,
        payload: { allocations: [{ receivable_id: different.id, amount: 10 }] },
        operation_key: randomUUID(),
      },
      true,
    );
  });
  await test(21, async () => {
    const foreignCustomer = await post(
        "customers",
        customerPayload,
        foreign,
        B.id,
      ),
      foreignDebt = await obligation(
        10,
        { customer_id: foreignCustomer.id },
        foreign,
        B.id,
      );
    await rpc(
      owner,
      "collection_apply",
      {
        target_id: remaining.id,
        payload: {
          allocations: [{ receivable_id: foreignDebt.id, amount: 10 }],
        },
        operation_key: randomUUID(),
      },
      true,
    );
  });
  await test(22, async () => {
    const obligations = await rows(owner, "receivable_balances", {
      source_id: source.id,
    });
    assert(
      obligations.length === 2 &&
        obligations.every(
          (r) => r.financial_status === "overdue" && r.days_overdue > 90,
        ),
      "Overdue installments not derived",
    );
  });
  await test(23, async () => {
    const dashboard = await call(
      owner,
      "/receivable-context/dashboard?company_id=" + A.id,
    );
    assert(
      dashboard.aging.some(
        (r: any) => r.bucket === "over_90" && Number(r.amount) >= 50,
      ),
      "Aging bucket missing",
    );
  });
  await test(24, async () => {
    await rpc(
      owner,
      "receivable_schedule_generate",
      {
        source_id: source.id,
        payload: {
          period_reference: "INVALID",
          issue_date: "2020-01-01",
          installments: [{ due_date: "2020-03-01", amount: 26 }],
        },
        operation_key: randomUUID(),
      },
      true,
    );
    const obligations = await rows(owner, "receivable_balances", {
      source_id: source.id,
    });
    assert(
      obligations.length === 2 &&
        obligations.every((r) => Number(r.original_amount) === 25),
      "Configured membership amounts changed",
    );
  });
  await test(25, async () => {
    const lot = await post("receivable-sources", {
      source_type: "lot_sale",
      customer_id: customer.id,
      currency_id: currency,
      reference: "LOT-" + tag,
      description: "Contrato financiero sintético",
      lot_identifier: "EXTERNAL-" + tag,
      agreed_price: 100,
      down_payment: 20,
    });
    const s = await call(
      owner,
      "/receivable-sources/" + lot.id + "/schedules",
      "POST",
      {
        period_reference: "CONTRACT",
        issue_date: "2026-09-01",
        installments: [
          { due_date: "2026-09-01", amount: 20 },
          { due_date: "2026-10-01", amount: 80 },
        ],
      },
    );
    assert(Number(s.total_amount) === 100, "Lot total");
  });
  await test(26, async () => {
    const before = await call(owner, "/treasury/cashflow?company_id=" + A.id);
    await apply(remaining.id, [{ receivable_id: debt.id, amount: 10 }]);
    const after = await call(owner, "/treasury/cashflow?company_id=" + A.id);
    assert(
      JSON.stringify(before.actual) === JSON.stringify(after.actual) &&
        JSON.stringify(before.position) === JSON.stringify(after.position),
      "Double counted collection",
    );
    assert(
      after.expected_receivables.length > 0,
      "Expected receivables missing",
    );
  });
  await test(27, async () => {
    const period = await post("reconciliation-periods", {
      bank_account_id: account.id,
      start_date: "2026-09-01",
      end_date: "2026-09-30",
    });
    await rpc(
      owner,
      "collection_match",
      {
        target_id: remaining.id,
        period_id: period.id,
        transaction_id: remaining.bank_transaction_id,
        amount: 10,
      },
      true,
    );
    const match = await call(
      reconciler,
      "/collections/" + remaining.id + "/matches",
      "POST",
      {
        period_id: period.id,
        transaction_id: remaining.bank_transaction_id,
        amount: 10,
      },
    );
    assert(match.status === "matched", "Match missing");
    const result = await call(
      reconciler,
      "/reconciliation-matches/" + match.id + "/actions",
      "POST",
      { action: "reconcile", payload: {} },
    );
    assert(result.status === "reconciled", "Reconciliation missing");
  });
  await test(28, async () => {
    await call(admin, "/users/" + owner.id + "/companies", "PUT", {
      company_id: A.id,
      active: false,
    });
    await call(owner, "/receivables?company_id=" + A.id, "GET", undefined, 403);
    assert(
      (await rows(owner, "receivables", { company_id: A.id })).length === 0,
      "Revoked RLS leaked",
    );
    await call(admin, "/users/" + owner.id + "/companies", "PUT", {
      company_id: A.id,
      active: true,
    });
  });
  await test(29, async () => {
    for (const table of [
      "receivables",
      "collections",
      "collection_allocations",
    ]) {
      const r = await owner.db.from(table).delete().eq("company_id", A.id);
      assert(!!r.error, "DELETE allowed " + table);
    }
    await rpc(
      owner,
      "treasury_action_before_collection",
      {
        kind: "reconciliation_period",
        target_id: randomUUID(),
        action: "close",
        payload: {},
      },
      true,
    );
  });
  await test(30, async () => {
    const audit = await rows(owner, "audit_logs", {
      company_id: A.id,
      entity_type: "collections",
    });
    assert(
      audit.length > 0 &&
        audit.every(
          (r) => r.category === "finance" && r.user_id && r.company_id === A.id,
        ),
      "Audit context missing",
    );
  });
  await test(31, async () => {
    const dashboard = await call(
      owner,
      "/receivable-context/dashboard?company_id=" + A.id,
    );
    assert(
      dashboard.portfolio.length &&
        dashboard.collections.length &&
        dashboard.customer_portfolio.length,
      "Collection dashboard empty",
    );
  });
  await test(32, async () => {
    const cashflow = await call(
      reconciler,
      "/treasury/cashflow?company_id=" + A.id,
    );
    assert(
      cashflow.actual.length &&
        cashflow.position.length &&
        cashflow.expected_receivables.length,
      "Finance dashboard absent",
    );
  });
  // Independent HTTPS requests establish real concurrent PostgreSQL transactions in DEV.
  async function parallel(name: string, fn: () => Promise<void>) {
    const r: any = { name, status: "RUNNING" };
    report.additional.push(r);
    try {
      await fn();
      r.status = "PASS";
      console.log("PASS CONCURRENT " + name);
    } catch (e) {
      r.status = "FAIL";
      throw e;
    } finally {
      await persist();
    }
  }
  const args = (coll: any, d: any, key = randomUUID()) => ({
    target_id: coll.id,
    payload: { allocations: [{ receivable_id: d.id, amount: 10 }] },
    operation_key: key,
  });
  await parallel("Dos cobros sobre el mismo pendiente", async () => {
    const d = await obligation(10),
      a = await credit(10),
      b = await credit(10);
    await identify(a.id);
    await identify(b.id);
    const result = await Promise.all([
      owner.db.rpc("collection_apply", args(a, d)),
      owner.db.rpc("collection_apply", args(b, d)),
    ]);
    assert(
      result.filter((r) => !r.error).length === 1 &&
        amount(await dbDebt(d.id), "outstanding_amount") === 0,
      "Concurrent debt consumed twice",
    );
  });
  await parallel("Dos aplicaciones del mismo saldo a favor", async () => {
    const a = await obligation(10),
      b = await obligation(10),
      coll = await credit(10);
    await identify(coll.id);
    const result = await Promise.all([
      owner.db.rpc("collection_apply", args(coll, a)),
      owner.db.rpc("collection_apply", args(coll, b)),
    ]);
    assert(
      result.filter((r) => !r.error).length === 1,
      "Concurrent credit spent twice",
    );
  });
  await parallel("Reintento identificar y aplicar", async () => {
    const coll = await credit(10),
      d = await obligation(10),
      p = {
        target_id: coll.id,
        customer_id: customer.id,
        reason: "Concurrent retry",
        operation_key: randomUUID(),
      };
    const ids = await Promise.all([
      owner.db.rpc("collection_identify", p),
      owner.db.rpc("collection_identify", p),
    ]);
    assert(
      ids.every((r) => !r.error),
      "Identify retry failed",
    );
    const a = args(coll, d),
      result = await Promise.all([
        owner.db.rpc("collection_apply", a),
        owner.db.rpc("collection_apply", a),
      ]);
    assert(
      result.every((r) => !r.error) &&
        (
          await rows(owner, "collection_allocations", {
            collection_id: coll.id,
          })
        ).length === 1,
      "Apply retry duplicated",
    );
  });
  await parallel("Reverso concurrente", async () => {
    const coll = await credit(10),
      d = await obligation(10);
    await identify(coll.id);
    await apply(coll.id, [{ receivable_id: d.id, amount: 10 }]);
    const result = await Promise.all(
      [0, 1].map(() =>
        owner.db.rpc("collection_reverse", {
          target_id: coll.id,
          reason: "Concurrent reverse",
          operation_key: randomUUID(),
        }),
      ),
    );
    assert(
      result.filter((r) => !r.error).length === 1 &&
        amount(await dbDebt(d.id), "outstanding_amount") === 10,
      "Reverse duplicated",
    );
  });
  await test(33, async () => {
    browserServer = await chromium.launchServer({
      channel: "msedge",
      headless: true,
    });
    browser = await chromium.connect(browserServer.wsEndpoint());
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1050 },
    });
    await page.addInitScript(
      ({ access, refresh, user, company }: any) => {
        sessionStorage.setItem(
          "erp.session",
          JSON.stringify({
            access_token: access,
            refresh_token: refresh,
            expires_in: 3600,
          }),
        );
        localStorage.setItem("erp.company." + user, company);
      },
      {
        access: owner.token,
        refresh: owner.refresh,
        user: owner.id,
        company: A.id,
      },
    );
    await page.goto(cfg.APP_ORIGIN + "/app/customers");
    await page
      .getByRole("cell", { name: customerPayload.legal_name, exact: true })
      .waitFor();
    await page.goto(cfg.APP_ORIGIN + "/app/receivable-dashboard");
    await page
      .getByRole("heading", {
        name: "Antigüedad de saldos pendientes",
        exact: true,
      })
      .waitFor();
    await page.getByText("Más de 90 días", { exact: true }).waitFor();
    await page.screenshot({
      path: dir + "/capturas/cobranzas-dev.png",
      fullPage: true,
    });
    await page.goto(cfg.APP_ORIGIN + "/app/collections");
    await page
      .getByRole("cell", { name: collection.collection_number, exact: true })
      .waitFor();
    await page
      .getByRole("row")
      .filter({ hasText: remaining.collection_number })
      .getByRole("button", { name: "Aplicaciones", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("cell", { name: debt.id, exact: true })
      .waitFor();
    await page.screenshot({
      path: dir + "/capturas/cobros-dev.png",
      fullPage: true,
    });
  });
  await test(34, async () => {
    await checkClientBoundary();
    const appSources = await readFile("src/client/receivables.tsx", "utf8");
    assert(
      !appSources.includes(cfg.SUPABASE_SECRET_KEY),
      "Secret in UI source",
    );
  });
  report.status = "PASS";
} catch (e) {
  report.status = "FAIL";
  report.incident =
    e instanceof ProofError ? e.message : "Detalle sensible omitido";
  process.exitCode = 1;
} finally {
  if (browserServer) browserServer.process()?.kill();
  for (const s of sessions)
    await authAdmin.signOut(s.token, "local").catch(() => {});
  // Revoke only synthetic verification users, never the initial administrator's other sessions.
  for (const s of sessions.filter((s) => report.fixtures.users?.includes(s.id)))
    await authAdmin.signOut(s.token, "global").catch(() => {});
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await persist();
  console.log(
    JSON.stringify({
      status: report.status,
      summary: report.summary,
      incident: report.incident,
    }),
  );
  process.exit(process.exitCode ?? 0);
}
