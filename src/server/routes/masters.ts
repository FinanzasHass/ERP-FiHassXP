import { Router } from "express";
import { z } from "zod";
import { getActor, requirePermission } from "../middleware/auth.js";
import { uuid, pageQuery } from "../validators/index.js";
const text = z.string().trim().min(1).max(150);
const base = {
  code: z.string().regex(/^[A-Za-z0-9_.-]{1,50}$/),
  name: text,
  description: z.string().max(2000).nullable().optional(),
};
const status = z.enum(["active", "inactive", "completed", "cancelled"]);
export const masterSchemas = {
  cost_center: z
    .object({
      ...base,
      category_id: uuid.nullable().optional(),
      parent_id: uuid.nullable().optional(),
      active: z.boolean().optional(),
      valid_from: z.iso.date().optional(),
      valid_to: z.iso.date().nullable().optional(),
    })
    .strict(),
  cost_center_category: z
    .object({ ...base, active: z.boolean().optional() })
    .strict(),
  project: z
    .object({
      ...base,
      status: status.optional(),
      start_date: z.iso.date().nullable().optional(),
      end_date: z.iso.date().nullable().optional(),
    })
    .strict(),
  subproject: z
    .object({ ...base, project_id: uuid, status: status.optional() })
    .strict(),
  currency: z
    .object({
      code: z.string().regex(/^[A-Z]{3}$/),
      name: text,
      symbol: z.string().min(1).max(10),
      decimal_places: z.number().int().min(0).max(6),
      active: z.boolean().optional(),
    })
    .strict(),
};
export const importSchema = z
  .object({
    company_id: uuid,
    commit: z.boolean(),
    update_existing: z.boolean().default(false),
    rows: z
      .array(
        z
          .object({
            company_code: z.string().min(1).max(50),
            code: base.code,
            name: text,
            parent_code: z.string().max(50).optional(),
            category: z.string().max(50).optional(),
            description: z.string().max(2000).optional(),
            active: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();
export function mastersRouter() {
  const router = Router();
  router.post("/cost-centers/import", async (req, res) => {
    const b = importSchema.parse(req.body);
    res.json(
      await getActor(req).db.rpc("import_cost_centers", {
        target_company: b.company_id,
        rows: b.rows,
        commit_batch: b.commit,
        update_existing: b.update_existing,
      }),
    );
  });
  for (const [path, kind, table] of [
    ["cost-centers", "cost_center", "cost_centers"],
    [
      "cost-center-categories",
      "cost_center_category",
      "cost_center_categories",
    ],
    ["projects", "project", "projects"],
    ["subprojects", "subproject", "subprojects"],
    ["currencies", "currency", "currencies"],
  ] as const) {
    const permission = kind === "cost_center_category" ? "cost_center" : kind;
    router.get(
      "/" + path,
      requirePermission(permission + ".view", (req) =>
        kind === "currency" ? null : uuid.parse(req.query.company_id),
      ),
      async (req, res) => {
        const q = pageQuery.parse(req.query);
        res.json(
          await getActor(req).db.list(
            table,
            q,
            kind === "currency" ? {} : { company_id: q.company_id! },
          ),
        );
      },
    );
    for (const method of ["post", "patch"] as const)
      router[method](
        "/" + path + (method === "patch" ? "/:id" : ""),
        async (req, res) => {
          const company =
            kind === "currency" ? null : uuid.parse(req.query.company_id);
          const payload = (
            method === "patch"
              ? masterSchemas[kind].partial()
              : masterSchemas[kind]
          ).parse(req.body);
          res
            .status(method === "post" ? 201 : 200)
            .json(
              await getActor(req).db.rpc("master_save", {
                kind,
                target_id:
                  method === "patch" ? uuid.parse(req.params.id) : null,
                target_company: company,
                payload,
              }),
            );
        },
      );
  }
  return router;
}
