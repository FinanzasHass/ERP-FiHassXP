import test from "node:test";
import assert from "node:assert/strict";
import { settlementPresentation } from "../src/client/settlement-presentation.js";
test("printed settlement separates original difference, reconciled return and current remainder", () => {
  const result = Object.fromEntries(
    settlementPresentation({
      advance_paid: 180,
      accepted_expenses: 160,
      return_due: 20,
      return_outstanding: 0,
      reimbursement_due: 0,
      reimbursement_outstanding: 0,
    }),
  );
  assert.equal(result["Devolución determinada"], "20.00");
  assert.equal(result["Devolución recibida y conciliada"], "20.00");
  assert.equal(result["Pendiente por devolver"], "0.00");
  assert.equal(
    Object.fromEntries(
      settlementPresentation({
        advance_paid: "0.30",
        accepted_expenses: "0.20",
        return_due: "0.10",
        return_outstanding: "0.03",
        reimbursement_due: 0,
        reimbursement_outstanding: 0,
      }),
    )["Devolución recibida y conciliada"],
    "0.07",
  );
});
