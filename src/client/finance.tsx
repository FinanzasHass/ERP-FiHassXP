import React, { useEffect, useState } from "react";
import { all, api, query, type Row } from "./api";
import { Empty, ErrorBox, Modal } from "./components";
type Field = {
  key: string;
  label: string;
  source?: string;
  options?: string[];
  type?: string;
  required?: boolean;
};
type Definition = {
  title: string;
  kind: string;
  endpoint: string;
  permission: string;
  fields: Field[];
  columns: string[];
};
const f = (key: string, label: string, extra: Partial<Field> = {}): Field => ({
  key,
  label,
  required: true,
  ...extra,
});
const ref = (key: string, label: string, source: string, required = true) =>
  f(key, label, { source, required });
const source = [
  ref("request_id", "Solicitud aprobada", "requests"),
  ref("supplier_id", "Proveedor", "suppliers"),
  ref("order_id", "Orden · opcional", "orders", false),
];
export const financePages: Record<string, Definition> = {
  requests: {
    title: "Solicitudes",
    kind: "request",
    endpoint: "financial-requests",
    permission: "request",
    columns: [
      "request_number",
      "description",
      "estimated_amount",
      "currency_id",
      "status",
    ],
    fields: [
      f("request_type", "Tipo", {
        options: ["purchase", "service", "direct_payment", "other"],
      }),
      ref("cost_center_id", "Centro de costo", "cost_centers"),
      ref("project_id", "Proyecto", "projects", false),
      ref("subproject_id", "Subproyecto", "subprojects", false),
      ref("currency_id", "Moneda", "currencies"),
      f("description", "Descripción", { type: "textarea" }),
      f("justification", "Justificación", { type: "textarea" }),
      f("required_date", "Fecha requerida", { type: "date" }),
      f("priority", "Prioridad", {
        options: ["low", "normal", "high", "urgent"],
      }),
      ref("supplier_id", "Proveedor · opcional", "suppliers", false),
      f("payment_modality", "Modalidad de pago", {
        options: [
          "advance",
          "cash",
          "credit",
          "against_invoice",
          "against_delivery",
          "custom",
        ],
      }),
    ],
  },
  suppliers: {
    title: "Proveedores",
    kind: "supplier",
    endpoint: "suppliers",
    permission: "supplier",
    columns: ["legal_name", "tax_id", "status"],
    fields: [
      f("country_code", "País ISO"),
      f("tax_id_type", "Tipo de identificación", {
        options: ["ruc", "dni", "foreign", "other"],
      }),
      f("tax_id", "Identificación fiscal"),
      f("legal_name", "Razón social"),
      f("trade_name", "Nombre comercial", { required: false }),
      f("address", "Dirección", { required: false }),
      f("phone", "Teléfono", { required: false }),
      f("email", "Correo", { type: "email", required: false }),
      f("reuse_identity", "Vincular identidad legal existente", {
        type: "checkbox",
        required: false,
      }),
    ],
  },
  "supplier-contacts": {
    title: "Contactos de proveedor",
    kind: "supplier_contact",
    endpoint: "supplier-contacts",
    permission: "supplier",
    columns: ["supplier_id", "name", "phone", "email"],
    fields: [
      ref("supplier_id", "Proveedor", "suppliers"),
      f("name", "Nombre"),
      f("phone", "Teléfono", { required: false }),
      f("email", "Correo", { type: "email", required: false }),
    ],
  },
  "bank-changes": {
    title: "Cambios de cuentas bancarias",
    kind: "bank_change",
    endpoint: "bank-changes",
    permission: "supplier",
    columns: ["supplier_id", "reason", "status", "created_at"],
    fields: [
      ref("supplier_id", "Proveedor", "suppliers"),
      ref("account_id", "Cuenta a sustituir · opcional", "accounts", false),
      f("reason", "Motivo y verificación del titular", { type: "textarea" }),
      f("bank_name", "Banco"),
      ref("currency_id", "Moneda", "currencies"),
      f("account_number", "Número de cuenta"),
      f("cci", "CCI de 20 dígitos", { required: false }),
      f("account_type", "Tipo de cuenta", {
        options: ["checking", "savings", "other"],
      }),
      f("is_primary", "Cuenta principal", {
        type: "checkbox",
        required: false,
      }),
    ],
  },
  "purchase-orders": {
    title: "Órdenes de compra / servicio",
    kind: "purchase_order",
    endpoint: "purchase-orders",
    permission: "purchase_order",
    columns: [
      "order_number",
      "description",
      "total_amount",
      "currency_id",
      "status",
    ],
    fields: [
      ...source.filter((x) => x.key !== "order_id"),
      f("order_type", "Tipo de orden", { options: ["purchase", "service"] }),
      f("description", "Descripción", { type: "textarea" }),
      f("requires_acceptance", "Requiere conformidad", {
        type: "checkbox",
        required: false,
      }),
    ],
  },
  "service-acceptances": {
    title: "Conformidades",
    kind: "service_acceptance",
    endpoint: "service-acceptances",
    permission: "service_acceptance",
    columns: ["request_id", "supplier_id", "acceptance_date", "status"],
    fields: [
      ...source,
      f("observations", "Observaciones y evidencias", {
        type: "textarea",
        required: false,
      }),
    ],
  },
  "tax-documents": {
    title: "Comprobantes",
    kind: "tax_document",
    endpoint: "tax-documents",
    permission: "tax_document",
    columns: [
      "series",
      "number",
      "supplier_id",
      "total_amount",
      "currency_id",
      "status",
    ],
    fields: [
      ...source,
      f("document_type", "Tipo de comprobante", {
        options: [
          "invoice",
          "receipt",
          "fee_receipt",
          "credit_note",
          "debit_note",
          "other",
        ],
      }),
      f("series", "Serie"),
      f("number", "Número"),
      f("issue_date", "Fecha de emisión", { type: "date" }),
      f("received_date", "Fecha de recepción", { type: "date" }),
      ref("currency_id", "Moneda", "currencies"),
      f("subtotal", "Base imponible", { type: "number" }),
      f("tax_amount", "Total tributos", { type: "number" }),
      f("non_taxable_amount", "Importe no gravado", { type: "number" }),
    ],
  },
  payables: {
    title: "Cuentas por pagar",
    kind: "payable",
    endpoint: "payables",
    permission: "payable",
    columns: [
      "supplier_id",
      "original_amount",
      "allocated_paid_amount",
      "payment_status",
      "currency_id",
      "due_date",
      "status",
    ],
    fields: [
      ...source,
      ref(
        "tax_document_id",
        "Comprobante revisado · opcional para anticipado",
        "documents",
        false,
      ),
      ref("payment_term_id", "Condición de pago", "payment_terms"),
      f("issue_date", "Fecha de obligación", { type: "date" }),
      f("explicit_due_date", "Vencimiento · si condición de fecha explícita", {
        type: "date",
        required: false,
      }),
      ref(
        "acceptance_id",
        "Conformidad · si base de vencimiento",
        "acceptances",
        false,
      ),
    ],
  },
  "payment-terms": {
    title: "Condiciones de pago",
    kind: "payment_term",
    endpoint: "payment-terms",
    permission: "payment_term",
    columns: ["code", "name", "days", "due_date_basis", "active"],
    fields: [
      f("code", "Código"),
      f("name", "Nombre"),
      f("days", "Días calendario", { type: "number" }),
      f("due_date_basis", "Base de vencimiento", {
        options: [
          "invoice_date",
          "document_received_date",
          "service_acceptance_date",
          "explicit_date",
          "other_future",
        ],
      }),
      f("end_of_month", "Al fin del mes resultante", {
        type: "checkbox",
        required: false,
      }),
      f("active", "Activa", { type: "checkbox", required: false }),
    ],
  },
  "approval-policies": {
    title: "Configuración de aprobaciones",
    kind: "approval_policy",
    endpoint: "approval-policies",
    permission: "approval_policy",
    columns: ["name", "request_type", "prevent_self_approval", "active"],
    fields: [
      f("name", "Nombre"),
      f("request_type", "Tipo de solicitud", {
        options: ["purchase", "service", "direct_payment", "other"],
      }),
      ref("approver_role_id", "Rol aprobador", "roles"),
      f("prevent_self_approval", "Impedir autoaprobación", {
        type: "checkbox",
        required: false,
      }),
      f("active", "Activa", { type: "checkbox", required: false }),
    ],
  },
};
const names: Record<string, string> = {
  request_number: "Solicitud",
  order_number: "Orden",
  description: "Descripción",
  estimated_amount: "Estimado",
  total_amount: "Total",
  allocated_paid_amount: "Pagado aplicado",
  payment_status: "Estado de pago",
  original_amount: "Obligación",
  currency_id: "Moneda",
  status: "Estado",
  legal_name: "Razón social",
  tax_id: "Identificación",
  supplier_id: "Proveedor",
  request_id: "Solicitud",
  acceptance_date: "Fecha conformidad",
  series: "Serie",
  number: "Número",
  due_date: "Vencimiento",
  code: "Código",
  name: "Nombre",
  days: "Días",
  due_date_basis: "Base",
  active: "Activo",
  request_type: "Tipo",
  prevent_self_approval: "Segregación",
  reason: "Motivo",
  created_at: "Fecha",
  phone: "Teléfono",
  email: "Correo",
  count: "Cantidad",
  amount: "Importe",
  area_id: "Área",
  cost_center_id: "CECO",
  project_id: "Proyecto",
  requester_name: "Solicitante",
  area_name: "Área",
  cost_center_name: "CECO",
  project_name: "Proyecto",
  currency_code: "Moneda",
};
const words: Record<string, string> = {
  draft: "Borrador",
  submitted: "Enviada",
  under_review: "En revisión",
  approved: "Aprobada",
  observed: "Observada",
  rejected: "Rechazada",
  cancelled: "Cancelada",
  in_process: "En proceso",
  completed: "Completada",
  pending: "Pendiente",
  pending_approval: "Por aprobar",
  sent: "Enviada",
  in_progress: "En curso",
  partially_received: "Recepción parcial",
  received: "Recibida",
  closed: "Cerrada",
  accepted: "Conforme",
  reviewed: "Revisado",
  on_hold: "Retenida",
  active: "Activo",
  inactive: "Inactivo",
  purchase: "Compra",
  service: "Servicio",
  direct_payment: "Obligación directa",
  other: "Otro",
  advance: "Anticipado a proveedor",
  cash: "Contado",
  credit: "Crédito",
  against_invoice: "Contra factura",
  against_delivery: "Contra entrega",
  custom: "Personalizado",
  low: "Baja",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
  invoice: "Factura",
  receipt: "Boleta",
  fee_receipt: "Recibo por honorarios",
  credit_note: "Nota de crédito",
  debit_note: "Nota de débito",
  invoice_date: "Emisión de comprobante",
  document_received_date: "Recepción de comprobante",
  service_acceptance_date: "Conformidad de servicio",
  explicit_date: "Fecha explícita",
  other_future: "Base futura (sin cálculo)",
  checking: "Corriente",
  savings: "Ahorros",
  ruc: "RUC",
  dni: "DNI",
  foreign: "Extranjero",
};
const label = (s: unknown) =>
  typeof s === "boolean"
    ? s
      ? "Sí"
      : "No"
    : words[String(s)] || String(s ?? "—");
