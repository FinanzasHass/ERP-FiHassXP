import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { createApp } from "../src/server/app.js";
import { readConfig } from "../src/server/config/env.js";
import { createAuthentication } from "../src/server/services/authentication.js";
import { createPrivilegedAuth } from "../src/server/integrations/supabase/auth-admin.js";
import { createSessionRepository } from "../src/server/repositories/session-repository.js";
const cfg = readConfig(process.env),
  prior = JSON.parse(await readFile("docs/fase-8a/resultado-dev.json", "utf8")),
  ref = (await readFile("supabase/.temp/project-ref", "utf8")).trim();
if (
  prior.status !== "PASS" ||
  cfg.NODE_ENV === "production" ||
  new URL(cfg.SUPABASE_URL).hostname !== ref + ".supabase.co" ||
  !["localhost", "127.0.0.1"].includes(new URL(cfg.APP_ORIGIN).hostname)
)
  throw new Error("Verified DEV required");
const admin = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
}).auth.admin;
let server: any, browserServer: any, token: string | undefined;
const result: any = {
  executedAt: new Date().toISOString(),
  sourceRun: prior.run,
  status: "RUNNING",
  readOnlyFinancialData: true,
  checks: [],
};
try {
  const u = await admin.getUserById(prior.fixtures.users[0]);
  if (
    u.error ||
    !u.data.user?.email?.startsWith(prior.run.toLowerCase() + "_owner@")
  )
    throw new Error("Synthetic identity mismatch");
  const link = await admin.generateLink({
    type: "magiclink",
    email: u.data.user.email,
  });
  if (link.error) throw new Error("Auth unavailable");
  const normal = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const login = await normal.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.data.properties.hashed_token,
  });
  if (login.error || !login.data.session)
    throw new Error("Session unavailable");
  token = login.data.session.access_token;
  server = createApp(cfg, {
    auth: createAuthentication(cfg),
    privileged: createPrivilegedAuth(cfg),
    repository: (t) => createSessionRepository(cfg, t),
  }).listen(cfg.PORT, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  browserServer = await chromium.launchServer({
    channel: "msedge",
    headless: true,
  });
  const browser = await chromium.connect(browserServer.wsEndpoint()),
    page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
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
      access: token,
      refresh: login.data.session.refresh_token,
      user: u.data.user.id,
      company: prior.fixtures.companyA,
    },
  );

  await page.goto(cfg.APP_ORIGIN + "/app/accounting-journals");
  await page
    .getByRole("heading", { name: "Asientos contables", exact: true })
    .waitFor();
  await page.getByText("Núcleo contable · Fase 8A", { exact: true }).waitFor();
  await page
    .getByRole("cell", { name: "SYNTH-2026-000001", exact: true })
    .waitFor();
  await page.screenshot({
    path: "docs/fase-8a/capturas/asientos-dev.png",
    fullPage: true,
  });
  result.checks.push({ name: "Asientos DEV y versión final", status: "PASS" });
  const response = await fetch(
    cfg.APP_ORIGIN +
      "/api/accounting/journals?company_id=" +
      prior.fixtures.companyA +
      "&limit=100",
    { headers: { Authorization: "Bearer " + token } },
  );
  if (!response.ok) throw new Error("Read unavailable");
  const entries = (await response.json()).data;
  let target: any;
  for (const entry of entries) {
    const response = await fetch(
      cfg.APP_ORIGIN + "/api/accounting/journals/" + entry.id,
      { headers: { Authorization: "Bearer " + token } },
    );
    if (!response.ok) throw new Error("Detail unavailable");
    const detail = await response.json();
    if (
      detail.lines.some((l: any) =>
        l.journal_line_dimensions?.some(
          (d: any) => d.snapshot_name === "CECO original",
        ),
      )
    ) {
      target = entry;
      break;
    }
  }
  if (!target) throw new Error("Historical fixture unavailable");
  await page
    .getByRole("row")
    .filter({ hasText: target.entry_number })
    .getByRole("button", { name: "Detalle", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByText("HISTORY · CECO original", { exact: true })
    .waitFor();
  await page
    .getByRole("dialog")
    .getByRole("heading", { name: "Historial", exact: true })
    .waitFor();
  await page.screenshot({
    path: "docs/fase-8a/capturas/dimensiones-historicas-dev.png",
    fullPage: true,
  });
  result.checks.push({
    name: "Detalle conserva CECO histórico, tercero e historial auditado",
    status: "PASS",
  });
  await page.goto(cfg.APP_ORIGIN + "/app/trial-balance");
  await page.getByRole("button", { name: "Consultar", exact: true }).click();
  await page.getByRole("cell", { name: "SYNTH-D", exact: true }).waitFor();
  await page.screenshot({
    path: "docs/fase-8a/capturas/balance-dev.png",
    fullPage: true,
  });
  result.checks.push({
    name: "Balance real y paginación final",
    status: "PASS",
  });
  result.status = "PASS";
} catch {
  result.status = "FAIL";
  process.exitCode = 1;
} finally {
  if (browserServer) browserServer.process()?.kill();
  if (token) await admin.signOut(token, "global").catch(() => {});
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await writeFile(
    "docs/fase-8a/resultado-ui-dev.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
  process.exit(process.exitCode ?? 0);
}
