import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { createApp } from "../src/server/app.js";
import { readConfig } from "../src/server/config/env.js";
import { createAuthentication } from "../src/server/services/authentication.js";
import { createPrivilegedAuth } from "../src/server/integrations/supabase/auth-admin.js";
import { createSessionRepository } from "../src/server/repositories/session-repository.js";
const cfg = readConfig(process.env),
  previous = JSON.parse(
    await readFile("docs/fase-6/resultado-dev.json", "utf8"),
  );
const ref = (await readFile("supabase/.temp/project-ref", "utf8")).trim();
if (
  cfg.NODE_ENV === "production" ||
  new URL(cfg.SUPABASE_URL).hostname !== ref + ".supabase.co" ||
  !["localhost", "127.0.0.1"].includes(new URL(cfg.APP_ORIGIN).hostname) ||
  previous.status !== "PASS"
)
  throw new Error("Verified DEV required");
const authAdmin = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
}).auth.admin;
const normal = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const result: any = {
  executedAt: new Date().toISOString(),
  sourceRun: previous.run,
  environment: "DEV",
  status: "RUNNING",
  checks: [],
};
let server: any, browserServer: any, token: string | undefined;
try {
  const u = await authAdmin.getUserById(previous.fixtures.users[0]);
  if (
    u.error ||
    !u.data.user?.email?.startsWith(previous.run.toLowerCase() + "_owner@")
  )
    throw new Error("Synthetic identity mismatch");
  const l = await authAdmin.generateLink({
    type: "magiclink",
    email: u.data.user.email,
  });
  if (l.error) throw new Error("Auth unavailable");
  const r = await normal.auth.verifyOtp({
    type: "magiclink",
    token_hash: l.data.properties.hashed_token,
  });
  if (r.error || !r.data.session) throw new Error("Session unavailable");
  token = r.data.session.access_token;
  const db = createSessionRepository(cfg, token);
  const reports = await db.list(
    "expense_reports",
    { page: 1, limit: 100 },
    { company_id: previous.fixtures.companyA },
  );
  const report: any = reports.data.find((x: any) => x.status === "settled");
  if (!report) throw new Error("Synthetic closed report missing");
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
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(
    ({ access, refresh, user, company }) => {
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
      refresh: r.data.session.refresh_token,
      user: u.data.user.id,
      company: previous.fixtures.companyA,
    },
  );
  await page.goto(cfg.APP_ORIGIN + "/app/expense-reports");
  await page
    .getByRole("row")
    .filter({ hasText: report.report_number })
    .getByRole("button", { name: "Ver expediente" })
    .click();
  await page.getByText(/^Página 1 · [1-9]\d* eventos$/).waitFor();
  result.checks.push({
    name: "Historial persistido visible en UI real",
    status: "PASS",
  });
  await page.screenshot({
    path: "docs/fase-6/capturas/rendicion-dev.png",
    fullPage: true,
  });
  const popupReady = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Imprimir / guardar PDF" }).click();
  const popup = await popupReady;
  await popup.getByText("Liquidación", { exact: true }).waitFor();
  await popup.getByText("CECO histórico F6", { exact: false }).waitFor();
  result.checks.push({
    name: "Representación imprimible de expediente DEV con dimensiones históricas",
    status: "PASS",
  });
  await popup.pdf({
    path: "docs/fase-6/capturas/representacion-dev-sintetica.pdf",
    format: "A4",
    printBackground: true,
  });
  result.status = "PASS";
} catch {
  result.status = "FAIL";
  process.exitCode = 1;
} finally {
  if (browserServer) browserServer.process()?.kill();
  if (token) await authAdmin.signOut(token, "global").catch(() => {}); // only the verified synthetic owner
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
  await writeFile(
    "docs/fase-6/resultado-ui-dev.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
  process.exit(process.exitCode ?? 0);
}
