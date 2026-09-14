import { z } from "zod";
import { uuid } from "./index.js";
const text = (max = 200) => z.string().trim().min(1).max(max);
const nullableId = uuid.nullable().optional();
const money = z.number().nonnegative().max(999999999999.99).multipleOf(0.01);
const date = z.iso.date();
export const account = z
  .object({
    code: text(40),
    name: text(),
    parent_id: nullableId,
    account_type: z.enum([
      "asset",
      "liability",
      "equity",
      "income",
      "expense",
      "memorandum",
    ]),
    normal_balance: z.enum(["debit", "credit"]),
    allows_posting: z.boolean(),
    requires_cost_center: z.boolean().optional(),
    requires_project: z.boolean().optional(),
    requires_third_party: z.boolean().optional(),
    active: z.boolean().optional(),
    valid_from: date,
    valid_to: date.nullable().optional(),
    pcge_reference_code: text(40).nullable().optional(),
  })
  .strict();
export const settings = z
  .object({
    functional_currency_id: uuid,
    number_prefix: z.string().regex(/^[A-Z][A-Z0-9]{1,11}$/),
    number_digits: z.number().int().min(4).max(12),
  })
  .strict();
export const period = z
  .object({
    year: z.number().int().min(1900).max(9999),
    month: z.number().int().min(1).max(12),
    start_date: date,
    end_date: date,
  })
  .strict();
export const entryType = z
  .object({
    code: z.string().regex(/^[a-z][a-z0-9_]{1,49}$/),
    name: text(),
    active: z.boolean().optional(),
  })
  .strict();
const dimension = z
  .object({
    dimension_type: z.enum(["cost_center", "project", "subproject", "area"]),
    dimension_id: uuid,
  })
  .strict();
const thirdParty = z.enum(["supplier", "customer", "employee"]);
export const journalLine = z
  .object({
    account_id: uuid,
    description: text(2000),
    debit: money,
    credit: money,
    foreign_amount: money.optional(),
    third_party_type: thirdParty.nullable().optional(),
    third_party_id: nullableId,
    dimensions: z.array(dimension).max(4).optional(),
  })
  .strict()
  .refine((x) => x.debit > 0 !== x.credit > 0, {
    message: "Cada línea requiere exclusivamente debe o haber",
  });
export const journal = z
  .object({
    entry_date: date,
    accounting_period_id: uuid,
    entry_type_id: uuid,
    description: text(2000),
    currency_id: uuid,
    exchange_rate_id: nullableId,
    source_type: z
      .enum([
        "manual",
        "opening",
        "payable",
        "payment",
        "collection",
        "receivable",
        "expense_report",
        "employee_return",
        "employee_reimbursement",
        "bank_adjustment",
      ])
      .optional(),
    source_id: nullableId,
    lines: z.array(journalLine).min(2).max(1000),
  })
  .strict();
export const reason = z.object({ reason: text(2000) }).strict();
export const reversal = reason.extend({
  entry_date: date,
  accounting_period_id: uuid,
  entry_type_id: uuid,
});
const rate = z.number().positive().max(999999999999.9999);
export const exchangeRate = z
  .object({
    date,
    currency_from: uuid,
    currency_to: uuid,
    buy_rate: rate,
    sell_rate: rate,
    accounting_rate: rate,
    source: text(500),
  })
  .strict();
const dimensionType = z.enum(["cost_center", "project", "subproject", "area"]);
export const rule = z
  .object({
    code: text(60),
    name: text(),
    source_event: text(80),
    conditions: z
      .object({
        currency_id: uuid.optional(),
        minimum_amount: money.optional(),
        maximum_amount: money.optional(),
        third_party_type: thirdParty.optional(),
      })
      .strict()
      .optional(),
    priority: z.number().int().optional(),
    valid_from: date,
    valid_to: date.nullable().optional(),
    lines: z
      .array(
        z
          .object({
            account_id: uuid,
            side: z.enum(["debit", "credit"]),
            description: text(2000),
            amount_key: z.enum(["amount", "net_amount", "tax_amount"]),
            multiplier: rate.optional(),
            use_third_party: z.boolean().optional(),
            dimension_types: z.array(dimensionType).max(4).optional(),
          })
          .strict(),
      )
      .min(2)
      .max(1000),
  })
  .strict();
export const preview = z
  .object({
    source_event: text(80),
    entry_date: date,
    currency_id: uuid,
    exchange_rate_id: nullableId,
    amounts: z
      .object({
        amount: money.optional(),
        net_amount: money.optional(),
        tax_amount: money.optional(),
      })
      .strict(),
    third_party_type: thirdParty.optional(),
    third_party_id: uuid.optional(),
    dimensions: z
      .object({
        cost_center: uuid.optional(),
        project: uuid.optional(),
        subproject: uuid.optional(),
        area: uuid.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const report = z
  .object({
    accounting_period_id: uuid.optional(),
    date_from: date.optional(),
    date_to: date.optional(),
    account_id: uuid.optional(),
    account_from: text(40).optional(),
    account_to: text(40).optional(),
    third_party_type: thirdParty.optional(),
    third_party_id: uuid.optional(),
    cost_center_id: uuid.optional(),
    project_id: uuid.optional(),
    currency_id: uuid.optional(),
    rollup: z.boolean().optional(),
    page: z.number().int().min(1).optional(),
    limit: z.number().int().min(1).max(1000).optional(),
  })
  .strict();
