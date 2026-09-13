import { test, expect, type Page } from "@playwright/test";
const company = "10000000-0000-4000-8000-000000000001",
  id = "20000000-0000-4000-8000-000000000001";
async function fixture(page: Page) {
  const writes: { path: string; body: any; key: string | undefined }[] = [];
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
    const req = route.request(),
      url = new URL(req.url());
    let body: any = { data: [], count: 0 };
    if (url.pathname === "/api/auth/workspace")
      body = {
        companies: [
          { id: company, code: "F7", legal_name: "Empresa sintética F7" },
        ],
        area: "Pruebas",
        position: "Operador",
      };
    else if (url.pathname === "/api/auth/me")
      body = {
        profile: {
          id,
          full_name: "Operador sintético",
          username: "fixture",
          status: "active",
        },
        permissions: [
          "customer.view",
          "customer.create",
          "receivable.view",
          "receivable.create",
          "collection.view",
          "collection.apply",
          "collection.identify",
          "receivable_report.view",
        ].map((code) => ({ code })),
      };
    else if (url.pathname === "/api/receivable-context/options")
      body = {
        customers: [{ id, name: "Cliente sintético", status: "active" }],
        currencies: [{ id, name: "PEN" }],
        methods: [],
        sources: [],
      };
    else if (req.method() === "POST") {
      writes.push({
        path: url.pathname,
        body: req.postDataJSON(),
        key: req.headers()["idempotency-key"],
      });
      body = { id };
    } else if (url.pathname === "/api/receivables")
      body = {
        data: [
          {
            id,
            customer_id: id,
            currency_id: id,
            receivable_number: "CXC-2027-000001",
            due_date: "2027-01-01",
            original_amount: 100,
            collected_amount: 40,
            outstanding_amount: 60,
            status: "active",
            financial_status: "partially_collected",
          },
        ],
        count: 1,
      };
    else if (url.pathname === "/api/collections")
      body = {
        data: [
          {
            id,
            customer_id: id,
            currency_id: id,
            collection_number: "COB-2027-000001",
            collection_date: "2027-01-01",
            amount: 80,
            applied_amount: 0,
            unapplied_amount: 80,
            status: "active",
            financial_status: "identified",
          },
        ],
        count: 1,
      };
    else if (url.pathname === "/api/receivable-context/dashboard")
      body = {
        portfolio: [
          {
            currency_id: id,
            outstanding_amount: 60,
            overdue_amount: 60,
            upcoming_amount: 0,
            overdue_customers: 1,
          },
        ],
        aging: [{ currency_id: id, bucket: "over_90", amount: 60 }],
        credits: [{ customer_id: id, currency_id: id, unapplied_amount: 80 }],
      };
    await route.fulfill({ json: body });
  });
  return writes;
}
test("F7 new customer form sends legal identity without Auth or membership fields", async ({
  page,
}) => {
  const writes = await fixture(page);
  await page.goto("/app/customers");
  await page.getByRole("button", { name: "Nuevo", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Tipo de persona").selectOption("natural");
  await dialog.getByLabel("Tipo de documento").fill("TEST");
  await dialog.getByLabel("Documento", { exact: true }).fill("SYNTHETIC");
  await dialog.getByLabel("Nombre / razón social").fill("Cliente prueba");
  await dialog.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes[0]!.body).toEqual({
    customer_type: "natural",
    document_type: "TEST",
    document_number: "SYNTHETIC",
    legal_name: "Cliente prueba",
  });
});
test("F7 allocation shows current receivable remainder and carries a stable operation key", async ({
  page,
}) => {
  const writes = await fixture(page);
  await page.goto("/app/collections");
  await page.getByRole("button", { name: "Aplicar", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Obligación 1").selectOption(id);
  await dialog.getByLabel("Importe 1").fill("40");
  await dialog.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes[0]!.body).toEqual({
    allocations: [{ receivable_id: id, amount: 40 }],
  });
  expect(writes[0]!.key).toMatch(/^[\da-f-]{36}$/);
});
test("F7 collection dashboard distinguishes receivable aging and customer credit", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/app/receivable-dashboard");
  await expect(
    page.getByRole("heading", { name: "Antigüedad de saldos pendientes" }),
  ).toBeVisible();
  await expect(page.getByText("Más de 90 días", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Saldos a favor", exact: true }),
  ).toBeVisible();
});
