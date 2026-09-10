import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, recordsFromRows } from "../src/client/import-parser.js";
test("CSV parses quotes, separators, multiline fields and explicit states", () => {
  const rows = parseCsv(
    'company_code;code;name;description;active\r\nA;CC;"Nombre; largo";"Línea 1\nLínea 2";false',
  );
  const [record] = recordsFromRows(rows);
  assert.equal(record!.name, "Nombre; largo");
  assert.equal(record!.active, false);
  assert.match(String(record!.description), /\n/);
});
test("import rejects malformed header, invalid state, formula-like extra columns and oversize batch", () => {
  assert.throws(() => parseCsv('a,"unterminated'));
  assert.throws(() =>
    recordsFromRows([
      ["company_code", "code", "code"],
      ["A", "CC", "X"],
    ]),
  );
  assert.throws(() =>
    recordsFromRows([
      ["company_code", "code", "name", "active"],
      ["A", "CC", "Name", "maybe"],
    ]),
  );
  assert.throws(() =>
    recordsFromRows([
      ["company_code", "code", "name"],
      ...Array.from({ length: 201 }, () => ["A", "CC", "Name"]),
    ]),
  );
});
