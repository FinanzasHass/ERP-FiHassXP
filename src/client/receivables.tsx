import React, { useEffect, useState } from "react";
import { api, all, query, type Row } from "./api";
import { Modal, ErrorBox, Empty } from "./components";
export const receivablePages: Record<
  string,
  { title: string; permission: string; endpoint: string; columns: string[] }
> = {
  customers: {
    title: "Clientes",
    permission: "customer.view",
    endpoint: "customers",
    columns: ["legal_name", "document_type", "document_number", "status"],
  },
  receivables: {
    title: "Cuentas por cobrar",
    permission: "receivable.view",
    endpoint: "receivables",
    columns: [
      "receivable_number",
      "customer_id",
      "due_date",
      "original_amount",
      "collected_amount",
      "outstanding_amount",
      "currency_id",
      "financial_status",
    ],
  },
  collections: {
    title: "Cobros",
    permission: "collection.view",
    endpoint: "collections",
    columns: [
      "collection_number",
      "customer_id",
      "collection_date",
      "amount",
      "applied_amount",
      "unapplied_amount",
      "currency_id",
      "financial_status",
    ],
  },
  "collection-deposits": {
    title: "Depósitos sin identificar",
    permission: "collection.view",
    endpoint: "collection-deposits",
    columns: [
      "transaction_date",
      "bank_reference",
      "amount",
      "currency_id",
      "financial_status",
    ],
  },
  "receivable-schedules": {
    title: "Cuotas y cronogramas",
    permission: "receivable_schedule.view",
    endpoint: "receivable-schedules",
    columns: [
      "source_id",
      "period_reference",
      "version",
      "total_amount",
      "currency_id",
      "status",
    ],
  },
  memberships: {
    title: "Membresías comerciales",
    permission: "membership.view",
    endpoint: "receivable-sources",
    columns: [
      "reference",
      "customer_id",
      "description",
      "currency_id",
      "status",
    ],
  },
  "lot-receivables": {
    title: "Contratos financieros de lotes",
    permission: "lot_receivable.view",
    endpoint: "receivable-sources",
    columns: [
      "reference",
      "customer_id",
      "description",
      "currency_id",
      "status",
    ],
  },
  "issued-documents": {
    title: "Referencias de documentos emitidos",
    permission: "receivable.view",
    endpoint: "issued-documents",
    columns: ["customer_id", "document_type", "series", "number", "issue_date"],
  },
};
const labels: Row = {
  plan_name: "Plan",
  start_date: "Inicio / primer vencimiento",
  end_date: "Fin",
  periodic_amount: "Importe por período",
  period_months: "Meses por período",
  lot_identifier: "Lote externo",
  agreed_price: "Precio acordado",
  down_payment: "Cuota inicial",
  financed_amount: "Saldo financiado",
  legal_name: "Nombre / razón social",
  document_type: "Tipo documento",
  document_number: "Documento",
  status: "Estado",
  receivable_number: "CxC",
  customer_id: "Cliente",
  due_date: "Vencimiento",
  original_amount: "Importe original",
  collected_amount: "Cobrado",
  outstanding_amount: "Pendiente",
  currency_id: "Moneda",
  financial_status: "Estado financiero",
  collection_number: "Cobro",
  collection_date: "Fecha de cobro",
  amount: "Importe",
  applied_amount: "Aplicado",
  unapplied_amount: "Saldo a favor",
  transaction_date: "Fecha bancaria",
  bank_reference: "Referencia bancaria",
  source_id: "Origen",
  period_reference: "Período",
  version: "Versión",
  total_amount: "Total",
  reference: "Referencia",
  description: "Descripción",
  series: "Serie",
  number: "Número",
  issue_date: "Emisión",
  active: "Activo",
  inactive: "Inactivo",
  closed: "Cerrado",
  superseded: "Sustituido",
  cancelled: "Cancelado",
  collected: "Cobrado",
  partially_collected: "Cobro parcial",
  overdue: "Vencido",
  pending: "Pendiente",
  unidentified: "Sin identificar",
  identified: "Identificado",
  partially_applied: "Aplicado parcialmente",
  applied: "Aplicado",
  reversed: "Revertido",
  actor_id: "Responsable",
  action: "Acción",
  created_at: "Fecha",
  reason: "Motivo",
  receivable_id: "CxC",
  score: "Coincidencia",
  qualification: "Criterio",
  current: "Al día",
  "1_30": "1–30 días",
  "31_60": "31–60 días",
  "61_90": "61–90 días",
  over_90: "Más de 90 días",
  bucket: "Antigüedad",
  overdue_amount: "Vencido",
  upcoming_amount: "Por vencer",
  overdue_customers: "Clientes vencidos",
  source_type: "Tipo de origen",
  membership: "Membresía",
  lot_sale: "Lote",
  manual_authorized: "Manual autorizada",
  other: "Otro",
};
type Field = {
  key: string;
  label: string;
  type?: string;
  options?: Row[];
  optional?: boolean;
};
type ActionForm = {
  title: string;
  fields: Field[];
  initial?: Row;
  rows?: "allocations" | "installments";
  rowOptions?: Row[];
  submit: (data: Row, key: string) => Promise<unknown>;
};
const field = (
  key: string,
  label: string,
  type = "text",
  options?: Row[],
  optional = false,
): Field => ({ key, label, type, options, optional });
const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" });
function display(key: string, value: unknown, opts: Row) {
  if (value == null) return "—";
  const group = (
    {
      customer_id: "customers",
      currency_id: "currencies",
      source_id: "sources",
    } as Row
  )[key];
  if (group)
    return opts[group]?.find((x: Row) => x.id === value)?.name ?? String(value);
  return typeof value === "object"
    ? JSON.stringify(value)
    : (labels[String(value)] ?? String(value));
}
function DataTable({
  rows,
  columns,
  opts,
  actions,
}: {
  rows: Row[];
  columns: string[];
  opts: Row;
  actions?: (r: Row) => React.ReactNode;
}) {
  return rows.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((k) => (
              <th key={k}>{labels[k] ?? k}</th>
            ))}
            {actions && <th>Acciones</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? i}>
              {columns.map((k) => (
                <td key={k}>{display(k, r[k], opts)}</td>
              ))}
              {actions && (
                <td>
                  <div className="row-actions">{actions(r)}</div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty />
  );
}
function Editor({
  form,
  close,
  done,
}: {
  form: ActionForm;
  close: () => void;
  done: () => Promise<void>;
}) {
  const [data, setData] = useState<Row>(form.initial ?? {}),
    [lines, setLines] = useState<Row[]>([{}]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [operationKey] = useState(() => crypto.randomUUID());
  const change = (key: string, value: unknown) =>
    setData({ ...data, [key]: value });
  return (
    <Modal title={form.title} close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const body: Row = {};
            for (const f of form.fields) {
              const value = data[f.key];
              if (value !== undefined && value !== "")
                body[f.key] = f.type === "number" ? Number(value) : value;
            }
            if (form.rows)
              body[form.rows] = lines.map((r) => ({
                ...r,
                amount: Number(r.amount),
              }));
            await form.submit(body, operationKey);
            await done();
            close();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          {form.fields.map((f) => (
            <label key={f.key}>
              {f.label}
              {f.options ? (
                <select
                  required={!f.optional}
                  value={data[f.key] ?? ""}
                  onChange={(e) => change(f.key, e.target.value)}
                >
                  <option value="">Seleccione…</option>
                  {f.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  required={!f.optional}
                  type={f.type ?? "text"}
                  step={f.type === "number" ? "0.01" : undefined}
                  min={f.type === "number" ? 0 : undefined}
                  value={data[f.key] ?? ""}
                  onChange={(e) => change(f.key, e.target.value)}
                />
              )}
            </label>
          ))}
        </div>
        {form.rows && (
          <fieldset>
            <legend>
              {form.rows === "allocations"
                ? "Distribución del cobro"
                : "Cuotas explícitas"}
            </legend>
            {lines.map((r, i) => (
              <div className="form-grid" key={i}>
                {form.rows === "allocations" ? (
                  <label>
                    Obligación
                    <select
                      aria-label={"Obligación " + (i + 1)}
                      required
                      value={r.receivable_id ?? ""}
                      onChange={(e) =>
                        setLines(
                          lines.map((x, j) =>
                            j === i
                              ? { ...x, receivable_id: e.target.value }
                              : x,
                          ),
                        )
                      }
                    >
                      <option value="">Seleccione…</option>
                      {form.rowOptions?.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label>
                    Vencimiento
                    <input
                      aria-label={"Vencimiento " + (i + 1)}
                      required
                      type="date"
                      value={r.due_date ?? ""}
                      onChange={(e) =>
                        setLines(
                          lines.map((x, j) =>
                            j === i ? { ...x, due_date: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </label>
                )}
                <label>
                  Importe
                  <input
                    aria-label={"Importe " + (i + 1)}
                    required
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={r.amount ?? ""}
                    onChange={(e) =>
                      setLines(
                        lines.map((x, j) =>
                          j === i ? { ...x, amount: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  disabled={lines.length === 1}
                  onClick={() => setLines(lines.filter((_, j) => j !== i))}
                >
                  Quitar
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={
                lines.length >= (form.rows === "allocations" ? 100 : 360)
              }
              onClick={() => setLines([...lines, {}])}
            >
              Añadir fila
            </button>
          </fieldset>
        )}
        <ErrorBox error={error} />
        <button className="primary" disabled={busy}>
          {busy ? "Guardando…" : "Confirmar"}
        </button>
      </form>
    </Modal>
  );
}
export function ReceivablePage({
  page,
  company,
  can,
}: {
  page: string;
  company: string;
  can: (p: string) => boolean;
}) {
  const d = receivablePages[page]!,
    [rows, setRows] = useState<Row[]>([]),
    [opts, setOpts] = useState<Row>({}),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [count, setCount] = useState(0),
    [index, setIndex] = useState(1),
    [revision, setRevision] = useState(0),
    [form, setForm] = useState<ActionForm | null>(null),
    [detail, setDetail] = useState<{
      title: string;
      rows: Row[];
      columns: string[];
      kind?: string;
      id?: string;
    } | null>(null);
  const filter =
    page === "memberships"
      ? { source_type: "membership" }
      : page === "lot-receivables"
        ? { source_type: "lot_sale" }
        : {};
  const url =
    "/" +
    d.endpoint +
    query({ company_id: company, page: index, limit: 30, ...filter });
  useEffect(() => {
    let active = true;
    setLoading(true);
    setRows([]);
    setError("");
    Promise.all([
      api(url),
      api("/receivable-context/options" + query({ company_id: company })),
    ])
      .then(([result, options]) => {
        if (active) {
          setRows(result.data);
          setCount(result.count);
          setOpts(options);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [url, revision]);
  const reload = async () => {
    setRevision((x) => x + 1);
  };
  const post = (path: string, body: Row, key?: string) =>
    api(path, "POST", body, key ? { "Idempotency-Key": key } : {});
  const base = "/" + d.endpoint,
    ctx = query({ company_id: company });
  const customers = () =>
    field(
      "customer_id",
      "Cliente",
      "select",
      opts.customers?.filter((x: Row) => x.status === "active") ?? [],
    );
  const currency = () =>
    field("currency_id", "Moneda", "select", opts.currencies ?? []);
  const reason = (
    title: string,
    submit: (body: Row, key: string) => Promise<unknown>,
  ) => setForm({ title, fields: [field("reason", "Motivo")], submit });
  const run = async (action: () => Promise<void>) => {
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  function create() {
    if (page === "customers")
      setForm({
        title: "Nuevo cliente",
        fields: [
          field("customer_type", "Tipo de persona", "select", [
            { id: "natural", name: "Natural" },
            { id: "legal", name: "Jurídica" },
          ]),
          field("document_type", "Tipo de documento"),
          field("document_number", "Documento"),
          field("legal_name", "Nombre / razón social"),
          field("email", "Correo", "email", undefined, true),
          field("phone", "Teléfono", "text", undefined, true),
          field("address", "Dirección", "text", undefined, true),
        ],
        submit: (body) => post(base + ctx, body),
      });
    if (page === "receivables")
      setForm({
        title: "Nueva obligación autorizada",
        fields: [
          customers(),
          currency(),
          field("issue_date", "Fecha de emisión", "date"),
          field("due_date", "Vencimiento", "date"),
          field("original_amount", "Importe", "number"),
          field("description", "Motivo de la obligación"),
        ],
        initial: { issue_date: today() },
        submit: (body, key) =>
          post(base + ctx, { ...body, source_type: "manual_authorized" }, key),
      });
    if (page === "collections")
      setForm({
        title: "Registrar cobro no bancario",
        fields: [
          currency(),
          field("collection_date", "Fecha de cobro", "date"),
          field("amount", "Importe", "number"),
          field(
            "payment_method_id",
            "Medio de cobro",
            "select",
            opts.methods ?? [],
          ),
          field("reference", "Referencia"),
        ],
        initial: { collection_date: today() },
        submit: (body, key) => post(base + ctx, body, key),
      });
    if (["memberships", "lot-receivables"].includes(page))
      setForm({
        title:
          page === "memberships"
            ? "Nueva membresía comercial"
            : "Nuevo contrato financiero de lote",
        fields: [
          customers(),
          currency(),
          field("reference", "Referencia de contrato"),
          field("description", "Descripción"),
          ...(page === "memberships"
            ? [
                field("plan_name", "Nombre del plan"),
                field("start_date", "Inicio y primer vencimiento", "date"),
                field("end_date", "Fin", "date", undefined, true),
                field("periodic_amount", "Importe por período", "number"),
                field("period_months", "Periodicidad en meses", "number"),
              ]
            : [
                field("lot_identifier", "Identificador externo del lote"),
                field("agreed_price", "Precio acordado", "number"),
                field("down_payment", "Cuota inicial", "number"),
              ]),
        ],
        submit: (body, key) =>
          post(
            "/receivable-sources" + ctx,
            {
              ...body,
              source_type: page === "memberships" ? "membership" : "lot_sale",
            },
            key,
          ),
      });
    if (page === "issued-documents")
      setForm({
        title: "Referencia de documento emitido",
        fields: [
          customers(),
          field("document_type", "Tipo"),
          field("series", "Serie"),
          field("number", "Número"),
          field("issue_date", "Emisión", "date"),
          field("description", "Descripción", "text", undefined, true),
        ],
        submit: (body) => post(base + ctx, body),
      });
  }
  function identify(r: Row) {
    setForm({
      title: "Confirmar cliente del cobro",
      fields: [customers(), field("reason", "Sustento de identificación")],
      initial: { customer_id: r.customer_id ?? "" },
      submit: (body, key) =>
        post("/collections/" + r.id + "/identify", body, key),
    });
  }
  async function application(r: Row) {
    const debts = await all("/receivables", {
      company_id: company,
      customer_id: r.customer_id,
    });
    setForm({
      title: "Aplicar cobro " + r.collection_number,
      fields: [],
      rows: "allocations",
      rowOptions: debts
        .filter(
          (x) =>
            x.status === "active" &&
            x.currency_id === r.currency_id &&
            Number(x.outstanding_amount) > 0,
        )
        .map((x) => ({
          id: x.id,
          name: x.receivable_number + " · pendiente " + x.outstanding_amount,
        })),
      submit: (body, key) => post("/collections/" + r.id + "/apply", body, key),
    });
  }
  function schedule(r: Row, replace = false) {
    setForm({
      title: replace
        ? "Sustituir cronograma sin cobros históricos"
        : "Generar cronograma",
      fields: [
        field("period_reference", "Referencia del período"),
        field("issue_date", "Fecha de emisión", "date"),
        ...(replace ? [field("reason", "Motivo de sustitución")] : []),
      ],
      initial: {
        period_reference: replace ? r.period_reference : "",
        issue_date: today(),
      },
      rows: "installments",
      submit: (body, key) =>
        post(
          "/receivable-sources/" +
            (replace ? r.source_id : r.id) +
            "/schedules",
          { ...body, ...(replace ? { replace_schedule_id: r.id } : {}) },
          key,
        ),
    });
  }
  async function history(r: Row) {
    const list = await all(base + "/" + r.id + "/history");
    setDetail({
      title: "Historial",
      rows: list,
      columns: ["created_at", "actor_id", "action", "reason"],
    });
  }
  const createPermission = (
    {
      customers: "customer.create",
      receivables: "receivable.create",
      collections: "collection.create",
      memberships: "membership.manage",
      "lot-receivables": "lot_receivable.manage",
      "issued-documents": "receivable.create",
    } as Row
  )[page];
  if (!can(d.permission)) return <Empty text="Sin permiso de consulta" />;
  return (
    <section>
      <div className="page-heading">
        <div>
          <p className="eyebrow">COBRANZAS · CONTEXTO EMPRESARIAL</p>
          <h1>{d.title}</h1>
        </div>
        {createPermission && can(createPermission) && (
          <button className="primary" onClick={create}>
            Nuevo
          </button>
        )}
      </div>
      {page === "collections" && (
        <p>
          Identificar y aplicar un cobro no lo concilia. Los cobros no bancarios
          requieren sustento cifrado antes de aplicarse.
        </p>
      )}
      {page === "lot-receivables" && (
        <p>
          Control del contrato financiero y sus cuotas; el lote se identifica
          por su referencia externa.
        </p>
      )}
      <ErrorBox error={error} />
      {loading ? (
        <p role="status">Cargando datos…</p>
      ) : (
        <DataTable
          rows={rows}
          columns={d.columns}
          opts={opts}
          actions={(r) => (
            <>
              {page === "customers" && can("customer.edit") && (
                <button
                  onClick={() =>
                    setForm({
                      title: "Editar datos del cliente",
                      fields: [
                        field("legal_name", "Nombre / razón social"),
                        field("email", "Correo", "email", undefined, true),
                        field("phone", "Teléfono", "text", undefined, true),
                        field("address", "Dirección", "text", undefined, true),
                      ],
                      initial: r,
                      submit: (body) =>
                        api(base + "/" + r.id + ctx, "PATCH", body),
                    })
                  }
                >
                  Editar
                </button>
              )}
              {page === "customers" &&
                r.status === "active" &&
                can("customer.disable") && (
                  <button
                    onClick={() =>
                      reason("Desactivar cliente", (body) =>
                        post(base + "/" + r.id + "/disable", body),
                      )
                    }
                  >
                    Desactivar
                  </button>
                )}
              {page === "receivables" &&
                r.status === "active" &&
                can("receivable.adjust") &&
                !r.installment_id && (
                  <button
                    onClick={() =>
                      setForm({
                        title: "Ajustar obligación",
                        fields: [
                          field(
                            "original_amount",
                            "Importe original",
                            "number",
                          ),
                          field("due_date", "Vencimiento", "date"),
                          field("description", "Descripción"),
                          field("reason", "Motivo"),
                        ],
                        initial: r,
                        submit: ({ reason, ...payload }) =>
                          post(base + "/" + r.id + "/actions", {
                            action: "adjust",
                            payload,
                            reason,
                          }),
                      })
                    }
                  >
                    Ajustar
                  </button>
                )}
              {page === "receivables" &&
                r.status === "active" &&
                !r.installment_id &&
                can("receivable.cancel") && (
                  <button
                    onClick={() =>
                      reason("Cancelar obligación", (body) =>
                        post(base + "/" + r.id + "/actions", {
                          action: "cancel",
                          payload: {},
                          ...body,
                        }),
                      )
                    }
                  >
                    Cancelar
                  </button>
                )}
              {page === "collection-deposits" && can("collection.identify") && (
                <button
                  onClick={() =>
                    run(async () => {
                      const coll = r.collection_id
                        ? { id: r.collection_id }
                        : await post(
                            "/collections" + ctx,
                            { bank_transaction_id: r.id },
                            crypto.randomUUID(),
                          );
                      identify(coll);
                    })
                  }
                >
                  Identificar
                </button>
              )}
              {page === "collections" && r.status === "active" && (
                <>
                  {can("collection.identify") && (
                    <button onClick={() => identify(r)}>Identificar</button>
                  )}
                  {can("collection.identify") && can("customer.view") && (
                    <button
                      onClick={() =>
                        run(async () => {
                          setDetail({
                            title:
                              "Candidatos sugeridos · confirme el cliente desde Identificar",
                            rows: await api(base + "/" + r.id + "/candidates"),
                            columns: ["legal_name", "score", "qualification"],
                          });
                        })
                      }
                    >
                      Sugerencias
                    </button>
                  )}
                  {r.customer_id && can("collection.apply") && (
                    <button onClick={() => run(() => application(r))}>
                      Aplicar
                    </button>
                  )}
                  {can("collection.reverse") && (
                    <button
                      onClick={() =>
                        reason("Revertir cobro", (body, key) =>
                          post(base + "/" + r.id + "/reverse", body, key),
                        )
                      }
                    >
                      Revertir
                    </button>
                  )}
                  {can("bank_reconciliation.match") && (
                    <button
                      onClick={() =>
                        run(async () => {
                          const periods = await all("/reconciliation-periods", {
                            company_id: company,
                          });
                          const movements = r.bank_transaction_id
                            ? [{id:r.bank_transaction_id,name:r.reference+' · '+r.amount}]
                            : (await all('/bank-transactions',{company_id:company})).filter(t=>t.transaction_type==='credit'&&t.evidence_state==='confirmed'&&t.currency_id===r.currency_id&&t.status!=='excluded').map(t=>({id:t.id,name:t.transaction_date+' · '+t.bank_reference+' · '+t.amount}));
                          setForm({
                            title: "Vincular con conciliación bancaria",
                            fields: [
                              field(
                                "period_id",
                                "Período abierto",
                                "select",
                                periods
                                  .filter((p) => p.status === "open")
                                  .map((p) => ({
                                    id: p.id,
                                    name: p.start_date + " / " + p.end_date,
                                  })),
                              ),
                              field(
                                "transaction_id",
                                "Movimiento bancario confirmado",
                                "select",
                                movements,
                              ),
                              field("amount", "Importe a vincular", "number"),
                            ],
                            initial: {
                              transaction_id: r.bank_transaction_id ?? "",
                              amount: r.amount,
                            },
                            submit: (body) =>
                              post(base + "/" + r.id + "/matches", body),
                          });
                        })
                      }
                    >
                      Vincular banco
                    </button>
                  )}
                </>
              )}
              {page === "collections" && (
                <button
                  onClick={() =>
                    run(async () =>
                      setDetail({
                        title: "Aplicaciones del cobro",
                        rows: await all(base + "/" + r.id + "/allocations"),
                        columns: [
                          "receivable_id",
                          "amount",
                          "status",
                          "created_at",
                          "reason",
                        ],
                        kind: "allocations",
                      }),
                    )
                  }
                >
                  Aplicaciones
                </button>
              )}
              {["collections", "issued-documents"].includes(page) && (
                <button
                  onClick={() =>
                    setDetail({
                      title: "Documentos cifrados",
                      rows: [],
                      columns: [],
                      kind:
                        page === "collections"
                          ? "collection_support"
                          : "issued_document",
                      id: r.id,
                    })
                  }
                >
                  Archivos
                </button>
              )}
              {["memberships", "lot-receivables"].includes(page) && (
                <button
                  onClick={() =>
                    run(async () => {
                      const list = await all(
                        page === "memberships"
                          ? "/membership-accounts"
                          : "/lot-contracts",
                        { company_id: company },
                      );
                      setDetail({
                        title: "Condiciones comerciales pactadas",
                        rows: list.filter((x) => x.source_id === r.id),
                        columns:
                          page === "memberships"
                            ? [
                                "plan_name",
                                "start_date",
                                "end_date",
                                "periodic_amount",
                                "period_months",
                              ]
                            : [
                                "lot_identifier",
                                "agreed_price",
                                "down_payment",
                                "financed_amount",
                              ],
                      });
                    })
                  }
                >
                  Condiciones
                </button>
              )}
              {["memberships", "lot-receivables"].includes(page) &&
                r.status === "active" &&
                can(
                  page === "memberships"
                    ? "membership.manage"
                    : "lot_receivable.manage",
                ) && (
                  <>
                    {can("receivable_schedule.create") && (
                      <button onClick={() => schedule(r)}>
                        Generar cuotas
                      </button>
                    )}
                    <button
                      onClick={() =>
                        reason("Cerrar origen comercial", (body) =>
                          post("/receivable-sources/" + r.id + "/close", body),
                        )
                      }
                    >
                      Cerrar
                    </button>
                  </>
                )}
              {page === "receivable-schedules" && (
                <>
                  <button
                    onClick={() =>
                      run(async () =>
                        setDetail({
                          title: "Cuotas del cronograma",
                          rows: await all(base + "/" + r.id + "/installments"),
                            columns: [
                              "number",
                              "due_date",
                              "original_amount",
                              "collected_amount",
                              "outstanding_amount",
                              "financial_status",
                              "currency_id",
                          ],
                        }),
                      )
                    }
                  >
                    Ver cuotas
                  </button>
                  {r.status === "active" &&
                    can("receivable_schedule.modify") && (
                      <button onClick={() => schedule(r, true)}>
                        Sustituir
                      </button>
                    )}
                </>
              )}
              {[
                "receivables",
                "collections",
                "receivable-schedules",
                "memberships",
                "lot-receivables",
              ].includes(page) && (
                <button onClick={() => run(() => history(r))}>Historial</button>
              )}
            </>
          )}
        />
      )}
      <div className="pagination">
        <button
          disabled={index === 1 || loading}
          onClick={() => setIndex(index - 1)}
        >
          Anterior
        </button>
        <span>
          {count} registros · página {index}
        </span>
        <button
          disabled={index * 30 >= count || loading}
          onClick={() => setIndex(index + 1)}
        >
          Siguiente
        </button>
      </div>
      {form && (
        <Editor
          key={form.title}
          form={form}
          close={() => setForm(null)}
          done={reload}
        />
      )}
      {detail && (
        <Modal title={detail.title} close={() => setDetail(null)}>
          {detail.id ? (
            <CollectionFiles
              company={company}
              id={detail.id}
              kind={detail.kind!}
              canUpload={can(
                detail.kind === "collection_support"
                  ? "collection.create"
                  : "receivable.create",
              )}
            />
          ) : (
            <DataTable
              rows={detail.rows}
              columns={detail.columns}
              opts={opts}
              actions={
                detail.kind === "allocations" && can("collection.reverse")
                  ? (r) =>
                      r.status === "valid" && (
                        <button
                          onClick={() => {
                            setDetail(null);
                            reason("Revertir aplicación", (body, key) =>
                              post(
                                "/collection-allocations/" + r.id + "/unapply",
                                body,
                                key,
                              ),
                            );
                          }}
                        >
                          Revertir aplicación
                        </button>
                      )
                  : undefined
              }
            />
          )}
        </Modal>
      )}
    </section>
  );
}
function CollectionFiles({
  company,
  id,
  kind,
  canUpload,
}: {
  company: string;
  id: string;
  kind: string;
  canUpload: boolean;
}) {
  const [files, setFiles] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () =>
    api(
      "/receivable-attachments" + query({ entity_type: kind, entity_id: id }),
    ).then((x) => setFiles(x.data));
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [id, kind]);
  return (
    <div>
      <p>Archivos privados cifrados. PDF, XML o imagen; máximo 5 MB.</p>
      <ErrorBox error={error} />
      {canUpload && (
        <input
          aria-label="Adjuntar documento"
          type="file"
          accept=".pdf,.xml,.png,.jpg,.jpeg"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setError("");
            try {
              if (file.size > 5242880) throw new Error("Máximo 5 MB");
              const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () =>
                  resolve(String(reader.result).split(",")[1]!);
                reader.onerror = reject;
                reader.readAsDataURL(file);
              });
              await api("/attachments/upload", "POST", {
                company_id: company,
                entity_type: kind,
                entity_id: id,
                filename: file.name,
                mime_type: file.name.toLowerCase().endsWith(".xml")
                  ? "application/xml"
                  : file.type,
                base64,
              });
              await load();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      <ul>
        {files.map((f) => (
          <li key={f.id}>
            {f.filename} · {f.status}
            <button
              onClick={async () => {
                try {
                  const file = await api("/attachments/" + f.id + "/download");
                  const url = URL.createObjectURL(
                    new Blob(
                      [
                        Uint8Array.from(atob(file.base64), (c) =>
                          c.charCodeAt(0),
                        ),
                      ],
                      { type: "application/octet-stream" },
                    ),
                  );
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = f.filename;
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Descargar
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
export function ReceivableDashboard({
  company,
  creditsOnly = false,
}: {
  company: string;
  creditsOnly?: boolean;
}) {
  const [data, setData] = useState<Row | null>(null),
    [opts, setOpts] = useState<Row>({}),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    Promise.all([
      api(
        "/receivable-context/dashboard" +
          query({ company_id: company, as_of: today() }),
      ),
      api("/receivable-context/options" + query({ company_id: company })),
    ])
      .then(([d, o]) => {
        if (active) {
          setData(d);
          setOpts(o);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [company]);
  const sections: Record<string, { title: string; columns: string[] }> =
    creditsOnly
      ? {
          credits: {
            title: "Saldos a favor por cliente",
            columns: ["customer_id", "currency_id", "unapplied_amount"],
          },
        }
      : {
          portfolio: {
            title: "Cartera por moneda",
            columns: [
              "currency_id",
              "outstanding_amount",
              "overdue_amount",
              "upcoming_amount",
              "overdue_customers",
            ],
          },
          aging: {
            title: "Antigüedad de saldos pendientes",
            columns: ["currency_id", "bucket", "amount"],
          },
          due_soon: {
            title: "Próximos 30 días · hasta 100 obligaciones",
            columns: [
              "receivable_number",
              "customer_id",
              "due_date",
              "currency_id",
              "outstanding_amount",
            ],
          },
          collections: {
            title: "Cobros por fecha y estado",
            columns: [
              "collection_date",
              "currency_id",
              "financial_status",
              "amount",
              "applied_amount",
              "unapplied_amount",
            ],
          },
          credits: {
            title: "Saldos a favor",
            columns: ["customer_id", "currency_id", "unapplied_amount"],
          },
          customer_portfolio: {
            title: "Obligaciones por cliente y origen",
            columns: [
              "customer_id",
              "source_type",
              "source_id",
              "currency_id",
              "outstanding_amount",
            ],
          },
        };
  return (
    <section>
      <h1>
        {creditsOnly ? "Saldos a favor" : "Cobranzas · cartera y vencimientos"}
      </h1>
      <p>
        Importes derivados de obligaciones y aplicaciones vigentes. Los ingresos
        bancarios se consultan por separado en Cash Flow.
      </p>
      <ErrorBox error={error} />
      {!data && !error ? (
        <p>Cargando datos…</p>
      ) : (
        data &&
        Object.entries(sections).map(([key, s]) => (
          <section key={key}>
            <h2>{s.title}</h2>
            <DataTable rows={data[key] ?? []} columns={s.columns} opts={opts} />
          </section>
        ))
      )}
    </section>
  );
}
