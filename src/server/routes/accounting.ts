import { Router } from "express";
import { z } from "zod";
import { getActor } from "../middleware/auth.js";
import { HttpError } from "../middleware/errors.js";
import { uuid } from "../validators/index.js";
import * as v from "../validators/accounting.js";
const context = z.object({ company_id: uuid }).strict();
const page = z
  .object({
    company_id: uuid,
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();
export function accountingRouter() {
  const router = Router();
  const tables: Record<string, string> = {
    accounts: "accounting_accounts",
    periods: "accounting_periods",
    "entry-types": "accounting_entry_types",
    journals: "journal_entries",
    rules: "accounting_rules",
    history: "accounting_history",
  };
  for (const [path, table] of Object.entries(tables))
    router.get("/accounting/" + path, async (req, res) => {
      const parsed = (
        path === "history" ? page.extend({ entity_id: uuid.optional() }) : page
      ).parse(req.query);
      const { company_id, page: currentPage, limit } = parsed,
        db = getActor(req).db;
      const filters: Record<string, string> = { company_id };
      if ("entity_id" in parsed && parsed.entity_id)
        filters.entity_id = String(parsed.entity_id);
      if (!(await db.rpc("has_company_access", { target_company: company_id })))
        throw new HttpError(403, "COMPANY_ACCESS_DENIED");
      res.json(await db.list(table, { page: currentPage, limit }, filters));
    });
  router.get("/accounting/options", async (req, res) =>
    res.json(
      await getActor(req).db.rpc("accounting_options", {
        target_company: context.parse(req.query).company_id,
      }),
    ),
  );
  for (const path of ["journals", "rules"] as const)
    router.get("/accounting/" + path + "/:id", async (req, res) => {
      const db = getActor(req).db,
        id = uuid.parse(req.params.id);
      const record = (
        await db.list(tables[path]!, { page: 1, limit: 1 }, { id })
      ).data[0] as Record<string, unknown> | undefined;
      if (!record) throw new HttpError(404, "NOT_FOUND");
      const lineFilters: Record<string, string> =
        path === "journals"
          ? { journal_entry_id: id, revision: String(record.revision) }
          : { rule_id: id };
      const lines: unknown[] = [];
      for (let p = 1; p <= 10; p++) {
        const result = await db.list(
          path === "journals" ? "journal_entry_lines" : "accounting_rule_lines",
          { page: p, limit: 100 },
          lineFilters,
        );
        lines.push(...result.data);
        if (lines.length >= result.count) break;
      }
      res.json({ record, lines });
    });
  router.get("/accounting/journal-lines/:id/dimensions", async (req, res) =>
    res.json(
      await getActor(req).db.list(
        "journal_line_dimensions",
        { page: 1, limit: 100 },
        { journal_line_id: uuid.parse(req.params.id) },
      ),
    ),
  );
  const masters = {
    accounts: { kind: "account", schema: v.account.omit({ active: true }) },
    periods: { kind: "period", schema: v.period },
    settings: { kind: "settings", schema: v.settings },
    "entry-types": { kind: "entry_type", schema: v.entryType },
  };
  for (const [path, { kind, schema }] of Object.entries(masters)) {
    router.post("/accounting/" + path, async (req, res) => {
      const { company_id, ...payload } = schema
        .extend({ company_id: uuid })
        .parse(req.body);
      res.status(201).json(
        await getActor(req).db.rpc("accounting_master_save", {
          kind,
          target_id: null,
          target_company: company_id,
          payload,
        }),
      );
    });
    if (path !== "periods")
      router.patch("/accounting/" + path + "/:id", async (req, res) => {
        const { company_id, ...payload } = schema
          .partial()
          .extend({ company_id: uuid })
          .parse(req.body);
        res.json(
          await getActor(req).db.rpc("accounting_master_save", {
            kind,
            target_id: uuid.parse(req.params.id),
            target_company: company_id,
            payload,
          }),
        );
      });
  }
  router.post("/accounting/accounts/:id/disable", async (req, res) =>
    res.json(
      await getActor(req).db.rpc("accounting_account_disable", {
        target_id: uuid.parse(req.params.id),
        reason: v.reason.parse(req.body).reason,
      }),
    ),
  );
  router.post("/accounting/accounts/import", async (req, res) => {
    const b = z
      .object({
        company_id: uuid,
        rows: z
          .array(
            v.account.omit({ parent_id: true }).extend({
              parent_code: z
                .string()
                .trim()
                .min(1)
                .max(40)
                .nullable()
                .optional(),
            }),
          )
          .min(1)
          .max(2000),
        confirm: z.boolean(),
      })
      .strict()
      .parse(req.body);
    res.json(
      await getActor(req).db.rpc("accounting_account_import", {
        target_company: b.company_id,
        rows: b.rows,
        confirm: b.confirm,
        operation_key: uuid.parse(req.get("Idempotency-Key")),
      }),
    );
  });
  router.post("/accounting/periods/:id/action", async (req, res) => {
    const b = v.reason
      .extend({ action: z.enum(["soft_close", "close", "reopen"]) })
      .parse(req.body);
    res.json(
      await getActor(req).db.rpc("accounting_period_action", {
        target_id: uuid.parse(req.params.id),
        ...b,
      }),
    );
  });
  router.post("/accounting/exchange-rates", async (req, res) => {
    const { company_id, ...payload } = v.exchangeRate
      .extend({ company_id: uuid })
      .parse(req.body);
    res.status(201).json(
      await getActor(req).db.rpc("accounting_exchange_rate_save", {
        target_company: company_id,
        payload,
      }),
    );
  });
  for (const path of ["journals", "rules"] as const) {
    const schema = path === "journals" ? v.journal : v.rule;
    for (const edit of [false, true])
      router.post(
        "/accounting/" + path + (edit ? "/:id/versions" : ""),
        async (req, res) => {
          const { company_id, ...payload } = schema
            .extend({ company_id: uuid })
            .parse(req.body);
          res.status(201).json(
            await getActor(req).db.rpc(
              path === "journals" ? "journal_save" : "accounting_rule_save",
              {
                target_id: edit ? uuid.parse(req.params.id) : null,
                target_company: company_id,
                payload,
                operation_key: uuid.parse(req.get("Idempotency-Key")),
              },
            ),
          );
        },
      );
  }
  router.post("/accounting/journals/:id/validate", async (req, res) => {
    z.object({}).strict().parse(req.body);
    res.json(
      await getActor(req).db.rpc("journal_validate", {
        target_id: uuid.parse(req.params.id),
      }),
    );
  });
  router.post("/accounting/journals/:id/post", async (req, res) => {
    z.object({}).strict().parse(req.body);
    res.json(
      await getActor(req).db.rpc("journal_post", {
        target_id: uuid.parse(req.params.id),
        operation_key: uuid.parse(req.get("Idempotency-Key")),
      }),
    );
  });
  router.post("/accounting/journals/:id/reverse", async (req, res) =>
    res.json(
      await getActor(req).db.rpc("journal_reverse", {
        target_id: uuid.parse(req.params.id),
        payload: v.reversal.parse(req.body),
        operation_key: uuid.parse(req.get("Idempotency-Key")),
      }),
    ),
  );
  router.post("/accounting/rules/:id/action", async (req, res) =>
    res.json(
      await getActor(req).db.rpc("accounting_rule_action", {
        target_id: uuid.parse(req.params.id),
        ...v.reason
          .extend({ action: z.enum(["activate_simulation", "disable"]) })
          .parse(req.body),
      }),
    ),
  );
  router.post("/accounting/rules/:id/preview", async (req, res) =>
    res.json(
      await getActor(req).db.rpc("accounting_preview", {
        target_id: uuid.parse(req.params.id),
        payload: v.preview.parse(req.body),
      }),
    ),
  );
  router.post("/accounting/reports/:kind", async (req, res) => {
    const { company_id, ...filters } = v.report
      .extend({ company_id: uuid })
      .parse(req.body);
    res.json(
      await getActor(req).db.rpc("accounting_report", {
        kind: z
          .enum(["general_ledger", "trial_balance"])
          .parse(req.params.kind),
        target_company: company_id,
        filters,
      }),
    );
  });
  return router;
}
