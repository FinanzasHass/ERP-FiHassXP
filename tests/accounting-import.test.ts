import { test } from "node:test";
import assert from "node:assert/strict";
import { accountingImportRows } from "../src/client/accounting-import-parser.js";
import { parseCsv } from "../src/client/import-parser.js";
test("account import preserves explicit code, hierarchy and booleans without deriving a chart", () => {
  const data = accountingImportRows(
    parseCsv(
      'code,name,parent_code,account_type,normal_balance,allows_posting,valid_from\n001,"Sintética, detalle",ROOT,asset,debit,true,2026-01-01',
    ),
  );
  assert.equal(data[0]?.code, "001");
  assert.equal(data[0]?.parent_code, "ROOT");
  assert.equal(data[0]?.allows_posting, true);
});
test("account import rejects extra identity scope, duplicate headers and ambiguous booleans", () => {
  const header = [
    "code",
    "name",
    "account_type",
    "normal_balance",
    "allows_posting",
    "valid_from",
  ];
  assert.throws(() =>
    accountingImportRows([
      [...header, "company_id"],
      ["A", "B", "asset", "debit", "true", "2026-01-01", "x"],
    ]),
  );
  assert.throws(() =>
    accountingImportRows([
      header,
      ["A", "B", "asset", "debit", "yes", "2026-01-01"],
    ]),
  );
  assert.throws(() =>
    accountingImportRows([
      [...header, "code"],
      ["A", "B", "asset", "debit", "true", "2026-01-01", "C"],
    ]),
  );
});
