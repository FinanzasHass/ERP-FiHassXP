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
  dir = "docs/fase-8a",
  tag = "F8A_" + new Date().toISOString().replace(/\D/g, "").slice(0, 14);
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
  "Empresa A no lee B",
  "Crear cuenta raíz e hija",
  "Código duplicado rechazado",
  "Ciclo jerárquico rechazado",
  "Cuenta usada no se elimina",
  "Importación preview sin persistencia",
  "Confirmación idempotente",
  "Crear período abierto",
  "Período cerrado rechaza posteo",
  "Crear asiento borrador",
  "Descuadre rechazado",
  "Debe y haber simultáneos rechazados",
  "Cuenta no imputable rechazada",
  "Validar asiento balanceado",
  "Posteo independiente",
  "Posteo idempotente",
  "Asiento posteado inmutable",
  "Reverso conserva original",
  "Doble reverso rechazado",
  "Dimensiones e identidad histórica",
  "Tercero obligatorio y empleado sin Auth",
  "Moneda y tipo de cambio explícito",
  "Simulación no persiste asientos",
  "Regla versionada inmutable",
  "Cuentas configuradas sin hardcode ni seed",
  "Mayor contable",
  "Balance de comprobación",
  "Solo posteados afectan balances",
  "Reapertura auditada",
  "REST directo no evade controles",
  "Revocación de membership inmediata",
  "Auditoría con actor y empresa",
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
    `# Fase 8A · Supabase DEV\n\nEjecución: ${tag}. Estado: ${report.status}. Mismo proyecto que la aplicación: verificado. Sólo fixtures sintéticos.\n\n| N.º | Verificación | Resultado |\n|---|---|---|\n` +
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
      "accounting_account",
      "accounting_period",
      "journal",
      "accounting_rule",
      "general_ledger",
      "trial_balance",
      "cost_center",
      "project",
      "subproject",
      "employee",
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
  const save = (path: string, body: any, s = owner) =>
    call(s, "/accounting/" + path, "POST", {
      company_id: s === foreign ? B.id : A.id,
      ...body,
    });
  const act = (path: string, body: any = {}, s = owner, key?: string) =>
    call(s, "/accounting/" + path, "POST", body, undefined, key);
  const accountBase = {
    name: "Cuenta exclusivamente sintética " + tag,
    account_type: "asset",
    normal_balance: "debit",
    allows_posting: true,
    valid_from: "2026-01-01",
  };
  const options = await call(owner, "/accounting/options?company_id=" + A.id),
    currency = options.currencies.find((x: any) => x.name === "PEN").id,
    usd = options.currencies.find((x: any) => x.name === "USD").id;
  const initiallyEmpty =
    (await rows(owner, "accounting_accounts", { company_id: A.id })).length ===
    0;
  const fixtureArea = await call(admin, '/areas', 'POST', {code:tag,name:'Área sintética contable '+tag});
  await save("settings", {
    functional_currency_id: currency,
    number_prefix: "SYNTH",
    number_digits: 6,
  });
  let parent: any,
    debit: any,
    credit: any,
    period: any,
    type: any,
    posted: any,
    inverse: any,
    rule: any;
  await test(2, async () => {
    parent = await save("accounts", {
      ...accountBase,
      code: "SYNTH-ROOT",
      allows_posting: false,
    });
    debit = await save("accounts", {
      ...accountBase,
      code: "SYNTH-D",
      parent_id: parent.id,
    });
    credit = await save("accounts", {
      ...accountBase,
      code: "SYNTH-C",
      parent_id: parent.id,
      account_type: "liability",
      normal_balance: "credit",
    });
    assert(debit.level === 2, "Derived level mismatch");
  });
  await test(1, async () => {
    const other = await save(
      "accounts",
      { ...accountBase, code: "SYNTH-B" },
      foreign,
    );
    assert(
      (await rows(owner, "accounting_accounts", { id: other.id })).length === 0,
      "Cross company read",
    );
    await rpc(
      owner,
      "accounting_master_save",
      {
        kind: "account",
        target_id: null,
        target_company: B.id,
        payload: { ...accountBase, code: "CROSS" },
      },
      true,
    );
  });
  await test(3, async () => {
    await rpc(
      owner,
      "accounting_master_save",
      {
        kind: "account",
        target_id: null,
        target_company: A.id,
        payload: { ...accountBase, code: "SYNTH-D" },
      },
      true,
    );
  });
  await test(4, async () => {
    await rpc(
      owner,
      "accounting_master_save",
      {
        kind: "account",
        target_id: parent.id,
        target_company: A.id,
        payload: { parent_id: debit.id },
      },
      true,
    );
  });
  const importRows = [
      { ...accountBase, code: "IMPORT-CHILD", parent_code: "IMPORT-ROOT" },
      { ...accountBase, code: "IMPORT-ROOT", allows_posting: false },
    ],
    importKey = randomUUID();
  await test(6, async () => {
    const before = (
      await rows(owner, "accounting_accounts", { company_id: A.id })
    ).length;
    const r = await call(
      owner,
      "/accounting/accounts/import",
      "POST",
      { company_id: A.id, rows: importRows, confirm: false },
      undefined,
      importKey,
    );
    assert(r.persisted === false && r.validated_rows === 2, "Preview result");
    assert(
      (await rows(owner, "accounting_accounts", { company_id: A.id }))
        .length === before,
      "Preview persisted",
    );
  });
  await test(7, async () => {
    for (let i = 0; i < 2; i++)
      await call(
        owner,
        "/accounting/accounts/import",
        "POST",
        { company_id: A.id, rows: importRows, confirm: true },
        undefined,
        importKey,
      );
    assert(
      (
        await rows(owner, "accounting_accounts", {
          company_id: A.id,
          code: "IMPORT-CHILD",
        })
      ).length === 1,
      "Duplicate import effect",
    );
  });
  await test(8, async () => {
    period = await save("periods", {
      year: 2026,
      month: 9,
      start_date: "2026-09-01",
      end_date: "2026-09-30",
    });
    assert(period.status === "open", "Period initial state");
    type = await save("entry-types", {
      code: "manual",
      name: "Manual sintético",
    });
  });
  const lines = (amount = 100) => [
    {
      account_id: debit.id,
      description: "Debe sintético",
      debit: amount,
      credit: 0,
    },
    {
      account_id: credit.id,
      description: "Haber sintético",
      debit: 0,
      credit: amount,
    },
  ];
  const payload = (items = lines(), extra: any = {}) => ({
    entry_date: "2026-09-13",
    accounting_period_id: period.id,
    entry_type_id: type.id,
    currency_id: currency,
    description: "Asiento sintético " + tag,
    lines: items,
    ...extra,
  });
  const draft = (items = lines(), extra: any = {}) =>
    save("journals", payload(items, extra));
  await test(10, async () => {
    posted = await draft();
    assert(
      posted.status === "draft" &&
        /^SYNTH-2026-\d{6}$/.test(posted.entry_number),
      "Draft or numbering",
    );
  });
  await test(11, async () => {
    const l = lines();
    l[1]!.credit = 99;
    const e = await draft(l);
    await rpc(owner, "journal_validate", { target_id: e.id }, true);
  });
  await test(12, async () => {
    const l = lines();
    l[0]!.credit = 1;
    await rpc(
      owner,
      "journal_save",
      {
        target_id: null,
        target_company: A.id,
        payload: payload(l),
        operation_key: randomUUID(),
      },
      true,
    );
  });
  await test(13, async () => {
    const l = lines();
    l[0]!.account_id = parent.id;
    const e = await draft(l);
    await rpc(owner, "journal_validate", { target_id: e.id }, true);
  });
  await test(14, async () => {
    const e = await act("journals/" + posted.id + "/validate");
    assert(e.status === "validated", "Balanced validation");
  });
  const postKey = randomUUID();
  await test(15, async () => {
    await rpc(
      owner,
      "journal_post",
      { target_id: posted.id, operation_key: randomUUID() },
      true,
    );
    const p = await act(
      "journals/" + posted.id + "/post",
      {},
      reconciler,
      postKey,
    );
    assert(
      p.status === "posted" && p.posted_by === reconciler.id,
      "Independent posting",
    );
  });
  await test(16, async () => {
    await act("journals/" + posted.id + "/post", {}, reconciler, postKey);
    assert(
      (await rows(owner, "journal_postings", { journal_entry_id: posted.id }))
        .length === 1,
      "Duplicate post evidence",
    );
  });
  await test(5, async () => {
    assert(
      !!(await rows(owner, "accounting_accounts", { id: debit.id }))[0]
        ?.first_used_at,
      "Account first use",
    );
    const r = await owner.db
      .from("accounting_accounts")
      .delete()
      .eq("id", debit.id);
    assert(!!r.error, "Account deletion succeeded");
    await rpc(
      owner,
      "accounting_master_save",
      {
        kind: "account",
        target_id: debit.id,
        target_company: A.id,
        payload: { code: "MUTATED" },
      },
      true,
    );
  });
  await test(17, async () => {
    await rpc(
      owner,
      "journal_save",
      {
        target_id: posted.id,
        target_company: A.id,
        payload: payload(),
        operation_key: randomUUID(),
      },
      true,
    );
    const r = await owner.db
      .from("journal_entry_lines")
      .update({ debit: 500 })
      .eq("journal_entry_id", posted.id);
    assert(!!r.error, "Posted lines writable");
  });
  await test(9, async () => {
    const e = await draft();
    await act("journals/" + e.id + "/validate");
    await act(
      "periods/" + period.id + "/action",
      { action: "close", reason: "Cierre sintético" },
      reconciler,
    );
    await rpc(
      reconciler,
      "journal_post",
      { target_id: e.id, operation_key: randomUUID() },
      true,
    );
  });
  await test(29, async () => {
    await act(
      "periods/" + period.id + "/action",
      { action: "reopen", reason: "Reapertura sintética" },
      reconciler,
    );
    const h = await rows(owner, "accounting_history", {
      entity_id: period.id,
      action: "reopen",
    });
    assert(
      h.length === 1 &&
        h[0].actor_id === reconciler.id &&
        h[0].reason === "Reapertura sintética",
      "Reopen audit",
    );
  });
  const reversePayload = {
      entry_date: "2026-09-13",
      accounting_period_id: period.id,
      entry_type_id: type.id,
      reason: "Reverso sintético",
    },
    reverseKey = randomUUID();
  await test(18, async () => {
    inverse = await act(
      "journals/" + posted.id + "/reverse",
      reversePayload,
      owner,
      reverseKey,
    );
    assert(
      inverse.original_entry_id === posted.id && inverse.status === "posted",
      "Inverse missing",
    );
    assert(
      (await rows(owner, "journal_entries", { id: posted.id }))[0]?.status ===
        "reversed",
      "Original missing",
    );
    const r = await rows(owner, "journal_entry_lines", {
      journal_entry_id: inverse.id,
    });
    assert(
      r.find((x) => x.account_id === debit.id)?.credit === 100,
      "Wrong inverse amount",
    );
  });
  await test(19, async () => {
    await act(
      "journals/" + posted.id + "/reverse",
      reversePayload,
      owner,
      reverseKey,
    );
    await rpc(
      owner,
      "journal_reverse",
      {
        target_id: posted.id,
        payload: reversePayload,
        operation_key: randomUUID(),
      },
      true,
    );
    assert(
      (await rows(owner, "journal_entries", { original_entry_id: posted.id }))
        .length === 1,
      "Duplicate inverse",
    );
  });
  let dimensional: any;
  await test(21, async () => {
    const a = await save("accounts", {
      ...accountBase,
      code: "THIRD",
      requires_third_party: true,
    });
    const l = lines();
    l[0]!.account_id = a.id;
    const e = await draft(l);
    await rpc(owner, "journal_validate", { target_id: e.id }, true);
    const employee = await rpc(owner, "employee_foundation_save", {
      kind: "employee",
      target_id: null,
      target_company: A.id,
      payload: {
        full_name: "Colaborador sintético sin Auth",
        document_type: "TEST",
        document_number: tag,
        area_id: fixtureArea.id,
      },
    });
    assert(employee.profile_id === null, "Employee unexpectedly requires Auth");
    dimensional = { account: a, employee };
  });
  await test(20, async () => {
    const center = await rpc(owner, "master_save", {
      kind: "cost_center",
      target_id: null,
      target_company: A.id,
      payload: {
        code: "HISTORY",
        name: "CECO original",
        valid_from: "2026-01-01",
      },
    });
    const project = await rpc(owner, "master_save", {
      kind: "project",
      target_id: null,
      target_company: A.id,
      payload: { code: "HISTORY", name: "Proyecto original" },
    });
    const l: any[] = lines(12);
    l[0] = {
      ...l[0],
      account_id: dimensional.account.id,
      third_party_type: "employee",
      third_party_id: dimensional.employee.id,
      dimensions: [
        { dimension_type: "cost_center", dimension_id: center.id },
        { dimension_type: "project", dimension_id: project.id },
      ],
    };
    const e = await draft(l);
    assert(
      (await rows(owner, "cost_centers", { id: center.id }))[0]
        ?.first_used_at === null,
      "Draft consumed CECO",
    );
    await act("journals/" + e.id + "/validate");
    await act("journals/" + e.id + "/post", {}, reconciler);
    await rpc(owner, "master_save", {
      kind: "cost_center",
      target_id: center.id,
      target_company: A.id,
      payload: { name: "CECO nuevo" },
    });
    await rpc(
      owner,
      "master_save",
      {
        kind: "cost_center",
        target_id: center.id,
        target_company: A.id,
        payload: { code: "MUTATED" },
      },
      true,
    );
    const ls = await rows(owner, "journal_entry_lines", {
      journal_entry_id: e.id,
    });
    const ds = await rows(owner, "journal_line_dimensions", {
      journal_line_id: ls.find((x) => x.account_id === dimensional.account.id)
        .id,
    });
    assert(
      ds.find((x) => x.dimension_type === "cost_center")?.snapshot_name ===
        "CECO original",
      "Historical dimension lost",
    );
    assert(
      !!(await rows(owner, "cost_centers", { id: center.id }))[0]
        ?.first_used_at,
      "Missing CECO first use",
    );
  });
  await test(22, async () => {
    await rpc(
      owner,
      "journal_save",
      {
        target_id: null,
        target_company: A.id,
        payload: payload(lines(), { currency_id: usd }),
        operation_key: randomUUID(),
      },
      true,
    );
    const fx = await save("exchange-rates", {
      date: "2026-09-13",
      currency_from: usd,
      currency_to: currency,
      buy_rate: 3.7,
      sell_rate: 3.8,
      accounting_rate: 3.75,
      source: "Fuente exclusivamente sintética",
    });
    const l = lines(375).map((x) => ({ ...x, foreign_amount: 100 }));
    const e = await draft(l, { currency_id: usd, exchange_rate_id: fx.id });
    await act("journals/" + e.id + "/validate");
    await act("journals/" + e.id + "/post", {}, reconciler);
  });
  const rulePayload = {
    code: "SYNTH-RULE",
    name: "Regla sintética",
    source_event: "manual",
    valid_from: "2026-01-01",
    lines: [
      {
        account_id: debit.id,
        side: "debit",
        description: "Debe sintético",
        amount_key: "amount",
      },
      {
        account_id: credit.id,
        side: "credit",
        description: "Haber sintético",
        amount_key: "amount",
      },
    ],
  };
  await test(23, async () => {
    rule = await save("rules", rulePayload);
    await act(
      "rules/" + rule.id + "/action",
      { action: "activate_simulation", reason: "Simulación sintética" },
      reconciler,
    );
    const before = (await rows(owner, "journal_entries", { company_id: A.id }))
      .length;
    const p = await act("rules/" + rule.id + "/preview", {
      source_event: "manual",
      entry_date: "2026-09-13",
      currency_id: currency,
      amounts: { amount: 75 },
    });
    assert(
      p.valid && p.persisted === false && p.posted === false,
      "Preview invalid",
    );
    assert(
      (await rows(owner, "journal_entries", { company_id: A.id })).length ===
        before,
      "Preview persisted",
    );
  });
  await test(24, async () => {
    const next = await save("rules/" + rule.id + "/versions", {
      ...rulePayload,
      name: "Versión segunda",
    });
    assert(
      next.version === 2 && next.previous_version_id === rule.id,
      "Version ancestry",
    );
    await act(
      "rules/" + next.id + "/action",
      { action: "activate_simulation", reason: "Segunda versión" },
      reconciler,
    );
    assert(
      (await rows(owner, "accounting_rules", { id: rule.id }))[0]?.status ===
        "disabled",
      "Old version active",
    );
    const r = await owner.db
      .from("accounting_rule_lines")
      .update({ multiplier: 2 })
      .eq("rule_id", rule.id);
    assert(!!r.error, "Rule content writable");
    rule = next;
  });
  await test(25, async () => {
    assert(initiallyEmpty, "Unexpected seeded accounts");
    assert(
      (await rows(owner, "accounting_rules", { company_id: A.id })).every(
        (r) => r.production_enabled === false,
      ),
      "Production rule enabled",
    );
    const files = [
      "src/client/accounting.tsx",
      "src/server/routes/accounting.ts",
      "src/server/validators/accounting.ts",
    ];
    for (const f of files)
      assert(
        !(await readFile(f, "utf8")).includes(debit.id),
        "Hardcoded fixture account",
      );
    assert(
      !(await rpc(admin, "has_permission", {
        permission_code: "journal.post",
        company_id: A.id,
      })),
      "Administrator obtained accounting execution",
    );
  });
  await test(26, async () => {
    const r = await save("reports/general_ledger", {
      accounting_period_id: period.id,
    });
    assert(r.count === 8, "Unexpected posted ledger count");
    assert(
      r.data.some((x: any) => x.journal_entry_id === posted.id) &&
        r.data.some((x: any) => x.journal_entry_id === inverse.id),
      "Ledger omitted original or inverse",
    );
  });
  await test(27, async () => {
    const r = await save("reports/trial_balance", {
      accounting_period_id: period.id,
    });
    assert(
      r.data.reduce(
        (sum: number, x: any) => sum + Number(x.closing_balance),
        0,
      ) === 0,
      "Unbalanced trial balance",
    );
    assert(
      r.data.find((x: any) => x.account_id === debit.id)?.closing_balance ===
        375,
      "Wrong derived debit balance",
    );
  });
  await test(28, async () => {
    const before = await save("reports/trial_balance", {
      accounting_period_id: period.id,
    });
    await draft(lines(987));
    const after = await save("reports/trial_balance", {
      accounting_period_id: period.id,
    });
    assert(
      JSON.stringify(before) === JSON.stringify(after),
      "Draft changed official balance",
    );
  });
  await test(30, async () => {
    for (const table of [
      "journal_entries",
      "journal_entry_lines",
      "journal_postings",
      "accounting_rules",
    ]) {
      const r = await owner.db.from(table).insert({ company_id: A.id });
      assert(!!r.error, "Direct REST insert accepted " + table);
    }
    assert(
      (await rows(foreign, "accounting_ledger_lines", { company_id: A.id }))
        .length === 0,
      "REST ledger company leak",
    );
  });
  await test(31, async () => {
    await call(admin, "/users/" + reconciler.id + "/companies", "PUT", {
      company_id: A.id,
      active: false,
    });
    await rpc(
      reconciler,
      "accounting_report",
      { kind: "general_ledger", target_company: A.id, filters: {} },
      true,
    );
    assert(
      (await rows(reconciler, "journal_entries", { company_id: A.id }))
        .length === 0,
      "Revoked session reads journals",
    );
    await call(admin, "/users/" + reconciler.id + "/companies", "PUT", {
      company_id: A.id,
      active: true,
    });
  });
  await test(32, async () => {
    const events = await rows(owner, "audit_logs", {
      company_id: A.id,
      category: "finance",
    });
    for (const action of [
      "accounting.save",
      "accounting.post",
      "accounting.reverse",
      "accounting.reopen",
      "accounting.import",
    ])
      assert(
        events.some(
          (x) => x.action === action && x.user_id && x.company_id === A.id,
        ),
        "Missing audited action " + action,
      );
  });
  const concurrency = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      report.additional.push({ name, status: "PASS" });
      console.log("PASS CONCURRENT " + name);
    } catch (e) {
      report.additional.push({ name, status: "FAIL" });
      throw e;
    } finally {
      await persist();
    }
  };
  let raced: any;
  await concurrency("Dos posteos del mismo asiento", async () => {
    raced = await draft();
    await act("journals/" + raced.id + "/validate");
    const rs = await Promise.all(
      [0, 1].map(() =>
        reconciler.db.rpc("journal_post", {
          target_id: raced.id,
          operation_key: randomUUID(),
        }),
      ),
    );
    assert(
      rs.every((r) => !r.error),
      "Concurrent posts failed",
    );
    assert(
      (await rows(owner, "journal_postings", { journal_entry_id: raced.id }))
        .length === 1,
      "Concurrent duplicate post",
    );
  });
  await concurrency("Dos reversos del mismo asiento", async () => {
    const rs = await Promise.all(
      [0, 1].map(() =>
        owner.db.rpc("journal_reverse", {
          target_id: raced.id,
          payload: reversePayload,
          operation_key: randomUUID(),
        }),
      ),
    );
    assert(rs.filter((r) => !r.error).length === 1, "Concurrent reverse count");
    assert(
      (await rows(owner, "journal_entries", { original_entry_id: raced.id }))
        .length === 1,
      "Concurrent duplicate reverse",
    );
  });
  await concurrency("Cierre de período contra posteo", async () => {
    const e = await draft();
    await act("journals/" + e.id + "/validate");
    const rs = await Promise.all([
      reconciler.db.rpc("accounting_period_action", {
        target_id: period.id,
        action: "close",
        reason: "Carrera sintética",
      }),
      reconciler.db.rpc("journal_post", {
        target_id: e.id,
        operation_key: randomUUID(),
      }),
    ]);
    assert(!rs[0].error, "Concurrent close failed");
    assert(
      (await rows(owner, "journal_postings", { journal_entry_id: e.id }))
        .length === (rs[1].error ? 0 : 1),
      "Race post inconsistent",
    );
    await rpc(
      reconciler,
      "journal_post",
      { target_id: e.id, operation_key: randomUUID() },
      !!rs[1].error,
    );
    await act(
      "periods/" + period.id + "/action",
      { action: "reopen", reason: "Restaurar período sintético" },
      reconciler,
    );
  });
  await concurrency("Dos versiones activadas simultáneamente", async () => {
    const next = await save("rules/" + rule.id + "/versions", rulePayload);
    const rs = await Promise.all(
      [rule, next].map((r) =>
        reconciler.db.rpc("accounting_rule_action", {
          target_id: r.id,
          action: "activate_simulation",
          reason: "Carrera sintética",
        }),
      ),
    );
    assert(
      rs.every((r) => !r.error),
      "Concurrent activation failed",
    );
    assert(
      (
        await rows(owner, "accounting_rules", {
          company_id: A.id,
          code: rulePayload.code,
          status: "simulation_active",
        })
      ).length === 1,
      "Multiple active versions",
    );
  });
  await test(33, async () => {
    browserServer = await chromium.launchServer({
      channel: "msedge",
      headless: true,
    });
    browser = await chromium.connect(browserServer.wsEndpoint());
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    await context.addInitScript(
      ({ token, refresh }: any) =>
        sessionStorage.setItem(
          "erp.session",
          JSON.stringify({
            access_token: token,
            refresh_token: refresh,
            expires_in: 3600,
          }),
        ),
      { token: owner.token, refresh: owner.refresh },
    );
    const page = await context.newPage();
    await page.goto(cfg.APP_ORIGIN + "/app/accounting-journals");
    await page
      .getByRole("heading", { name: "Asientos contables", exact: true })
      .waitFor();
    await page
      .getByRole("cell", { name: posted.entry_number, exact: true })
      .waitFor();
    await page.screenshot({
      path: dir + "/capturas/asientos-dev.png",
      fullPage: true,
    });
    await page.goto(cfg.APP_ORIGIN + "/app/trial-balance");
    await page.getByRole("button", { name: "Consultar", exact: true }).click();
    await page.getByRole("cell", { name: "SYNTH-D", exact: true }).waitFor();
    await page.screenshot({
      path: dir + "/capturas/balance-dev.png",
      fullPage: true,
    });
    await page.goto(cfg.APP_ORIGIN + "/app/accounting-accounts");
    await page
      .getByRole("button", { name: "Nueva cuenta", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Código", { exact: true }).fill("UI-SYNTH");
    await dialog
      .getByLabel("Nombre", { exact: true })
      .fill("Cuenta sintética desde UI");
    await dialog.getByLabel("Tipo", { exact: true }).selectOption("asset");
    await dialog.getByLabel("Naturaleza").selectOption("debit");
    await dialog.getByLabel("Vigente desde").fill("2026-01-01");
    await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
    await page.getByRole("cell", { name: "UI-SYNTH", exact: true }).waitFor();
    await page.screenshot({
      path: dir + "/capturas/cuentas-dev.png",
      fullPage: true,
    });
  });
  await test(34, async () => {
    await checkClientBoundary();
    for (const file of [
      "src/client/accounting.tsx",
      "src/client/accounting-import.tsx",
    ])
      assert(
        !(await readFile(file, "utf8")).includes(cfg.SUPABASE_SECRET_KEY),
        "Secret in source",
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
