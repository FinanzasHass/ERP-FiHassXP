import { Router } from "express";
import { z } from "zod";
import { getActor } from "../middleware/auth.js";
import { HttpError } from "../middleware/errors.js";
import { uuid } from "../validators/index.js";
import {
  employeeInput,
  expenseCategoryInput,
  expensePolicyInput,
  travelInput,
  travelAction,
} from "../validators/employee-expenses.js";

const listQuery = z
  .object({
    company_id: uuid,
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();
const context = z.object({ company_id: uuid }).strict();

export function employeeExpensesRouter() {
  const router = Router();
  const resources = [
    ["employees", "employees"],
    ["expense-categories", "expense_categories"],
    ["expense-policies", "employee_expense_policies"],
    ["travel-expenses", "travel_expense_requests"],
    ["employee-advances", "employee_advances"],
  ] as const;
  for (const [path, table] of resources) {
    router.get(`/${path}`, async (req, res) => {
      const { page, limit, company_id } = listQuery.parse(req.query);
      const actor = getActor(req);
      if (
        !(await actor.db.rpc("has_company_access", {
          target_company: company_id,
        }))
      )
        throw new HttpError(403, "COMPANY_ACCESS_DENIED");
      res.json(await actor.db.list(table, { page, limit }, { company_id }));
    });
  }
  for (const [path, kind, schema] of [
    ["employees", "employee", employeeInput],
    ["expense-categories", "category", expenseCategoryInput],
  ] as const) {
    router.post(`/${path}`, async (req, res) => {
      const { company_id } = context.parse(req.query);
      res.status(201).json(
        await getActor(req).db.rpc("employee_foundation_save", {
          kind,
          target_id: null,
          target_company: company_id,
          payload: schema.parse(req.body),
        }),
      );
    });
    router.patch(`/${path}/:id`, async (req, res) => {
      const { company_id } = context.parse(req.query);
      res.json(
        await getActor(req).db.rpc("employee_foundation_save", {
          kind,
          target_id: uuid.parse(req.params.id),
          target_company: company_id,
          payload: schema.partial().parse(req.body),
        }),
      );
    });
  }
  router.post("/expense-policies", async (req, res) => {
    const { company_id } = context.parse(req.query);
    res.status(201).json(
      await getActor(req).db.rpc("employee_foundation_save", {
        kind: "policy",
        target_id: null,
        target_company: company_id,
        payload: expensePolicyInput.parse(req.body),
      }),
    );
  });
  router.get("/employee-bank-accounts", async (req, res) => {
    const { company_id } = context.parse(req.query);
    res.json(
      await getActor(req).db.rpc("employee_bank_list", {
        target_company: company_id,
      }),
    );
  });
  router.post("/employee-bank-accounts", async (req, res) => {
    const { company_id } = context.parse(req.query);
    const payload = z
      .object({
        employee_id: uuid,
        currency_id: uuid,
        bank_name: z.string().trim().min(1).max(150),
        account_number: z.string().regex(/^[0-9A-Za-z-]{6,40}$/),
        cci: z
          .string()
          .regex(/^[0-9]{20}$/)
          .nullable()
          .optional(),
        account_type: z.string().trim().min(1).max(50),
        replaces_id: uuid.nullable().optional(),
      })
      .strict()
      .parse(req.body);
    res
      .status(201)
      .json(
        await getActor(req).db.rpc("employee_bank_change", {
          target_company: company_id,
          payload,
        }),
      );
  });
  router.post("/employee-bank-accounts/:id/decision", async (req, res) => {
    const { approve } = z
      .object({ approve: z.boolean() })
      .strict()
      .parse(req.body);
    res.json(
      await getActor(req).db.rpc("employee_bank_decide", {
        target_id: uuid.parse(req.params.id),
        approve,
      }),
    );
  });
  for (const method of ["post", "put"] as const) {
    router[method](
      "/travel-expenses" + (method === "put" ? "/:id" : ""),
      async (req, res) => {
        const { company_id } = context.parse(req.query);
        res.status(method === "post" ? 201 : 200).json(
          await getActor(req).db.rpc("travel_expense_save", {
            target_id: method === "put" ? uuid.parse(req.params.id) : null,
            target_company: company_id,
            payload: travelInput.parse(req.body),
          }),
        );
      },
    );
  }
  router.get("/travel-expenses/:id", async (req, res) => {
    const id = uuid.parse(req.params.id),
      db = getActor(req).db;
    const record = (
      await db.list("travel_expense_requests", { page: 1, limit: 1 }, { id })
    ).data[0];
    if (!record) throw new HttpError(404, "NOT_FOUND");
    const [items, history] = await Promise.all([
      db.list(
        "travel_expense_request_items",
        { page: 1, limit: 100 },
        { request_id: id },
      ),
      db.list(
        "travel_expense_history",
        { page: 1, limit: 100 },
        { request_id: id },
      ),
    ]);
    res.json({
      record,
      items: items.data,
      history: history.data,
      history_total: history.count,
    });
  });
  router.post("/travel-expenses/:id/actions", async (req, res) => {
    const { action, comment } = travelAction.parse(req.body);
    res.json(
      await getActor(req).db.rpc("travel_expense_transition", {
        target_id: uuid.parse(req.params.id),
        action,
        comment: comment ?? null,
      }),
    );
  });
  return router;
}
