/** Display-only derivation; the authoritative amounts come from the settlement RPC. */
export function settlementPresentation(row: Record<string, unknown>) {
  const minor = (value: unknown) => {
    const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(String(value));
    if (!match) throw new Error("Liquidación inválida");
    return BigInt(match[1]!) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  };
  const format = (amount: bigint) =>
    `${amount / 100n}.${(amount % 100n).toString().padStart(2, "0")}`;
  const received = minor(row.return_due) - minor(row.return_outstanding);
  if (received < 0n) throw new Error("Liquidación inconsistente");
  return [
    ["Anticipo entregado", format(minor(row.advance_paid))],
    ["Gasto aceptado", format(minor(row.accepted_expenses))],
    ["Devolución determinada", format(minor(row.return_due))],
    ["Devolución recibida y conciliada", format(received)],
    ["Pendiente por devolver", format(minor(row.return_outstanding))],
    ["Reembolso determinado", format(minor(row.reimbursement_due))],
    ["Pendiente por reembolsar", format(minor(row.reimbursement_outstanding))],
  ];
}
