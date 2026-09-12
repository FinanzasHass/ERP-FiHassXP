import { Router } from "express";
import { z } from "zod";
import { getActor } from "../middleware/auth.js";
import { HttpError } from "../middleware/errors.js";
import { uuid } from "../validators/index.js";
import {
  treasurySchemas,
  treasuryAction,
  bankImport,
} from "../validators/treasury.js";
const resources: Record<string, [string, string]> = {
  banks: ["bank", "banks"],
  "bank-accounts": ["bank_account", "company_bank_accounts"],
  "payment-methods": ["payment_method", "payment_methods"],
  "payment-orders": ["payment_order", "payment_orders"],
  payments: ["payment", "payments"],
  "payment-batches": ["payment_batch", "payment_batches"],
  "bank-transactions": ["bank_transaction", "bank_transactions"],
  "reconciliation-periods": [
    "reconciliation_period",
    "bank_reconciliation_periods",
  ],
  "reconciliation-matches": [
    "reconciliation_match",
    "bank_reconciliation_matches",
  ],
};
const query = z
  .object({
    company_id: uuid,
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    status: z
      .string()
      .regex(/^[a-z_]+$/)
      .optional(),
    bank_account_id: uuid.optional(),
  })
  .strict();
export function treasuryRouter() {
  const r = Router();
  for (const [path, [kind, table]] of Object.entries(resources)) {
    r.get("/" + path, async (req, res) => {
      const { page, limit, ...filters } = query.parse(req.query);
      if (
        !(await getActor(req).db.rpc("has_company_access", {
          target_company: filters.company_id,
        }))
      )
        throw new HttpError(403, "COMPANY_ACCESS_DENIED");
      res.json(await getActor(req).db.list(table, { page, limit }, filters));
    });
    r.get("/" + path + "/:id", async (req, res) => {
      const a = getActor(req),
        id = uuid.parse(req.params.id),
        found = await a.db.list(table, { page: 1, limit: 1 }, { id });
      if (!found.data[0]) throw new HttpError(404, "NOT_FOUND");
      const result: Record<string, unknown> = { record: found.data[0] };
      const rel =
        kind === "payment_order"
          ? ["payment_order_items", "payment_order_id"]
          : kind === "payment"
            ? ["payment_allocations", "payment_id"]
            : kind === "payment_batch"
              ? ["payment_batch_items", "batch_id"]
              : kind === "reconciliation_period"
                ? ["bank_reconciliation_matches", "period_id"]
                : null;
      if (rel)
        result.items = (
          await a.db.list(rel[0]!, { page: 1, limit: 100 }, { [rel[1]!]: id })
        ).data;
      if (kind === "payment")
        result.attachments = (
          await a.db.list(
            "attachments",
            { page: 1, limit: 100 },
            { entity_type: "payment", entity_id: id },
          )
        ).data;
      res.json(result);
    });
    if (treasurySchemas[kind])
      for (const method of ["post", "patch"] as const)
        r[method](
          "/" + path + (method === "patch" ? "/:id" : ""),
          async (req, res) => {
            const schema = treasurySchemas[kind]!;
            const payload = (
              method === "patch" ? schema.partial() : schema
            ).parse(req.body);
            res
              .status(method === "post" ? 201 : 200)
              .json(
                await getActor(req).db.rpc("treasury_save", {
                  kind,
                  target_id:
                    method === "patch" ? uuid.parse(req.params.id) : null,
                  target_company: uuid.parse(req.query.company_id),
                  payload,
                }),
              );
          },
        );
    r.post("/" + path + "/:id/actions", async (req, res) =>
      res.json(
        await getActor(req).db.rpc("treasury_action", {
          kind,
          target_id: uuid.parse(req.params.id),
          ...treasuryAction.parse(req.body),
        }),
      ),
    );
  }
  for (const name of ["options", "dashboard", "cashflow"])
    r.get("/treasury/" + name, async (req, res) =>
      res.json(
        await getActor(req).db.rpc("treasury_" + name, {
          target_company: uuid.parse(req.query.company_id),
        }),
      ),
    );
  r.get("/treasury/candidates/:id", async (req, res) =>
    res.json(
      await getActor(req).db.rpc("treasury_candidates", {
        target_company: uuid.parse(req.query.company_id),
        transaction_id: uuid.parse(req.params.id),
      }),
    ),
  );
  r.post("/treasury/import", async (req, res) =>
    res.json(
      await getActor(req).db.rpc("treasury_import", {
        target_company: uuid.parse(req.query.company_id),
        ...bankImport.parse(req.body),
      }),
    ),
  );
  r.post("/treasury/match", async (req, res) =>
    res.status(201).json(
      await getActor(req).db.rpc("treasury_match", {
        target_company: uuid.parse(req.query.company_id),
        ...z
          .object({
            period_id: uuid,
            transaction_id: uuid,
            payment_id: uuid,
            match_amount: z.number().positive().multipleOf(0.01),
          })
          .strict()
          .parse(req.body),
      }),
    ),
  );
  return r;
}
