import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const company = "10000000-0000-4000-8000-000000000001",
  id = "20000000-0000-4000-8000-000000000001",
  actor = "30000000-0000-4000-8000-000000000001";
const grants = [
  "travel_expense.view_own",
  "travel_expense.create",
  "travel_expense.submit",
  "expense_report.view_own",
  "expense_report.create",
  "expense_report.submit",
  "employee_return.register",
];
async function fixture(page: Page, report = false) {
  const writes: any[] = [];
  const historyPages: number[] = [];
  const items = Array.from({ length: 101 }, (_, n) => ({
    id: `item-${n}`,
    description: `Gasto sintético ${n + 1}`,
    cost_center_id: id,
    reported_amount: 1,
    accepted_amount: 1,
    rejected_amount: 0,
    support_type: "declaration",
    status: "accepted",
    dimension_snapshot: {
      cost_centers: [{ id, code: "HIST", name: "Nombre histórico" }],
    },
  }));
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
      url = new URL(req.url()),
      path = url.pathname;
    let body: any = { data: [], count: 0 };
    if (path === "/api/auth/workspace")
      body = {
        companies: [
          {
            id: company,
            code: "FIXTURE",
            legal_name: "Empresa sintética Fase 6",
          },
        ],
        area: "Pruebas",
        position: "Verificación",
      };
    else if (path === "/api/auth/me")
      body = {
        profile: {
          id: actor,
          full_name: "Colaborador sintético",
          username: "fixture",
          status: "active",
        },
        permissions: grants.map((code) => ({ code })),
      };
    else if (path === "/api/employee-expenses/options")
      body = {
        employees: [{ id, name: "Empleado sin cuenta ERP" }],
        currencies: [{ id, name: "PEN" }],
        categories: [{ id, name: "Movilidad" }],
        cost_centers: [{ id, name: "Nombre actual" }],
        projects: [],
        subprojects: [],
        travels: [],
        methods: [],
      };
    else if (req.method() === "POST") {
      writes.push(req.postDataJSON());
      body = { id };
    } else if (path === "/api/expense-reports")
      body = {
        data: [
          {
            id,
            report_number: "REN-2027-000001",
            employee_id: id,
            currency_id: id,
            status: "settlement_pending",
            total_reported: 101,
            total_accepted: 101,
            total_rejected: 0,
          },
        ],
        count: 1,
      };
    else if (path === `/api/expense-reports/${id}`)
      body = {
        record: {
          id,
          report_number: "REN-2027-000001",
          employee_id: id,
          currency_id: id,
          status: "settlement_pending",
          created_by: actor,
          version: 1,
        },
        items: items.slice(0, 100),
        items_total: 101,
        settlement: {
          id,
          advance_paid: 101,
          accepted_expenses: 101,
          return_due: 20,
        reimbursement_due: 0,
        return_outstanding: 0,
          reimbursement_outstanding: 0,
        },
      };
    else if (path === `/api/expense-reports/${id}/items`) {
      const n = Number(url.searchParams.get("page"));
      body = { data: items.slice((n - 1) * 100, n * 100), count: 101 };
    } else if (path.endsWith("/history")) {
      const n = Number(url.searchParams.get("page"));
      historyPages.push(n);
      body = {
        data: [
          {
            id: `h${n}`,
            created_at: "2027-01-01T12:00:00Z",
            action: `evento-${n}`,
            version: 1,
            reason: "Fixture histórico",
          },
        ],
        count: 121,
      };
    }
    await route.fulfill({ json: body });
  });
  await page.goto(report ? "/app/expense-reports" : "/app/travel-expenses");
  return { writes, historyPages };
}
test("VIA sends current edited budget and optional dimensions safely", async ({
  page,
}) => {
  const { writes } = await fixture(page);
  await page
    .getByRole("button", { name: "Nueva solicitud", exact: true })
    .click();
  await page.getByLabel("Colaborador", { exact: true }).selectOption(id);
  await page.getByLabel("Moneda", { exact: true }).selectOption(id);
  await page.getByLabel("Destino", { exact: true }).fill("Destino sintético");
  await page
    .getByLabel("Motivo del viaje", { exact: true })
    .fill("Prueba de formulario");
  await page.getByLabel("Inicio", { exact: true }).fill("2027-01-01");
  await page.getByLabel("Fin", { exact: true }).fill("2027-01-03");
  await page.getByLabel("CECO", { exact: true }).selectOption(id);
  await page.getByLabel("Categoría", { exact: true }).selectOption(id);
  await page
    .getByLabel("Concepto", { exact: true })
    .fill("Presupuesto actualizado");
  await page.getByLabel("Estimado", { exact: true }).fill("180");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].items[0]).toMatchObject({
    description: "Presupuesto actualizado",
    estimated_amount: 180,
    cost_center_id: id,
    project_id: null,
    subproject_id: null,
  });
  expect(writes[0]).not.toHaveProperty("paid_amount");
});
test("report loads beyond 100 items, history paginates, print preserves snapshot", async ({
  page,
}) => {
  const { historyPages } = await fixture(page, true);
  await page
    .getByRole("button", { name: "Ver expediente", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Gasto sintético 101", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Siguiente", exact: true })
    .last()
    .click();
  await expect.poll(() => historyPages.includes(2)).toBeTruthy();
  await expect(page.getByText("evento-2", { exact: true })).toBeVisible();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Imprimir / guardar PDF" }).click();
  const popup = await popupPromise;
  await expect(
    popup.getByText("HIST · Nombre histórico", { exact: true }),
  ).toHaveCount(101);
  await expect(
    popup.getByText("Gasto sintético 101", { exact: true }),
  ).toBeVisible();
  await popup.close();
  await mkdir("docs/fase-6/capturas", { recursive: true });
  await page.screenshot({
    path: "docs/fase-6/capturas/rendicion-regresion.png",
  });
});

test("DJ representation retains original declarant and expense, independent of current names", async ({
  page,
}) => {
  await fixture(page);
  const declaration = {
    id,
    declared_on: "2027-01-01",
    reason: "Declaración original sintética",
    amount: 20,
    status: "approved",
    original_values: {
      employee_id: id,
      item: {
        description: "Gasto declarado original",
        currency_id: id,
        reported_amount: 20,
        cost_center_id: id,
        dimension_snapshot: {
          employee: { full_name: "Declarante histórico" },
          cost_centers: [{ id, code: "OLD", name: "CECO original" }],
        },
      },
    },
  };
  await page.route("**/api/expense-declarations**", async (route) =>
    route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith("/" + id)
        ? { record: declaration }
        : { data: [declaration], count: 1 },
    }),
  );
  await page.goto("/app/expense-declarations");
  await page.getByRole("button", { name: "Ver expediente" }).click();
  const popupReady = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Imprimir / guardar PDF" }).click();
  const popup = await popupReady;
  await expect(
    popup.getByText("Declarante histórico", { exact: true }),
  ).toBeVisible();
  await expect(
    popup.getByText("Gasto declarado original", { exact: true }),
  ).toBeVisible();
  await expect(
    popup.getByText("OLD · CECO original", { exact: true }),
  ).toBeVisible();
  await popup.close();
});
