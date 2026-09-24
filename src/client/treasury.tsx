import React, { useEffect, useState } from "react";
import { AccountingTraceLink } from "./accounting-trace";
import { api, all, query, type Row } from "./api";
import { Modal, Empty, ErrorBox } from "./components";
import { mapBankRows } from "./bank-import-parser";
type Field = [string, string, string?, boolean?];
type Def = {
  title: string;
  kind: string;
  permission: string;
  columns: string[];
  fields: Field[];
};
export const treasuryPages: Record<string, Def> = {
  banks: {
    title: "Bancos",
    kind: "bank",
    permission: "bank",
    columns: ["code", "name", "country_code", "active"],
    fields: [
      ["code", "Código"],
      ["name", "Nombre"],
      ["country_code", "País ISO"],
    ],
  },
  "bank-accounts": {
    title: "Cuentas de la empresa",
    kind: "bank_account",
    permission: "bank",
    columns: [
      "display_name",
      "bank_id",
      "currency_id",
      "account_number",
      "opening_balance",
      "active",
    ],
    fields: [
      ["bank_id", "Banco", "banks"],
      ["currency_id", "Moneda", "currencies"],
      ["account_number", "Número de cuenta"],
      ["cci", "CCI", "text", false],
      ["account_type", "Tipo de cuenta"],
      ["display_name", "Nombre visible"],
      ["opening_balance", "Saldo de apertura · opcional", "number", false],
      ["opening_date", "Fecha del saldo de apertura", "date", false],
      ["valid_from", "Vigente desde", "date"],
    ],
  },
  "payment-methods": {
    title: "Medios de pago",
    kind: "payment_method",
    permission: "bank",
    columns: ["code", "name", "requires_beneficiary_account", "active"],
    fields: [
      ["code", "Código"],
      ["name", "Nombre"],
      [
        "requires_beneficiary_account",
        "Exige cuenta beneficiaria aprobada",
        "checkbox",
      ],
    ],
  },
  "payment-orders": {
    title: "Órdenes de pago",
    kind: "payment_order",
    permission: "payment_order",
    columns: [
      "payment_order_number",
      "beneficiary_id",
      "total_amount",
      "currency_id",
      "status",
      "scheduled_payment_date",
    ],
    fields: [
      ["beneficiary_type", "Tipo de beneficiario", "beneficiary_types"],
      ["beneficiary_id", "Beneficiario", "beneficiaries"],
      ["currency_id", "Moneda", "currencies"],
      ["payment_method_id", "Medio", "methods"],
      [
        "beneficiary_account_id",
        "Cuenta beneficiaria aprobada",
        "beneficiary_accounts",
        false,
      ],
      ["requested_payment_date", "Fecha solicitada", "date"],
      ["description", "Descripción"],
    ],
  },
  payments: {
    title: "Pagos",
    kind: "payment",
    permission: "payment",
    columns: [
      "payment_number",
      "payment_date",
      "amount",
      "currency_id",
      "operation_number",
      "status",
    ],
    fields: [
      ["payment_order_id", "Orden de pago", "orders"],
      ["payment_date", "Fecha de pago", "date"],
      ["operation_number", "Número de operación"],
      ["reference", "Referencia", "text", false],
    ],
  },
  "payment-batches": {
    title: "Lotes de pago",
    kind: "payment_batch",
    permission: "payment_batch",
    columns: [
      "batch_number",
      "description",
      "total_amount",
      "currency_id",
      "status",
    ],
    fields: [
      ["currency_id", "Moneda", "currencies"],
      ["description", "Descripción"],
      [
        "individual_approval_required",
        "Exigir aprobación individual",
        "checkbox",
      ],
    ],
  },
  "bank-transactions": {
    title: "Movimientos bancarios",
    kind: "bank_transaction",
    permission: "bank_transaction",
    columns: [
      "transaction_date",
      "bank_account_id",
      "transaction_type",
      "amount",
      "currency_id",
      "bank_reference",
      "evidence_state",
      "status",
    ],
    fields: [
      ["bank_account_id", "Cuenta", "bank_accounts"],
      ["transaction_date", "Fecha de movimiento", "date"],
      ["transaction_type", "Tipo · debit o credit"],
      ["amount", "Importe", "number"],
      ["bank_reference", "Referencia bancaria"],
      ["description", "Descripción"],
      ["external_id", "Identificador externo", "text", false],
    ],
  },
  "reconciliation-periods": {
    title: "Conciliación bancaria",
    kind: "reconciliation_period",
    permission: "bank_reconciliation",
    columns: ["bank_account_id", "start_date", "end_date", "status"],
    fields: [
      ["bank_account_id", "Cuenta", "bank_accounts"],
      ["start_date", "Inicio", "date"],
      ["end_date", "Fin", "date"],
    ],
  },
  "reconciliation-matches": {
    title: "Coincidencias de conciliación",
    kind: "reconciliation_match",
    permission: "bank_reconciliation",
    columns: [
      "bank_transaction_id",
      "payment_id",
      "employee_return_id",
      "collection_id",
      "amount",
      "status",
      "matched_at",
      "reconciled_at",
    ],
    fields: [],
  },
};
const labels: Record<string, string> = {
  currency_code: "Moneda ISO",
  external_id: "Identificador externo · opcional",
  counterparty: "Contraparte · opcional",
  value_date: "Fecha valor · opcional",
  exclude: "Excluir de matching",
  excluded: "Excluido de matching",
  draft: "Borrador",
  submitted: "Enviada",
  under_review: "En revisión",
  approved: "Aprobada",
  scheduled: "Programada",
  partially_paid: "Pago parcial",
  paid: "Pagada",
  executed: "Ejecutado",
  reversed: "Reversado",
  cancelled: "Cancelado",
  observed: "Observada",
  rejected: "Rechazada",
  open: "Abierta",
  closed: "Cerrada",
  matched: "Vinculado",
  reconciled: "Conciliado",
  unmatched: "Sin vincular",
  partially_matched: "Vínculo parcial",
  expected: "Esperado",
  confirmed: "Confirmado",
  debit: "Débito",
  credit: "Crédito",
  completed: "Completado",
  partially_completed: "Completado parcialmente",
  submit: "Enviar",
  review: "Iniciar revisión",
  approve: "Aprobar",
  observe: "Observar",
  reject: "Rechazar",
  cancel: "Cancelar",
  schedule: "Programar",
  execute: "Registrar ejecución",
  reverse: "Reversar",
  reopen: "Reabrir",
  reconcile: "Conciliar",
  close: "Cerrar período",
  unmatch: "Retirar vínculo",
  payment_order_number: "Orden de pago",
  payment_number: "Pago",
  batch_number: "Lote",
  description: "Descripción",
  currency_id: "Moneda",
  amount: "Importe",
  total_amount: "Total",
  status: "Estado",
  beneficiary_id: "Beneficiario",
  beneficiary_type: "Tipo de beneficiario",
  bank_account_id: "Cuenta",
  operation_number: "Operación",
  payment_date: "Fecha de pago",
  scheduled_payment_date: "Programada",
  bank_reference: "Referencia bancaria",
  evidence_state: "Evidencia",
  transaction_type: "Tipo",
  transaction_date: "Fecha",
  code: "Código",
  name: "Nombre",
  country_code: "País",
  active: "Activo",
  display_name: "Cuenta",
  account_number: "Número",
  bank_id: "Banco",
  opening_balance: "Saldo de apertura",
  start_date: "Inicio",
  end_date: "Fin",
  requires_beneficiary_account: "Exige cuenta",
  bank_transaction_id: "Movimiento",
  payment_id: "Pago",
  employee_return_id: "Devolución de colaborador",
  collection_id: "Cobro de cliente",
  matched_at: "Vinculado el",
  reconciled_at: "Conciliado el",
};
const sources: Record<string, string> = {
  currency_id: "currencies",
  beneficiary_id: "suppliers",
  bank_id: "banks",
  bank_account_id: "bank_accounts",
  payment_method_id: "methods",
  beneficiary_account_id: "supplier_accounts",
  payment_order_id: "orders",
};
function textValue(
  key: string,
  value: any,
  opts: Row,
  beneficiaryType = "supplier",
) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (key === "account_number") return "••••" + String(value).slice(-4);
  const list =
    opts[
      beneficiaryType === "employee" && key === "beneficiary_id"
        ? "employees"
        : beneficiaryType === "employee" && key === "beneficiary_account_id"
          ? "employee_accounts"
          : (sources[key] ?? "")
    ];
  if (Array.isArray(list))
    return (
      list.find((x: Row) => x.id === value)?.name ?? String(value).slice(0, 8)
    );
  return labels[String(value)] ?? String(value);
}
function FormField({
  f,
  value,
  set,
  opts,
}: {
  f: Field;
  value: any;
  set: (v: any) => void;
  opts: Row;
}) {
  const [k, label, type = "text", required = true] = f;
  return (
    <label>
      {label}
      {required ? " *" : ""}
      {!["text", "number", "date", "checkbox"].includes(type) ? (
        <select
          aria-label={label}
          required={required}
          value={value ?? ""}
          onChange={(e) => set(e.target.value)}
        >
          <option value="">Seleccione</option>
          {(opts[type] ?? []).map((o: Row) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      ) : type === "checkbox" ? (
        <input
          aria-label={label}
          type="checkbox"
          checked={value ?? true}
          onChange={(e) => set(e.target.checked)}
        />
      ) : (
        <input
          aria-label={label}
          type={type}
          required={required}
          step={type === "number" ? "0.01" : undefined}
          value={value ?? ""}
          onChange={(e) =>
            set(
              type === "number" && e.target.value !== ""
                ? Number(e.target.value)
                : e.target.value,
            )
          }
        />
      )}
    </label>
  );
}
function allowedActions(d: Def, row: Row, can: (p: string) => boolean) {
  let acts: string[] = [];
  const s = row.status;
  if (d.kind === "payment_order") {
    if (["draft", "observed"].includes(s)) acts = ["submit", "cancel"];
    if (["submitted", "under_review"].includes(s))
      acts = ["approve", "observe", "reject", "cancel"];
    if (["approved", "scheduled"].includes(s))
      acts = ["schedule", "reopen", "cancel"];
  }
  if (d.kind === "payment")
    acts =
      s === "draft"
        ? ["execute", "cancel"]
        : s === "executed"
          ? ["reverse"]
          : [];
  if (d.kind === "payment_batch")
    acts =
      s === "draft"
        ? ["submit", "cancel"]
        : s === "submitted"
          ? ["approve", "cancel"]
          : ["approved", "partially_completed"].includes(s)
            ? ["cancel"]
            : [];
  if (d.kind === "reconciliation_period")
    acts = s === "open" ? ["close"] : ["reopen"];
  if (d.kind === "reconciliation_match")
    acts =
      s === "matched"
        ? ["reconcile", "unmatch"]
        : s === "reconciled"
          ? ["unmatch"]
          : [];
  if (
    d.kind === "bank_transaction" &&
    row.evidence_state === "confirmed" &&
    s === "unmatched"
  )
    acts = ["exclude"];
  return acts.filter((a) =>
    can(
      a === "exclude"
        ? "bank_reconciliation.reconcile"
        : a === "schedule"
          ? "payment.schedule"
          : a === "unmatch"
            ? "bank_reconciliation.match"
            : d.kind === "payment_order" && a === "reopen"
              ? "payment_order.edit"
              : d.kind === "payment" && a === "cancel"
                ? "payment.execute"
                : d.permission + "." + a,
    ),
  );
}
export function TreasuryPage({
  page,
  company,
  can,
}: {
  page: string;
  company: string;
  can: (p: string) => boolean;
}) {
  const d = treasuryPages[page]!,
    [rows, setRows] = useState<Row[]>([]),
    [opts, setOpts] = useState<Row>({}),
    [error, setError] = useState(""),
    [form, setForm] = useState<Row | null>(null),
    [detail, setDetail] = useState<Row | null>(null),
    [items, setItems] = useState<Row[]>([]),
    [action, setAction] = useState<{ row: Row; name: string } | null>(null),
    [actionData, setActionData] = useState<Row>({}),
    [accountingReason, setAccountingReason] = useState(""),
    [busy, setBusy] = useState(false),
    [importing, setImporting] = useState(false),
    [matching, setMatching] = useState<Row | null>(null);
  const refresh = async () => {
    setRows((await all("/" + page, { company_id: company })).map((x) => x));
  };
  useEffect(() => {
    setRows([]);
    setOpts({});
    setDetail(null);
    setForm(null);
    setAction(null);
    setError("");
    if (!can(d.permission + ".view")) return;
    Promise.all([
      refresh(),
      api("/treasury/options" + query({ company_id: company })).then(setOpts),
    ]).catch((e) => setError(e.message));
  }, [page, company]);
  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operación fallida");
    } finally {
      setBusy(false);
    }
  };
  const loadForm = async (row?: Row) =>
    guard(async () => {
      let extra: Row = {};
      if (["payment_order", "payment", "payment_batch"].includes(d.kind)) {
        const payables = await all("/payables", { company_id: company });
        extra.payables = payables
          .filter(
            (p) => p.status === "approved" && Number(p.outstanding_amount) > 0,
          )
          .map((p) => ({
            ...p,
            name:
              p.id.slice(0, 8) +
              " · " +
              p.outstanding_amount +
              " · vence " +
              p.due_date,
          }));
        const orders = await all("/payment-orders", { company_id: company });
        extra.orders = orders
          .filter((o) => !["cancelled", "rejected", "paid"].includes(o.status))
          .map((o) => ({
            ...o,
            name: o.payment_order_number + " · " + o.total_amount,
          }));
      }
      setOpts({ ...opts, ...extra });
      setForm(
        row ?? {
          beneficiary_type: "supplier",
          individual_approval_required: true,
          requires_beneficiary_account: true,
        },
      );
      setItems(row ? (await api("/" + page + "/" + row.id)).items : []);
    });
  const save = () =>
    guard(async () => {
      const payload: Row = {};
      for (const [k, , type = "text", required = true] of d.fields) {
        const v = form?.[k];
        if (v !== undefined && v !== "") payload[k] = v;
        else if (type === "checkbox") payload[k] = true;
        else if (required) throw new Error("Complete " + k);
      }
      if (d.kind === "payment_order")
        payload.items = items.map((i) => ({
          payable_id: i.payable_id,
          amount_to_pay: Number(i.amount_to_pay),
        }));
      if (d.kind === "payment")
        payload.allocations = items.map((i) => ({
          payable_id: i.payable_id,
          allocated_amount: Number(i.allocated_amount),
        }));
      if (d.kind === "payment_batch")
        payload.order_ids = items.map((i) => i.payment_order_id);
      if (form?.id && d.kind === "bank_account") {
        for (const k of Object.keys(payload))
          if (!["display_name", "active", "valid_to"].includes(k))
            delete payload[k];
      }
      await api(
        "/" +
          page +
          (form?.id ? "/" + form.id : "") +
          query({ company_id: company }),
        form?.id ? "PATCH" : "POST",
        payload,
      );
      setForm(null);
      await refresh();
    });
  const show = (row: Row) =>
    guard(async () => setDetail(await api("/" + page + "/" + row.id)));
  const upload = (file: File) =>
    guard(async () => {
      const buf = new Uint8Array(await file.arrayBuffer());
      if (buf.length > 5242880) throw new Error("Máximo 5 MB");
      let raw = "";
      for (const b of buf) raw += String.fromCharCode(b);
      await api("/attachments/upload", "POST", {
        company_id: company,
        entity_type: "payment",
        entity_id: detail!.record.id,
        filename: file.name,
        mime_type: file.type,
        base64: btoa(raw),
      });
      setDetail(await api("/payments/" + detail!.record.id));
    });
  if (!can(d.permission + ".view"))
    return <Empty text="Sin permiso de consulta" />;
  const createPermission =
    d.kind === "payment"
      ? "payment.execute"
      : d.kind === "bank_transaction"
        ? "bank_transaction.create_manual"
        : d.kind === "reconciliation_period"
          ? "bank_reconciliation.match"
          : d.permission + ".create";
  return (
    <section>
      <div className="page-heading">
        <div>
          <p className="eyebrow">TESORERÍA · EMPRESA ACTIVA</p>
          <h1>{d.title}</h1>
          <p>Operaciones trazables, sin conversión de moneda implícita.</p>
        </div>
        <div>
          {d.fields.length > 0 && can(createPermission) && (
            <button className="primary" onClick={() => loadForm()}>
              Nuevo registro
            </button>
          )}
          {page === "bank-transactions" && can("bank_transaction.import") && (
            <button onClick={() => setImporting(true)}>
              Importar extracto
            </button>
          )}
        </div>
      </div>
      <ErrorBox error={error} />
      <button onClick={() => guard(refresh)}>Actualizar</button>
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {d.columns.map((k) => (
                  <th key={k}>{labels[k] ?? k}</th>
                ))}
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {d.columns.map((k) => (
                    <td key={k}>
                      {textValue(k, row[k], opts, row.beneficiary_type)}
                    </td>
                  ))}
                  <td>
                    <button onClick={() => show(row)}>Ver detalle</button>
                    {allowedActions(d, row, can).map((a) => (
                      <button
                        key={a}
                        onClick={() => {
                          setAction({ row, name: a });
                          setActionData({});
                        }}
                      >
                        {labels[a]}
                      </button>
                    ))}
                    {((d.kind === "payment_order" &&
                      ["draft", "observed"].includes(row.status)) ||
                      ["bank", "bank_account", "payment_method"].includes(
                        d.kind,
                      )) &&
                      can(d.permission + ".edit") && (
                        <button onClick={() => loadForm(row)}>Editar</button>
                      )}
                    {page === "bank-transactions" &&
                      row.evidence_state === "confirmed" &&
                      can("bank_reconciliation.match") && (
                        <button onClick={() => setMatching(row)}>
                          Proponer coincidencias
                        </button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {form && (
        <Modal
          title={form.id ? "Editar " + d.title : "Nuevo registro · " + d.title}
          close={() => setForm(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="form-grid">
              {d.fields.map((f) => (
                <FormField
                  key={f[0]}
                  f={f}
                  value={form[f[0]]}
                  set={(v) => {
                    if (
                      f[0] === "beneficiary_type" ||
                      f[0] === "beneficiary_id"
                    ) {
                      setItems([]);
                      setForm({
                        ...form,
                        beneficiary_account_id: "",
                        ...(f[0] === "beneficiary_type"
                          ? { beneficiary_id: "" }
                          : {}),
                        [f[0]]: v,
                      });
                    } else setForm({ ...form, [f[0]]: v });
                  }}
                  opts={{
                    ...opts,
                    beneficiary_types: [
                      { id: "supplier", name: "Proveedor" },
                      { id: "employee", name: "Colaborador" },
                    ],
                    beneficiaries:
                      form.beneficiary_type === "employee"
                        ? opts.employees
                        : opts.suppliers,
                    beneficiary_accounts: (form.beneficiary_type === "employee"
                      ? opts.employee_accounts
                      : opts.supplier_accounts
                    )?.filter(
                      (a: Row) =>
                        (a.employee_id ?? a.supplier_id) ===
                          form.beneficiary_id &&
                        a.currency_id === form.currency_id,
                    ),
                  }}
                />
              ))}
            </div>
            {["payment_order", "payment", "payment_batch"].includes(d.kind) && (
              <fieldset>
                <legend>
                  {d.kind === "payment_batch"
                    ? "Órdenes incluidas"
                    : "Aplicaciones a obligaciones"}
                </legend>
                {items.map((item, index) => {
                  const batch = d.kind === "payment_batch",
                    amount =
                      d.kind === "payment"
                        ? "allocated_amount"
                        : "amount_to_pay";
                  return (
                    <div className="form-grid" key={index}>
                      <FormField
                        f={[
                          batch ? "payment_order_id" : "payable_id",
                          batch ? "Orden" : "Obligación",
                          batch ? "orders" : "payables",
                        ]}
                        value={item[batch ? "payment_order_id" : "payable_id"]}
                        set={(v) =>
                          setItems(
                            items.map((x, i) =>
                              i === index
                                ? {
                                    ...x,
                                    [batch ? "payment_order_id" : "payable_id"]:
                                      v,
                                  }
                                : x,
                            ),
                          )
                        }
                        opts={
                          d.kind === "payment_order"
                            ? {
                                ...opts,
                                payables: opts.payables?.filter(
                                  (p: Row) =>
                                    (form.beneficiary_type === "employee"
                                      ? p.employee_id
                                      : p.supplier_id) ===
                                      form.beneficiary_id &&
                                    p.currency_id === form.currency_id,
                                ),
                              }
                            : opts
                        }
                      />
                      {!batch && (
                        <FormField
                          f={[amount, "Importe", "number"]}
                          value={item[amount]}
                          set={(v) =>
                            setItems(
                              items.map((x, i) =>
                                i === index ? { ...x, [amount]: v } : x,
                              ),
                            )
                          }
                          opts={opts}
                        />
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setItems(items.filter((_, i) => i !== index))
                        }
                      >
                        Retirar fila
                      </button>
                    </div>
                  );
                })}
                <button type="button" onClick={() => setItems([...items, {}])}>
                  Añadir fila
                </button>
              </fieldset>
            )}
            <ErrorBox error={error} />
            <button disabled={busy} className="primary">
              Guardar
            </button>
          </form>
        </Modal>
      )}
      {action && (
        <Modal
          title={labels[action.name] ?? action.name}
          close={() => setAction(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              guard(async () => {
                await api(
                  "/" + page + "/" + action.row.id + "/actions",
                  "POST",
                  { action: action.name, payload: actionData },
                );
                setAction(null);
                await refresh();
              });
            }}
          >
            <p>
              Esta acción queda auditada. La autorización y segregación se
              vuelven a comprobar.
            </p>
            {action.name === "schedule" && (
              <>
                <FormField
                  f={["bank_account_id", "Cuenta de salida", "bank_accounts"]}
                  value={actionData.bank_account_id}
                  set={(v) =>
                    setActionData({ ...actionData, bank_account_id: v })
                  }
                  opts={opts}
                />
                <FormField
                  f={["scheduled_payment_date", "Fecha programada", "date"]}
                  value={actionData.scheduled_payment_date}
                  set={(v) =>
                    setActionData({ ...actionData, scheduled_payment_date: v })
                  }
                  opts={opts}
                />
              </>
            )}
            {[
              "reverse",
              "cancel",
              "reopen",
              "observe",
              "reject",
              "unmatch",
              "exclude",
            ].includes(action.name) && (
              <FormField
                f={["reason", "Motivo"]}
                value={actionData.reason}
                set={(v) => setActionData({ ...actionData, reason: v })}
                opts={opts}
              />
            )}
            <ErrorBox error={error} />
            <button disabled={busy} className="primary">
              Confirmar {labels[action.name]?.toLowerCase()}
            </button>
          </form>
        </Modal>
      )}
      {detail && (
        <Modal title="Detalle de operación" close={() => setDetail(null)}>
          {page === "payments" && (
            <AccountingTraceLink
              entityType="payment"
              id={detail.record.id}
              can={can}
            />
          )}
          {page === "bank-transactions" && (
            <AccountingTraceLink
              entityType="bank_transaction"
              id={detail.record.id}
              can={can}
            />
          )}
          <dl>
            {Object.entries(detail.record)
              .filter(([k]) => !["cci", "account_number"].includes(k))
              .map(([k, v]) => (
                <React.Fragment key={k}>
                  <dt>{labels[k] ?? k}</dt>
                  <dd>
                    {textValue(k, v, opts, detail.record?.beneficiary_type)}
                  </dd>
                </React.Fragment>
              ))}
          </dl>
          {page === "bank-transactions" &&
            can("bank_transaction.classify_accounting") &&
            detail.record.source &&
            ["manual", "import"].includes(detail.record.source) &&
            detail.record.evidence_state === "confirmed" &&
            detail.record.status !== "reconciled" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void guard(async () => {
                    await api(
                      "/bank-transactions/" +
                        detail.record.id +
                        "/accounting-adjustment",
                      "POST",
                      { reason: accountingReason },
                    );
                    setAccountingReason("");
                  });
                }}
              >
                <h3>Clasificación contable explícita</h3>
                <p>
                  Solo crea un evento pendiente de regla; no contabiliza ni
                  reconcilia el movimiento.
                </p>
                <label>
                  Motivo
                  <input
                    required
                    minLength={1}
                    maxLength={2000}
                    value={accountingReason}
                    onChange={(e) => setAccountingReason(e.target.value)}
                  />
                </label>
                <button disabled={busy}>Crear ajuste contable</button>
              </form>
            )}
          {detail.items?.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Referencia</th>
                  <th>Importe</th>
                </tr>
              </thead>
              <tbody>
                {detail.items.map((i: Row) => (
                  <tr key={i.id}>
                    <td>
                      {i.payable_id ?? i.payment_order_id ?? i.payment_id}
                    </td>
                    <td>
                      {i.amount_to_pay ?? i.allocated_amount ?? i.amount ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {d.kind === "payment" && (
            <>
              <h3>Vouchers cifrados</h3>
              {detail.record.status === "draft" && can("payment.execute") && (
                <input
                  aria-label="Adjuntar voucher"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.xml"
                  onChange={(e) =>
                    e.target.files?.[0] && upload(e.target.files[0])
                  }
                />
              )}
              <ul>
                {detail.attachments?.map((a: Row) => (
                  <li key={a.id}>
                    {a.filename} ·{" "}
                    {a.status === "ready" ? (
                      <button
                        onClick={() =>
                          guard(async () => {
                            const f = await api(
                              "/attachments/" + a.id + "/download",
                            );
                            const bytes = Uint8Array.from(atob(f.base64), (c) =>
                              c.charCodeAt(0),
                            );
                            const url = URL.createObjectURL(
                              new Blob([bytes], { type: f.mime_type }),
                            );
                            const link = document.createElement("a");
                            link.href = url;
                            link.download = f.filename;
                            link.click();
                            setTimeout(() => URL.revokeObjectURL(url), 1000);
                          })
                        }
                      >
                        Descargar
                      </button>
                    ) : (
                      "Pendiente"
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          <ErrorBox error={error} />
        </Modal>
      )}
      {importing && (
        <BankImport
          company={company}
          opts={opts}
          close={() => {
            setImporting(false);
            guard(refresh);
          }}
        />
      )}
      {matching && (
        <MatchForm
          transaction={matching}
          company={company}
          close={() => {
            setMatching(null);
            guard(refresh);
          }}
        />
      )}
    </section>
  );
}

function BankImport({
  company,
  opts,
  close,
}: {
  company: string;
  opts: Row;
  close: () => void;
}) {
  const [raw, setRaw] = useState<string[][]>([]),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [account, setAccount] = useState(""),
    [name, setName] = useState(""),
    [preview, setPreview] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const fields = [
    "transaction_date",
    "transaction_type",
    "amount",
    "currency_code",
    "bank_reference",
    "description",
    "external_id",
    "counterparty",
    "value_date",
  ];
  const parse = async (file: File) => {
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const worker = new Worker(
        new URL("./bank-import-worker.ts", import.meta.url),
        { type: "module" },
      );
      const rows = await new Promise<string[][]>(async (resolve, reject) => {
        const timer = setTimeout(() => {
          worker.terminate();
          reject(new Error("Tiempo de lectura agotado"));
        }, 15000);
        worker.onmessage = (e) => {
          clearTimeout(timer);
          worker.terminate();
          e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.rows);
        };
        worker.onerror = () => {
          clearTimeout(timer);
          worker.terminate();
          reject(new Error("Archivo inválido"));
        };
        worker.postMessage({
          name: file.name,
          bytes: await file.arrayBuffer(),
        });
      });
      setRaw(rows);
      setName(file.name);
      setMapping(
        Object.fromEntries(
          fields.map((k) => [k, rows[0]!.includes(k) ? k : ""]),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const run = async (confirm: boolean) => {
    setBusy(true);
    setError("");
    try {
      const result = await api(
        "/treasury/import" + query({ company_id: company }),
        "POST",
        {
          account_id: account,
          source_filename: name,
          column_mapping: Object.fromEntries(
            Object.entries(mapping).filter(([, column]) => column),
          ),
          rows: mapBankRows(raw, mapping),
          confirm,
        },
      );
      setPreview(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Importar extracto bancario" close={close}>
      <p>
        CSV/XLSX con columnas configurables. Fechas ISO, importes positivos con
        punto decimal, tipo debit/credit y moneda ISO. No se asume un formato
        bancario universal.
      </p>
      <FormField
        f={["account", "Cuenta", "bank_accounts"]}
        value={account}
        set={(v) => {
          setAccount(v);
          setPreview(null);
        }}
        opts={opts}
      />
      <input
        aria-label="Archivo de extracto"
        type="file"
        accept=".csv,.xlsx"
        disabled={busy}
        onChange={(e) => e.target.files?.[0] && parse(e.target.files[0])}
      />
      {raw.length > 0 && (
        <>
          <div className="form-grid">
            {fields.map((k) => (
              <label key={k}>
                {labels[k] ?? k}
                <select
                  aria-label={"Columna " + k}
                  value={mapping[k] ?? ""}
                  onChange={(e) => {
                    setMapping({ ...mapping, [k]: e.target.value });
                    setPreview(null);
                  }}
                >
                  <option value="">Sin mapear</option>
                  {raw[0]!.map((h) => (
                    <option key={h}>{h}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button disabled={busy || !account} onClick={() => run(false)}>
            Preview sin persistencia
          </button>
        </>
      )}
      {preview && (
        <div>
          <p role="status">
            {preview.status} · duplicados: {preview.duplicates} · insertados:{" "}
            {preview.inserted}
          </p>
          {preview.rows && (
            <>
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Referencia</th>
                    <th>Importe</th>
                    <th>Duplicado</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 100).map((r: Row, i: number) => (
                    <tr key={i}>
                      <td>{r.transaction_date}</td>
                      <td>{r.bank_reference}</td>
                      <td>
                        {r.amount} {r.currency_code}
                      </td>
                      <td>{r.duplicate ? "Sí" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p>
                Se muestran hasta 100 filas; se validan todas. Los duplicados se
                informan y no se insertan.
              </p>
              <button
                className="primary"
                disabled={busy}
                onClick={() => run(true)}
              >
                Confirmar importación
              </button>
            </>
          )}
        </div>
      )}
      <ErrorBox error={error} />
    </Modal>
  );
}
function MatchForm({
  transaction,
  company,
  close,
}: {
  transaction: Row;
  company: string;
  close: () => void;
}) {
  const [candidates, setCandidates] = useState<Row[]>([]),
    [periods, setPeriods] = useState<Row[]>([]),
    [data, setData] = useState<Row>({ amount: transaction.amount }),
    [error, setError] = useState("");
  useEffect(() => {
    Promise.all([
      api(
        "/treasury/candidates/" +
          transaction.id +
          query({ company_id: company }),
      ).then(setCandidates),
      all("/reconciliation-periods", { company_id: company }).then(setPeriods),
    ]).catch((e) => setError(e.message));
  }, [transaction.id, company]);
  return (
    <Modal
      title="Coincidencias sugeridas · confirmación requerida"
      close={close}
    >
      <p>
        Movimiento {transaction.bank_reference} · {transaction.amount}. Ninguna
        sugerencia se concilia automáticamente.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          api("/treasury/match" + query({ company_id: company }), "POST", {
            period_id: data.period_id,
            transaction_id: transaction.id,
            payment_id: data.payment_id,
            match_amount: Number(data.amount),
          })
            .then(close)
            .catch((e) => setError(e.message));
        }}
      >
        <FormField
          f={["period_id", "Período abierto", "periods"]}
          value={data.period_id}
          set={(v) => setData({ ...data, period_id: v })}
          opts={{
            periods: periods
              .filter(
                (p) =>
                  p.bank_account_id === transaction.bank_account_id &&
                  p.status === "open",
              )
              .map((p) => ({
                id: p.id,
                name: p.start_date + " / " + p.end_date,
              })),
          }}
        />
        <FormField
          f={["payment_id", "Pago sugerido", "payments"]}
          value={data.payment_id}
          set={(v) => setData({ ...data, payment_id: v })}
          opts={{
            payments: candidates.map((p) => ({
              id: p.id,
              name:
                p.payment_number +
                " · " +
                p.amount +
                " · coincidencia " +
                p.score,
            })),
          }}
        />
        <FormField
          f={["amount", "Importe a vincular", "number"]}
          value={data.amount}
          set={(v) => setData({ ...data, amount: v })}
          opts={{}}
        />
        <ErrorBox error={error} />
        <button className="primary">Confirmar vínculo</button>
        <p>Después revise y concilie desde Coincidencias.</p>
      </form>
    </Modal>
  );
}
export function TreasuryDashboard({
  company,
  can,
  page,
}: {
  company: string;
  can: (p: string) => boolean;
  page: string;
}) {
  const [data, setData] = useState<Row | null>(null),
    [opts, setOpts] = useState<Row>({}),
    [error, setError] = useState(""),
    [window, setWindow] = useState("30");
  useEffect(() => {
    setData(null);
    setError("");
    api(
      "/treasury/" +
        (page === "cashflow" ? "cashflow" : "dashboard") +
        query({ company_id: company }),
    )
      .then((x) => {
        setData(x);
        setOpts({ currencies: x.currencies ?? [] });
      })
      .catch((e) => setError(e.message));
  }, [company, page]);
  if (!can(page === "cashflow" ? "cashflow.view" : "payment_order.view"))
    return <Empty text="Sin permiso de consulta" />;
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Lima",
  });
  const diff = (date: string) =>
    Math.round((Date.parse(date) - Date.parse(today)) / 86400000);
  const queue = (data?.schedule ?? []).filter((r: Row) => {
    const days = diff(r.scheduled_payment_date ?? r.requested_payment_date);
    return window === "overdue"
      ? diff(r.due_date) < 0
      : days >= 0 && days <= Number(window);
  });
  const currency = (id: string) => textValue("currency_id", id, opts);
  const totals = (list: Row[], field: string) =>
    Object.entries(
      list.reduce(
        (a: Row, r: Row) => ({
          ...a,
          [r.currency_id]: (a[r.currency_id] ?? 0) + Number(r[field]),
        }),
        {},
      ),
    );
  return (
    <section>
      <p className="eyebrow">TESORERÍA</p>
      <h1>
        {page === "cashflow"
          ? "Cash Flow y posición registrada"
          : page === "schedule"
            ? "Programación de pagos"
            : "Panel de Tesorería"}
      </h1>
      <ErrorBox error={error} />
      {data &&
        (page === "cashflow" ? (
          <>
            <p>
              Actual: extractos confirmados, conciliados o pendientes.
              Comprometido: saldo de CxP aprobadas, contado una sola vez. No
              representa saldo disponible garantizado.
            </p>
            {[
              "position",
              "actual",
              "committed",
              "expected_receivables",
              "forecast",
            ].map((k) => (
              <section key={k}>
                <h2>
                  {
                    {
                      position: "Posición bancaria registrada",
                      actual: "Actual · por fecha",
                      committed: "Comprometido · por vencimiento",
                      expected_receivables:
                        "CxC esperadas · no son ingresos bancarios",
                      forecast: "Forecast · sin fuentes adicionales",
                    }[k]
                  }
                </h2>
                {data[k]?.length ? (
                  <table>
                    <thead>
                      <tr>
                        <th>Cuenta / Fecha</th>
                        <th>Moneda</th>
                        <th>Importe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data[k].map((r: Row, i: number) => (
                        <tr key={i}>
                          <td>
                            {r.display_name ?? r.transaction_date ?? r.due_date}
                          </td>
                          <td>{currency(r.currency_id)}</td>
                          <td>
                            {r.recorded_position === null
                              ? "Sin saldo de apertura"
                              : Number(r.recorded_position ?? r.amount).toFixed(
                                  2,
                                )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <Empty text="Sin registros en esta fuente" />
                )}
              </section>
            ))}
          </>
        ) : (
          <>
            <div className="finance-stats">
              {[0, 7, 30].map((days) => (
                <article className="panel" key={days}>
                  <h3>
                    {days === 0
                      ? "Programación de hoy"
                      : "Próximos " + days + " días"}
                  </h3>
                  {totals(
                    (data.schedule ?? []).filter((r: Row) => {
                      const n = diff(
                        r.scheduled_payment_date ?? r.requested_payment_date,
                      );
                      return n >= 0 && n <= days;
                    }),
                    "outstanding_amount",
                  ).map(([id, amount]) => (
                    <p key={id}>
                      {currency(id)} {Number(amount).toFixed(2)}
                    </p>
                  ))}
                </article>
              ))}
              {[
                [
                  "Pagos ejecutados pendientes de conciliar",
                  data.payments_unreconciled,
                ],
                ["Movimientos sin conciliar", data.bank_unreconciled],
                ["Lotes pendientes", data.batches_pending],
              ].map(([label, v]) => (
                <article className="panel" key={label}>
                  <h3>{label}</h3>
                  <strong className="finance-number">
                    {v ?? "Sin acceso"}
                  </strong>
                </article>
              ))}
            </div>
            <label>
              Horizonte
              <select
                aria-label="Horizonte"
                value={window}
                onChange={(e) => setWindow(e.target.value)}
              >
                <option value="0">Hoy</option>
                <option value="7">7 días</option>
                <option value="15">15 días</option>
                <option value="30">30 días</option>
                <option value="overdue">Vencidos</option>
              </select>
            </label>
            <p>
              {queue.length} órdenes ·{" "}
              {totals(queue, "outstanding_amount")
                .map(([id, v]) => currency(id) + " " + Number(v).toFixed(2))
                .join(" / ") || "Sin importes en este horizonte"}
            </p>
            {data.approved_payables && (
              <section>
                <h3>CxP aprobadas por vencer · saldo comprometido</h3>
                {totals(data.approved_payables, "amount").map(
                  ([id, amount]) => (
                    <p key={id}>
                      {currency(id)} {Number(amount).toFixed(2)}
                    </p>
                  ),
                )}
              </section>
            )}
            <p>
              Cola de hasta 500 OP activas. Programar no cambia el vencimiento
              de la obligación.
            </p>
            {queue.length ? (
              <table>
                <thead>
                  <tr>
                    <th>Proveedor</th>
                    <th>OP</th>
                    <th>Vencimiento</th>
                    <th>Programación</th>
                    <th>Prioridad</th>
                    <th>Importe</th>
                    <th>Banco</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map((r: Row) => (
                    <tr key={r.id}>
                      <td>{r.beneficiary}</td>
                      <td>
                        <a href="/app/payment-orders">
                          {r.payment_order_number}
                        </a>
                      </td>
                      <td>{r.due_date}</td>
                      <td>{r.scheduled_payment_date ?? "Sin programar"}</td>
                      <td>{r.priority ?? "—"}</td>
                      <td>
                        {currency(r.currency_id)}{" "}
                        {Number(r.outstanding_amount).toFixed(2)}
                      </td>
                      <td>{r.bank ?? "Sin banco"}</td>
                      <td>{labels[r.status] ?? r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty />
            )}
          </>
        ))}
    </section>
  );
}
