import { employeeSettlement, minorUnits } from "./employee-settlement.js";

/** Check the server arithmetic contract against the authoritative transactional RPC. */
export function validateSettlementContract(row: Record<string, unknown>) {
  const money = (key: string) => String(row[key]);
  const difference = (left: string, right: string) => {
    const cents = minorUnits(money(left)) - minorUnits(money(right));
    if (cents < 0n) throw new Error("SETTLEMENT_INCONSISTENT");
    return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
  };
  const m = (amount: string) => ({ currencyId: "single-rpc-currency", amount });
  const calculated = employeeSettlement({
    advancePaid: m(money("advance_paid")),
    acceptedExpenses: m(money("accepted_expenses")),
    confirmedReturns: m(difference("return_due", "return_outstanding")),
    reimbursementPaid: m(
      difference("reimbursement_due", "reimbursement_outstanding"),
    ),
    // Documentary and workflow eligibility remain exclusively in the close RPC.
    pendingItems: 0,
    documentaryComplete: false,
  });
  if (
    minorUnits(calculated.returnDue) !== minorUnits(money("return_due")) ||
    minorUnits(calculated.reimbursementDue) !==
      minorUnits(money("reimbursement_due"))
  )
    throw new Error("SETTLEMENT_INCONSISTENT");
  return row;
}
