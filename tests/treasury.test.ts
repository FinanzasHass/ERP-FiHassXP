import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  encryptVersionedAttachment,
  decryptVersionedAttachment,
  attachmentKey,
  encryptAttachment,
} from "../src/server/services/attachment-crypto.js";
import {
  treasurySchemas,
  treasuryAction,
  bankImport,
} from "../src/server/validators/treasury.js";
import { bankFileRows, mapBankRows } from "../src/client/bank-import-parser.js";
import { readConfig } from "../src/server/config/env.js";
test("versioned keys retain legacy V1 and bind V2 metadata without exposing keys", () => {
  const one = randomBytes(32).toString("hex"),
    two = randomBytes(32).toString("hex"),
    cfg = {
      ATTACHMENT_ENCRYPTION_KEY: one,
      ATTACHMENT_ENCRYPTION_KEYS: { V2: two },
      ATTACHMENT_ENCRYPTION_ACTIVE_VERSION: "V2",
    },
    bytes = Buffer.from("synthetic");
  const old = encryptAttachment(one, bytes, "company", "id");
  assert.deepEqual(
    decryptVersionedAttachment(cfg, old, "company", "id", "V1"),
    bytes,
  );
  const current = encryptVersionedAttachment(cfg, bytes, "company", "id", "V2");
  assert.deepEqual(
    decryptVersionedAttachment(cfg, current, "company", "id", "V2"),
    bytes,
  );
  assert.throws(() =>
    decryptVersionedAttachment(cfg, current, "company", "id", "V1"),
  );
  assert.throws(() => attachmentKey(cfg, "V3"));
  assert.throws(() =>
    readConfig({
      ATTACHMENT_ENCRYPTION_KEY: one,
      ATTACHMENT_ENCRYPTION_KEY_V1: two,
    }),
  );
});
test("treasury input rejects forged execution state, scope, actor, balance and invalid import amount", () => {
  assert.equal(
    treasurySchemas.payment!.safeParse({
      status: "executed",
      company_id: randomBytes(16).toString("hex"),
      executed_by: "user",
    }).success,
    false,
  );
  assert.equal(treasuryAction.safeParse({ action: "paid" }).success, false);
  assert.equal(bankImport.safeParse({ rows: [{ amount: -5 }] }).success, false);
});
test("bank CSV adapter maps explicit columns, preserves zero prefixes and rejects grouped money", async () => {
  const csv =
    "fecha;tipo;importe;moneda;operacion;texto\n2026-09-11;debit;60.00;PEN;000123;Sintético";
  const rows = await bankFileRows(
    "extract.csv",
    new TextEncoder().encode(csv).buffer,
  );
  const mapping = {
    transaction_date: "fecha",
    transaction_type: "tipo",
    amount: "importe",
    currency_code: "moneda",
    bank_reference: "operacion",
    description: "texto",
  };
  const result = mapBankRows(rows, mapping);
  assert.equal(result[0]!.bank_reference, "000123");
  assert.equal(result[0]!.amount, 60);
  rows[1]![2] = "1,000.00";
  assert.throws(() => mapBankRows(rows, mapping));
  await assert.rejects(() => bankFileRows("extract.exe", new ArrayBuffer(10)));
});
test("bank XLSX parser accepts configured sheet and rejects formula cells", async () => {
  const { default: ExcelJS } = await import("exceljs");
  const w = new ExcelJS.Workbook(),
    s = w.addWorksheet("Extracto");
  s.addRow(["fecha", "importe"]);
  s.addRow(["2026-09-11", 60]);
  const bytes = await w.xlsx.writeBuffer();
  assert.equal(
    (
      await bankFileRows("extract.xlsx", bytes as unknown as ArrayBuffer)
    )[1]![1],
    "60",
  );
  s.getCell("B2").value = { formula: "1+1", result: 2 };
  await assert.rejects(
    () =>
      w.xlsx
        .writeBuffer()
        .then((b) => bankFileRows("extract.xlsx", b as unknown as ArrayBuffer)),
    /fórmulas/,
  );
});
