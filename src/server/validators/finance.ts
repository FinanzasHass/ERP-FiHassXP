import { z } from "zod";
import { uuid } from "./index.js";
const text = z.string().trim().min(1).max(2000),
  optionalText = z.string().trim().max(2000).nullable().optional();
const money = z
  .number()
  .finite()
  .min(0)
  .max(1e12)
  .refine(
    (v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.001,
    "Maximum two decimals",
  );
const reference = uuid.nullable().optional();
const dimensions = {
  cost_center_id: uuid,
  project_id: reference,
  subproject_id: reference,
};
const source = { request_id: uuid, supplier_id: uuid, order_id: reference };
const items = z
  .array(
    z
      .object({
        description: text,
        quantity: z.number().positive().max(1e9).multipleOf(0.0001),
        unit_price: z.number().min(0).max(1e12).multipleOf(0.0001),
      })
      .strict(),
  )
  .min(1)
  .max(100);
export const bankProposal = z
  .object({
    bank_name: text,
    currency_id: uuid,
    account_number: z.string().regex(/^[0-9A-Za-z-]{6,40}$/),
    cci: z
      .string()
      .regex(/^\d{20}$/)
      .nullable()
      .optional(),
    account_type: z.enum(["checking", "savings", "other"]),
    is_primary: z.boolean().optional(),
  })
  .strict();
export const financeSchemas = {
  request: z
    .object({
      ...dimensions,
      request_type: z.enum(["purchase", "service", "direct_payment", "other"]),
      currency_id: uuid,
      description: text,
      justification: z.string().trim().min(1).max(4000),
      required_date: z.iso.date(),
      priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
      supplier_id: reference,
      payment_modality: z.enum([
        "advance",
        "cash",
        "credit",
        "against_invoice",
        "against_delivery",
        "custom",
      ]),
      items,
    })
    .strict(),
  supplier: z
    .object({
      country_code: z
        .string()
        .regex(/^[A-Z]{2}$/)
        .optional(),
      tax_id_type: z.enum(["ruc", "dni", "foreign", "other"]),
      tax_id: z.string().trim().min(1).max(32),
      legal_name: z.string().trim().min(1).max(200),
      trade_name: optionalText,
      address: optionalText,
      phone: optionalText,
      email: z.email().nullable().optional(),
      reuse_identity: z.boolean().optional(),
    })
    .strict(),
  supplier_contact: z
    .object({
      supplier_id: uuid,
      name: text,
      phone: optionalText,
      email: z.email().nullable().optional(),
    })
    .strict(),
  bank_change: z
    .object({
      supplier_id: uuid,
      account_id: reference,
      proposed: bankProposal,
      reason: text,
    })
    .strict(),
  payment_term: z
    .object({
      code: z.string().regex(/^[A-Za-z0-9_.-]{1,50}$/),
      name: text,
      days: z.number().int().min(0).max(3650).optional(),
      due_date_basis: z.enum([
        "invoice_date",
        "document_received_date",
        "service_acceptance_date",
        "explicit_date",
        "other_future",
      ]),
      end_of_month: z.boolean().optional(),
      active: z.boolean().optional(),
    })
    .strict(),
  approval_policy: z
    .object({
      name: text,
      request_type: z.enum(["purchase", "service", "direct_payment", "other"]),
      approver_role_id: uuid,
      prevent_self_approval: z.boolean().optional(),
      active: z.boolean().optional(),
    })
    .strict(),
  purchase_order: z
    .object({
      request_id: uuid,
      supplier_id: uuid,
      order_type: z.enum(["purchase", "service"]),
      description: text,
      requires_acceptance: z.boolean().optional(),
      items,
    })
    .strict(),
  service_acceptance: z
    .object({ ...source, observations: optionalText })
    .strict(),
  tax_document: z
    .object({
      ...source,
      document_type: z.enum([
        "invoice",
        "receipt",
        "fee_receipt",
        "credit_note",
        "debit_note",
        "other",
      ]),
      series: z.string().regex(/^[A-Z0-9-]{1,20}$/),
      number: z.string().regex(/^\d{1,20}$/),
      issue_date: z.iso.date(),
      received_date: z.iso.date(),
      due_date: z.iso.date().nullable().optional(),
      currency_id: uuid,
      subtotal: money,
      tax_amount: money,
      non_taxable_amount: money.optional(),
      amounts: z
        .array(
          z
            .object({
              code: z.string().min(1).max(50),
              name: text,
              amount: money,
            })
            .strict(),
        )
        .max(20)
        .optional(),
    })
    .strict(),
  payable: z
    .object({
      ...source,
      tax_document_id: reference,
      payment_term_id: uuid,
      issue_date: z.iso.date(),
      explicit_due_date: z.iso.date().optional(),
      acceptance_id: reference,
    })
    .strict(),
};
export const transitionSchema = z
  .object({
    action: z.enum([
      "submit",
      "reopen",
      "start_review",
      "approve",
      "observe",
      "reject",
      "cancel",
      "send",
      "start",
      "partial_receive",
      "receive",
      "close",
      "accept",
      "review",
      "hold",
      "disable",
      "enable",
    ]),
    comment: text,
  })
  .strict();
export const uploadSchema = z
  .object({
    company_id: uuid,
    entity_type: z.enum([
      "request",
      "purchase_order",
      "service_acceptance",
      "tax_document",
      "payable",
      "supplier_bank_change",
      "payment",
      "expense_receipt", "tax_support", "declaration_support", "employee_payment_evidence",
      "employee_return_evidence", "employee_reimbursement_support", "expense_representation","collection_support","issued_document",
    ]),
    entity_id: uuid,
    filename: z
      .string()
      .min(1)
      .max(180)
      .regex(/^[^\\/\x00-\x1f]+$/),
    mime_type: z.enum([
      "application/pdf",
      "application/xml",
      "image/png",
      "image/jpeg",
    ]),
    base64: z
      .string()
      .min(4)
      .max(6990510)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();
