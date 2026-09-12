import { z } from "zod";
import { uuid } from "./index.js";
const text = z.string().trim().min(1).max(200),
  money = z.number().positive().max(999999999999).multipleOf(0.01),
  date = z.iso.date();
export const treasurySchemas: Record<string, z.ZodObject<any>> = {
  bank: z
    .object({
      code: text,
      name: text,
      country_code: z
        .string()
        .regex(/^[A-Z]{2}$/)
        .optional(),
      active: z.boolean().optional(),
    })
    .strict(),
  bank_account: z
    .object({
      bank_id: uuid,
      currency_id: uuid,
      account_number: z.string().regex(/^[0-9A-Za-z-]{6,40}$/),
      cci: z
        .string()
        .regex(/^[0-9]{20}$/)
        .nullable()
        .optional(),
      account_type: text,
      display_name: text,
      opening_balance: z.number().nullable().optional(),
      opening_date: date.nullable().optional(),
      valid_from: date.optional(),
      valid_to: date.nullable().optional(),
      active: z.boolean().optional(),
    })
    .strict(),
  payment_method: z
    .object({
      code: text,
      name: text,
      requires_beneficiary_account: z.boolean(),
      active: z.boolean().optional(),
    })
    .strict(),
  payment_order: z
    .object({
      beneficiary_type: z.enum(["supplier", "employee"]).optional(),
      beneficiary_id: uuid,
      currency_id: uuid,
      bank_account_id: uuid.nullable().optional(),
      beneficiary_account_id: uuid.nullable().optional(),
      payment_method_id: uuid,
      requested_payment_date: date,
      description: text,
      items: z
        .array(z.object({ payable_id: uuid, amount_to_pay: money }).strict())
        .min(1)
        .max(100),
    })
    .strict(),
  payment: z
    .object({
      payment_order_id: uuid,
      payment_date: date,
      operation_number: text.max(100),
      reference: text.optional(),
      allocations: z
        .array(z.object({ payable_id: uuid, allocated_amount: money }).strict())
        .min(1)
        .max(100),
    })
    .strict(),
  payment_batch: z
    .object({
      currency_id: uuid,
      description: text,
      individual_approval_required: z.boolean().default(true),
      order_ids: z.array(uuid).min(1).max(100),
    })
    .strict(),
  reconciliation_period: z
    .object({ bank_account_id: uuid, start_date: date, end_date: date })
    .strict(),
  bank_transaction: z
    .object({
      bank_account_id: uuid,
      transaction_date: date,
      value_date: date.optional(),
      transaction_type: z.enum(["debit", "credit"]),
      amount: money,
      bank_reference: text,
      description: text,
      counterparty: text.optional(),
      external_id: text.optional(),
    })
    .strict(),
};
export const treasuryAction = z
  .object({
    action: z.enum([
      "submit",
      "review",
      "approve",
      "observe",
      "reject",
      "cancel",
      "schedule",
      "execute",
      "reverse",
      "reopen",
      "reconcile",
      "close",
      "unmatch",
      "exclude",
    ]),
    payload: z
      .object({
        reason: z.string().trim().min(1).max(2000).optional(),
        bank_account_id: uuid.optional(),
        scheduled_payment_date: date.optional(),
      })
      .strict()
      .default({}),
  })
  .strict();
export const bankRow = z
  .object({
    transaction_date: date,
    value_date: date.optional(),
    transaction_type: z.enum(["debit", "credit"]),
    amount: money,
    currency_code: z.string().regex(/^[A-Z]{3}$/),
    bank_reference: text,
    description: text,
    counterparty: text.optional(),
    external_id: text.optional(),
  })
  .strict();
export const bankImport = z
  .object({
    account_id: uuid,
    source_filename: text.max(180),
    column_mapping: z.record(text, text),
    rows: z.array(bankRow).min(1).max(2000),
    confirm: z.boolean().default(false),
  })
  .strict();
