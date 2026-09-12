/** Pure settlement arithmetic. Authorization and transactional locking belong in RPCs.
 * Decimal strings deliberately avoid binary floating-point monetary arithmetic.
 */
export type Money = { currencyId: string; amount: string };
export type SettlementInput = {
  advancePaid: Money;
  acceptedExpenses: Money;
  confirmedReturns: Money;
  reimbursementPaid: Money;
  pendingItems: number;
  documentaryComplete: boolean;
};

const maximumMinorUnits = 99999999999999n;
export function minorUnits(value: string): bigint {
  if (!/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(value))
    throw new Error("INVALID_MONEY");
  const [whole, fraction = ""] = value.split(".");
  const result = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (result > maximumMinorUnits) throw new Error("INVALID_MONEY");
  return result;
}
function decimal(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
}
export function employeeSettlement(input: SettlementInput) {
  const values = [
    input.advancePaid,
    input.acceptedExpenses,
    input.confirmedReturns,
    input.reimbursementPaid,
  ];
  const currencyId = input.advancePaid.currencyId;
  if (!currencyId || values.some((value) => value.currencyId !== currencyId))
    throw new Error("CURRENCY_MISMATCH");
  if (!Number.isSafeInteger(input.pendingItems) || input.pendingItems < 0)
    throw new Error("INVALID_PENDING_ITEMS");
  const paid = minorUnits(input.advancePaid.amount);
  const accepted = minorUnits(input.acceptedExpenses.amount);
  const returned = minorUnits(input.confirmedReturns.amount);
  const reimbursed = minorUnits(input.reimbursementPaid.amount);
  const returnDue = paid > accepted ? paid - accepted : 0n;
  const reimbursementDue = accepted > paid ? accepted - paid : 0n;
  if (returned > returnDue || reimbursed > reimbursementDue)
    throw new Error("SETTLEMENT_EXCEEDS_BALANCE");
  return {
    currencyId,
    advancePaid: decimal(paid),
    acceptedExpenses: decimal(accepted),
    returnDue: decimal(returnDue),
    reimbursementDue: decimal(reimbursementDue),
    returnOutstanding: decimal(returnDue - returned),
    reimbursementOutstanding: decimal(reimbursementDue - reimbursed),
    canClose:
      input.pendingItems === 0 &&
      input.documentaryComplete &&
      returned === returnDue &&
      reimbursed === reimbursementDue,
  };
}

export function acceptedItemAmount(input: {
  reported: string;
  accepted: string;
  status: "accepted" | "observed" | "rejected";
  allowPartialAcceptance: boolean;
  reason?: string;
}) {
  const reported = minorUnits(input.reported),
    accepted = minorUnits(input.accepted);
  if (reported === 0n || accepted > reported)
    throw new Error("INVALID_ITEM_AMOUNT");
  if (input.status !== "accepted" && accepted !== 0n)
    throw new Error("UNACCEPTED_ITEM_HAS_AMOUNT");
  if (input.status === "accepted" && accepted === 0n)
    throw new Error("ACCEPTED_ITEM_REQUIRES_AMOUNT");
  if (
    input.status === "accepted" &&
    accepted < reported &&
    !input.allowPartialAcceptance
  )
    throw new Error("PARTIAL_ACCEPTANCE_DISABLED");
  if (
    (input.status !== "accepted" || accepted < reported) &&
    !input.reason?.trim()
  )
    throw new Error("REVIEW_REASON_REQUIRED");
  return {
    reported: decimal(reported),
    accepted: decimal(accepted),
    rejected: decimal(input.status === "observed" ? 0n : reported - accepted),
  };
}