const actionNames: Record<string, string> = {
  submit: "Enviar",
  reopen: "Reabrir y volver a aprobar",
  start_review: "Iniciar revisión",
  approve: "Aprobar",
  observe: "Observar",
  reject: "Rechazar",
  cancel: "Cancelar",
  send: "Marcar enviada",
  start: "Iniciar",
  partial_receive: "Recepción parcial",
  receive: "Recibir",
  close: "Cerrar",
  accept: "Dar conformidad",
  review: "Revisar",
  hold: "Retener",
  disable: "Desactivar",
  enable: "Activar",
  due_date: "Cambiar vencimiento",
};
function actions(
  d: Definition,
  row: Row,
  can: (p: string) => boolean,
  actor: string,
): string[] {
  const s = row.status;
  let a: string[] = [];
  if (d.kind === "request") {
    if (
      row.requester_id === actor &&
      ["draft", "observed"].includes(s) &&
      can("request.submit")
    )
      a.push("submit");
    if (row.requester_id === actor && s === "approved" && can("request.submit"))
      a.push("reopen");
    if (s === "submitted" && can("request.approve")) a.push("start_review");
    if (s === "under_review")
      for (const x of ["approve", "observe", "reject"])
        if (can("request." + x)) a.push(x);
    if (
      ["draft", "submitted", "under_review", "observed", "approved"].includes(
        s,
      ) &&
      can("request.cancel")
    )
      a.push("cancel");
  } else if (d.kind === "purchase_order") {
    const map: Record<string, string[]> = {
      draft: ["submit", "cancel"],
      pending_approval: ["approve", "cancel"],
      approved: ["send", "cancel"],
      sent: ["start", "cancel"],
      in_progress: ["partial_receive", "receive", "cancel"],
      partially_received: ["partial_receive", "receive", "cancel"],
      received: ["close", "cancel"],
    };
    a = (map[s] || []).filter((x) =>
      can("purchase_order." + (x === "approve" || x === "cancel" ? x : "edit")),
    );
  } else if (d.kind === "service_acceptance")
    a = (
      s === "pending"
        ? ["accept", "observe", "reject"]
        : s === "observed"
          ? ["accept", "reject"]
          : []
    ).filter((x) =>
      can("service_acceptance." + (x === "accept" ? "accept" : "observe")),
    );
  else if (d.kind === "tax_document")
    a = (
      s === "draft"
        ? ["review", "observe", "cancel"]
        : s === "observed"
          ? ["review", "cancel"]
          : s === "reviewed"
            ? ["cancel"]
            : []
    ).filter((x) =>
      can("tax_document." + (x === "cancel" ? "cancel" : "review")),
    );
  else if (d.kind === "payable")
    a = (
      s === "draft"
        ? ["review", "hold", "cancel", "due_date"]
        : s === "under_review"
          ? ["approve", "hold", "cancel", "due_date"]
          : s === "approved"
            ? ["hold", "cancel"]
            : s === "on_hold"
              ? ["review", "cancel", "due_date"]
              : []
    ).filter((x) => can("payable." + (x === "due_date" ? "review" : x)));
  else if (d.kind === "bank_change" && s === "pending") {
    if (can("supplier.bank_change_approve") && row.requested_by !== actor)
      a.push("approve", "reject");
    if (can("supplier.bank_change") && row.requested_by === actor)
      a.push("cancel");
  } else if (d.kind === "supplier" && can("supplier.disable"))
    a = [s === "active" ? "disable" : "enable"];
  return a;
}
async function optionsFor(d: Definition, company: string) {
  const options: Record<string, Row[]> = await api(
    "/finance/options" + query({ company_id: company }),
  );
  const sources = new Set(d.fields.map((x) => x.source));
  for (const [key, path, status] of [
    ["requests", "financial-requests", "approved"],
    ["orders", "purchase-orders", ""],
    ["documents", "tax-documents", "reviewed"],
    ["acceptances", "service-acceptances", "accepted"],
    ["accounts", "supplier-bank-accounts", "active"],
  ])
    if (sources.has(key))
      options[key] = (
        await all("/" + path, {
          company_id: company,
          ...(status ? { status } : {}),
        })
      ).map((r) => ({
        ...r,
        name:
          r.request_number ||
          r.order_number ||
          (r.series ? r.series + "-" + r.number : undefined) ||
          r.bank_name ||
          "Conformidad " + r.acceptance_date,
      }));
  return options;
}
function FinancialForm({
  d,
  initial,
  options,
  save,
  close,
}: {
  d: Definition;
  initial: Row;
  options: Record<string, Row[]>;
  save: (data: Row) => Promise<void>;
  close: () => void;
}) {
  const [values, setValues] = useState<Row>({
    country_code: "PE",
    request_type: "purchase",
    payment_modality: "credit",
    priority: "normal",
    days: 0,
    active: true,
    prevent_self_approval: true,
    requires_acceptance: true,
    subtotal: 0,
    tax_amount: 0,
    non_taxable_amount: 0,
    ...initial,
  });
  const [items, setItems] = useState<Row[]>(
    initial.items?.length
      ? initial.items
      : [{ description: "", quantity: 1, unit_price: 0 }],
  );
  const [taxes, setTaxes] = useState<Row[]>(initial.amounts || []),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const hasItems = ["request", "purchase_order"].includes(d.kind);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const payload: Row = {};
          for (const field of d.fields) {
            const value = values[field.key];
            if (value !== undefined && value !== "")
              payload[field.key] =
                field.type === "number" ? Number(value) : value;
            else if (!field.required && initial.id && field.source)
              payload[field.key] = null;
          }
          if (hasItems)
            payload.items = items.map(
              ({ description, quantity, unit_price }) => ({
                description,
                quantity: Number(quantity),
                unit_price: Number(unit_price),
              }),
            );
          if (d.kind === "tax_document" && taxes.length)
            payload.amounts = taxes.map(({ code, name, amount }) => ({
              code,
              name,
              amount: Number(amount),
            }));
          if (d.kind === "bank_change") {
            payload.proposed = {};
            for (const k of [
              "bank_name",
              "currency_id",
              "account_number",
              "cci",
              "account_type",
              "is_primary",
            ]) {
              if (payload[k] !== undefined) payload.proposed[k] = payload[k];
              delete payload[k];
            }
          }
          await save(payload);
          close();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="form-grid">
        {d.fields.map((field) => (
          <label key={field.key}>
            {field.label}
            {field.required ? " *" : ""}
            {field.source || field.options ? (
              <select
                aria-label={field.label + (field.required ? ' *' : '')}
                required={field.required}
                value={values[field.key] ?? ""}
                onChange={(e) =>
                  setValues({
                    ...values,
                    [field.key]: e.target.value,
                    ...(field.key === "project_id"
                      ? { subproject_id: "" }
                      : {}),
                  })
                }
              >
                <option value="">Seleccione…</option>
                {field.source
                  ? (options[field.source] || [])
                      .filter(
                        (r) =>
                          field.key !== "subproject_id" ||
                          r.project_id === values.project_id,
                      )
                      .filter(
                        (r) =>
                          field.key !== "account_id" ||
                          r.supplier_id === values.supplier_id,
                      )
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))
                  : field.options?.map((x) => (
                      <option key={x} value={x}>
                        {label(x)}
                      </option>
                    ))}
              </select>
            ) : field.type === "textarea" ? (
              <textarea
                aria-label={field.label + (field.required ? ' *' : '')}
                required={field.required}
                maxLength={field.key === "justification" ? 4000 : 2000}
                value={values[field.key] ?? ""}
                onChange={(e) =>
                  setValues({ ...values, [field.key]: e.target.value })
                }
              />
            ) : field.type === "checkbox" ? (
              <input
                type="checkbox"
                aria-label={field.label}
                checked={!!values[field.key]}
                onChange={(e) =>
                  setValues({ ...values, [field.key]: e.target.checked })
                }
              />
            ) : (
              <input
                required={field.required}
                aria-label={field.label + (field.required ? ' *' : '')}
                type={field.type || "text"}
                min={field.type === "number" ? 0 : undefined}
                step={field.type === "number" ? "0.01" : undefined}
                value={values[field.key] ?? ""}
                onChange={(e) =>
                  setValues({ ...values, [field.key]: e.target.value })
                }
              />
            )}
          </label>
        ))}
      </div>
      {hasItems && (
        <section>
          <h3>Detalle de ítems</h3>
          {items.map((item, index) => (
            <div className="finance-item" key={index}>
              {["description", "quantity", "unit_price"].map((key, i) => (
                <label key={key}>
                  {["Descripción", "Cantidad", "Precio unitario"][i]}
                  <input
                    required
                    type={i ? "number" : "text"}
                    min={i === 1 ? "0.0001" : "0"}
                    step="0.0001"
                    value={item[key]}
                    onChange={(e) =>
                      setItems(
                        items.map((r, j) =>
                          j === index ? { ...r, [key]: e.target.value } : r,
                        ),
                      )
                    }
                  />
                </label>
              ))}
              <button
                type="button"
                disabled={items.length === 1}
                onClick={() => setItems(items.filter((_, i) => i !== index))}
              >
                Quitar
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={items.length >= 100}
            onClick={() =>
              setItems([
                ...items,
                { description: "", quantity: 1, unit_price: 0 },
              ])
            }
          >
            Añadir ítem
          </button>
          <p>
            Total calculado:{" "}
            <strong>
              {items
                .reduce(
                  (s, r) =>
                    s +
                    Math.round(
                      Number(r.quantity) * Number(r.unit_price) * 100,
                    ) /
                      100,
                  0,
                )
                .toFixed(2)}
            </strong>
          </p>
        </section>
      )}
      {d.kind === "tax_document" && (
        <section>
          <h3>Desglose de tributos · opcional</h3>
          {taxes.map((tax, index) => (
            <div className="finance-item" key={index}>
              {["code", "name", "amount"].map((k) => (
                <label key={k}>
                  {k === "code"
                    ? "Código"
                    : k === "name"
                      ? "Concepto"
                      : "Importe"}
                  <input
                    required
                    type={k === "amount" ? "number" : "text"}
                    step="0.01"
                    min="0"
                    value={tax[k]}
                    onChange={(e) =>
                      setTaxes(
                        taxes.map((r, j) =>
                          j === index ? { ...r, [k]: e.target.value } : r,
                        ),
                      )
                    }
                  />
                </label>
              ))}
              <button
                type="button"
                onClick={() => setTaxes(taxes.filter((_, i) => i !== index))}
              >
                Quitar
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setTaxes([...taxes, { code: "", name: "", amount: 0 }])
            }
          >
            Añadir concepto tributario
          </button>
        </section>
      )}
      <ErrorBox error={error} />
      <footer className="form-actions">
        <button type="button" onClick={close}>
          Cancelar
        </button>
        <button className="primary" disabled={busy}>
          {busy ? "Guardando…" : "Guardar"}
        </button>
      </footer>
    </form>
  );
}
export function FinancePage({
  page,
  company,
  can,
  actor,
}: {
  page: string;
  company: string;
  can: (p: string) => boolean;
  actor: string;
}) {
  const inbox = page === "approvals",
    d = inbox ? financePages.requests! : financePages[page]!;
  const [rows, setRows] = useState<Row[]>([]),
    [options, setOptions] = useState<Record<string, Row[]>>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0),
    [status, setStatus] = useState(""),
    [pageNo, setPageNo] = useState(1),
    [count, setCount] = useState(0),
    [detail, setDetail] = useState<Row | null>(null),
    [editing, setEditing] = useState<Row | null>(null),
    [action, setAction] = useState(""),
    [note, setNote] = useState(""),
    [date, setDate] = useState("");
  useEffect(() => {
    let live = true;
    setBusy(true);
    setError("");
    Promise.all([
      inbox
        ? api("/approvals" + query({ company_id: company }))
        : api(
            "/" +
              d.endpoint +
              query({ company_id: company, status, page: pageNo }),
          ),
      optionsFor(d, company),
    ])
      .then(([result, opts]) => {
        if (live) {
          setRows(
            (inbox ? result : result.data).map((r: Row) => ({
              ...r,
              ...(r.suppliers || {}),
              id: r.id,
            })),
          );
          setCount(inbox ? result.length : result.count);
          setOptions(opts);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [company, d, inbox, status, pageNo, refresh]);
  const display = (key: string, value: unknown) => {
    if (value === null || value === undefined) return "—";
    const optKey: Record<string, string> = {
      currency_id: "currencies",
      supplier_id: "suppliers",
      request_id: "requests",
      project_id: "projects",
      cost_center_id: "cost_centers",
    };
    const source = d.fields.find((f) => f.key === key)?.source || optKey[key];
    if (source)
      return (
        options[source]?.find((r) => r.id === value)?.name ||
        "Referencia del expediente"
      );
    return label(value);
  };
  const open = async (row: Row) => {
    try {
      setError("");
      setDetail(await api("/" + d.endpoint + "/" + row.id));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const createPermission =
    d.kind === "bank_change"
      ? "supplier.bank_change"
      : d.kind === "approval_policy"
        ? "approval_policy.manage"
        : d.kind === "supplier_contact"
          ? "supplier.edit"
          : d.permission + ".create";
  const editable =
    detail &&
    (d.kind === "request"
      ? detail.record.requester_id === actor &&
        ["draft", "observed"].includes(detail.record.status) &&
        can("request.edit_own")
      : ["bank_change", "payable", "service_acceptance"].includes(d.kind)
        ? false
        : can(
            d.kind === "approval_policy"
              ? "approval_policy.manage"
              : d.permission + ".edit",
          ) &&
          (!detail.record.status ||
            ["draft", "observed", "active", "inactive"].includes(
              detail.record.status,
            )));
  if (!company) return <Empty text="Seleccione una empresa" />;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {inbox ? "BANDEJA" : "OPERACIÓN EMPRESARIAL"}
          </p>
          <h1>{inbox ? "Pendientes de aprobación" : d.title}</h1>
          <p>
            Información de la empresa activa. Cada cambio conserva su
            trazabilidad.
          </p>
        </div>
        {!inbox && can(createPermission) && (
          <button className="primary" onClick={() => setEditing({})}>
            Nuevo registro
          </button>
        )}
      </div>
      <ErrorBox error={error} />
      <div className="toolbar">
        {!inbox &&
          !["payment_term", "approval_policy", "supplier_contact"].includes(
            d.kind,
          ) && (
            <label>
              Estado
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPageNo(1);
                }}
              >
                <option value="">Todos</option>
                {Array.from(
                  new Set([
                    "draft",
                    "submitted",
                    "under_review",
                    "approved",
                    "observed",
                    "rejected",
                    "cancelled",
                    "pending",
                    "active",
                    "inactive",
                    "reviewed",
                    "on_hold",
                    "accepted",
                  ]),
                ).map((s) => (
                  <option key={s} value={s}>
                    {label(s)}
                  </option>
                ))}
              </select>
            </label>
          )}
        <button onClick={() => setRefresh((x) => x + 1)}>Actualizar</button>
        <span>{count} registros</span>
      </div>
      {busy ? (
        <p role="status">Cargando operaciones…</p>
      ) : !rows.length ? (
        <Empty text="No hay registros visibles con sus permisos y filtros" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {(inbox
                  ? [
                      "request_number",
                      "requester_name",
                      "area_name",
                      "cost_center_name",
                      "project_name",
                      "description",
                      "estimated_amount",
                      "currency_code",
                      "required_date",
                      "status",
                    ]
                  : d.columns
                ).map((k) => (
                  <th key={k}>{names[k] || k}</th>
                ))}
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {(inbox
                    ? [
                        "request_number",
                        "requester_name",
                        "area_name",
                        "cost_center_name",
                        "project_name",
                        "description",
                        "estimated_amount",
                        "currency_code",
                        "required_date",
                        "status",
                      ]
                    : d.columns
                  ).map((k) => (
                    <td key={k}>
                      {k === "status" ? (
                        <span className="badge">{label(row[k])}</span>
                      ) : (
                        display(k, row[k])
                      )}
                    </td>
                  ))}
                  <td>
                    <button onClick={() => open(row)}>Ver expediente</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!inbox && (
        <div className="pagination">
          <button
            disabled={pageNo === 1}
            onClick={() => setPageNo((x) => x - 1)}
          >
            Anterior
          </button>
          <span>Página {pageNo}</span>
          <button
            disabled={pageNo * 30 >= count}
            onClick={() => setPageNo((x) => x + 1)}
          >
            Siguiente
          </button>
        </div>
      )}
      {editing && (
        <Modal
          title={editing.id ? "Editar " + d.title : "Nuevo · " + d.title}
          close={() => setEditing(null)}
        >
          <FinancialForm
            d={d}
            options={options}
            initial={editing}
            close={() => setEditing(null)}
            save={async (payload) => {
              await api(
                "/" +
                  d.endpoint +
                  (editing.id ? "/" + editing.id : "") +
                  query({ company_id: company }),
                editing.id ? "PATCH" : "POST",
                payload,
              );
              setDetail(null);
              setRefresh((x) => x + 1);
            }}
          />
        </Modal>
      )}
      {detail && !editing && (
        <Modal
          title={
            detail.record.request_number ||
            detail.record.order_number ||
            d.title
          }
          close={() => {
            setDetail(null);
            setAction("");
          }}
        >
          <div className="finance-detail">
            <span className="badge">{label(detail.record.status)}</span>
            <dl>
              {d.fields
                .filter((f) => f.type !== "checkbox")
                .map((f) => (
                  <div key={f.key}>
                    <dt>{f.label}</dt>
                    <dd>
                      {display(
                        f.key,
                        detail.record[f.key] ??
                          detail.record.suppliers?.[f.key],
                      )}
                    </dd>
                  </div>
                ))}
            </dl>
            {detail.items?.length > 0 && (
              <>
                <h3>Ítems</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Descripción</th>
                      <th>Cantidad</th>
                      <th>Precio</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((i: Row) => (
                      <tr key={i.id}>
                        <td>{i.description}</td>
                        <td>{i.quantity}</td>
                        <td>{i.unit_price}</td>
                        <td>{i.amount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {d.kind === "payable" && (
              <p>
                Obligación: {detail.record.original_amount} · Saldo:{" "}
                {detail.record.outstanding_amount} · Vencimiento:{" "}
                {detail.record.due_date}
              </p>
            )}
            {d.kind === "bank_change" && (
              <dl>
                {Object.entries(detail.record.proposed || {}).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{label(v)}</dd>
                  </div>
                ))}
              </dl>
            )}
            <div className="form-actions">
              {editable && (
                <button
                  onClick={() =>
                    setEditing({
                      ...detail.record,
                      ...detail.record.suppliers,
                      id: detail.record.id,
                      items: detail.items,
                      amounts: detail.amounts,
                    })
                  }
                >
                  Editar borrador / metadata
                </button>
              )}
              {actions(d, detail.record, can, actor).map((a) => (
                <button
                  key={a}
                  onClick={() => {
                    setAction(a);
                    setNote("");
                  }}
                >
                  {actionNames[a]}
                </button>
              ))}
            </div>
            {action && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  try {
                    if (action === "due_date")
                      await api(
                        "/payables/" + detail.record.id + "/due-date",
                        "PATCH",
                        { new_date: date, reason: note },
                      );
                    else
                      await api(
                        "/" + d.endpoint + "/" + detail.record.id + "/actions",
                        "POST",
                        { action, comment: note },
                      );
                    setDetail(null);
                    setAction("");
                    setRefresh((x) => x + 1);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <h3>{actionNames[action]}</h3>
                {action === "due_date" && (
                  <label>
                    Nueva fecha
                    <input
                      required
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </label>
                )}
                <label>
                  Comentario / motivo obligatorio
                  <textarea
                    required
                    maxLength={2000}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                <ErrorBox error={error} />
                <button className="primary" disabled={busy}>
                  Confirmar acción
                </button>
              </form>
            )}
            {detail.history && (
              <>
                <h3>Historial de versiones</h3>
                <ol>
                  {[...detail.history]
                    .sort((a, b) => a.created_at.localeCompare(b.created_at))
                    .map((h: Row) => (
                      <li key={h.id}>
                        <strong>
                          v{h.version} · {actionNames[h.action] || h.action}
                        </strong>{" "}
                        · {label(h.previous_state)} → {label(h.new_state)}
                        <p>
                          {h.comment || "Registro de contenido"} ·{" "}
                          {new Date(h.created_at).toLocaleString("es-PE")}
                        </p>
                        <details>
                          <summary>Contenido conservado</summary>
                          <p>{h.snapshot.description}</p>
                          <p>{h.snapshot.justification}</p>
                          <p>
                            Estimado: {h.snapshot.estimated_amount} · CECO:{" "}
                            {(h.snapshot.dimension_snapshot?.cost_centers || [])
                              .map((c: Row) => c.code + " " + c.name)
                              .join(" / ")}
                          </p>
                          <ul>
                            {(h.snapshot.items || []).map((i: Row) => (
                              <li key={i.id}>
                                {i.description} · {i.quantity} × {i.unit_price}{" "}
                                = {i.amount}
                              </li>
                            ))}
                          </ul>
                        </details>
                      </li>
                    ))}
                </ol>
              </>
            )}
            {[
              "request",
              "purchase_order",
              "service_acceptance",
              "tax_document",
              "payable",
              "bank_change",
            ].includes(d.kind) && (
              <Attachments
                detail={detail}
                d={d}
                company={company}
                onChange={() => open(detail.record)}
              />
            )}
            {d.kind === "supplier" && can("supplier.bank_view") && (
              <SupplierAccounts
                supplier={detail.record.supplier_id}
                company={company}
              />
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
function SupplierAccounts({
  supplier,
  company,
}: {
  supplier: string;
  company: string;
}) {
  const [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    all("/supplier-bank-accounts", {
      company_id: company,
      supplier_id: supplier,
    })
      .then((r) => {
        if (live) setRows(r);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [supplier, company]);
  return (
    <section>
      <h3>Cuentas bancarias aprobadas</h3>
      <ErrorBox error={error} />
      {!rows.length ? (
        <Empty text="Sin cuentas aprobadas" />
      ) : (
        rows.map((r) => (
          <p key={r.id}>
            {r.bank_name} · {r.account_number} · CCI {r.cci || "—"} ·{" "}
            {label(r.status)}
          </p>
        ))
      )}
    </section>
  );
}
function Attachments({
  detail,
  d,
  company,
  onChange,
}: {
  detail: Row;
  d: Definition;
  company: string;
  onChange: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section>
      <h3>Documentos y evidencias</h3>
      <ErrorBox error={error} />
      <p>PDF, XML, PNG o JPEG · máximo 5 MB por archivo.</p>
      <input
        aria-label="Adjuntar evidencia"
        type="file"
        accept=".pdf,.xml,.png,.jpg,.jpeg"
        disabled={busy}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setError("");
          setBusy(true);
          try {
            if (file.size > 5242880) throw new Error("El máximo es 5 MB.");
            const base64 = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve(String(reader.result).split(",")[1]!);
              reader.onerror = reject;
              reader.readAsDataURL(file);
            });
            await api("/attachments/upload", "POST", {
              company_id: company,
              entity_type:
                d.kind === "bank_change" ? "supplier_bank_change" : d.kind,
              entity_id: detail.record.id,
              filename: file.name,
              mime_type: file.name.toLowerCase().endsWith(".xml")
                ? "application/xml"
                : file.type,
              base64,
            });
            onChange();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
      {(detail.attachments || []).map((a: Row) => (
        <p key={a.id}>
          {a.filename} · {a.size} bytes ·{" "}
          {a.status === "ready" ? "Disponible" : "Carga pendiente"}{" "}
          {a.status === "ready" && (
            <button
              onClick={async () => {
                try {
                  const file = await api("/attachments/" + a.id + "/download");
                  const bytes = Uint8Array.from(atob(file.base64), (c) =>
                    c.charCodeAt(0),
                  );
                  const url = URL.createObjectURL(
                    new Blob([bytes], { type: "application/octet-stream" }),
                  );
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = file.filename;
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Descargar
            </button>
          )}
        </p>
      ))}
    </section>
  );
}
export function FinancialDashboard({
  company,
  can,
  reports = false,
}: {
  company: string;
  can: (p: string) => boolean;
  reports?: boolean;
}) {
  const [data, setData] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [lookups,setLookups]=useState<Record<string,Row[]>>({});
  useEffect(() => {
    let live = true;
    if (!company) return;
    api("/finance/reports" + query({ company_id: company }))
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    if(reports)api('/finance/options'+query({company_id:company})).then(async opts=>{
      if(can('area.view'))opts.areas=await all('/areas');
      if(live)setLookups(opts);
    }).catch(()=>{});
    return () => {
      live = false;
    };
  }, [company,reports]);
  const reportValue=(key:string,value:unknown,row:Row)=>{
    if(value===null||value===undefined)return '—';
    if(key==='currency_id')return lookups.currencies?.find(x=>x.id===value)?.name||'Moneda '+String(value).slice(0,8);
    if(key==='area_id')return lookups.areas?.find(x=>x.id===value)?.name||'Área '+String(value).slice(0,8);
    if(key==='project_id')return row.history?.name||lookups.projects?.find(x=>x.id===value)?.name||'Proyecto';
    if(key==='cost_center_id')return row.history?.at(-1)?.name||lookups.cost_centers?.find(x=>x.id===value)?.name||'CECO';
    return label(value);
  };
  return (
    <>
      <ErrorBox error={error} />
      <div className="section-heading">
        <h2>{reports ? "Reportes operativos" : "Control operativo"}</h2>
        <span>Datos visibles según sus permisos</span>
      </div>
      <div className="dashboard-grid">
        {[
          [
            "Solicitudes pendientes",
            "pending_requests",
            ["request.view_own", "request.view_area", "request.view_company"],
          ],
          [
            "Por aprobar",
            "pending_approvals",
            ["request.approve", "request.observe", "request.reject"],
          ],
          [
            "Comprobantes observados",
            "observed_documents",
            ["tax_document.view"],
          ],
          [
            "CxP vencidas / próximos 7 días",
            "payables_due_soon",
            ["payable.view"],
          ],
        ].map(([title, key, permissions]) => (
          <section className="metric" key={String(key)}>
            <h3>{String(title)}</h3>
            <strong className="finance-number">
              {(permissions as string[]).some(can)
                ? data
                  ? String(data[String(key)])
                  : "…"
                : "Sin acceso"}
            </strong>
          </section>
        ))}
      </div>
      {reports &&
        data &&
        [
          ["Solicitudes por estado", "requests_by_status"],
          ["Solicitudes por área", "requests_by_area"],
          ["CxP por vencimiento", "payables_by_due_date"],
          ["Obligaciones por CECO", "obligations_by_cost_center"],
          ["Obligaciones por proyecto", "obligations_by_project"],
        ].map(([title, key]) => (
          <section className="panel" key={key}>
            <h3>{title}</h3>
            {!data[key!]?.length ? (
              <Empty />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {Object.keys(data[key!][0]).map((k) => (
                        <th key={k}>{names[k] || k}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data[key!].map((r: Row, i: number) => (
                      <tr key={i}>
                        {Object.entries(r).map(([k, v]) => (
                          <td key={k}>
                            {k === "history"
                              ? Array.isArray(v)
                                ? v.map((x) => x.name).join(" / ")
                                : (v as Row)?.name || "—"
                              : reportValue(k,v,r)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}
    </>
  );
}
