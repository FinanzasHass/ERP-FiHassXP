import { Router } from "express";
import { z } from "zod";
import { getActor } from "../middleware/auth.js";
import { HttpError } from "../middleware/errors.js";
import { uuid } from "../validators/index.js";
import {
  expenseReportInput,
  expenseItemInput,
  expenseActionInput,
  expenseReviewInput,
  expenseTaxInput,
  employeeReturnInput,
} from "../validators/employee-expenses.js";
import { validateSettlementContract } from "../services/settlement-contract.js";
const context = z.object({ company_id: uuid }).strict();
const paging = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();
const note = z.object({ reason: z.string().trim().min(1).max(2000) }).strict();

export function expenseReportsRouter() {
  const router = Router();
  for (const [path, table] of [
    ["expense-reports", "expense_reports"],
    ["expense-declarations", "expense_declarations"],
    ["employee-returns", "employee_returns"],
    ["employee-reimbursements", "employee_reimbursements"],
  ] as const) {
    router.get(`/${path}`, async (req, res) => {
      const { company_id, ...pagination } = paging
        .extend({ company_id: uuid })
        .parse(req.query);
      const db = getActor(req).db;
      if (!(await db.rpc("has_company_access", { target_company: company_id })))
        throw new HttpError(403, "COMPANY_ACCESS_DENIED");
      res.json(await db.list(table, pagination, { company_id }));
    });
  }
  for (const [path, fn] of [
    ["options", "expense_options"],
    ["dashboard", "expense_dashboard"],
  ] as const)
    router.get(`/employee-expenses/${path}`, async (req, res) => {
      const { company_id } = context.parse(req.query),
        db = getActor(req).db;
      if (!(await db.rpc("has_company_access", { target_company: company_id })))
        throw new HttpError(403, "COMPANY_ACCESS_DENIED");
      res.json(await db.rpc(fn, { target_company: company_id }));
    });
  router.post("/expense-reports", async (req, res) =>
    res
      .status(201)
      .json(
        await getActor(req).db.rpc("expense_report_create", {
          target_company: context.parse(req.query).company_id,
          payload: expenseReportInput.parse(req.body),
        }),
      ),
  );
  router.get("/expense-attachments", async (req, res) => {
    const { entity_type, entity_id } = z
      .object({
        entity_type: z.enum([
          "expense_receipt",
          "tax_support",
          "declaration_support",
          "employee_payment_evidence",
          "employee_return_evidence",
          "employee_reimbursement_support",
          "expense_representation",
        ]),
        entity_id: uuid,
      })
      .strict()
      .parse(req.query);
    res.json(
      await getActor(req).db.list(
        "attachments",
        { page: 1, limit: 100 },
        { entity_type, entity_id },
      ),
    );
  });
  for (const [path, table] of [
    ["expense-declarations", "expense_declarations"],
    ["employee-returns", "employee_returns"],
    ["employee-reimbursements", "employee_reimbursements"],
  ] as const)
    router.get(`/${path}/:id`, async (req, res) => {
      const id = uuid.parse(req.params.id),
        db = getActor(req).db;
      const record = (await db.list(table, { page: 1, limit: 1 }, { id }))
        .data[0];
      if (!record) throw new HttpError(404, "NOT_FOUND");
      const matches =
        table === "employee_returns"
          ? (
              await db.list(
                "bank_reconciliation_matches",
                { page: 1, limit: 100 },
                { employee_return_id: id },
              )
            ).data
          : [];
      res.json({ record, matches });
    });
  router.get("/expense-reports/:id", async (req, res) => {
    const id = uuid.parse(req.params.id),
      db = getActor(req).db;
    const record = (
      await db.list("expense_reports", { page: 1, limit: 1 }, { id })
    ).data[0];
    if (!record) throw new HttpError(404, "NOT_FOUND");
    const [items, settlement] = await Promise.all([
      db.list(
        "expense_report_items",
        { page: 1, limit: 100 },
        { report_id: id },
      ),
      db.rpc<Record<string, unknown> | null>("expense_settlement_detail", {
        target_id: id,
      }),
    ]);
    res.json({
      record,
      items: items.data,
      items_total: items.count,
      settlement: settlement ? validateSettlementContract(settlement) : null,
    });
  });
  // Histories are independently paginated and retain stable chronological ordering.
  for (const [path, table, parent, foreign] of [
    [
      "travel-expenses",
      "travel_expense_history",
      "travel_expense_requests",
      "request_id",
    ],
    [
      "expense-reports",
      "expense_report_history",
      "expense_reports",
      "report_id",
    ],
  ] as const)
    router.get(`/${path}/:id/history`, async (req, res) => {
      const id = uuid.parse(req.params.id),
        db = getActor(req).db,
        p = paging.parse(req.query);
      if (!(await db.list(parent, { page: 1, limit: 1 }, { id })).data[0])
        throw new HttpError(404, "NOT_FOUND");
      const result = await db.list(table, p, { [foreign]: id });
      res.json({ ...result, ...p });
    });
  router.get("/expense-reports/:id/items", async (req, res) => {
    const id = uuid.parse(req.params.id),
      db = getActor(req).db,
      p = paging.parse(req.query);
    if (
      !(await db.list("expense_reports", { page: 1, limit: 1 }, { id })).data[0]
    )
      throw new HttpError(404, "NOT_FOUND");
    res.json(await db.list("expense_report_items", p, { report_id: id }));
  });
  for (const method of ["post", "put"] as const)
    router[method](
      "/expense-reports/:id/items" + (method === "put" ? "/:item" : ""),
      async (req, res) =>
        res
          .status(method === "post" ? 201 : 200)
          .json(
            await getActor(req).db.rpc("expense_item_save", {
              report_id: uuid.parse(req.params.id),
              target_id: method === "put" ? uuid.parse(req.params.item) : null,
              payload: expenseItemInput.parse(req.body),
            }),
          ),
    );
  router.post("/expense-reports/:id/actions", async (req, res) => {
    const { action, reason } = expenseActionInput.parse(req.body);
    res.json(
      await getActor(req).db.rpc("expense_report_transition", {
        target_id: uuid.parse(req.params.id),
        action,
        reason: reason ?? null,
      }),
    );
  });
  router.post("/expense-items/:id/review", async (req, res) =>
    res.json(
      await getActor(req).db.rpc("expense_item_review", {
        target_id: uuid.parse(req.params.id),
        ...expenseReviewInput.parse(req.body),
      }),
    ),
  );
  router.post("/expense-items/:id/declaration", async (req, res) => {
    const body = z
      .object({
        declared_on: z.iso.date(),
        reason: z.string().trim().min(1).max(4000),
      })
      .strict()
      .parse(req.body);
    res
      .status(201)
      .json(
        await getActor(req).db.rpc("expense_declaration_create", {
          item_id: uuid.parse(req.params.id),
          ...body,
        }),
      );
  });
  router.post("/expense-declarations/:id/decision", async (req, res) =>
    res.json(
      await getActor(req).db.rpc("expense_declaration_decide", {
        target_id: uuid.parse(req.params.id),
        ...note.extend({ approve: z.boolean() }).parse(req.body),
      }),
    ),
  );
  router.post("/expense-items/:id/tax-document", async (req, res) =>
    res
      .status(201)
      .json(
        await getActor(req).db.rpc("expense_tax_document", {
          item_id: uuid.parse(req.params.id),
          payload: expenseTaxInput.parse(req.body),
        }),
      ),
  );
  router.post("/expense-tax-documents/:id/review", async (req, res) => {
    z.object({})
      .strict()
      .parse(req.body ?? {});
    res.json(
      await getActor(req).db.rpc("expense_tax_document_review", {
        target_id: uuid.parse(req.params.id),
      }),
    );
  });
  router.post("/expense-settlements/:id/returns", async (req, res) =>
    res
      .status(201)
      .json(
        await getActor(req).db.rpc("employee_return_register", {
          settlement_id: uuid.parse(req.params.id),
          payload: employeeReturnInput.parse(req.body),
        }),
      ),
  );
  router.get("/employee-returns/:id/candidates", async (req, res) =>
    res.json(
      await getActor(req).db.rpc("employee_return_candidates", {
        return_id: uuid.parse(req.params.id),
      }),
    ),
  );
  router.post("/employee-returns/:id/matches", async (req, res) => {
    const body = z
      .object({
        period_id: uuid,
        transaction_id: uuid,
        amount: z.number().positive().max(999999999999.99).multipleOf(0.01),
      })
      .strict()
      .parse(req.body);
    res
      .status(201)
      .json(
        await getActor(req).db.rpc("employee_return_match", {
          return_id: uuid.parse(req.params.id),
          ...body,
        }),
      );
  });
  router.post("/employee-returns/:id/cancel", async (req, res) =>
    res.json(
      await getActor(req).db.rpc("employee_return_cancel", {
        target_id: uuid.parse(req.params.id),
        ...note.parse(req.body),
      }),
    ),
  );
  router.post("/travel-expenses/:id/cancel-unpaid", async (req, res) =>
    res.json(
      await getActor(req).db.rpc("travel_cancel_unpaid", {
        target_id: uuid.parse(req.params.id),
        ...note.parse(req.body),
      }),
    ),
  );
  return router;
}
