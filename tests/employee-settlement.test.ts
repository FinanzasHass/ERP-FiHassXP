import test from "node:test";
import assert from "node:assert/strict";
import {
  employeeSettlement,
  minorUnits,
  acceptedItemAmount,
} from "../src/server/services/employee-settlement.js";

const money = (amount: string) => ({ currencyId: "synthetic-PEN", amount });
const settle = (
  advance: string,
  accepted: string,
  returned = "0",
  reimbursed = "0",
) =>
  employeeSettlement({
    advancePaid: money(advance),
    acceptedExpenses: money(accepted),
    confirmedReturns: money(returned),
    reimbursementPaid: money(reimbursed),
    pendingItems: 0,
    documentaryComplete: true,
  });

test("180 delivered / 160 accepted preserves advance and requires 20 return", () => {
  const result = settle("180", "160");
  assert.equal(result.advancePaid, "180.00");
  assert.equal(result.returnOutstanding, "20.00");
  assert.equal(result.reimbursementDue, "0.00");
  assert.equal(result.canClose, false);
  assert.equal(settle("180", "160", "20").canClose, true);
});
test("180 / 220 requires reimbursement; no-advance and exact cases", () => {
  assert.equal(settle("180", "220").reimbursementOutstanding, "40.00");
  assert.equal(settle("180", "220", "0", "40").canClose, true);
  assert.equal(settle("0", "220").reimbursementOutstanding, "220.00");
  assert.equal(settle("180", "180").canClose, true);
});
test("cent arithmetic is exact and malformed or lossy amounts are rejected", () => {
  assert.equal(settle("0.30", "0.20").returnDue, "0.10");
  for (const amount of [
    "NaN",
    "Infinity",
    "-1",
    "1e3",
    "1.001",
    "",
    " 1",
    "01",
    "1000000000000",
  ])
    assert.throws(() => minorUnits(amount), /INVALID_MONEY/);
  assert.equal(minorUnits("999999999999.99"), 99999999999999n);
});
test("cannot oversettle or net a return against reimbursement", () => {
  assert.throws(() => settle("180", "160", "20.01"), /EXCEEDS/);
  assert.throws(() => settle("180", "160", "0", "1"), /EXCEEDS/);
  assert.throws(() => settle("180", "220", "1"), /EXCEEDS/);
  assert.throws(() => settle("180", "220", "0", "40.01"), /EXCEEDS/);
});
test("mixed currencies, pending review and incomplete support prevent close", () => {
  const input = {
    advancePaid: money("180"),
    acceptedExpenses: money("180"),
    confirmedReturns: money("0"),
    reimbursementPaid: money("0"),
    pendingItems: 1,
    documentaryComplete: true,
  };
  assert.equal(employeeSettlement(input).canClose, false);
  assert.equal(
    employeeSettlement({
      ...input,
      pendingItems: 0,
      documentaryComplete: false,
    }).canClose,
    false,
  );
  assert.throws(
    () =>
      employeeSettlement({
        ...input,
        acceptedExpenses: { currencyId: "USD", amount: "180" },
      }),
    /CURRENCY/,
  );
  assert.throws(
    () => employeeSettlement({ ...input, pendingItems: -1 }),
    /PENDING/,
  );
});
test("partial acceptance requires policy and reason; observed is not rejected expense", () => {
  const item = {
    reported: "100",
    accepted: "80",
    status: "accepted" as const,
    allowPartialAcceptance: false,
    reason: "Synthetic review",
  };
  assert.throws(() => acceptedItemAmount(item), /DISABLED/);
  assert.deepEqual(
    acceptedItemAmount({ ...item, allowPartialAcceptance: true }),
    { reported: "100.00", accepted: "80.00", rejected: "20.00" },
  );
  assert.throws(
    () =>
      acceptedItemAmount({
        ...item,
        allowPartialAcceptance: true,
        reason: " ",
      }),
    /REASON/,
  );
  assert.throws(
    () => acceptedItemAmount({ ...item, status: "rejected" }),
    /UNACCEPTED/,
  );
  assert.equal(
    acceptedItemAmount({ ...item, status: "observed", accepted: "0" }).rejected,
    "0.00",
  );
  assert.equal(
    acceptedItemAmount({ ...item, status: "rejected", accepted: "0" }).rejected,
    "100.00",
  );
});
