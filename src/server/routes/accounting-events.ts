import { Router } from "express";
import { z } from "zod";
import { getActor } from "../middleware/auth.js";
import { HttpError } from "../middleware/errors.js";
import { uuid } from "../validators/index.js";
import { reason } from "../validators/accounting.js";
import {
  afe,
  legacy,
  configurableImports,
} from "../validators/accounting-configuration.js";

const empty = z.object({}).strict();
const page = z
  .object({
    company_id: uuid,
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();
const states = z.enum([
  "pending_mapping",
  "ready",
  "previewed",
  "draft_generated",
  "posted",
  "ignored_authorized",
  "error",
]);

/** Every database call uses the authenticated request client and the database's live RLS/RPC checks. */
export function accountingEventsRouter() {
  const router = Router();
  router.get("/accounting/demo-dashboard", async (req, res) => {
    const company_id = page
        .pick({ company_id: true })
        .parse(req.query).company_id,
      db = getActor(req).db;
    if (!(await db.rpc("has_company_access", { target_company: company_id })))
      throw new HttpError(403, "COMPANY_ACCESS_DENIED");
    res.json(
      await db.rpc("accounting_demo_dashboard", { target_company: company_id }),
    );
  });
  router.get("/accounting/trace", async (req, res) => {
    const {
        company_id,
        entity_type,
        entity_id,
        page: current,
        limit,
      } = page
        .extend({
          entity_type: z.enum([
            "payable",
            "payment",
            "receivable",
            "collection",
            "expense_report",
            "employee_advance",
            "employee_reimbursement",
            "employee_return",
            "bank_transaction",
          ]),
          entity_id: uuid,
        })
        .parse(req.query),
      db = getActor(req).db;
    if (!(await db.rpc("has_company_access", { target_company: company_id })))
      throw new HttpError(403, "COMPANY_ACCESS_DENIED");
    const sources = await db.list(
      "accounting_event_sources",
      { page: current, limit },
      { company_id, entity_type, entity_id },
    );
    const records = await Promise.all(
      sources.data.map(async (value) => {
        const source = value as { event_id: string };
        return (
          await db.list(
            "accounting_event_queue",
            { page: 1, limit: 1 },
            { company_id, id: source.event_id },
          )
        ).data[0];
      }),
    );
    res.json({ data: records.filter(Boolean), count: sources.count });
  });
  for (const [path, table, schema, rpc] of [
    ["afes", "afes", afe, "accounting_afe_save"],
    ["legacy-mappings", "legacy_mappings", legacy, "accounting_legacy_save"],
  ] as const) {
    router.get("/accounting/" + path, async (req, res) => {
      const { company_id, page: current, limit } = page.parse(req.query),
        db = getActor(req).db;
      if (!(await db.rpc("has_company_access", { target_company: company_id })))
        throw new HttpError(403, "COMPANY_ACCESS_DENIED");
      res.json(await db.list(table, { page: current, limit }, { company_id }));
    });
    for (const edit of [false, true])
      router.post(
        "/accounting/" + path + (edit ? "/:id/versions" : ""),
        async (req, res) => {
          const { company_id, ...payload } = schema
            .extend({ company_id: uuid })
            .parse(req.body);
          res.json(
            await getActor(req).db.rpc(rpc, {
              target_id: edit ? uuid.parse(req.params.id) : null,
              target_company: company_id,
              payload,
            }),
          );
        },
      );
  }
  router.post("/accounting/configuration-import/:kind", async (req, res) => {
    const kind = z
      .enum([
        "afe",
        "legacy_mapping",
        "project",
        "subproject",
        "entry_type",
        "rule",
      ])
      .parse(req.params.kind);
    const b = z
      .object({
        company_id: uuid,
        rows: z.array(configurableImports[kind]).min(1).max(2000),
        confirm: z.boolean(),
      })
      .strict()
      .parse(req.body);
    res.json(
      await getActor(req).db.rpc("accounting_master_import", {
        kind,
        target_company: b.company_id,
        rows: b.rows,
        confirm: b.confirm,
        operation_key: uuid.parse(req.get("Idempotency-Key")),
      }),
    );
  });
  router.get("/accounting/events", async (req, res) => {
    const {
      page: current,
      limit,
      from,
      to,
      cost_center_id,
      project_id,
      ...filters
    } = page
      .extend({
        status: states.optional(),
        event_type: z
          .string()
          .regex(/^[A-Z_]{1,80}$/)
          .optional(),
        third_party_id: uuid.optional(),
        source_id: uuid.optional(),
        from: z.iso.date().optional(),
        to: z.iso.date().optional(),
        cost_center_id: uuid.optional(),
        project_id: uuid.optional(),
      })
      .parse(req.query);
    const db = getActor(req).db;
    if (
      !(await db.rpc("has_company_access", {
        target_company: filters.company_id,
      }))
    )
      throw new HttpError(403, "COMPANY_ACCESS_DENIED");
    res.json(
      await db.list(
        "accounting_event_queue",
        { page: current, limit, from, to },
        {
          ...filters,
          ...(cost_center_id
            ? { "dimensions->>cost_center": cost_center_id }
            : {}),
          ...(project_id ? { "dimensions->>project": project_id } : {}),
        },
      ),
    );
  });
  router.get("/accounting/events/:id", async (req, res) => {
    const db = getActor(req).db,
      id = uuid.parse(req.params.id);
    const record = (
      await db.list("accounting_event_queue", { page: 1, limit: 1 }, { id })
    ).data[0];
    if (!record) throw new HttpError(404, "NOT_FOUND");
    const sources = await db.list(
      "accounting_event_sources",
      { page: 1, limit: 100 },
      { event_id: id },
    );
    res.json({ record, sources: sources.data, sources_count: sources.count });
  });
  for (const action of ["resolve", "preview"] as const)
    router.post(`/accounting/events/:id/${action}`, async (req, res) => {
      empty.parse(req.body);
      res.json(
        await getActor(req).db.rpc(`accounting_event_${action}`, {
          target_id: uuid.parse(req.params.id),
        }),
      );
    });
  router.post("/accounting/events/:id/generate", async (req, res) => {
    const body = z
      .object({ period_id: uuid, entry_type_id: uuid })
      .strict()
      .parse(req.body);
    res.json(
      await getActor(req).db.rpc("accounting_event_generate", {
        target_id: uuid.parse(req.params.id),
        ...body,
        operation_key: uuid.parse(req.get("Idempotency-Key")),
      }),
    );
  });
  router.post("/accounting/events/:id/ignore", async (req, res) =>
    res.json(
      await getActor(req).db.rpc("accounting_event_ignore", {
        target_id: uuid.parse(req.params.id),
        ...reason.parse(req.body),
      }),
    ),
  );
  router.post("/accounting/demo/configure", async (req, res) => {
    const { company_id, ...body } = reason
      .extend({ company_id: uuid, enabled: z.boolean() })
      .parse(req.body);
    res.json(
      await getActor(req).db.rpc("accounting_demo_configure", {
        target_company: company_id,
        ...body,
      }),
    );
  });
  router.post("/accounting/demo/designate-company", async (req, res) => {
    const { company_id, reason: designation_reason } = reason
      .extend({ company_id: uuid })
      .parse(req.body);
    res.json(
      await getActor(req).db.rpc("accounting_demo_company_designate", {
        target_company: company_id,
        reason: designation_reason,
      }),
    );
  });
  router.post("/accounting/rules/:id/designate-demo", async (req, res) =>
    res.json(
      await getActor(req).db.rpc("accounting_demo_rule_designate", {
        target_id: uuid.parse(req.params.id),
        ...reason.parse(req.body),
      }),
    ),
  );
  router.post("/accounting/rules/:id/dimension-matches", async (req, res) => {
    const body = z
      .object({
        company_id: uuid,
        dimensions: z
          .array(
            z
              .object({
                dimension_type: z.enum([
                  "cost_center",
                  "project",
                  "subproject",
                  "area",
                  "afe_future",
                ]),
                dimension_id: uuid,
              })
              .strict(),
          )
          .max(5),
      })
      .strict()
      .parse(req.body);
    res.json(
      await getActor(req).db.rpc("accounting_rule_dimension_match_save", {
        target_rule: uuid.parse(req.params.id),
        target_company: body.company_id,
        dimensions: body.dimensions,
      }),
    );
  });
  router.post(
    "/bank-transactions/:id/accounting-adjustment",
    async (req, res) =>
      res.json(
        await getActor(req).db.rpc("accounting_bank_adjustment_capture", {
          target_transaction: uuid.parse(req.params.id),
          ...reason.parse(req.body),
        }),
      ),
  );
  return router;
}
