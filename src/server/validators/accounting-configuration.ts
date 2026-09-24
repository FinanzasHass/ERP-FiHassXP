import { z } from "zod";
import { entryType, rule } from "./accounting.js";
const text = (max: number) => z.string().trim().min(1).max(max);
export const afe = z
  .object({
    code: text(60),
    name: text(200),
    active: z.boolean().optional(),
    valid_from: z.iso.date(),
    valid_to: z.iso.date().nullable().optional(),
  })
  .strict();
export const legacy = z
  .object({
    dictionary: z.enum([
      "SUBDIARIO",
      "MONEDA",
      "MODULO",
      "TIPODOCUM",
      "ELEMENTO",
      "REPARABLE",
    ]),
    legacy_code: text(100),
    description: text(2000).nullable().optional(),
    erp_mapping: z.record(z.string(), z.unknown()).optional(),
    valid_from: z.iso.date(),
    valid_to: z.iso.date().nullable().optional(),
    notes: text(2000).nullable().optional(),
  })
  .strict();
const project = z
  .object({
    code: text(50),
    name: text(200),
    description: text(2000).nullable().optional(),
    status: z.enum(["active", "inactive"]).optional(),
  })
  .strict();
export const configurableImports = {
  afe,
  legacy_mapping: legacy,
  project,
  subproject: project.extend({ project_code: text(50) }),
  entry_type: entryType,
  rule,
};
