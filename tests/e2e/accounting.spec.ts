import { test, expect, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
const company = "10000000-0000-4000-8000-000000000001",
  id = "20000000-0000-4000-8000-000000000001";
async function fixture(page: Page) {
  const writes: { path: string; body: any; key?: string }[] = [];
  await page.addInitScript(() =>
    sessionStorage.setItem(
      "erp.session",
      JSON.stringify({
        access_token: "synthetic",
        refresh_token: "synthetic",
        expires_in: 3600,
      }),
    ),
  );
  await page.route("**/api/**", async (route) => {
    const r = route.request(),
      u = new URL(r.url());
    let body: any = { data: [], count: 0 };
    if (u.pathname === "/api/auth/workspace")
      body = {
        companies: [
          {
            id: company,
            code: "SYNTH",
            legal_name: "Empresa sintética contable",
          },
        ],
      };
    else if (u.pathname === "/api/auth/me")
      body = {
        profile: { id, full_name: "Contador sintético", status: "active" },
        permissions: [
          "accounting_account.view",
          "accounting_account.create",
          "accounting_account.import",
          "accounting_period.view",
          "accounting_period.manage",
          "journal.view",
          "journal.create",
          "accounting_rule.view",
          "accounting_rule.create",
          "general_ledger.view",
          "trial_balance.view",
        ].map((code) => ({ code })),
      };
    else if (u.pathname === "/api/accounting/options")
      body = {
        settings: { id, functional_currency_id: id },
        currencies: [{ id, name: "PEN" }],
        accounts: [{ id, name: "SYNTH · Cuenta sintética" }],
        periods: [{ id, name: "2026-09 · Abierto" }],
        entry_types: [{ id, name: "Manual" }],
        cost_centers: [],
        projects: [],
        subprojects: [],
        areas: [],
        exchange_rates: [],
      };
    else if (r.method() === "POST") {
      writes.push({
        path: u.pathname,
        body: r.postDataJSON(),
        key: r.headers()["idempotency-key"],
      });
      if (u.pathname.endsWith("/accounts/import"))
        body = {
          status: r.postDataJSON().confirm ? "imported" : "preview",
          validated_rows: 1,
          persisted: r.postDataJSON().confirm,
        };
      else if (u.pathname.includes("/reports/"))
        body = {
          data: [
            {
              account_id: id,
              account_code: "SYNTH",
              account_name: "Cuenta sintética",
              opening_balance: 0,
              debits: 100,
              credits: 100,
              closing_balance: 0,
            },
          ],
          count: 1,
        };
      else body = { id };
    }
    await route.fulfill({ json: body });
  });
  return writes;
}
test("account form creates explicit synthetic metadata without hidden account seeds", async ({
  page,
}) => {
  const writes = await fixture(page);
  await page.goto("/app/accounting-accounts");
  await page.getByRole("button", { name: "Nueva cuenta", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Código", { exact: true }).fill("SYNTH");
  await dialog.getByLabel("Nombre", { exact: true }).fill("Cuenta sintética");
  await dialog.getByLabel("Tipo", { exact: true }).selectOption("asset");
  await dialog.getByLabel("Naturaleza").selectOption("debit");
  await dialog.getByLabel("Vigente desde").fill("2026-01-01");
  await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes[0]?.body).toMatchObject({
    company_id: company,
    code: "SYNTH",
    account_type: "asset",
    allows_posting: true,
  });
  expect(writes[0]?.body.active).toBeUndefined();
});
test("journal editor sends current lines and preserves independent validation/posting", async ({
  page,
}) => {
  const writes = await fixture(page);
  await page.goto("/app/accounting-journals");
  await page
    .getByRole("button", { name: "Nuevo asiento", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Fecha", { exact: true }).fill("2026-09-13");
  await dialog.getByLabel("Período", { exact: true }).selectOption(id);
  await dialog.getByLabel("Tipo", { exact: true }).selectOption(id);
  await dialog
    .getByLabel("Descripción", { exact: true })
    .nth(0)
    .fill("Asiento sintético");
  await dialog.getByLabel("Moneda", { exact: true }).selectOption(id);
  for (let i = 0; i < 2; i++) {
    const line = dialog.locator("fieldset").nth(i);
    await line.getByLabel("Cuenta", { exact: true }).selectOption(id);
    await line
      .getByLabel("Descripción", { exact: true })
      .fill("Línea sintética");
    await line
      .getByLabel(i === 0 ? "Debe funcional" : "Haber funcional", {
        exact: true,
      })
      .fill("100");
  }
  await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes).toHaveLength(1);
  expect(writes[0]?.path).toBe("/api/accounting/journals");
  expect(writes[0]?.body.status).toBeUndefined();
  expect(writes[0]?.key).toMatch(/^[a-f0-9-]{36}$/);
});
test("chart CSV requires nonpersistent preview before explicit confirmation; report uses server values", async ({
  page,
}) => {
  const writes = await fixture(page);
  await page.goto("/app/accounting-accounts");
  await page.getByRole("button", { name: "Importar CSV / XLSX" }).click();
  await page
    .getByLabel("Archivo de cuentas")
    .setInputFiles({
      name: "synthetic.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "code,name,account_type,normal_balance,allows_posting,valid_from\n001,Sintética,asset,debit,true,2026-01-01",
      ),
    });
  await page
    .getByRole("button", { name: "Validar preview sin persistencia" })
    .click();
  await expect(
    page.getByText("1 cuentas validadas sin persistencia."),
  ).toBeVisible();
  expect(writes[0]?.body.confirm).toBe(false);
  await page.getByRole("button", { name: "Confirmar importación" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(writes[1]?.body.confirm).toBe(true);
  expect(writes[1]?.key).toBe(writes[0]?.key);
  expect(writes[1]?.body.rows[0].code).toBe("001");
  await page.goto("/app/trial-balance");
  await page.getByRole("button", { name: "Consultar", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "Cuenta sintética", exact: true }),
  ).toBeVisible();
});

test("accounting XLSX preserves text codes and rejects formulas and numeric identifiers",async({page})=>{
 await fixture(page);await page.goto('/app/accounting-accounts');await page.getByRole('button',{name:'Importar CSV / XLSX'}).click();
 const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Cuentas');sheet.addRow(['code','name','account_type','normal_balance','allows_posting','valid_from']);sheet.addRow(['001','Cuenta sintética','asset','debit','true','2026-01-01']);
 const upload=async()=>page.getByLabel('Archivo de cuentas').setInputFiles({name:'synthetic.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await workbook.xlsx.writeBuffer())});
 await upload();await expect(page.getByRole('cell',{name:'001',exact:true})).toBeVisible();
 sheet.getCell('A2').value=1;await upload();await expect(page.getByRole('alert')).toContainText('códigos deben almacenarse como texto');
 sheet.getCell('A2').value={formula:'1+1',result:2};await upload();await expect(page.getByRole('alert')).toContainText('no se admiten fórmulas');
});
