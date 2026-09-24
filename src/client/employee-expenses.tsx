import { settlementPresentation } from "./settlement-presentation";
import {AccountingTraceLink} from './accounting-trace';
import React, { useEffect, useRef, useState } from "react";
import { api, all, query, type Row } from "./api";
import { Modal, ErrorBox, Empty } from "./components";
type Field = [string, string, string?, boolean?];
type FormState = {
  title: string;
  fields: Field[];
  values: Row;
  submit: (data: Row) => Promise<void>;
  travel?: boolean;
};
export const expensePages: Record<
  string,
  { title: string; permissions: string[]; columns: string[] }
> = {
  "travel-expenses": {
    title: "Solicitudes de viáticos",
    permissions: ["travel_expense.view_own", "travel_expense.view_company"],
    columns: [
      "request_number",
      "employee_id",
      "destination",
      "estimated_amount",
      "requested_advance_amount",
      "currency_id",
      "status",
    ],
  },
  "expense-reports": {
    title: "Rendiciones",
    permissions: ["expense_report.view_own", "expense_report.view_company"],
    columns: [
      "report_number",
      "employee_id",
      "total_reported",
      "total_accepted",
      "total_rejected",
      "currency_id",
      "status",
    ],
  },
  "employee-advances": {
    title: "Anticipos",
    permissions: ["employee_advance.view"],
    columns: [
      "employee_id",
      "approved_amount",
      "paid_amount",
      "outstanding_to_render",
      "currency_id",
      "status",
    ],
  },
  "expense-declarations": {
    title: "Declaraciones juradas",
    permissions: [
      "declaration.view",
      "expense_report.view_own",
      "expense_report.view_company",
    ],
    columns: ["declared_on", "reason", "amount", "status"],
  },
  "employee-returns": {
    title: "Devoluciones",
    permissions: ["employee_return.view"],
    columns: [
      "employee_id",
      "return_date",
      "reference",
      "amount",
      "currency_id",
      "status",
    ],
  },
  "employee-reimbursements": {
    title: "Reembolsos",
    permissions: ["employee_reimbursement.view"],
    columns: [
      "employee_id",
      "approved_amount",
      "paid_amount",
      "currency_id",
      "status",
    ],
  },
};
const labels: Row = {
  request_number: "Solicitud",
  report_number: "Rendición",
  employee_id: "Colaborador",
  destination: "Destino",
  purpose: "Motivo",
  estimated_amount: "Presupuesto",
  requested_advance_amount: "Anticipo solicitado",
  currency_id: "Moneda",
  status: "Estado",
  total_reported: "Reportado",
  total_accepted: "Aceptado",
  total_rejected: "Rechazado",
  approved_amount: "Aprobado",
  paid_amount: "Pagado",
  outstanding_to_render: "Por rendir",
  declared_on: "Fecha DJ",
  reason: "Motivo",
  amount: "Importe",
  return_date: "Fecha devolución",
  reference: "Referencia",
  draft: "Borrador",
  submitted: "Enviada",
  under_review: "En revisión",
  approved: "Aprobada",
  observed: "Observada",
  rejected: "Rechazada",
  settlement_pending: "Liquidación pendiente",
  settled: "Liquidada",
  cancelled: "Cancelada",
  pending: "Pendiente",
  accepted: "Aceptada",
  registered: "Registrada",
  matched: "Vinculada",
  reconciled: "Conciliada",
  paid: "Pagado",
  partially_paid: "Pago parcial",
  submit: "Enviar",
  approve: "Aprobar",
  observe: "Observar",
  reject: "Rechazar",
  close: "Liquidar",
  reopen: "Reabrir",
  cancel: "Cancelar",
  advance_paid: "Anticipo entregado",
  accepted_expenses: "Gasto aceptado",
  return_outstanding: "Por devolver",
  reimbursement_outstanding: "Por reembolsar",
  return_due: "Devolución calculada",
  reimbursement_due: "Reembolso calculado",
  cost_center_id: "CECO",
  project_id: "Proyecto",
  subproject_id: "Subproyecto",
  category_id: "Categoría",
  expense_date: "Fecha",
  description: "Descripción",
  reported_amount: "Importe reportado",
  accepted_amount: "Importe aceptado",
  rejected_amount: "Importe rechazado",
  decision_reason: "Motivo de revisión",
  created_at: "Registrado",
  quantity: "Cantidad",
  reported: "Reportado",
  delivered: "Entregado",
  outstanding: "Por rendir",
  period: "Periodo",
  employee_return_due: "Devolución calculada",
  employee_reimbursement_due: "Reembolso calculado",
  report_id: "Expediente",
  version: "Versión",
  start_date: "Inicio",
  end_date: "Fin",
};
const dimensions: Field[] = [
  ["cost_center_id", "CECO", "cost_centers"],
  ["project_id", "Proyecto", "projects", false],
  ["subproject_id", "Subproyecto", "subprojects", false],
];
const itemFields: Field[] = [
  ["expense_date", "Fecha del gasto", "date"],
  ["category_id", "Categoría", "categories"],
  ["description", "Descripción"],
  ["reported_amount", "Importe reportado", "number"],
  ["support_type", "Sustento", "supports"],
  ...dimensions,
];
const sources: Row = {
  employee_id: "employees",
  currency_id: "currencies",
  category_id: "categories",
  cost_center_id: "cost_centers",
  project_id: "projects",
  subproject_id: "subprojects",
};
function value(key: string, v: any, opts: Row) {
  if (v === null || v === undefined) return "—";
  return (
    opts[sources[key]]?.find((x: Row) => x.id === v)?.name ??
    labels[v] ??
    String(v)
  );
}
function FieldControl({
  field,
  data,
  set,
  opts,
}: {
  field: Field;
  data: Row;
  set: (key: string, v: any) => void;
  opts: Row;
}) {
  const [key, label, type = "text", required = true] = field;
  return (
    <label>
      {label}
      {required ? " *" : ""}
      {["text", "number", "date"].includes(type) ? (
        <input
          aria-label={label}
          type={type}
          step={type === "number" ? ".01" : undefined}
          min={type === "number" ? 0 : undefined}
          required={required}
          value={data[key] ?? ""}
          onChange={(e) =>
            set(
              key,
              type === "number" && e.target.value !== ""
                ? Number(e.target.value)
                : e.target.value,
            )
          }
        />
      ) : (
        <select
          aria-label={label}
          required={required}
          value={data[key] ?? ""}
          onChange={(e) => set(key, e.target.value)}
        >
          <option value="">Seleccione</option>
          {(opts[type] ?? [])
            .filter(
              (x: Row) =>
                type !== "subprojects" || x.project_id === data.project_id,
            )
            .map((x: Row) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
        </select>
      )}
    </label>
  );
}
function Printable({
  title,
  record,
  items,
  settlement,
  opts,
}: {
  title: string;
  record: Row;
  items: Row[];
  settlement?: Row;
  opts: Row;
}) {
  if (record.original_values?.item) {
    const original = record.original_values;
    record = {
      ...record,
      employee_id: original.employee_id,
      currency_id: original.item.currency_id,
    };
    items = [original.item];
    const employee = original.item.dimension_snapshot?.employee;
    if (employee?.full_name)
      opts = {
        ...opts,
        employees: [
          { id: original.employee_id, name: employee.full_name },
          ...(opts.employees ?? []),
        ],
      };
  }
  const historicalCenter = (item: Row) => {
    const center = item.dimension_snapshot?.cost_centers?.find(
      (row: Row) => row.id === item.cost_center_id,
    );
    return center
      ? `${center.code} · ${center.name}`
      : value("cost_center_id", item.cost_center_id, opts);
  };
  return (
    <button
      onClick={() => {
        const escape = (v: any) =>
          String(v ?? "—").replace(
            /[&<>"']/g,
            (c) =>
              ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
              })[c]!,
          );
        const fields = Object.keys(record).filter(
          (k) => labels[k] && !["account_number", "cci"].includes(k),
        );
        const html = `<!doctype html><html lang="es"><meta charset="utf-8"><title>${escape(title)}</title><style>body{font:12pt sans-serif;margin:24mm;color:#172b3a}h1{font-size:22pt}table{border-collapse:collapse;width:100%;margin:20px 0}td,th{border:1px solid #bbb;padding:7px;text-align:left}footer{font-size:9pt;color:#555}tr{break-inside:avoid}</style><h1>${escape(title)}</h1><p>${escape(record.report_number ?? record.request_number ?? "Declaración jurada")} · Versión ${escape(record.version ?? 1)}</p><table>${fields.map((k) => `<tr><th>${escape(labels[k])}</th><td>${escape(value(k, record[k], opts))}</td></tr>`).join("")}</table>${items.length ? `<h2>Partidas</h2><table><tr><th>Concepto</th><th>CECO</th><th>Reportado / estimado</th><th>Aceptado</th><th>Rechazado</th></tr>${items.map((i) => `<tr><td>${escape(i.description)}</td><td>${escape(historicalCenter(i))}</td><td>${escape(i.reported_amount ?? i.estimated_amount)}</td><td>${escape(i.accepted_amount)}</td><td>${escape(i.rejected_amount)}</td></tr>`).join("")}</table>` : ""}${settlement ? `<h2>Liquidación</h2><table>${settlementPresentation(settlement).map(([label, amount]) => `<tr><th>${escape(label)}</th><td>${escape(amount)} ${escape(value("currency_id", record.currency_id, opts))}</td></tr>`).join("")}</table>` : ""}<footer>Representación del expediente ERP · ${escape(new Date().toLocaleString("es-PE"))}. La fuente de verdad es el expediente y su historial.</footer></html>`;
        const win = window.open("", "_blank");
        if (win) {
          win.document.write(html);
          win.document.close();
          win.focus();
          win.print();
        }
      }}
    >
      Imprimir / guardar PDF
    </button>
  );
}
export function ExpenseHistory({ path, id }: { path: string; id: string }) {
  const [page, setPage] = useState(1),
    [result, setResult] = useState<Row>({ data: [], count: 0 }),
    [error, setError] = useState("");
  useEffect(() => {
    setError("");
    api(`/${path}/${id}/history` + query({ page, limit: 20 }))
      .then(setResult)
      .catch((e) => setError(e.message));
  }, [path, id, page]);
  return (
    <section>
      <h3>Historial</h3>
      <ErrorBox error={error} />
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Acción</th>
            <th>Versión</th>
            <th>Motivo</th>
          </tr>
        </thead>
        <tbody>
          {result.data.map((h: Row) => (
            <tr key={h.id}>
              <td>{new Date(h.created_at).toLocaleString("es-PE")}</td>
              <td>{labels[h.action] ?? h.action}</td>
              <td>{h.version ?? h.request_version}</td>
              <td>{h.reason ?? h.comment ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pagination">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          Anterior
        </button>
        <span>
          Página {page} · {result.count} eventos
        </span>
        <button
          disabled={page * 20 >= result.count}
          onClick={() => setPage(page + 1)}
        >
          Siguiente
        </button>
      </div>
    </section>
  );
}
function ExpenseFiles({
  kind,
  id,
  company,
  editable,
}: {
  kind: string;
  id: string;
  company: string;
  editable: boolean;
}) {
  const [files, setFiles] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () =>
    api(
      "/expense-attachments" + query({ entity_type: kind, entity_id: id }),
    ).then((x) => setFiles(x.data));
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [kind, id]);
  return (
    <section>
      <h4>Evidencias cifradas</h4>
      <ErrorBox error={error} />
      {editable && (
        <input
          aria-label="Adjuntar sustento"
          type="file"
          accept=".pdf,.xml,.png,.jpg,.jpeg"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setError("");
            try {
              if (file.size > 5242880)
                throw new Error("Máximo 5 MB por archivo");
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
      <p>PDF, XML, PNG o JPEG · máximo 5 MB.</p>
      {files.map((a) => (
        <p key={a.id}>
          {a.filename} · {a.status === "ready" ? "Disponible" : "Pendiente"}{" "}
          {a.status === "ready" && (
            <button
              onClick={async () => {
                try {
                  const file = await api(`/attachments/${a.id}/download`),
                    url = URL.createObjectURL(
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
export function EmployeeExpensePage({
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
  const definition = expensePages[page]!,
    [rows, setRows] = useState<Row[]>([]),
    [opts, setOpts] = useState<Row>({}),
    [count, setCount] = useState(0),
    [pageNo, setPageNo] = useState(1),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [detail, setDetail] = useState<Row | null>(null),
    [form, setForm] = useState<FormState | null>(null),
    [travelItems, setTravelItems] = useState<Row[]>([
      { description: "", estimated_amount: 0 },
    ]);
  const currentTravelItems = useRef(travelItems);
  currentTravelItems.current = travelItems;
  const returnAttempt = useRef(crypto.randomUUID());
  const permitted = definition.permissions.some(can);
  const load = async () => {
    const result = await api(
      "/" + page + query({ company_id: company, page: pageNo, limit: 20 }),
    );
    setRows(result.data);
    setCount(result.count);
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    setDetail(null);
    setError("");
    setRows([]);
    if (permitted)
      Promise.all([
        load(),
        api("/employee-expenses/options" + query({ company_id: company })).then(
          (x) =>
            setOpts({
              ...x,
              supports: [
                { id: "tax_document", name: "Comprobante" },
                { id: "declaration", name: "Declaración jurada" },
                {
                  id: "payment_evidence",
                  name: "Evidencia de pago autorizada",
                },
                { id: "other_authorized", name: "Otro sustento autorizado" },
              ],
              decisions: [
                { id: "accepted", name: "Aceptar" },
                { id: "observed", name: "Observar" },
                { id: "rejected", name: "Rechazar" },
              ],
              document_types: [
                { id: "invoice", name: "Factura" },
                { id: "receipt", name: "Boleta" },
                { id: "fee_receipt", name: "Recibo por honorarios" },
                { id: "other", name: "Otro" },
              ],
            }),
        ),
      ]).catch((e) => setError(e.message));
  }, [page, company, pageNo]);
  const readDetail = async (id: string) => {
    const result = await api(`/${page}/${id}`);
    if (page === "expense-reports" && result.items_total > result.items.length)
      result.items = await all(`/expense-reports/${id}/items`);
    return result;
  };
  const show = (row: Row) =>
    run(async () => {
      if (page === "employee-advances") {
        setDetail({ record: row });
        return;
      }
      setDetail(await readDetail(row.id));
    });
  const refreshDetail = async () => {
    await load();
    if (detail) setDetail(await readDetail(detail.record.id));
  };
  const open = (
    title: string,
    fields: Field[],
    submit: (data: Row) => Promise<void>,
    values: Row = {},
    travel = false,
  ) => setForm({ title, fields, submit, values, travel });
  const perform = (path: string, data: Row) =>
    run(async () => {
      await api(path, "POST", data);
      await refreshDetail();
    });
  const askAction = (action: string) =>
    open(labels[action] ?? action, [["reason", "Motivo"]], async (body) => {
      await api(
        `/${page}/${detail!.record.id}/actions`,
        "POST",
        page === "travel-expenses"
          ? { action, comment: body.reason }
          : { action, reason: body.reason },
      );
      await refreshDetail();
    });
  const createTravel = (record?: Row, items?: Row[]) => {
    setTravelItems(items ?? [{ description: "", estimated_amount: 0 }]);
    open(
      record ? "Editar solicitud VIA" : "Nueva solicitud VIA",
      [
        ["employee_id", "Colaborador", "employees"],
        ["currency_id", "Moneda", "currencies"],
        ["destination", "Destino"],
        ["purpose", "Motivo del viaje"],
        ["start_date", "Inicio", "date"],
        ["end_date", "Fin", "date"],
        ["requested_advance_amount", "Anticipo solicitado", "number"],
        ...dimensions,
      ],
      async (body) => {
        const normalized = currentTravelItems.current.map((i) => ({
          category_id: i.category_id,
          description: i.description,
          estimated_amount: Number(i.estimated_amount),
          cost_center_id: i.cost_center_id || body.cost_center_id,
          project_id: i.project_id || body.project_id || null,
          subproject_id: i.subproject_id || body.subproject_id || null,
        }));
        await api(
          "/travel-expenses" +
            (record ? "/" + record.id : "") +
            query({ company_id: company }),
          record ? "PUT" : "POST",
          { ...body, items: normalized },
        );
        await refreshDetail();
      },
      record ?? { requested_advance_amount: 0 },
      true,
    );
  };
  const itemForm = (item?: Row) =>
    open(
      item ? "Corregir partida" : "Agregar gasto",
      itemFields,
      async (body) => {
        await api(
          `/expense-reports/${detail!.record.id}/items` +
            (item ? "/" + item.id : ""),
          item ? "PUT" : "POST",
          body,
        );
        await refreshDetail();
      },
      item ?? {},
    );
  const data = detail?.record,
    editable = data && ["draft", "observed"].includes(data.status);
  if (!permitted)
    return (
      <Empty text="No tiene acceso a esta sección en la empresa seleccionada." />
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">GASTOS Y VIÁTICOS</p>
          <h1>
            {page === "travel-expenses" && !can("travel_expense.view_company")
              ? "Mis solicitudes"
              : page === "expense-reports" &&
                  !can("expense_report.view_company")
                ? "Mis rendiciones"
                : definition.title}
          </h1>
          <p>Expedientes de la empresa seleccionada, según sus permisos.</p>
        </div>
        {page === "travel-expenses" && can("travel_expense.create") && (
          <button className="primary" onClick={() => createTravel()}>
            Nueva solicitud
          </button>
        )}
        {page === "expense-reports" && can("expense_report.create") && (
          <button
            className="primary"
            onClick={() =>
              open(
                "Nueva rendición",
                [
                  ["employee_id", "Colaborador", "employees"],
                  ["currency_id", "Moneda", "currencies"],
                  [
                    "travel_expense_request_id",
                    "Solicitud VIA · opcional",
                    "travels",
                    false,
                  ],
                ],
                async (body) => {
                  await api(
                    "/expense-reports" + query({ company_id: company }),
                    "POST",
                    body,
                  );
                  await load();
                },
              )
            }
          >
            Nueva rendición
          </button>
        )}
      </div>
      <ErrorBox error={error} />
      <section className="table-card">
        <table>
          <thead>
            <tr>
              {definition.columns.map((k) => (
                <th key={k}>{labels[k] ?? k}</th>
              ))}
              <th>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {definition.columns.map((k) => (
                  <td key={k}>{value(k, row[k], opts)}</td>
                ))}
                <td>
                  <button onClick={() => show(row)}>Ver expediente</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p>No hay registros visibles.</p>}
        <div className="pagination">
          <button disabled={pageNo === 1} onClick={() => setPageNo(pageNo - 1)}>
            Anterior
          </button>
          <span>
            {count} registros · página {pageNo}
          </span>
          <button
            disabled={pageNo * 20 >= count}
            onClick={() => setPageNo(pageNo + 1)}
          >
            Siguiente
          </button>
        </div>
      </section>
      {detail && (
        <section className="table-card expense-detail">
          {['expense-reports','employee-advances','employee-returns','employee-reimbursements'].includes(page)&&<AccountingTraceLink entityType={{'expense-reports':'expense_report','employee-advances':'employee_advance','employee-returns':'employee_return','employee-reimbursements':'employee_reimbursement'}[page]!} id={detail.record.id} can={can}/>}
          <div className="page-heading">
            <h2>
              {data!.report_number ?? data!.request_number ?? definition.title}
            </h2>
            <button onClick={() => setDetail(null)}>Cerrar detalle</button>
          </div>
          <ErrorBox error={error} />
          <dl className="form-grid">
            {definition.columns.map((k) => (
              <div key={k}>
                <dt>{labels[k] ?? k}</dt>
                <dd>{value(k, data![k], opts)}</dd>
              </div>
            ))}
          </dl>
          {[
            "travel-expenses",
            "expense-reports",
            "expense-declarations",
          ].includes(page) && (
            <Printable
              title={definition.title}
              record={data!}
              items={detail.items ?? []}
              settlement={detail.settlement}
              opts={opts}
            />
          )}
          {page === "travel-expenses" && (
            <div className="actions">
              {editable && can("travel_expense.create") && (
                <button onClick={() => createTravel(data!, detail.items)}>
                  Editar borrador
                </button>
              )}
              {editable && can("travel_expense.submit") && (
                <button
                  onClick={() =>
                    perform(`/travel-expenses/${data!.id}/actions`, {
                      action: "submit",
                    })
                  }
                >
                  Enviar
                </button>
              )}
              {["submitted", "under_review"].includes(data!.status) &&
                data!.created_by !== actor &&
                ["approve", "observe", "reject"]
                  .filter((a) => can("travel_expense." + a))
                  .map((a) => (
                    <button key={a} onClick={() => askAction(a)}>
                      {labels[a]}
                    </button>
                  ))}
              {data!.status === "approved" &&
                can("travel_expense.cancel") &&
                can("employee_advance.cancel") && (
                  <button
                    onClick={() =>
                      open(
                        "Cancelar VIA sin desembolso",
                        [["reason", "Motivo"]],
                        async (body) => {
                          await api(
                            `/travel-expenses/${data!.id}/cancel-unpaid`,
                            "POST",
                            body,
                          );
                          await refreshDetail();
                        },
                      )
                    }
                  >
                    Cancelar sin desembolso
                  </button>
                )}
            </div>
          )}
          {page === "expense-reports" && (
            <>
              <div className="actions">
                {editable && can("expense_report.create") && (
                  <button onClick={() => itemForm()}>Agregar gasto</button>
                )}
                {editable && can("expense_report.submit") && (
                  <button
                    onClick={() =>
                      perform(`/expense-reports/${data!.id}/actions`, {
                        action: "submit",
                      })
                    }
                  >
                    Enviar rendición
                  </button>
                )}
                {["submitted", "under_review"].includes(data!.status) &&
                  data!.created_by !== actor &&
                  ["approve", "observe", "reject"]
                    .filter((a) => can("expense_report." + a))
                    .map((a) => (
                      <button key={a} onClick={() => askAction(a)}>
                        {labels[a]}
                      </button>
                    ))}
                {data!.status === "settlement_pending" &&
                  can("expense_report.close") && (
                    <button
                      onClick={() =>
                        perform(`/expense-reports/${data!.id}/actions`, {
                          action: "close",
                        })
                      }
                    >
                      Liquidar expediente
                    </button>
                  )}
                {["settlement_pending", "settled"].includes(data!.status) &&
                  can("expense_report.reopen") && (
                    <button onClick={() => askAction("reopen")}>
                      Reabrir con motivo
                    </button>
                  )}
              </div>
              {detail.settlement && (
                <section className="finance-stats">
                  {[
                    "advance_paid",
                    "accepted_expenses",
                    "return_outstanding",
                    "reimbursement_outstanding",
                  ].map((k) => (
                    <article key={k}>
                      <span>{labels[k]}</span>
                      <strong>
                        {detail.settlement[k]}{" "}
                        {value("currency_id", data!.currency_id, opts)}
                      </strong>
                    </article>
                  ))}
                </section>
              )}
              {detail.settlement &&
                Number(detail.settlement.return_outstanding) > 0 &&
                can("employee_return.register") && (
                  <button
                    onClick={() =>
                      open(
                        "Registrar devolución",
                        [
                          ["amount", "Importe", "number"],
                          ["return_date", "Fecha", "date"],
                          ["payment_method_id", "Medio", "methods"],
                          ["reference", "Referencia"],
                        ],
                        async (body) => {
                          await api(
                            `/expense-settlements/${detail.settlement.id}/returns`,
                            "POST",
                            { ...body, idempotency_key: returnAttempt.current },
                          );
                          returnAttempt.current = crypto.randomUUID();
                          await refreshDetail();
                        },
                        {
                          amount: Number(detail.settlement.return_outstanding),
                        },
                      )
                    }
                  >
                    Registrar devolución
                  </button>
                )}
              <h3>Gastos y revisión por partida</h3>
              {(detail.items ?? []).map((i: Row) => (
                <article key={i.id} className="expense-item">
                  <h4>{i.description}</h4>
                  <p>
                    {i.reported_amount} ·{" "}
                    {value("currency_id", data!.currency_id, opts)} ·{" "}
                    {labels[i.status]} · Aceptado {i.accepted_amount} ·
                    Rechazado {i.rejected_amount}
                  </p>
                  <p>{i.decision_reason}</p>
                  <div className="actions">
                    {editable &&
                      i.support_type === "tax_document" &&
                      !i.tax_document_id &&
                      can("tax_document.view") && (
                        <button
                          onClick={() =>
                            run(async () => {
                              const documents = await all("/tax-documents", {
                                company_id: company,
                              });
                              setOpts({
                                ...opts,
                                existingDocuments: documents
                                  .filter(
                                    (d) =>
                                      d.currency_id === data!.currency_id &&
                                      d.status !== "cancelled" &&
                                      !d.expense_report_item_id,
                                  )
                                  .map((d) => ({
                                    ...d,
                                    name: `${d.series}-${d.number} · ${d.total_amount}`,
                                  })),
                              });
                              open(
                                "Vincular comprobante existente",
                                [
                                  [
                                    "existing_id",
                                    "Comprobante",
                                    "existingDocuments",
                                  ],
                                ],
                                async (body) => {
                                  await api(
                                    `/expense-items/${i.id}/tax-document`,
                                    "POST",
                                    body,
                                  );
                                  await refreshDetail();
                                },
                              );
                            })
                          }
                        >
                          Vincular comprobante existente
                        </button>
                      )}
                    {editable &&
                      ["pending", "observed", "rejected"].includes(i.status) &&
                      !i.tax_document_id &&
                      can("expense_report.create") && (
                        <button onClick={() => itemForm(i)}>
                          Corregir partida
                        </button>
                      )}
                    {editable &&
                      i.support_type === "declaration" &&
                      can("declaration.create") && (
                        <button
                          onClick={() =>
                            open(
                              "Declaración jurada",
                              [
                                ["declared_on", "Fecha de declaración", "date"],
                                ["reason", "Motivo y declaración"],
                              ],
                              async (body) => {
                                await api(
                                  `/expense-items/${i.id}/declaration`,
                                  "POST",
                                  body,
                                );
                                await refreshDetail();
                              },
                            )
                          }
                        >
                          Registrar DJ
                        </button>
                      )}
                    {editable &&
                      i.support_type === "tax_document" &&
                      !i.tax_document_id &&
                      can("tax_document.create") && (
                        <button
                          onClick={() =>
                            open(
                              "Comprobante del gasto",
                              [
                                ["supplier_id", "Proveedor", "suppliers"],
                                ["document_type", "Tipo", "document_types"],
                                ["series", "Serie"],
                                ["number", "Número"],
                                ["issue_date", "Emisión", "date"],
                                ["received_date", "Recepción", "date"],
                                ["subtotal", "Base gravada", "number"],
                                ["tax_amount", "Impuestos", "number"],
                                ["non_taxable_amount", "No gravado", "number"],
                              ],
                              async (body) => {
                                await api(
                                  `/expense-items/${i.id}/tax-document`,
                                  "POST",
                                  body,
                                );
                                await refreshDetail();
                              },
                              {
                                subtotal: 0,
                                tax_amount: 0,
                                non_taxable_amount: 0,
                              },
                            )
                          }
                        >
                          Registrar comprobante
                        </button>
                      )}
                    {i.tax_document_id &&
                      can("tax_document.review") &&
                      ["submitted", "under_review", "draft"].includes(
                        data!.status,
                      ) && (
                        <button
                          onClick={() =>
                            perform(
                              `/expense-tax-documents/${i.tax_document_id}/review`,
                              {},
                            )
                          }
                        >
                          Revisar comprobante
                        </button>
                      )}
                    {["submitted", "under_review"].includes(data!.status) &&
                      can("expense_report.review") &&
                      data!.created_by !== actor && (
                        <button
                          onClick={() =>
                            open(
                              "Revisar partida",
                              [
                                ["decision", "Decisión", "decisions"],
                                [
                                  "accepted_amount",
                                  "Importe aceptado",
                                  "number",
                                ],
                                ["reason", "Motivo de decisión"],
                              ],
                              async (body) => {
                                await api(
                                  `/expense-items/${i.id}/review`,
                                  "POST",
                                  body,
                                );
                                await refreshDetail();
                              },
                              {
                                decision: "accepted",
                                accepted_amount: Number(i.reported_amount),
                              },
                            )
                          }
                        >
                          Revisar gasto
                        </button>
                      )}
                  </div>
                  {i.support_type !== "declaration" && (
                    <ExpenseFiles
                      kind={
                        i.support_type === "tax_document"
                          ? "tax_support"
                          : i.support_type === "payment_evidence"
                            ? "employee_payment_evidence"
                            : "expense_receipt"
                      }
                      id={i.id}
                      company={company}
                      editable={!!editable && can("expense_report.create")}
                    />
                  )}
                </article>
              ))}
            </>
          )}
          {page === "expense-declarations" && (
            <ExpenseFiles
              kind="declaration_support"
              id={data!.id}
              company={company}
              editable={
                data!.created_by === actor &&
                can("expense_report.create") &&
                data!.status === "pending"
              }
            />
          )}
          {page === "expense-declarations" &&
            data!.status === "pending" &&
            can("declaration.approve") && (
              <div className="actions">
                {[true, false].map((approve) => (
                  <button
                    key={String(approve)}
                    onClick={() =>
                      open(
                        approve ? "Aprobar DJ" : "Rechazar DJ",
                        [["reason", "Motivo"]],
                        async (body) => {
                          await api(
                            `/expense-declarations/${data!.id}/decision`,
                            "POST",
                            { ...body, approve },
                          );
                          await refreshDetail();
                        },
                      )
                    }
                  >
                    {approve ? "Aprobar DJ" : "Rechazar DJ"}
                  </button>
                ))}
              </div>
            )}
          {page === "employee-returns" && (
            <>
              {data!.status === "registered" &&
                can("employee_return.register") && (
                  <button
                    onClick={() =>
                      open(
                        "Cancelar devolución registrada",
                        [["reason", "Motivo"]],
                        async (body) => {
                          await api(
                            `/employee-returns/${data!.id}/cancel`,
                            "POST",
                            body,
                          );
                          await refreshDetail();
                        },
                      )
                    }
                  >
                    Cancelar devolución con motivo
                  </button>
                )}
              <ExpenseFiles
                kind="employee_return_evidence"
                id={data!.id}
                company={company}
                editable={
                  data!.status === "registered" &&
                  data!.created_by === actor &&
                  can("employee_return.register")
                }
              />
              {can("employee_return.match") && (
                <button
                  onClick={() =>
                    run(async () => {
                      const [transactions, periods] = await Promise.all([
                        api(`/employee-returns/${data!.id}/candidates`),
                        all("/reconciliation-periods", { company_id: company }),
                      ]);
                      const additions = {
                        ...opts,
                        transactions: transactions.map((x: Row) => ({
                          ...x,
                          name: `${x.transaction_date} · ${x.amount} · ${x.bank_reference}`,
                        })),
                        periods: periods
                          .filter((x: Row) => x.status === "open")
                          .map((x: Row) => ({
                            ...x,
                            name: `${x.start_date} — ${x.end_date}`,
                          })),
                      };
                      setOpts(additions);
                      open(
                        "Vincular devolución a abono bancario",
                        [
                          ["period_id", "Periodo", "periods"],
                          ["transaction_id", "Abono bancario", "transactions"],
                          ["amount", "Importe", "number"],
                        ],
                        async (body) => {
                          await api(
                            `/employee-returns/${data!.id}/matches`,
                            "POST",
                            body,
                          );
                          await refreshDetail();
                        },
                        { amount: Number(data!.amount) },
                      );
                    })
                  }
                >
                  Buscar abonos compatibles
                </button>
              )}
              {(detail.matches ?? []).map((m: Row) => (
                <p key={m.id}>
                  {m.amount} · {labels[m.status]}{" "}
                  {m.status === "matched" &&
                    can("bank_reconciliation.reconcile") && (
                      <button
                        onClick={() =>
                          run(async () => {
                            await api(
                              `/reconciliation-matches/${m.id}/actions`,
                              "POST",
                              { action: "reconcile" },
                            );
                            await refreshDetail();
                          })
                        }
                      >
                        Confirmar conciliación
                      </button>
                    )}
                </p>
              ))}
            </>
          )}
          {page === "employee-reimbursements" && (
            <ExpenseFiles
              kind="employee_reimbursement_support"
              id={data!.id}
              company={company}
              editable={
                can("employee_reimbursement.create") && data!.status !== "paid"
              }
            />
          )}
          {["travel-expenses", "expense-reports"].includes(page) && (
            <ExpenseHistory
              key={data!.id + data!.status}
              path={page}
              id={data!.id}
            />
          )}
        </section>
      )}
      {form && (
        <Modal title={form.title} close={() => !busy && setForm(null)}>
          <ErrorBox error={error} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const body: Row = {};
                for (const [k] of form.fields) {
                  const v = form.values[k];
                  if (v !== undefined && v !== "") body[k] = v;
                }
                await form.submit(body);
                setForm(null);
              });
            }}
          >
            <div className="form-grid">
              {form.fields.map((f) => (
                <FieldControl
                  key={f[0]}
                  field={f}
                  data={form.values}
                  set={(k, v) =>
                    setForm({
                      ...form,
                      values: {
                        ...form.values,
                        [k]: v,
                        ...(k === "project_id" ? { subproject_id: "" } : {}),
                      },
                    })
                  }
                  opts={opts}
                />
              ))}
            </div>
            {form.travel && (
              <fieldset>
                <legend>Presupuesto por partida</legend>
                {travelItems.map((i, index) => (
                  <div className="form-grid" key={index}>
                    {(
                      [
                        ["category_id", "Categoría", "categories"],
                        ["description", "Concepto"],
                        ["estimated_amount", "Estimado", "number"],
                        ...dimensions.map(
                          (f) =>
                            [f[0], f[1] + " · opcional", f[2], false] as Field,
                        ),
                      ] as Field[]
                    ).map((f) => (
                      <FieldControl
                        key={f[0]}
                        field={f}
                        data={i}
                        set={(k, v) =>
                          setTravelItems(
                            travelItems.map((x, n) =>
                              n === index ? { ...x, [k]: v } : x,
                            ),
                          )
                        }
                        opts={opts}
                      />
                    ))}
                  </div>
                ))}
                <button
                  type="button"
                  disabled={travelItems.length >= 100}
                  onClick={() =>
                    setTravelItems([
                      ...travelItems,
                      { description: "", estimated_amount: 0 },
                    ])
                  }
                >
                  Agregar partida
                </button>
              </fieldset>
            )}
            <button className="primary" disabled={busy}>
              {busy ? "Guardando…" : "Guardar"}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
export function EmployeeExpenseDashboard({ company }: { company: string }) {
  const [data, setData] = useState<Row | null>(null),
    [opts, setOpts] = useState<Row>({}),
    [error, setError] = useState("");
  useEffect(() => {
    setData(null);
    Promise.all([
      api("/employee-expenses/dashboard" + query({ company_id: company })).then(
        setData,
      ),
      api("/employee-expenses/options" + query({ company_id: company })).then(
        setOpts,
      ),
    ]).catch((e) => setError(e.message));
  }, [company]);
  return (
    <>
      <div className="page-heading">
        <h1>Gastos de colaboradores</h1>
      </div>
      <ErrorBox error={error} />
      {data &&
        Object.entries(data).map(([section, rows]) => (
          <section className="table-card" key={section}>
            <h2>
              {{
                reports: "Rendiciones por estado",
                advances: "Anticipos",
                settlements: "Expedientes de liquidación",
                expenses: "Gastos aceptados por dimensiones y periodo",
              }[section] ?? section}
            </h2>
            {!(rows as Row[]).length ? (
              <p>No hay registros visibles.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    {Object.keys((rows as Row[])[0]!)
                      .filter((k) => k !== "report_id")
                      .map((k) => (
                        <th key={k}>{labels[k] ?? k}</th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {(rows as Row[]).map((r, index) => (
                    <tr key={index}>
                      {Object.entries(r)
                        .filter(([k]) => k !== "report_id")
                        .map(([k, v]) => (
                          <td key={k}>{value(k, v, opts)}</td>
                        ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        ))}
    </>
  );
}
