import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import ExcelJS from "exceljs";
const a = "10000000-0000-4000-8000-000000000001",
  b = "10000000-0000-4000-8000-000000000002",
  u = "00000000-0000-4000-8000-000000000001";
const grants = [
  "user.view",
  "user.create",
  "user.edit",
  "role.view",
  "permission.assign",
  "company.view",
  "area.view",
  "position.view",
  "audit.view",
  "cost_center.view",
  "cost_center.create",
  "cost_center.edit",
  "cost_center.disable",
  "project.view",
  "subproject.view",
  "currency.view",
];
async function fixture(page: Page, blocked = false) {
  const writes: Record<string, any>[] = [];
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      p = url.pathname;
    let body: any = { data: [], count: 0 },
      status = 200;
    if (p === "/api/auth/login") {
      status = blocked ? 403 : 200;
      body = blocked
        ? { error: "PROFILE_DISABLED" }
        : {
            access_token: "fixture",
            refresh_token: "fixture-refresh",
            expires_in: 3600,
          };
    } else if (p === "/api/auth/workspace")
      body = {
        companies: [
          {
            id: a,
            code: "TEST_A",
            legal_name: "Empresa A · entorno de prueba",
          },
          {
            id: b,
            code: "TEST_B",
            legal_name: "Empresa B · entorno de prueba",
          },
        ],
        area: "Administración",
        position: "Coordinación",
      };
    else if (p === "/api/auth/me")
      body = {
        profile: {
          id: u,
          full_name: "Usuario de prueba",
          username: "prueba",
          status: "active",
        },
        permissions: (url.searchParams.get("company_id") === b
          ? ["company.view"]
          : grants
        ).map((code) => ({ code })),
      };
    else if (p === "/api/cost-centers/import") {
      writes.push(req.postDataJSON());
      body = {
        committed: req.postDataJSON().commit,
        created: 1,
        updated: 0,
        ignored: 0,
        errors: [],
        rows: [],
      };
    } else if (p === "/api/cost-centers" && req.method() === "POST") {
      writes.push(req.postDataJSON());
      body = { id: u, ...req.postDataJSON() };
      status = 201;
    } else if (p === "/api/cost-centers")
      body = {
        data: [
          {
            id: u,
            code: "ADM",
            name: "Administración prueba",
            active: true,
            parent_id: null,
            level: 0,
            valid_from: "2026-09-09",
            company_id: a,
          },
        ],
        count: 1,
      };
    else if (p === "/api/roles")
      body = {
        data: [{ id: u, name: "Rol prueba", code: "test", active: true }],
        count: 1,
      };
    else if (p === "/api/permissions")
      body = {
        data: [
          {
            id: u,
            resource: "payment",
            action: "execute",
            code: "payment.execute",
            description: "Ejecutar pagos",
            active: true,
            is_sensitive: true,
          },
        ],
        count: 1,
      };
    else if (p === "/api/audit")
      body = {
        data: [
          {
            id: u,
            created_at: "2026-09-09T12:00:00Z",
            action: "insert",
            entity_type: "cost_centers",
            company_id: a,
            old_values: null,
            new_values: { code: "ADM" },
          },
        ],
        count: 1,
      };
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  return writes;
}
async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Correo o usuario").fill("prueba");
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill("password-for-test");
  await page.getByRole("button", { name: "Ingresar a la plataforma" }).click();
  await expect(
    page.getByRole("heading", { name: "Su espacio de gestión" }),
  ).toBeVisible();
}
test("login and dashboard without fictitious financial quantities; company guard clears capabilities", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/login");
  await mkdir("docs/fase-5/capturas", { recursive: true });
  await page.screenshot({
    path: "docs/fase-5/capturas/login-regresion.png",
    fullPage: true,
  });
  await login(page);
  await expect(page.getByText("Sin acceso", { exact: true })).toHaveCount(4);
  await page.screenshot({
    path: "docs/fase-5/capturas/dashboard-regresion.png",
    fullPage: true,
  });
  await page.getByLabel("Empresa activa", { exact: true }).selectOption(b);
  await expect(
    page.getByRole("button", { name: "Centros de costo", exact: true }),
  ).toHaveCount(0);
  await page.goto("/app/cost-centers");
  await expect(
    page.getByText("No tiene permiso para acceder a este módulo."),
  ).toBeVisible();
});
test("blocked profile cannot enter app", async ({ page }) => {
  await fixture(page, true);
  await page.goto("/login");
  await page.getByLabel("Correo o usuario").fill("prueba");
  await page.getByLabel("Contraseña", { exact: true }).fill("password");
  await page.getByRole("button", { name: "Ingresar a la plataforma" }).click();
  await expect(page.getByRole("alert")).toContainText("inactiva o bloqueada");
});
test("CECO subcenter form, hierarchy, import preview and explicit confirmation", async ({
  page,
}) => {
  const writes = await fixture(page);
  await login(page);
  await page
    .getByRole("button", { name: "Centros de costo", exact: true })
    .click();
  await page.getByRole("button", { name: "Vista árbol" }).click();
  await page.getByRole("button", { name: "ADM Administración prueba" }).click();
  await page.getByRole("button", { name: "Nuevo subcentro" }).click();
  await page.getByLabel("Código *", { exact: true }).fill("SUB");
  await page.getByLabel("Nombre *", { exact: true }).fill("Subcentro");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].parent_id).toBe(u);
  await page.getByRole("button", { name: "Importar Excel / CSV" }).click();
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "centros.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "company_code,code,name,parent_code,category,description,active\nTEST_A,IMPORT,Importación,,,,true",
      ),
    });
  await page.getByRole("button", { name: "Validar y previsualizar" }).click();
  await expect(page.getByText("Vista previa · sin escrituras")).toBeVisible();
  expect(writes.at(-1)?.commit).toBe(false);
  await page
    .getByRole("button", { name: "Confirmar importación del lote" })
    .click();
  await expect.poll(() => writes.at(-1)?.commit).toBe(true);
});
test("role matrix shows sensitive human labels and audit has old/new detail", async ({
  page,
}) => {
  await fixture(page);
  await login(page);
  await page
    .getByRole("button", { name: "Roles y permisos", exact: true })
    .click();
  await page.getByRole("button", { name: "Abrir ↗" }).click();
  await page.getByRole("button", { name: "Matriz de permisos" }).click();
  await expect(page.getByText("Sensible", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Ejecutar Sensible")).toBeVisible();
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  await page.getByRole("button", { name: "Auditoría", exact: true }).click();
  await page.getByRole("button", { name: "Abrir ↗" }).click();
  await expect(page.getByRole("heading", { name: "Después" })).toBeVisible();
});
test("mobile sidebar drawer and tablet layout", async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole("button", { name: "Alternar menú" }).click();
  await expect(
    page.getByRole("button", { name: "Centros de costo", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cerrar menú" }).click();
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(
    page.getByRole("heading", { name: "Su espacio de gestión" }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/fase-5/capturas/tablet-regresion.png",
    fullPage: true,
  });
});
test("Excel workbook is parsed in worker and rejects formulas", async ({
  page,
}) => {
  await fixture(page);
  await login(page);
  await page
    .getByRole("button", { name: "Centros de costo", exact: true })
    .click();
  await page.getByRole("button", { name: "Importar Excel / CSV" }).click();
  const workbook = new ExcelJS.Workbook(),
    sheet = workbook.addWorksheet("CECO");
  sheet.addRow(["company_code", "code", "name"]);
  sheet.addRow(["TEST_A", "XLSX", "Centro Excel"]);
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "centros.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    });
  await expect(
    page.getByRole("cell", { name: "Centro Excel", exact: true }),
  ).toBeVisible();
  sheet.getCell("C2").value = { formula: "1+1", result: 2 };
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "formulas.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    });
  await expect(page.getByRole("alert")).toContainText("No se admiten fórmulas");
});
