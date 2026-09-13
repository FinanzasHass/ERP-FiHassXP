import { z } from "zod";
import { uuid } from "./index.js";
const text = (max = 200) => z.string().trim().min(1).max(max),
  money = z.number().positive().max(999999999999.99).multipleOf(0.01),
  zeroMoney = z.number().nonnegative().max(999999999999.99).multipleOf(0.01);
export const customerInput = z
  .object({
    customer_type: z.enum(["natural", "legal"]),
    document_type: text(30),
    document_number: text(40),
    legal_name: text(),
    trade_name: text().nullable().optional(),
    email: z.email().nullable().optional(),
    phone: text(50).nullable().optional(),
    address: text(500).nullable().optional(),
  })
  .strict();
const sourceBase = {
  customer_id: uuid,
  reference: text(),
  description: text(2000),
  currency_id: uuid,
};
export const sourceInput = z.discriminatedUnion("source_type", [
  z
    .object({
      ...sourceBase,
      source_type: z.literal("membership"),
      plan_name: text(),
      start_date: z.iso.date(),
      end_date: z.iso.date().nullable().optional(),
      periodic_amount: money,
      period_months: z.number().int().min(1).max(120),
    })
    .strict(),
  z
    .object({
      ...sourceBase,
      source_type: z.literal("lot_sale"),
      lot_identifier: text(),
      agreed_price: money,
      down_payment: zeroMoney,
    })
    .strict(),
  z
    .object({
      ...sourceBase,
      source_type: z.enum(["manual_authorized", "other"]),
    })
    .strict(),
]);
export const receivableInput = z
  .object({
    customer_id: uuid,
    source_type: z.enum(["manual_authorized", "other"]),
    source_id: uuid.nullable().optional(),
    currency_id: uuid,
    issue_date: z.iso.date(),
    due_date: z.iso.date(),
    original_amount: money,
    description: text(2000),
    document_id: uuid.nullable().optional(),
  })
  .strict();
export const scheduleInput = z
  .object({
    period_reference: text(),
    issue_date: z.iso.date(),
    installments: z
      .array(z.object({ due_date: z.iso.date(), amount: money }).strict())
      .min(1)
      .max(360),
    replace_schedule_id: uuid.optional(),
    reason: text(2000).optional(),
  })
  .strict();
export const collectionInput = z.union([
  z.object({ bank_transaction_id: uuid }).strict(),
  z
    .object({
      currency_id: uuid,
      collection_date: z.iso.date(),
      amount: money,
      payment_method_id: uuid,
      reference: text(),
    })
    .strict(),
]);
export const allocationInput = z
  .object({
    allocations: z
      .array(z.object({ receivable_id: uuid, amount: money }).strict())
      .min(1)
      .max(100),
  })
  .strict();
export const reasonInput = z.object({ reason: text(2000) }).strict();
export const identifyInput = reasonInput.extend({ customer_id: uuid });
export const receivableChangeInput = z
  .object({
    action: z.enum(["adjust", "cancel"]),
    payload: z
      .object({
        due_date: z.iso.date().optional(),
        original_amount: money.optional(),
        description: text(2000).optional(),
      })
      .strict(),
    reason: text(2000),
  })
  .strict();
export const collectionMatchInput = z
  .object({ period_id: uuid, transaction_id: uuid, amount: money })
  .strict();
export const issuedDocumentInput = z
  .object({
    customer_id: uuid,
    document_type: text(40),
    series: text(20),
    number: text(30),
    issue_date: z.iso.date(),
    description: text(2000).optional(),
  })
  .strict();
