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
  dir = "docs/fase-6",
  tag = "F6_" + new Date().toISOString().replace(/\D/g, "").slice(0, 14);
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
  "Empresa A no accede expediente B",
  "Solicitud VIA y numeración",
  "Autoaprobación rechazada",
  "Anticipo aprobado no pagado",
  "Tesorería entrega anticipo",
  "Rendición menor al anticipo",
  "Devolución calculada exacta",
  "Devolución y conciliación",
  "Rendición mayor al anticipo",
  "Reembolso calculado exacto",
  "Reembolso integrado con Tesorería",
  "Rendición exacta",
  "Comprobante duplicado rechazado",
  "DJ vinculada al gasto",
  "DJ respeta políticas",
  "Ítem observado",
  "Ítem rechazado",
  "Aceptación parcial por política",
  "Dimensiones históricas",
  "Adjuntos cifrados",
  "Revocación bloquea documentos",
  "Cierre con saldo rechazado",
  "Cierre correcto",
  "Reapertura auditada",
  "REST directo bloqueado",
  "Auditoría financiera",
  "Dashboard propio aislado",
  "Dashboard Finanzas",
  "UI DEV sin mocks",
  "Secretos fuera del bundle",
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
    `# Fase 6 · Supabase DEV\n\nEjecución: ${tag}. Estado: ${report.status}. Mismo proyecto que la aplicación: verificado. Sólo fixtures sintéticos.\n\n| N.º | Verificación | Resultado |\n|---|---|---|\n` +
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
) {
  await new Promise((r) => setTimeout(r, 520));
  const response = await fetch(cfg.APP_ORIGIN + "/api" + path, {
    method,
    headers: {
      Authorization: "Bearer " + s.token,
      "Content-Type": "application/json",
      ...(path === "/users" && method === "POST"
        ? { "Idempotency-Key": randomUUID() }
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
  const admin = await session(initial.initialAdministrator);
  const operators: any[] = [];
  for (const kind of ["owner", "reviewer", "approver", "executor", "own"]) {
    const u = await call(admin, "/users", "POST", {
      email: tag.toLowerCase() + "_" + kind + "@example.test",
      username: tag.toLowerCase() + "_" + kind,
      full_name: "PRUEBA DEV " + kind + " " + tag,
      status: "active",
    });
    operators.push(await session(u.id));
  }
  const [owner, reviewer, approver, executor, own] = operators;
  const A = await call(admin, "/companies", "POST", {
      code: tag + "_A",
      legal_name: "DEV sintético " + tag + " A",
      tax_id: tag + "A",
      country_code: "PE",
    }),
    B = await call(admin, "/companies", "POST", {
      code: tag + "_B",
      legal_name: "DEV sintético " + tag + " B",
      tax_id: tag + "B",
      country_code: "PE",
    });
  report.fixtures = {
    companyA: A.id,
    companyB: B.id,
    users: operators.map((s) => s.id),
  };
  await persist();
  const permissions = await list(admin, "/permissions");
  const resources = [
    "employee",
    "expense_category",
    "expense_policy",
    "travel_expense",
    "employee_advance",
    "expense_report",
    "declaration",
    "employee_return",
    "employee_reimbursement",
    "bank",
    "payment_order",
    "payment",
    "payment_batch",
    "bank_transaction",
    "bank_reconciliation",
    "cashflow",
    "payable",
    "supplier",
    "tax_document",
    "cost_center",
    "project",
    "subproject",
  ];
  const role = await call(admin, "/roles", "POST", {
    code: tag.toLowerCase() + "_operator",
    name: "Operador sintético " + tag,
  });
  await call(admin, "/roles/" + role.id + "/permissions", "PUT", {
    permission_ids: permissions
      .filter(
        (p) =>
          p.active &&
          (resources.includes(p.resource) || p.code === "audit.finance_view"),
      )
      .map((p) => p.id),
  });
  for (const s of operators) {
    await call(admin, "/users/" + s.id + "/companies", "PUT", {
      company_id: A.id,
      active: true,
    });
    if (s !== own)
      await call(admin, "/users/" + s.id + "/roles", "PUT", {
        role_id: role.id,
        company_id: A.id,
        assign: true,
      });
  }
  const ownRole = await call(admin, "/roles", "POST", {
    code: tag.toLowerCase() + "_own",
    name: "Sólo propios " + tag,
  });
  await call(admin, "/roles/" + ownRole.id + "/permissions", "PUT", {
    permission_ids: permissions
      .filter((p) =>
        [
          "travel_expense.view_own",
          "travel_expense.create",
          "travel_expense.submit",
          "expense_report.view_own",
          "expense_report.create",
          "expense_report.submit",
          "declaration.create",
        ].includes(p.code),
      )
      .map((p) => p.id),
  });
  await call(admin, "/users/" + own.id + "/roles", "PUT", {
    role_id: ownRole.id,
    company_id: A.id,
    assign: true,
  });
  const post = (s: any, path: string, body: any, expected?: number) =>
    call(s, "/" + path + "?company_id=" + A.id, "POST", body, expected);
  const area = await call(admin, "/areas", "POST", {
    code: tag,
    name: "Área sintética " + tag,
  });
  const currency = (
    await call(owner, "/employee-expenses/options?company_id=" + A.id)
  ).currencies.find((x: any) => x.name === "PEN");
  assert(currency, "PEN currency");
  const center = await post(owner, "cost-centers", {
      code: "F6",
      name: "CECO histórico F6",
    }),
    project = await post(owner, "projects", {
      code: "F6",
      name: "Proyecto F6",
    });
  const employee = await post(owner, "employees", {
    profile_id: null,
    full_name: "Empleado sin cuenta " + tag,
    document_type: "test",
    document_number: tag,
    area_id: area.id,
  });
  const linked = await post(owner, "employees", {
    profile_id: own.id,
    full_name: "Empleado con cuenta " + tag,
    document_type: "test",
    document_number: tag + "LINK",
    area_id: area.id,
  });
  const category = await post(owner, "expense-categories", {
    code: "mobility",
    name: "Movilidad sintética",
  });
  await post(owner, "expense-policies", {
    currency_id: currency.id,
    allow_declarations: true,
    declaration_max_amount: 500,
    declaration_requires_approval: true,
    category_ids: [category.id],
    allow_partial_acceptance: true,
    require_distinct_reviewer: true,
    allow_reopen: true,
    allow_cancel_unpaid_travel: true,
  });
  const bank = await post(owner, "banks", {
      code: "F6",
      name: "Banco sintético F6",
      country_code: "PE",
    }),
    account = await post(owner, "bank-accounts", {
      bank_id: bank.id,
      currency_id: currency.id,
      account_number: "123456789012",
      account_type: "checking",
      display_name: "Cuenta sintética F6",
      opening_balance: 10000,
      opening_date: "2026-09-01",
      valid_from: "2026-09-01",
    }),
    method = await post(owner, "payment-methods", {
      code: "f6",
      name: "Medio sintético F6",
      requires_beneficiary_account: false,
    });
  const travelBase = {
    employee_id: employee.id,
    currency_id: currency.id,
    cost_center_id: center.id,
    project_id: project.id,
    destination: "Destino sintético",
    purpose: "Prueba DEV " + tag,
    start_date: "2026-09-12",
    end_date: "2026-09-13",
    requested_advance_amount: 180,
    items: [
      {
        category_id: category.id,
        description: "Presupuesto sintético",
        estimated_amount: 220,
        cost_center_id: center.id,
        project_id: project.id,
      },
    ],
  };
  const travelAction = (s: any, id: string, action: string, denied = false) =>
    rpc(
      s,
      "travel_expense_transition",
      { target_id: id, action, comment: null },
      denied,
    );
  const reportAction = (
    s: any,
    id: string,
    action: string,
    reason: string | null = null,
    denied = false,
  ) =>
    rpc(
      s,
      "expense_report_transition",
      { target_id: id, action, reason },
      denied,
    );
  const treasury = (
    s: any,
    kind: string,
    id: string,
    action: string,
    payload: any = {},
  ) => rpc(s, "treasury_action", { kind, target_id: id, action, payload });
  const save = (s: any, kind: string, payload: any) =>
    rpc(s, "treasury_save", {
      kind,
      target_id: null,
      target_company: A.id,
      payload,
    });
  const upload = (s: any, kind: string, id: string) =>
    call(s, "/attachments/upload", "POST", {
      company_id: A.id,
      entity_type: kind,
      entity_id: id,
      filename: "fixture.pdf",
      mime_type: "application/pdf",
      base64: Buffer.from(
        "%PDF-1.4\nDocumento exclusivamente sintético " + tag + "\n%%EOF",
      ).toString("base64"),
    });
  async function pay(p: any, approval = approver) {
    const op = await save(owner, "payment_order", {
      beneficiary_type: "employee",
      beneficiary_id: employee.id,
      currency_id: currency.id,
      payment_method_id: method.id,
      requested_payment_date: "2026-09-12",
      description: "OP sintética F6",
      items: [
        { payable_id: p.id, amount_to_pay: Number(p.outstanding_amount) },
      ],
    });
    await treasury(owner, "payment_order", op.id, "submit");
    await treasury(approval, "payment_order", op.id, "approve");
    await treasury(executor, "payment_order", op.id, "schedule", {
      bank_account_id: account.id,
      scheduled_payment_date: "2026-09-12",
    });
    const payment = await save(executor, "payment", {
      payment_order_id: op.id,
      payment_date: "2026-09-12",
      operation_number: randomUUID(),
      allocations: [
        { payable_id: p.id, allocated_amount: Number(p.outstanding_amount) },
      ],
    });
    await upload(executor, "payment", payment.id);
    await treasury(executor, "payment", payment.id, "execute");
    return payment;
  }
  async function makeReport(
    amount: number,
    travel?: any,
    support = "declaration",
    s = owner,
    employeeId = employee.id,
  ) {
    const r = await post(s, "expense-reports", {
      employee_id: employeeId,
      currency_id: currency.id,
      ...(travel ? { travel_expense_request_id: travel.id } : {}),
    });
    const i = await call(s, "/expense-reports/" + r.id + "/items", "POST", {
      expense_date: "2026-09-12",
      category_id: category.id,
      description: "Gasto sintético " + tag,
      reported_amount: amount,
      support_type: support,
      cost_center_id: center.id,
      project_id: project.id,
    });
    return { r, i };
  }
  async function review(f: any, amount = Number(f.i.reported_amount)) {
    if (f.i.support_type === "declaration") {
      const dj = await call(
        owner,
        "/expense-items/" + f.i.id + "/declaration",
        "POST",
        { declared_on: "2026-09-12", reason: "Declaro gasto sintético" },
      );
      await call(
        reviewer,
        "/expense-declarations/" + dj.id + "/decision",
        "POST",
        { approve: true, reason: "Revisión sintética" },
      );
    }
    await reportAction(owner, f.r.id, "submit");
    await call(reviewer, "/expense-items/" + f.i.id + "/review", "POST", {
      decision: "accepted",
      accepted_amount: amount,
      reason: "Revisión sintética",
    });
    await reportAction(approver, f.r.id, "approve");
    return rpc(owner, "expense_settlement_detail", { target_id: f.r.id });
  }
  let travel: any,
    advance: any,
    less: any,
    lessSettlement: any,
    returned: any,
    more: any,
    moreSettlement: any,
    exact: any,
    taxCase: any,
    djCase: any,
    evidence: any;
  await test(2, async () => {
    travel = await post(owner, "travel-expenses", travelBase);
    assert(/^VIA-\d{4}-\d{6}$/.test(travel.request_number), "VIA numbering");
    assert(
      employee.profile_id === null,
      "Offline employee requires no profile",
    );
    await travelAction(owner, travel.id, "submit");
  });
  await test(1, async () => {
    await call(
      owner,
      "/travel-expenses?company_id=" + B.id,
      "GET",
      undefined,
      403,
    );
    await rpc(
      owner,
      "travel_expense_save",
      { target_id: null, target_company: B.id, payload: travelBase },
      true,
    );
    assert(
      (await rows(owner, "travel_expense_requests", { company_id: B.id }))
        .length === 0,
      "Company isolation",
    );
  });
  await test(3, async () => {
    await travelAction(owner, travel.id, "approve", true);
  });
  await test(4, async () => {
    await travelAction(reviewer, travel.id, "approve");
    advance = (
      await rows(owner, "employee_advances", { travel_request_id: travel.id })
    )[0];
    assert(
      Number(advance.paid_amount) === 0 &&
        Number(advance.approved_amount) === 180,
      "Approval is not payment",
    );
  });
  await test(5, async () => {
    await pay(
      (await rows(owner, "payables", { employee_advance_id: advance.id }))[0],
    );
    assert(
      Number(
        (await rows(owner, "employee_advances", { id: advance.id }))[0]
          .paid_amount,
      ) === 180,
      "Treasury derives delivered",
    );
  });
  await test(6, async () => {
    less = await makeReport(160, travel);
    lessSettlement = await review(less);
    assert(
      Number(lessSettlement.accepted_expenses) === 160,
      "Accepted expense",
    );
  });
  await test(7, async () => {
    assert(
      Number(lessSettlement.return_due) === 20 &&
        Number(lessSettlement.reimbursement_due) === 0,
      "Exact return arithmetic",
    );
  });
  await test(22, async () => {
    await reportAction(approver, less.r.id, "close", null, true);
  });
  await test(8, async () => {
    returned = await call(
      owner,
      "/expense-settlements/" + lessSettlement.id + "/returns",
      "POST",
      {
        amount: 20,
        return_date: "2026-09-12",
        payment_method_id: method.id,
        reference: "Retorno sintético",
        idempotency_key: randomUUID(),
      },
    );
    assert(returned.status === "registered", "Registration not reconciliation");
    await upload(owner, "employee_return_evidence", returned.id);
    const period = await save(reviewer, "reconciliation_period", {
      bank_account_id: account.id,
      start_date: "2026-09-01",
      end_date: "2026-09-30",
    });
    const tx = await save(reviewer, "bank_transaction", {
      bank_account_id: account.id,
      transaction_date: "2026-09-12",
      transaction_type: "credit",
      amount: 20,
      bank_reference: tag + "RETURN",
      description: "Retorno sintético",
    });
    const m = await call(
      reviewer,
      "/employee-returns/" + returned.id + "/matches",
      "POST",
      { period_id: period.id, transaction_id: tx.id, amount: 20 },
    );
    assert(
      Number(
        (
          await rpc(owner, "expense_settlement_detail", {
            target_id: less.r.id,
          })
        ).return_outstanding,
      ) === 20,
      "Match alone cannot settle",
    );
    await treasury(reviewer, "reconciliation_match", m.id, "reconcile");
    assert(
      Number(
        (
          await rpc(owner, "expense_settlement_detail", {
            target_id: less.r.id,
          })
        ).return_outstanding,
      ) === 0,
      "Reconciled return clears remainder",
    );
  });
  await test(23, async () => {
    await reportAction(approver, less.r.id, "close");
    assert(
      (await rows(owner, "expense_reports", { id: less.r.id }))[0].status ===
        "settled",
      "Close state",
    );
    assert(
      Number(
        (await rows(owner, "employee_advances", { id: advance.id }))[0]
          .outstanding_to_render,
      ) === 0,
      "Advance applied",
    );
  });
  await test(9, async () => {
    const t = await post(owner, "travel-expenses", travelBase);
    await travelAction(owner, t.id, "submit");
    await travelAction(reviewer, t.id, "approve");
    const a = (
      await rows(owner, "employee_advances", { travel_request_id: t.id })
    )[0];
    await pay(
      (await rows(owner, "payables", { employee_advance_id: a.id }))[0],
    );
    more = await makeReport(220, t);
    moreSettlement = await review(more);
  });
  await test(10, async () => {
    assert(
      Number(moreSettlement.reimbursement_due) === 40 &&
        Number(moreSettlement.return_due) === 0,
      "Exact reimbursement arithmetic",
    );
  });
  await test(11, async () => {
    const e = (
      await rows(owner, "employee_reimbursements", { report_id: more.r.id })
    )[0];
    assert(Number(e.paid_amount) === 0, "Reimbursement not manually paid");
    await pay(
      (await rows(owner, "payables", { employee_reimbursement_id: e.id }))[0],
      reviewer,
    );
    assert(
      Number(
        (await rows(owner, "employee_reimbursements", { id: e.id }))[0]
          .paid_amount,
      ) === 40,
      "Reimbursement paid through allocations",
    );
  });
  await test(12, async () => {
    const t = await post(owner, "travel-expenses", travelBase);
    await travelAction(owner, t.id, "submit");
    await travelAction(reviewer, t.id, "approve");
    const a = (
      await rows(owner, "employee_advances", { travel_request_id: t.id })
    )[0];
    await pay(
      (await rows(owner, "payables", { employee_advance_id: a.id }))[0],
    );
    exact = await makeReport(180, t);
    const s = await review(exact);
    assert(
      Number(s.return_due) === 0 && Number(s.reimbursement_due) === 0,
      "Exact settlement",
    );
    await reportAction(approver, exact.r.id, "close");
  });
  await test(24, async () => {
    await reportAction(approver, exact.r.id, "reopen", null, true);
    await reportAction(
      approver,
      exact.r.id,
      "reopen",
      "Corrección sintética controlada",
    );
    assert(
      (
        await rows(owner, "expense_settlements", { report_id: exact.r.id })
      ).some((x) => x.status === "superseded"),
      "Old settlement preserved",
    );
    const h = await call(
      owner,
      "/expense-reports/" + exact.r.id + "/history?page=1&limit=100",
    );
    assert(
      h.data.some(
        (x: any) => x.action === "reopen" && x.actor_id === approver.id,
      ),
      "Reopen history",
    );
  });
  await test(13, async () => {
    const supplier = await post(owner, "suppliers", {
      tax_id_type: "other",
      tax_id: tag,
      country_code: "PE",
      legal_name: "Proveedor sintético " + tag,
    });
    taxCase = await makeReport(100, undefined, "tax_document");
    const data = {
      supplier_id: supplier.supplier_id,
      document_type: "invoice",
      series: "F6",
      number: "1",
      issue_date: "2026-09-12",
      received_date: "2026-09-12",
      subtotal: 100,
      tax_amount: 0,
      non_taxable_amount: 0,
    };
    await call(
      owner,
      "/expense-items/" + taxCase.i.id + "/tax-document",
      "POST",
      data,
    );
    const duplicate = await makeReport(100, undefined, "tax_document");
    await call(
      owner,
      "/expense-items/" + duplicate.i.id + "/tax-document",
      "POST",
      data,
      409,
    );
  });
  await test(14, async () => {
    djCase = await makeReport(100);
    const d = await call(
      owner,
      "/expense-items/" + djCase.i.id + "/declaration",
      "POST",
      { declared_on: "2026-09-12", reason: "DJ sintética" },
    );
    assert(
      d.item_id === djCase.i.id && d.original_values.item,
      "Structured original DJ",
    );
    await call(
      reviewer,
      "/expense-declarations/" + d.id + "/decision",
      "POST",
      { approve: true, reason: "Revisión" },
    );
    assert(
      (await rows(owner, "expense_report_items", { id: djCase.i.id }))[0]
        .status === "pending",
      "DJ does not accept item",
    );
  });
  await test(15, async () => {
    const f = await makeReport(501);
    await call(
      owner,
      "/expense-items/" + f.i.id + "/declaration",
      "POST",
      { declared_on: "2026-09-12", reason: "Sobre límite" },
      409,
    );
    await reportAction(owner, djCase.r.id, "submit");
  });
  await test(16, async () => {
    await call(reviewer, "/expense-items/" + djCase.i.id + "/review", "POST", {
      decision: "observed",
      accepted_amount: 0,
      reason: "Aclaración requerida",
    });
    assert(
      (await rows(owner, "expense_report_items", { id: djCase.i.id }))[0]
        .status === "observed",
      "Observed item",
    );
  });
  await test(17, async () => {
    await call(reviewer, "/expense-items/" + djCase.i.id + "/review", "POST", {
      decision: "rejected",
      accepted_amount: 0,
      reason: "Rechazo sintético",
    });
    assert(
      Number(
        (await rows(owner, "expense_report_items", { id: djCase.i.id }))[0]
          .rejected_amount,
      ) === 100,
      "Rejected exact amount",
    );
  });
  await test(18, async () => {
    await call(reviewer, "/expense-items/" + djCase.i.id + "/review", "POST", {
      decision: "accepted",
      accepted_amount: 80,
      reason: "Aceptación parcial autorizada",
    });
    const i = (
      await rows(owner, "expense_report_items", { id: djCase.i.id })
    )[0];
    assert(
      Number(i.accepted_amount) === 80 && Number(i.rejected_amount) === 20,
      "Partial acceptance",
    );
  });
  await test(19, async () => {
    const i = (await rows(owner, "expense_report_items", { id: less.i.id }))[0];
    assert(
      i.dimension_snapshot.cost_centers.some((x: any) => x.id === center.id) &&
        i.dimension_snapshot.project.id === project.id &&
        i.dimension_snapshot.employee.area_id === area.id,
      "Historical dimensions",
    );
    await call(
      owner,
      "/cost-centers/" + center.id + "?company_id=" + A.id,
      "PATCH",
      { code: "MUTATE" },
      409,
    );
  });
  await test(20, async () => {
    evidence = await upload(owner, "tax_support", taxCase.i.id);
    const file = await call(owner, "/attachments/" + evidence.id + "/download");
    assert(
      Buffer.from(file.base64, "base64").toString().startsWith("%PDF"),
      "Decrypted authorized download",
    );
    const a = (await rows(owner, "attachments", { id: evidence.id }))[0];
    const blob = await owner.db.storage
      .from(a.storage_bucket)
      .download(a.storage_path);
    assert(!blob.error, "Ciphertext download");
    const bytes = Buffer.from(await blob.data!.arrayBuffer());
    assert(
      !bytes.includes(Buffer.from("%PDF")) && !bytes.includes(Buffer.from(tag)),
      "Storage ciphertext is opaque",
    );
  });
  await test(21, async () => {
    await call(admin, "/users/" + owner.id + "/companies", "PUT", {
      company_id: A.id,
      active: false,
    });
    try {
      await call(
        owner,
        "/attachments/" + evidence.id + "/download",
        "GET",
        undefined,
        404,
      );
    } finally {
      await call(admin, "/users/" + owner.id + "/companies", "PUT", {
        company_id: A.id,
        active: true,
      });
    }
  });
  await test(25, async () => {
    for (const table of [
      "expense_reports",
      "expense_report_items",
      "employee_advances",
      "employee_returns",
      "employee_reimbursements",
    ]) {
      const r = await owner.db
        .from(table)
        .update({ company_id: B.id })
        .eq("id", randomUUID());
      assert(!!r.error, "REST DML denied " + table);
    }
  });
  await test(26, async () => {
    const logs = await rows(owner, "audit_logs", { company_id: A.id });
    assert(
      logs.some((x) => x.category === "finance" && x.user_id),
      "Financial audit company and actor",
    );
    assert(
      !JSON.stringify(logs).includes(cfg.SUPABASE_SECRET_KEY),
      "Secret absent from audit",
    );
  });
  await test(27, async () => {
    await makeReport(5, undefined, "declaration", own, linked.id);
    const d = await call(
      own,
      "/employee-expenses/dashboard?company_id=" + A.id,
    );
    assert(
      d.reports.reduce((n: number, r: any) => n + Number(r.quantity), 0) === 1,
      "Own dashboard excludes other employees",
    );
    assert(
      (await rows(own, "expense_reports")).every(
        (r) => r.employee_id === linked.id,
      ),
      "Own REST scope",
    );
  });
  await test(28, async () => {
    const d = await call(
      owner,
      "/employee-expenses/dashboard?company_id=" + A.id,
    );
    assert(
      d.reports.reduce((n: number, r: any) => n + Number(r.quantity), 0) > 1 &&
        d.settlements.length >= 2,
      "Finance dashboard derived rows",
    );
  });
  await test(29, async () => {
    browserServer = await chromium.launchServer({
      channel: "msedge",
      headless: true,
    });
    browser = await chromium.connect(browserServer.wsEndpoint());
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    await page.addInitScript(
      ({ token, refresh, c, user }) => {
        sessionStorage.setItem(
          "erp.session",
          JSON.stringify({
            access_token: token,
            refresh_token: refresh,
            expires_in: 3600,
          }),
        );
        localStorage.setItem("erp.company." + user, c);
      },
      { token: owner.token, refresh: owner.refresh, c: A.id, user: owner.id },
    );
    await page.goto(cfg.APP_ORIGIN + "/app/expense-reports");
    await page
      .getByRole("cell", { name: less.r.report_number, exact: true })
      .waitFor();
    await page
      .getByRole("row")
      .filter({ hasText: less.r.report_number })
      .getByRole("button", { name: "Ver expediente" })
      .click();
    await page.getByText("Anticipo entregado", { exact: true }).waitFor();
    await page.getByText(/^Página 1 · [1-9]\d* eventos$/).waitFor();
    await page.screenshot({
      path: dir + "/capturas/rendicion-dev.png",
      fullPage: true,
    });
    await page.close();
  });
  await test(30, async () => {
    await checkClientBoundary();
  });
  const concurrent = await makeReport(10);
  const d = await call(
    owner,
    "/expense-items/" + concurrent.i.id + "/declaration",
    "POST",
    { declared_on: "2026-09-12", reason: "Concurrencia sintética" },
  );
  await call(reviewer, "/expense-declarations/" + d.id + "/decision", "POST", {
    approve: true,
    reason: "Revisión",
  });
  await reportAction(owner, concurrent.r.id, "submit");
  await call(
    reviewer,
    "/expense-items/" + concurrent.i.id + "/review",
    "POST",
    { decision: "accepted", accepted_amount: 10, reason: "Revisión" },
  );
  await Promise.all([
    reportAction(approver, concurrent.r.id, "approve"),
    reportAction(approver, concurrent.r.id, "approve"),
  ]);
  assert(
    (
      await rows(owner, "employee_reimbursements", {
        report_id: concurrent.r.id,
      })
    ).length === 1,
    "Concurrent reimbursement unique",
  );
  report.additional.push({
    name: "Dos aprobaciones RPC concurrentes generan una obligación",
    status: "PASS",
  });
  await Promise.all([
    reportAction(approver, more.r.id, "close"),
    reportAction(approver, more.r.id, "close"),
  ]);
  assert(
    (
      await rows(owner, "expense_report_history", { report_id: more.r.id })
    ).filter((x) => x.action === "close").length === 1,
    "Concurrent close applies once",
  );
  report.additional.push({
    name: "Dos cierres concurrentes aplican una liquidación",
    status: "PASS",
  });
  const ct = await post(owner, "travel-expenses", travelBase);
  await travelAction(owner, ct.id, "submit");
  await Promise.all([
    travelAction(reviewer, ct.id, "approve"),
    travelAction(reviewer, ct.id, "approve"),
  ]);
  const ca = await rows(owner, "employee_advances", {
    travel_request_id: ct.id,
  });
  assert(ca.length === 1, "Concurrent VIA has one advance");
  report.additional.push({
    name: "Retry concurrente VIA no duplica anticipo",
    status: "PASS",
  });
  await pay(
    (await rows(owner, "payables", { employee_advance_id: ca[0].id }))[0],
  );
  const cr = await makeReport(160, ct),
    cs = await review(cr);
  const attempts = await Promise.all(
    [1, 2].map(() =>
      owner.db.rpc("employee_return_register", {
        settlement_id: cs.id,
        payload: {
          amount: 20,
          return_date: "2026-09-12",
          payment_method_id: method.id,
          reference: "Concurrencia DEV",
          idempotency_key: randomUUID(),
        },
      }),
    ),
  );
  assert(
    attempts.filter((x) => !x.error).length === 1 &&
      attempts.filter((x) => x.error?.code === "23514").length === 1,
    "Only one concurrent return consumes remainder",
  );
  assert(
    (await rows(owner, "employee_returns", { settlement_id: cs.id })).length ===
      1,
    "No duplicate reservation",
  );
  report.additional.push({
    name: "Dos devoluciones concurrentes consumen una vez el mismo remanente",
    status: "PASS",
  });
  report.status = "PASS";
} catch (e) {
  report.status = "FAIL";
  report.error =
    e instanceof ProofError
      ? e.message
      : "Verificación detenida; detalle sensible omitido";
  console.log(report.error);
  process.exitCode = 1;
} finally {
  await persist();
  if (browserServer) browserServer.process()?.kill();
  for (const s of sessions)
    await authAdmin.signOut(s.token, "local").catch(() => {});
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
  // Supabase/browser transport handles can otherwise keep this one-shot verifier alive.
  process.exit(process.exitCode ?? 0);
}
