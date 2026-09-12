import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { checkClientBoundary } from "./check-client-boundary.mjs";
import { chromium } from "@playwright/test";
import { createApp } from "../src/server/app.js";
import { readConfig } from "../src/server/config/env.js";
import { createAuthentication } from "../src/server/services/authentication.js";
import { createPrivilegedAuth } from "../src/server/integrations/supabase/auth-admin.js";
import { createSessionRepository } from "../src/server/repositories/session-repository.js";
const cfg = readConfig(process.env),
  dir = "docs/fase-5",
  tag = "F5_" + new Date().toISOString().replace(/\D/g, "").slice(0, 14);
if (
  cfg.NODE_ENV === "production" ||
  !["localhost", "127.0.0.1"].includes(new URL(cfg.APP_ORIGIN).hostname)
)
  throw new Error("DEV verification only");
const ref = (await readFile("supabase/.temp/project-ref", "utf8")).trim();
if (new URL(cfg.SUPABASE_URL).hostname !== ref + ".supabase.co")
  throw new Error("DEV project mismatch");
const migration = JSON.parse(
  await readFile(dir + "/migraciones-dev.json", "utf8"),
);
if (migration.status !== "PASS")
  throw new Error("Apply and verify DEV migrations first");
const previous = JSON.parse(
  await readFile("docs/fase-3.1/fixtures-dev.json", "utf8"),
);
const privileged = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const normal = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
class ProofError extends Error {}
const assert = (v: unknown, message: string) => {
  if (!v) throw new ProofError(message);
};
const report: any = {
  run: tag,
  startedAt: new Date().toISOString(),
  environment: "DEV",
  sameProjectAsApplication: true,
  results: [],
  fixtures: {
    companies: [],
    roles: [],
    users: previous.users.map((u: any) => ({ id: u.id, kind: u.kind })),
  },
};
await mkdir(dir + "/capturas", { recursive: true });
let server: any, browser: any, browserServer: any;
const tokens: string[] = [];
async function persist() {
  report.updatedAt = new Date().toISOString();
  report.summary = {
    pass: report.results.filter((r: any) => r.status === "PASS").length,
    fail: report.results.filter((r: any) => r.status === "FAIL").length,
  };
  await writeFile(dir + "/resultado-dev.json", JSON.stringify(report, null, 2));
}
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    report.results.push({ name, status: "PASS" });
    console.log("PASS " + name);
  } catch (e) {
    report.results.push({
      name,
      status: "FAIL",
      evidence:
        e instanceof ProofError
          ? e.message
          : "Detalle sensible omitido; revisar la operación indicada.",
    });
    console.log("FAIL " + name);
    throw e;
  } finally {
    await persist();
  }
}
async function session(id: string) {
  const u = await privileged.auth.admin.getUserById(id);
  assert(!u.error, "Auth identity unavailable");
  const l = await privileged.auth.admin.generateLink({
    type: "magiclink",
    email: u.data.user!.email!,
  });
  assert(!l.error, "Auth link unavailable");
  const r = await normal.auth.verifyOtp({
    type: "magiclink",
    token_hash: l.data.properties.hashed_token,
  });
  assert(!r.error && r.data.session, "Auth session unavailable");
  tokens.push(r.data.session!.access_token);
  return r.data.session!.access_token;
}
async function call(
  token: string,
  path: string,
  method = "GET",
  body?: unknown,
  expected?: number,
) {
  await new Promise((r) => setTimeout(r, 520));
  const response = await fetch(cfg.APP_ORIGIN + "/api" + path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      ...(path === "/users" && method === "POST"
        ? { "Idempotency-Key": randomUUID() }
        : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = response.status === 204 ? null : await response.json();
  if (expected !== undefined)
    assert(
      response.status === expected,
      `${method} ${path.split("?")[0]} expected ${expected}, received ${response.status}`,
    );
  else
    assert(
      response.ok,
      `${method} ${path.split("?")[0]} failed ${response.status}: ${String(data?.error || "UNKNOWN")}`,
    );
  return data;
}
async function list(token: string, path: string) {
  const rows: any[] = [];
  for (let page = 1; page <= 30; page++) {
    const r = await call(
      token,
      path + (path.includes("?") ? "&" : "?") + "limit=100&page=" + page,
    );
    rows.push(...r.data);
    if (rows.length >= r.count) break;
  }
  return rows;
}
const rest = (token: string) =>
  createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
try {
  const app = createApp(cfg, {
    auth: createAuthentication(cfg),
    privileged: createPrivilegedAuth(cfg),
    repository: (t) => createSessionRepository(cfg, t),
  });
  await new Promise<void>((resolve, reject) => {
    server = app.listen(cfg.PORT, "127.0.0.1", resolve);
    server.once("error", () =>
      reject(new ProofError("Local port unavailable")),
    );
  });
  const admin = await session(previous.initialAdministrator),
    ownerId = previous.users.find((u: any) => u.kind === "solicitante").id,
    reviewerId = previous.users.find((u: any) => u.kind === "aprobador").id,
    executorId = previous.users.find((u: any) => u.kind === "finanzas").id;
  const owner = await session(ownerId),
    reviewer = await session(reviewerId),
    executor = await session(executorId);
  const reconciliationUser = await call(admin, "/users", "POST", {
    email: tag.toLowerCase() + "_recon@example.test",
    username: tag.toLowerCase() + "_recon",
    full_name: "PRUEBA DEV conciliador " + tag,
    status: "active",
  });
  const reconciler = await session(reconciliationUser.id);
  const A = await call(admin, "/companies", "POST", {
      code: tag + "_A",
      legal_name: "DEV Fase 5 A " + tag,
      tax_id: tag + "A",
      country_code: "PE",
    }),
    B = await call(admin, "/companies", "POST", {
      code: tag + "_B",
      legal_name: "DEV Fase 5 B " + tag,
      tax_id: tag + "B",
      country_code: "PE",
    });
  report.fixtures.companies = [
    { id: A.id, code: A.code },
    { id: B.id, code: B.code },
  ];
  report.fixtures.users.push({
    id: reconciliationUser.id,
    kind: "conciliador",
  });
  const permissions = await list(admin, "/permissions");
  const resources = [
    "request",
    "supplier",
    "purchase_order",
    "service_acceptance",
    "tax_document",
    "payable",
    "payment_term",
    "approval_policy",
    "cost_center",
    "project",
    "subproject",
    "bank",
    "payment_order",
    "payment",
    "payment_batch",
    "bank_transaction",
    "bank_reconciliation",
    "cashflow",
  ];
  const role = await call(admin, "/roles", "POST", {
    code: tag.toLowerCase() + "_operator",
    name: "Prueba integral " + tag,
  });
  report.fixtures.roles = [role.id];
  await call(admin, "/roles/" + role.id + "/permissions", "PUT", {
    permission_ids: permissions
      .filter(
        (p) =>
          p.active &&
          (resources.includes(p.resource) || p.code === "audit.finance_view"),
      )
      .map((p) => p.id),
  });
  for (const id of [ownerId, reviewerId, executorId, reconciliationUser.id]) {
    await call(admin, "/users/" + id + "/status", "PUT", { status: "active" });
    await call(admin, "/users/" + id + "/companies", "PUT", {
      company_id: A.id,
      active: true,
    });
    await call(admin, "/users/" + id + "/roles", "PUT", {
      role_id: role.id,
      company_id: A.id,
      assign: true,
    });
  }
  const post = (token: string, path: string, body: any, expected?: number) =>
    call(token, "/" + path + "?company_id=" + A.id, "POST", body, expected);
  const act = (
    token: string,
    path: string,
    id: string,
    action: string,
    payload: any = {},
    expected?: number,
  ) =>
    call(
      token,
      "/" + path + "/" + id + "/actions",
      "POST",
      { action, payload },
      expected,
    );
  const f4act = (token: string, path: string, id: string, action: string) =>
    call(token, "/" + path + "/" + id + "/actions", "POST", {
      action,
      comment: "Sintético " + tag,
    });
  const options = await call(owner, "/finance/options?company_id=" + A.id),
    currency = options.currencies.find((x: any) => x.name?.startsWith("PEN ·")),
    usd = options.currencies.find((x: any) => x.name?.startsWith("USD ·"));
  assert(currency && usd, "Currency seeds missing");
  const center = await post(owner, "cost-centers", {
    code: "CECO",
    name: "Centro sintético F5",
  });
  const supplier = await post(owner, "suppliers", {
    tax_id_type: "other",
    tax_id: tag,
    country_code: "PE",
    legal_name: "Proveedor sintético " + tag,
  });
  const bankChange = await post(owner, "bank-changes", {
    supplier_id: supplier.supplier_id,
    reason: "Cuenta sintética",
    proposed: {
      bank_name: "Banco Sintético",
      currency_id: currency.id,
      account_number: "111222333444",
      account_type: "checking",
      is_primary: true,
    },
  });
  await f4act(reviewer, "bank-changes", bankChange.id, "approve");
  const supplierAccount = (
    await list(owner, "/supplier-bank-accounts?company_id=" + A.id)
  )[0];
  await post(owner, "approval-policies", {
    name: "Aprobación sintética",
    request_type: "service",
    approver_role_id: role.id,
  });
  const term = await post(owner, "payment-terms", {
    code: "EXPLICIT",
    name: "Fecha sintética",
    due_date_basis: "explicit_date",
  });
  const payables: any[] = [];
  for (let n = 0; n < 2; n++) {
    const request = await post(owner, "financial-requests", {
      request_type: "service",
      cost_center_id: center.id,
      currency_id: currency.id,
      description: "Anticipo sintético " + n,
      justification: "Verificar pago proveedor sin factura",
      required_date: "2026-09-11",
      payment_modality: "advance",
      items: [
        { description: "Servicio sintético", quantity: 1, unit_price: 100 },
      ],
    });
    await f4act(owner, "financial-requests", request.id, "submit");
    await f4act(reviewer, "financial-requests", request.id, "start_review");
    await f4act(reviewer, "financial-requests", request.id, "approve");
    const p = await post(owner, "payables", {
      request_id: request.id,
      supplier_id: supplier.supplier_id,
      payment_term_id: term.id,
      issue_date: "2026-09-11",
      explicit_due_date: "2026-09-15",
    });
    await f4act(reviewer, "payables", p.id, "review");
    await f4act(reviewer, "payables", p.id, "approve");
    payables.push(p);
  }
  report.fixtures.payables = payables.map((p) => p.id);
  const bank = await post(owner, "banks", {
    code: "DEV",
    name: "Banco sintético DEV",
    country_code: "PE",
  });
  const account = await post(owner, "bank-accounts", {
    bank_id: bank.id,
    currency_id: currency.id,
    account_number: "123456789012",
    account_type: "checking",
    display_name: "Cuenta DEV PEN",
    opening_balance: 500,
    opening_date: "2026-09-01",
    valid_from: "2026-09-01",
  });
  const method = await post(owner, "payment-methods", {
    code: "transfer",
    name: "Transferencia",
    requires_beneficiary_account: true,
  });
  let order: any,
    payment: any,
    second: any,
    batch: any,
    attachment: any,
    transaction: any,
    period: any,
    match: any;
  const orderBase = {
    beneficiary_id: supplier.supplier_id,
    currency_id: currency.id,
    payment_method_id: method.id,
    beneficiary_account_id: supplierAccount.id,
    requested_payment_date: "2026-09-11",
    description: "OP sintética " + tag,
    items: payables.map((p) => ({ payable_id: p.id, amount_to_pay: 100 })),
  };
  const voucher = async (pay: any) =>
    call(executor, "/attachments/upload", "POST", {
      company_id: A.id,
      entity_type: "payment",
      entity_id: pay.id,
      filename: "voucher.pdf",
      mime_type: "application/pdf",
      base64: Buffer.from(
        "%PDF-1.4\nVoucher exclusivamente sintético\n%%EOF",
      ).toString("base64"),
    });
  await test("01 Banco empresa A no accesible desde B", async () => {
    await call(
      owner,
      "/bank-accounts?company_id=" + B.id,
      "GET",
      undefined,
      403,
    );
    const r = await rest(owner)
      .from("company_bank_accounts")
      .select("id")
      .eq("company_id", B.id);
    assert(!r.error && r.data.length === 0, "Cross-company rows");
    await call(
      owner,
      "/bank-accounts?company_id=" + B.id,
      "POST",
      {
        bank_id: bank.id,
        currency_id: currency.id,
        account_number: "123456789",
        account_type: "checking",
        display_name: "Wrong",
      },
      403,
    );
  });
  await test("02 Crear OP", async () => {
    order = await post(owner, "payment-orders", orderBase);
    report.fixtures.order = order.id;
    assert(/^OP-\d{4}-\d{6}$/.test(order.payment_order_number), "OP numbering");
  });
  await test("03 OP varias CxP", async () => {
    const detail = await call(owner, "/payment-orders/" + order.id);
    assert(
      detail.items.length === 2 && Number(order.total_amount) === 200,
      "OP items total",
    );
  });
  await test("04 Exceder outstanding rechazado", async () => {
    await post(
      owner,
      "payment-orders",
      {
        ...orderBase,
        items: [{ payable_id: payables[0].id, amount_to_pay: 1000 }],
      },
      409,
    );
  });
  await test("05 Monedas incompatibles rechazadas", async () => {
    await post(
      owner,
      "payment-orders",
      { ...orderBase, currency_id: usd.id },
      409,
    );
  });
  await test("06 Autoaprobación prohibida", async () => {
    await act(owner, "payment-orders", order.id, "submit");
    await act(owner, "payment-orders", order.id, "approve", {}, 403);
    await act(reviewer, "payment-orders", order.id, "approve");
  });
  await test("07 OP aprobada inmutable", async () => {
    await call(
      owner,
      "/payment-orders/" + order.id + "?company_id=" + A.id,
      "PATCH",
      { description: "Edición silenciosa" },
      409,
    );
    await act(executor, "payment-orders", order.id, "schedule", {
      bank_account_id: account.id,
      scheduled_payment_date: "2026-09-11",
    });
  });
  await test("15 Lote de pagos", async () => {
    batch = await post(owner, "payment-batches", {
      currency_id: currency.id,
      description: "Lote sintético",
      individual_approval_required: true,
      order_ids: [order.id],
    });
    await act(owner, "payment-batches", batch.id, "submit");
    await act(owner, "payment-batches", batch.id, "approve", {}, 403);
    await act(reviewer, "payment-batches", batch.id, "approve");
  });
  const input = {
    payment_order_id: order.id,
    payment_date: "2026-09-11",
    operation_number: tag + "_P1",
    allocations: [{ payable_id: payables[0].id, allocated_amount: 60 }],
  };
  await post(owner, "payments", input, 403);
  payment = await post(executor, "payments", input);
  report.fixtures.payment = payment.id;
  await act(executor, "payments", payment.id, "execute", {}, 409);
  await test("13 Voucher cifrado y metadatos V1", async () => {
    attachment = await voucher(payment);
    assert(
      attachment.encryption_algorithm === "AES-256-GCM" &&
        attachment.encryption_key_version === "V1",
      "Version metadata missing",
    );
    const content = await call(
      executor,
      "/attachments/" + attachment.id + "/download",
    );
    assert(
      Buffer.from(content.base64, "base64").toString().startsWith("%PDF-"),
      "Voucher not readable through API",
    );
    const raw = await fetch(
      cfg.SUPABASE_URL +
        "/storage/v1/object/authenticated/financial-encrypted/" +
        attachment.storage_path,
      {
        headers: {
          apikey: cfg.SUPABASE_PUBLISHABLE_KEY,
          Authorization: "Bearer " + executor,
        },
      },
    );
    const bytes = Buffer.from(await raw.arrayBuffer());
    assert(
      raw.ok &&
        bytes.subarray(0, 4).toString() === "ERP1" &&
        !bytes.includes(Buffer.from("%PDF-")),
      "Storage has plaintext",
    );
  });
  await test("14 Revocación membership bloquea voucher", async () => {
    await call(admin, "/users/" + executorId + "/companies", "PUT", {
      company_id: A.id,
      active: false,
    });
    try {
      await call(
        executor,
        "/attachments/" + attachment.id + "/download",
        "GET",
        undefined,
        404,
      );
      const r = await rest(executor)
        .from("attachments")
        .select("id")
        .eq("id", attachment.id);
      assert(!r.error && r.data.length === 0, "Metadata visible after revoke");
    } finally {
      await call(admin, "/users/" + executorId + "/companies", "PUT", {
        company_id: A.id,
        active: true,
      });
    }
  });
  await test("08 Pago parcial", async () => {
    await act(executor, "payments", payment.id, "execute");
    const p = (await call(owner, "/payables/" + payables[0].id)).record;
    assert(
      Number(p.outstanding_amount) === 40 &&
        p.payment_status === "partially_paid",
      "Partial balance incorrect",
    );
  });
  await test("09 Pago completo", async () => {
    second = await post(executor, "payments", {
      payment_order_id: order.id,
      payment_date: "2026-09-11",
      operation_number: tag + "_P2",
      allocations: [
        { payable_id: payables[0].id, allocated_amount: 40 },
        { payable_id: payables[1].id, allocated_amount: 100 },
      ],
    });
    await voucher(second);
    await act(executor, "payments", second.id, "execute");
    assert(
      (await call(owner, "/payables/" + payables[0].id)).record
        .payment_status === "paid",
      "Paid balance incorrect",
    );
  });
  await test("10 Pago cubriendo varias CxP", async () => {
    const detail = await call(executor, "/payments/" + second.id);
    assert(
      detail.items.length === 2 && Number(detail.record.amount) === 140,
      "Multiple allocation mismatch",
    );
    assert(
      (await call(owner, "/payment-orders/" + order.id)).record.status ===
        "paid",
      "OP not derived paid",
    );
  });
  await test("11 CxP no puede marcarse paid manualmente", async () => {
    await call(
      owner,
      "/payables/" + payables[0].id + "/actions",
      "POST",
      { action: "paid", comment: "Prohibido" },
      400,
    );
    const r = await rest(owner)
      .from("payables")
      .update({ outstanding_amount: 0 })
      .eq("id", payables[1].id);
    assert(!!r.error, "REST balance write accepted");
  });
  await test("12 Reverso restaura outstanding", async () => {
    await act(reviewer, "payments", second.id, "reverse", {
      reason: "Reverso sintético",
    });
    assert(
      Number(
        (await call(owner, "/payables/" + payables[0].id)).record
          .outstanding_amount,
      ) === 40,
      "Reversal balance",
    );
    assert(
      (await call(executor, "/payments/" + second.id)).record.status ===
        "reversed",
      "Original not preserved",
    );
  });
  const importRows = [
    {
      transaction_date: "2026-09-11",
      transaction_type: "debit",
      amount: 60,
      currency_code: "PEN",
      bank_reference: tag + "_P1",
      description: "Extracto DEV sintético",
      external_id: tag + "_ROW1",
    },
  ];
  const importBody = {
    account_id: account.id,
    source_filename: "synthetic.csv",
    column_mapping: { transaction_date: "fecha", amount: "importe" },
    rows: importRows,
    confirm: false,
  };
  await test("16 Importación bancaria preview sin persistencia", async () => {
    const before = (await list(owner, "/bank-transactions?company_id=" + A.id))
      .length;
    const preview = await post(owner, "treasury/import", importBody);
    assert(
      preview.status === "preview" && preview.inserted === 0,
      "Invalid preview",
    );
    assert(
      (await list(owner, "/bank-transactions?company_id=" + A.id)).length ===
        before,
      "Preview wrote rows",
    );
  });
  await test("17 Idempotencia importación", async () => {
    const first = await post(owner, "treasury/import", {
      ...importBody,
      confirm: true,
    });
    const second = await post(owner, "treasury/import", {
      ...importBody,
      confirm: true,
    });
    assert(
      first.inserted === 1 &&
        second.inserted === 0 &&
        second.status === "already_imported",
      "Import not idempotent",
    );
    transaction = (
      await list(owner, "/bank-transactions?company_id=" + A.id)
    ).find((t) => t.external_id === tag + "_ROW1");
    report.fixtures.transaction = transaction.id;
  });
  await test("18 Suggested match sin conciliación automática", async () => {
    const candidates = await call(
      reconciler,
      "/treasury/candidates/" + transaction.id + "?company_id=" + A.id,
    );
    assert(
      candidates.some((x: any) => x.id === payment.id),
      "Candidate missing",
    );
    assert(transaction.status === "unmatched", "Auto reconciled");
  });
  period = await post(reconciler, "reconciliation-periods", {
    bank_account_id: account.id,
    start_date: "2026-09-01",
    end_date: "2026-09-30",
  });
  await test("20 Movimiento empresa B rechazado", async () => {
    await call(
      reconciler,
      "/treasury/match?company_id=" + B.id,
      "POST",
      {
        period_id: period.id,
        transaction_id: transaction.id,
        payment_id: payment.id,
        match_amount: 60,
      },
      403,
    );
  });
  await test("19 Conciliación, cierre y reapertura controlada", async () => {
    const input = {
      period_id: period.id,
      transaction_id: transaction.id,
      payment_id: payment.id,
      match_amount: 60,
    };
    await post(executor, "treasury/match", input, 403);
    await post(owner, "treasury/match", input, 403);
    match = await post(reconciler, "treasury/match", input);
    await act(reconciler, "reconciliation-matches", match.id, "reconcile");
    await act(reconciler, "reconciliation-periods", period.id, "close");
    await act(
      reconciler,
      "reconciliation-matches",
      match.id,
      "unmatch",
      { reason: "Prueba" },
      409,
    );
    await act(reconciler, "reconciliation-periods", period.id, "reopen", {
      reason: "Verificar reapertura sintética",
    });
    assert(
      (await call(owner, "/bank-transactions/" + transaction.id)).record
        .status === "reconciled",
      "Reconciliation status",
    );
  });
  await test("21 REST directo bloqueado", async () => {
    const write = await rest(executor)
      .from("payments")
      .update({ status: "executed" })
      .eq("id", second.id);
    assert(!!write.error, "REST payment mutation");
    const result = await rest(executor).rpc("treasury_save", {
      kind: "payment",
      target_id: null,
      target_company: A.id,
      payload: { ...input, status: "executed" },
    });
    assert(!!result.error, "RPC forged state");
  });
  await test("22 Auditoría empresarial sin cuentas completas", async () => {
    const events = await list(
      owner,
      "/audit?category=finance&company_id=" + A.id,
    );
    for (const table of [
      "payment_orders",
      "payments",
      "bank_transactions",
      "bank_reconciliation_matches",
    ])
      assert(
        events.some(
          (e) => e.entity_type === table && e.user_id && e.company_id === A.id,
        ),
        "Audit missing " + table,
      );
    assert(
      events
        .filter((e) => e.entity_type === "company_bank_accounts")
        .every((e) => !e.new_values?.account_number && !e.new_values?.cci),
      "Account leaked in audit",
    );
  });
  await test("23 Cash Flow no duplica pagos", async () => {
    const flow = await call(owner, "/treasury/cashflow?company_id=" + A.id);
    assert(
      flow.actual.length === 1 && Number(flow.actual[0].amount) === -60,
      "Actual duplicated",
    );
    assert(
      flow.committed.reduce((n: number, x: any) => n + Number(x.amount), 0) ===
        140,
      "Committed duplicated",
    );
    assert(
      Number(flow.position[0].recorded_position) === 440,
      "Recorded position mismatch",
    );
    assert(flow.forecast.length === 0, "Invented forecast");
  });
  await test("24 UI real sin mocks", async () => {
    browserServer = await chromium.launchServer({
      channel: "msedge",
      headless: true,
    });
    browser = await chromium.connect(browserServer.wsEndpoint());
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    await page.addInitScript(
      ({ token, user, company }) => {
        sessionStorage.setItem(
          "erp.session",
          JSON.stringify({
            access_token: token,
            refresh_token: "unused",
            expires_in: 3600,
          }),
        );
        localStorage.setItem("erp.company." + user, company);
      },
      { token: owner, user: ownerId, company: A.id },
    );
    await page.goto(cfg.APP_ORIGIN + "/app/banks");
    await page
      .getByRole("button", { name: "Nuevo registro", exact: true })
      .click();
    const form = page.getByRole("dialog");
    await form.getByLabel("Código", { exact: true }).fill("UI");
    await form
      .getByLabel("Nombre", { exact: true })
      .fill("Banco desde UI " + tag);
    await form.getByLabel("País ISO", { exact: true }).fill("PE");
    await form.getByRole("button", { name: "Guardar", exact: true }).click();
    await form.waitFor({ state: "hidden" });
    await page
      .getByRole("cell", { name: "Banco desde UI " + tag, exact: true })
      .waitFor();
    await page.goto(cfg.APP_ORIGIN + "/app/payments");
    await page
      .getByRole("cell", { name: payment.payment_number, exact: true })
      .waitFor();
    await page.screenshot({
      path: dir + "/capturas/pagos-dev.png",
      fullPage: true,
    });
    await page.goto(cfg.APP_ORIGIN + "/app/cashflow");
    await page.getByRole("cell", { name: "440.00", exact: true }).waitFor();
    await page.screenshot({
      path: dir + "/capturas/cashflow-dev.png",
      fullPage: true,
    });
    await page.close();
  });
  await test("25 Secretos ausentes del bundle", async () => {
    await checkClientBoundary();
  });
  report.status = "PASS";
} catch (e) {
  report.status = "FAIL";
  report.error =
    e instanceof ProofError
      ? e.message
      : "Error de verificación; detalle sensible omitido.";
  console.log(report.error);
  process.exitCode = 1;
} finally {
  report.results.sort((a: any, b: any) => a.name.localeCompare(b.name));
  await persist();
  for (const t of tokens)
    await privileged.auth.admin.signOut(t, "local").catch(() => {});
  if (browserServer) browserServer.process()?.kill();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
  process.exit(process.exitCode ?? 0);
}
