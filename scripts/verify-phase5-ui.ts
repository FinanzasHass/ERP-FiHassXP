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
const base = JSON.parse(await readFile(dir + "/resultado-dev.json", "utf8"));
const report: any = {
  run: tag,
  startedAt: new Date().toISOString(),
  environment: "DEV",
  sameProjectAsApplication: true,
  results: [],
  baseRun: base.run,
};
await mkdir(dir + "/capturas", { recursive: true });
let server: any, browser: any, browserServer: any;
let stage="setup";
const tokens: string[] = [];
async function persist() {
  report.updatedAt = new Date().toISOString();
  report.summary = {
    pass: report.results.filter((r: any) => r.status === "PASS").length,
    fail: report.results.filter((r: any) => r.status === "FAIL").length,
  };
  await writeFile(
    dir + "/ui-dev.json",
    JSON.stringify(report, null, 2),
  );
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
    server.once("error", () => reject(new ProofError("Port unavailable")));
  });
  const ownerId = base.fixtures.users.find(
      (u: any) => u.kind === "solicitante",
    ).id,
    executorId = base.fixtures.users.find((u: any) => u.kind === "finanzas").id,
    reviewerId = base.fixtures.users.find(
      (u: any) => u.kind === "aprobador",
    ).id,
    c = base.fixtures.companies[0].id;
  const owner = await session(ownerId),
    executor = await session(executorId),
    reviewer = await session(reviewerId);
  const order = (await call(owner, "/payment-orders/" + base.fixtures.order))
    .record;
  const remaining = [];
  for (const id of base.fixtures.payables) {
    const p = (await call(owner, "/payables/" + id)).record;
    remaining.push({
      payable_id: id,
      allocated_amount: Number(p.outstanding_amount),
    });
  }
  const created: any[] = [];
  await test("UI DEV: CSV/XLSX preview, duplicados, confirmación y moneda legible", async () => {
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
      { token: owner, user: ownerId, company: c },
    );
    const transaction = (
      await call(owner, "/bank-transactions/" + base.fixtures.transaction)
    ).record;
    const headers = [
      "transaction_date",
      "transaction_type",
      "amount",
      "currency_code",
      "bank_reference",
      "description",
      "external_id",
    ];
    const values = [
      "2026-09-11",
      "debit",
      "60.00",
      "PEN",
      transaction.bank_reference,
      "UI import " + tag,
      transaction.external_id,
    ];
    for (const ext of ["csv", "xlsx"]) {
      let bytes: Buffer;
      if (ext === "csv")
        bytes = Buffer.from(headers.join(";") + "\n" + values.join(";"));
      else {
        const { default: ExcelJS } = await import("exceljs");
        const w = new ExcelJS.Workbook();
        const s = w.addWorksheet("Extracto");
        s.addRow(headers);
        s.addRow(values.map((v, i) => (i === 5 ? v + " XLSX" : v)));
        bytes = Buffer.from(await w.xlsx.writeBuffer());
      }
      stage=ext+" navigation";
      await page.goto(cfg.APP_ORIGIN + "/app/bank-transactions");
      await page
        .getByRole("button", { name: "Importar extracto", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      stage=ext+" account";
      await dialog
        .getByLabel("Cuenta", { exact: true })
        .selectOption(transaction.bank_account_id);
      stage=ext+" upload";
      await dialog
        .getByLabel("Archivo de extracto", { exact: true })
        .setInputFiles({
          name: "extracto." + ext,
          mimeType:
            ext === "csv"
              ? "text/csv"
              : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: bytes,
        });
      stage=ext+" preview";
      await dialog
        .getByRole("button", { name: "Preview sin persistencia", exact: true })
        .click();
      await dialog.getByRole("status").filter({ hasText: "preview" }).waitFor();
      await dialog
        .getByRole("button", { name: "Confirmar importación", exact: true })
        .click();
      await dialog
        .getByRole("status")
        .filter({ hasText: "imported" })
        .waitFor();
      assert(
        (await dialog.getByRole("status").textContent())?.includes(
          "insertados: 0",
        ),
        "Duplicate UI import inserted",
      );
      await page.screenshot({
        path: dir + "/capturas/import-" + ext + "-dev.png",
        fullPage: true,
      });
      await page.keyboard.press("Escape");
    }
    stage="cashflow";await page.goto(cfg.APP_ORIGIN + "/app/cashflow");
    await page
      .getByRole("cell", { name: "PEN", exact: true })
      .first()
      .waitFor();
    await page.getByRole("cell", { name: "440.00", exact: true }).waitFor();
    await page.screenshot({
      path: dir + "/capturas/cashflow-dev.png",
      fullPage: true,
    });
    stage="dashboard";await page.goto(cfg.APP_ORIGIN + "/app/treasury");
    await page
      .getByRole("heading", { name: "Panel de Tesorería", exact: true })
      .waitFor();
    await page.getByText("PEN 140.00", { exact: true }).first().waitFor();
    await page.screenshot({
      path: dir + "/capturas/tesoreria-dev.png",
      fullPage: true,
    });
    await page.close();
  });
  report.status = "PASS";
} catch (e) {
  report.status = "FAIL";
  report.error =
    e instanceof ProofError
      ? e.message
      : "Error de seguimiento; detalle sensible omitido.";
  console.log("Stage: "+stage+" · "+(e instanceof Error?e.name:"error"));
  if(browser){const pages=browser.contexts().flatMap((c:any)=>c.pages());if(pages[0])await pages[0].screenshot({path:dir+"/capturas/ui-diagnostic.png",fullPage:true}).catch(()=>{});}
  console.log(report.error);
  process.exitCode = 1;
} finally {
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
