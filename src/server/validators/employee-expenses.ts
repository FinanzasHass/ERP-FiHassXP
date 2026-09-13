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
    allow_reopen: z.boolean().optional(),
    allow_cancel_unpaid_travel: z.boolean().optional(),
    allow_payment_evidence: z.boolean().optional(),
    allow_other_support: z.boolean().optional(),
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

export const expenseReportInput = z
  .object({
    employee_id: uuid,
    currency_id: uuid,
    travel_expense_request_id: uuid.nullable().optional(),
    employee_advance_id: uuid.nullable().optional(),
  })
  .strict();
export const expenseItemInput = z
  .object({
    expense_date: z.iso.date(),
    category_id: uuid,
    description: text(2000),
    reported_amount: amount.positive(),
    support_type: z.enum([
      "tax_document",
      "declaration",
      "payment_evidence",
      "other_authorized",
    ]),
    ...dimensions,
  })
  .strict();
export const expenseActionInput = z
  .object({
    action: z.enum([
      "submit",
      "approve",
      "observe",
      "reject",
      "close",
      "reopen",
    ]),
    reason: text(2000).optional(),
  })
  .strict();
export const expenseReviewInput = z
  .object({
    decision: z.enum(["accepted", "observed", "rejected"]),
    accepted_amount: amount,
    reason: text(2000),
  })
  .strict();
export const expenseTaxInput = z.union([
  z.object({ existing_id: uuid }).strict(),
  z
    .object({
      supplier_id: uuid,
      document_type: z.enum([
        "invoice",
        "receipt",
        "fee_receipt",
        "credit_note",
        "debit_note",
        "other",
      ]),
      series: z.string().regex(/^[A-Za-z0-9-]{1,20}$/),
      number: z.string().regex(/^[0-9]{1,20}$/),
      issue_date: z.iso.date(),
      received_date: z.iso.date(),
      subtotal: amount,
      tax_amount: amount,
      non_taxable_amount: amount,
    })
    .strict(),
]);
export const employeeReturnInput = z
  .object({
    amount: amount.positive(),
    return_date: z.iso.date(),
    payment_method_id: uuid,
    reference: text(200),
    idempotency_key: uuid,
  })
  .strict();
