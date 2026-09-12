import { z } from "zod";
import { uuid } from "./index.js";
const text = (max: number) => z.string().trim().min(1).max(max);
const amount = z.number().min(0).max(999999999999.99).multipleOf(0.01);
const dimensions = {
  cost_center_id: uuid,
  project_id: uuid.nullable().optional(),
  subproject_id: uuid.nullable().optional(),
};
export const employeeInput = z
  .object({
    profile_id: uuid.nullable().optional(),
    full_name: text(200),
    document_type: text(30),
    document_number: text(30),
    area_id: uuid,
    position_id: uuid.nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict();
export const expenseCategoryInput = z
  .object({
    code: z.string().regex(/^[a-z][a-z0-9_]{1,49}$/),
    name: text(150),
    active: z.boolean().optional(),
  })
  .strict();
export const expensePolicyInput = z
  .object({
    currency_id: uuid,
    allow_declarations: z.boolean().optional(),
    declaration_max_amount: amount.positive().nullable().optional(),
    declaration_requires_approval: z.boolean().optional(),
    allow_partial_acceptance: z.boolean().optional(),
    require_distinct_reviewer: z.boolean().optional(),
    render_due_days: z.number().int().min(0).max(3650).nullable().optional(),
    category_ids: z.array(uuid).max(100).optional(),
  })
  .strict()
  .refine(
    (p) => !p.allow_declarations || !!p.category_ids?.length,
    "Las declaraciones requieren categorías autorizadas",
  );
export const travelInput = z
  .object({
    employee_id: uuid,
    ...dimensions,
    destination: text(200),
    purpose: text(2000),
    start_date: z.iso.date(),
    end_date: z.iso.date(),
    currency_id: uuid,
    requested_advance_amount: amount,
    items: z
      .array(
        z
          .object({
            category_id: uuid,
            description: text(1000),
            estimated_amount: amount.positive(),
            ...dimensions,
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine((p) => p.end_date >= p.start_date, "La fecha final precede al inicio")
  .refine(
    (p) =>
      p.requested_advance_amount <=
      p.items.reduce(
        (sum, item) => sum + Math.round(item.estimated_amount * 100),
        0,
      ) /
        100,
    "El anticipo supera el presupuesto estimado",
  );
export const travelAction = z
  .object({
    action: z.enum(["submit", "approve", "observe", "reject", "cancel"]),
    comment: text(2000).optional(),
  })
  .strict()
  .refine(
    (p) => !["observe", "reject", "cancel"].includes(p.action) || !!p.comment,
    "La transición requiere un motivo",
  );
