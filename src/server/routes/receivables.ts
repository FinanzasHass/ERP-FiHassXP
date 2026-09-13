import { Router } from "express";
import { z } from "zod";
import { getActor } from "../middleware/auth.js";
import { HttpError } from "../middleware/errors.js";
import { uuid } from "../validators/index.js";
import * as v from "../validators/receivables.js";
const context = z.object({ company_id: uuid }).strict();
const pagination = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();
const tables: Record<string, string> = {
  customers: "customers",
  receivables: "receivable_balances",
  collections: "collection_balances",
  "receivable-sources": "receivable_sources",
  "receivable-schedules": "receivable_schedules",
  "receivable-installments": "receivable_installments",
  "membership-accounts": "membership_accounts",
  "lot-contracts": "lot_finance_contracts",
  "issued-documents": "issued_document_references",
};
export function receivablesRouter() {
  const router = Router();
  for (const [path, table] of Object.entries(tables)) {
    router.get("/" + path, async (req, res) => {
      const schema =
        path === "receivable-sources"
          ? pagination.extend({
              company_id: uuid,
              source_type: z
                .enum(["membership", "lot_sale", "manual_authorized", "other"])
                .optional(),
            })
          : path === "receivables"
            ? pagination.extend({
                company_id: uuid,
                customer_id: uuid.optional(),
              })
            : pagination.extend({ company_id: uuid });
      const parsed = schema.parse(req.query),
        { company_id, page, limit } = parsed,
        filters: Record<string, string> = { company_id };
      if ("source_type" in parsed && parsed.source_type)
        filters.source_type = String(parsed.source_type);
      if ("customer_id" in parsed && parsed.customer_id)
        filters.customer_id = String(parsed.customer_id);
      const db = getActor(req).db;
      if (!(await db.rpc("has_company_access", { target_company: company_id })))
        throw new HttpError(403, "COMPANY_ACCESS_DENIED");
      res.json(await db.list(table, { page, limit }, filters));
    });
    router.get("/" + path + "/:id", async (req, res) => {
      const id = uuid.parse(req.params.id),
        db = getActor(req).db,
        record = (await db.list(table, { page: 1, limit: 1 }, { id })).data[0];
      if (!record) throw new HttpError(404, "NOT_FOUND");
      const children =
        path === "collections"
          ? await db.list(
              "collection_allocations",
              { page: 1, limit: 100 },
              { collection_id: id },
            )
          : path === "receivable-schedules"
            ? await db.list(
                "receivable_installments",
                { page: 1, limit: 100 },
                { schedule_id: id },
              )
            : { data: [], count: 0 };
      res.json({
        record,
        children: children.data,
        children_total: children.count,
      });
    });
  }
  router.get("/collection-deposits", async (req, res) => {
    const { company_id, page, limit } = pagination
      .extend({ company_id: uuid })
      .parse(req.query);
    res.json(
      await getActor(req).db.rpc("collection_deposit_queue", {
        target_company: company_id,
        page,
        page_size: limit,
      }),
    );
  });
  router.get("/receivable-context/options", async (req, res) =>
    res.json(
      await getActor(req).db.rpc("receivable_options", {
        target_company: context.parse(req.query).company_id,
      }),
    ),
  );
  router.get("/receivable-context/dashboard", async (req, res) => {
    const { company_id, as_of } = context
      .extend({ as_of: z.iso.date().optional() })
      .parse(req.query);
    res.json(
      await getActor(req).db.rpc("receivable_dashboard", {
        target_company: company_id,
        ...(as_of ? { as_of } : {}),
      }),
    );
  });
  router.post("/customers", async (req, res) =>
    res
      .status(201)
      .json(
        await getActor(req).db.rpc("customer_save", {
          target_id: null,
          target_company: context.parse(req.query).company_id,
          payload: v.customerInput.parse(req.body),
        }),
      ),
  );
  router.patch("/customers/:id", async (req, res) =>
    res.json(
      await getActor(req).db.rpc("customer_save", {
        target_id: uuid.parse(req.params.id),
        target_company: context.parse(req.query).company_id,
        payload: v.customerInput.partial().parse(req.body),
      }),
    ),
  );
  router.post("/customers/:id/disable", async (req, res) =>
    res.json(
      await getActor(req).db.rpc("customer_disable", {
        target_id: uuid.parse(req.params.id),
        ...v.reasonInput.parse(req.body),
      }),
    ),
  );
  for (const [path, fn, schema] of [
    ["receivable-sources", "receivable_source_create", v.sourceInput],
    ["receivables", "receivable_create", v.receivableInput],
    ["collections", "collection_register", v.collectionInput],
  ] as const) {
    router.post("/" + path, async (req, res) =>
      res
        .status(201)
        .json(
          await getActor(req).db.rpc(fn, {
            target_company: context.parse(req.query).company_id,
            payload: schema.parse(req.body),
            operation_key: uuid.parse(req.header("Idempotency-Key")),
          }),
        ),
    );
  }
  router.post("/receivable-sources/:id/schedules", async (req, res) =>
    res
      .status(201)
      .json(
        await getActor(req).db.rpc("receivable_schedule_generate", {
          source_id: uuid.parse(req.params.id),
          payload: v.scheduleInput.parse(req.body),
          operation_key: uuid.parse(req.header("Idempotency-Key")),
        }),
      ),
  );
  router.post("/receivable-sources/:id/close", async (req, res) =>
    res.json(
      await getActor(req).db.rpc("receivable_source_close", {
        target_id: uuid.parse(req.params.id),
        ...v.reasonInput.parse(req.body),
      }),
    ),
  );
  router.post("/receivables/:id/actions", async (req, res) =>
    res.json(
      await getActor(req).db.rpc("receivable_change", {
        target_id: uuid.parse(req.params.id),
        ...v.receivableChangeInput.parse(req.body),
      }),
    ),
  );
  router.post("/collections/:id/identify", async (req, res) =>
    res.json(
      await getActor(req).db.rpc("collection_identify", {
        target_id: uuid.parse(req.params.id),
        ...v.identifyInput.parse(req.body),
        operation_key: uuid.parse(req.header("Idempotency-Key")),
      }),
    ),
  );
  router.post("/collections/:id/apply", async (req, res) =>
    res.json(
      await getActor(req).db.rpc("collection_apply", {
        target_id: uuid.parse(req.params.id),
        payload: v.allocationInput.parse(req.body),
        operation_key: uuid.parse(req.header("Idempotency-Key")),
      }),
    ),
  );
  for (const [path, fn] of [
    ["collections/:id/reverse", "collection_reverse"],
    ["collection-allocations/:id/unapply", "collection_unapply"],
  ] as const)
    router.post("/" + path, async (req, res) =>
      res.json(
        await getActor(req).db.rpc(fn, {
          target_id: uuid.parse(req.params.id),
          ...v.reasonInput.parse(req.body),
          operation_key: uuid.parse(req.header("Idempotency-Key")),
        }),
      ),
    );
  router.get("/collections/:id/candidates", async (req, res) =>
    res.json(
      await getActor(req).db.rpc("collection_candidates", {
        target_id: uuid.parse(req.params.id),
      }),
    ),
  );
  router.post("/collections/:id/matches", async (req, res) =>
    res
      .status(201)
      .json(
        await getActor(req).db.rpc("collection_match", {
          target_id: uuid.parse(req.params.id),
          ...v.collectionMatchInput.parse(req.body),
        }),
      ),
  );
  router.post("/issued-documents", async (req, res) =>
    res
      .status(201)
      .json(
        await getActor(req).db.rpc("issued_document_create", {
          target_company: context.parse(req.query).company_id,
          payload: v.issuedDocumentInput.parse(req.body),
        }),
      ),
  );
  for (const [path, kind, table] of [
    ["receivables", "receivable", "receivable_balances"],
    ["collections", "collection", "collection_balances"],
    ["receivable-sources", "source", "receivable_sources"],
    ["receivable-schedules", "schedule", "receivable_schedules"],
  ] as const) {
    router.get("/" + path + "/:id/history", async (req, res) => {
      const id = uuid.parse(req.params.id),
        db = getActor(req).db,
        p = pagination.parse(req.query);
      if (!(await db.list(table, { page: 1, limit: 1 }, { id })).data[0])
        throw new HttpError(404, "NOT_FOUND");
      res.json(
        await db.list("receivable_history", p, {
          entity_type: kind,
          entity_id: id,
        }),
      );
    });
  }
  router.get("/collections/:id/allocations", async (req, res) => {
    const id = uuid.parse(req.params.id),
      db = getActor(req).db;
    if (
      !(await db.list("collection_balances", { page: 1, limit: 1 }, { id }))
        .data[0]
    )
      throw new HttpError(404, "NOT_FOUND");
    res.json(
      await db.list("collection_allocations", pagination.parse(req.query), {
        collection_id: id,
      }),
    );
  });
  router.get("/receivable-schedules/:id/installments", async (req, res) => {
    const id = uuid.parse(req.params.id),
      db = getActor(req).db;
    if (
      !(await db.list("receivable_schedules", { page: 1, limit: 1 }, { id }))
        .data[0]
    )
      throw new HttpError(404, "NOT_FOUND");
    const {page,limit}=pagination.parse(req.query);
    res.json(await db.rpc('receivable_schedule_installments',{target_id:id,page,page_size:limit}));
  });
  router.get("/receivable-attachments", async (req, res) => {
    const q = z
      .object({
        entity_type: z.enum(["collection_support", "issued_document"]),
        entity_id: uuid,
      })
      .strict()
      .parse(req.query);
    res.json(
      await getActor(req).db.list("attachments", { page: 1, limit: 100 }, q),
    );
  });
  return router;
}
