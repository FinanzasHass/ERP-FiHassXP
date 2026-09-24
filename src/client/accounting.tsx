import React, { useEffect, useState } from "react";
import { api, all, query, type Row } from "./api";
import { Modal, Empty, ErrorBox } from "./components";
import { AccountingImport } from "./accounting-import";
export const accountingPages: Record<
  string,
  { title: string; permission: string; endpoint: string; columns: string[] }
> = {
  "accounting-events": {title:"Operaciones pendientes",permission:"accounting_event.view",endpoint:"events",columns:[]},
  "accounting-configuration": {title:"Configuración e importación",permission:"accounting_configuration.view",endpoint:"configuration",columns:[]},
  "accounting-afes": {title:"AFE",permission:"afe.view",endpoint:"afes",columns:[]},
  "accounting-accounts": {
    title: "Plan de cuentas",
    permission: "accounting_account.view",
    endpoint: "accounts",
    columns: [
      "code",
      "name",
      "level",
      "account_type",
      "normal_balance",
      "allows_posting",
      "active",
    ],
  },
  "accounting-periods": {
    title: "Períodos contables",
    permission: "accounting_period.view",
    endpoint: "periods",
    columns: ["year", "month", "start_date", "end_date", "status"],
  },
  "accounting-journals": {
    title: "Asientos contables",
    permission: "journal.view",
    endpoint: "journals",
    columns: [
      "entry_number",
      "entry_date",
      "description",
      "status",
      "revision",
    ],
  },
  "accounting-rules": {
    title: "Reglas contables",
    permission: "accounting_rule.view",
    endpoint: "rules",
    columns: ["code", "name", "version", "source_event", "status"],
  },
  "accounting-simulation": {
    title: "Simulación contable",
    permission: "accounting_rule.view",
    endpoint: "rules",
    columns: ["code", "name", "version", "status"],
  },
  "general-ledger": {
    title: "Mayor contable",
    permission: "general_ledger.view",
    endpoint: "general_ledger",
    columns: [
      "entry_date",
      "entry_number",
      "account_code",
      "account_name",
      "description",
      "debit",
      "credit",
      "running_balance",
    ],
  },
  "trial-balance": {
    title: "Balance de comprobación",
    permission: "trial_balance.view",
    endpoint: "trial_balance",
    columns: [
      "account_code",
      "account_name",
      "opening_balance",
      "debits",
      "credits",
      "closing_balance",
    ],
  },
};
const labels: Record<string, string> = {
  code: "Código",
  name: "Nombre",
  level: "Nivel",
  account_type: "Tipo",
  normal_balance: "Naturaleza",
  allows_posting: "Acepta movimientos",
  active: "Activo",
  year: "Año",
  month: "Mes",
  start_date: "Desde",
  end_date: "Hasta",
  status: "Estado",
  entry_number: "Número",
  entry_date: "Fecha",
  description: "Descripción",
  revision: "Revisión",
  version: "Versión",
  source_event: "Evento",
  account_code: "Cuenta",
  account_name: "Nombre de cuenta",
  debit: "Debe",
  credit: "Haber",
  running_balance: "Saldo acumulado",
  opening_balance: "Saldo inicial",
  debits: "Debe",
  credits: "Haber",
  closing_balance: "Saldo final",
};
const states: Record<string, string> = {
  draft: "Borrador",
  validated: "Validado",
  posted: "Contabilizado",
  reversed: "Reversado",
  open: "Abierto",
  soft_closed: "Cierre preliminar",
  closed: "Cerrado",
  reopened: "Reabierto",
  simulation_active: "Activa para simulación",
  disabled: "Inactiva",
  asset: "Activo",
  liability: "Pasivo",
  equity: "Patrimonio",
  income: "Ingreso",
  expense: "Gasto",
  memorandum: "Orden",
  debit: "Deudora",
  credit: "Acreedora",
};
type Field = {
  key: string;
  label: string;
  type?: string;
  options?: Row[];
  required?: boolean;
};
const opts = (pairs: string[]) =>
  pairs.map((id) => ({ id, name: states[id] || id }));
function Form({
  fields,
  initial = {},
  save,
  close,
  title,
  children,
}: {
  fields: Field[];
  initial?: Row;
  save: (data: Row) => Promise<void>;
  close: () => void;
  title: string;
  children?: React.ReactNode;
}) {
  const [data, set] = useState<Row>(initial),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title={title} close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const result: Row = {};
            for (const f of fields) {
              const value = data[f.key];
              if (f.type === "checkbox") result[f.key] = Boolean(value);
              else if (value !== undefined && value !== "")
                result[f.key] = f.type === "number" ? Number(value) : value;
            }
            await save(result);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          {fields.map((f) => (
            <label key={f.key}>
              {f.label}
              {f.options ? (
                <select
                  aria-label={f.label}
                  required={f.required}
                  value={data[f.key] ?? ""}
                  onChange={(e) => set({ ...data, [f.key]: e.target.value })}
                >
                  <option value="">Seleccione</option>
                  {f.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  aria-label={f.label}
                  type={f.type || "text"}
                  step={f.type === "number" ? "any" : undefined}
                  required={f.required}
                  checked={
                    f.type === "checkbox" ? Boolean(data[f.key]) : undefined
                  }
                  value={
                    f.type === "checkbox" ? undefined : (data[f.key] ?? "")
                  }
                  onChange={(e) =>
                    set({
                      ...data,
                      [f.key]:
                        f.type === "checkbox"
                          ? e.target.checked
                          : e.target.value,
                    })
                  }
                />
              )}
            </label>
          ))}
        </div>
        {children}
        <ErrorBox error={error} />
        <div className="modal-actions">
          <button type="button" onClick={close}>
            Cancelar
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Procesando…" : "Guardar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function AccountingPage({
  page,
  company,
  can,
}: {
  page: string;
  company: string;
  can: (p: string) => boolean;
}) {
  const [importing, setImporting] = useState(false);
  const def = accountingPages[page]!,
    [rows, setRows] = useState<Row[]>([]),
    [options, setOptions] = useState<Row>({}),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [modal, setModal] = useState<{
      title: string;
      fields: Field[];
      initial?: Row;
      save: (d: Row) => Promise<void>;
    } | null>(null),
    [editor, setEditor] = useState<{
      kind: "journal" | "rule";
      record?: Row;
      lines?: Row[];
    } | null>(null),
    [detail, setDetail] = useState<Row | null>(null),
    [filter, setFilter] = useState<Row>({}),
    [reportMeta, setReportMeta] = useState<Row>({});
  const report = page === "general-ledger" || page === "trial-balance";
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const o = await api(
        "/accounting/options" + query({ company_id: company }),
      );
      setOptions(o);
      if (!report)
        setRows(
          await all("/accounting/" + def.endpoint, { company_id: company }),
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    const linked = new URLSearchParams(window.location.search).get('journal_id');
    if (page === 'accounting-journals' && linked) void inspect({id:linked},false);
  }, [company, page]);
  const complete = async () => {
    setModal(null);
    setEditor(null);
    setDetail(null);
    await load();
  };
  const action = (
    title: string,
    fields: Field[],
    save: (d: Row) => Promise<unknown>,
    initial: Row = {},
  ) =>
    setModal({
      title,
      fields,
      initial,
      save: async (d) => {
        await save(d);
        await complete();
      },
    });
  const select = (
    key: string,
    label: string,
    list: string,
    required = false,
  ): Field => ({ key, label, options: options[list] || [], required });
  const request = async (path: string, body: Row) =>
    api("/accounting/" + path, "POST", body, {
      "Idempotency-Key": crypto.randomUUID(),
    });
  const accountFields: Field[] = [
    { key: "code", label: "Código", required: true },
    { key: "name", label: "Nombre", required: true },
    select("parent_id", "Cuenta superior", "accounts"),
    {
      key: "account_type",
      label: "Tipo",
      options: opts([
        "asset",
        "liability",
        "equity",
        "income",
        "expense",
        "memorandum",
      ]),
      required: true,
    },
    {
      key: "normal_balance",
      label: "Naturaleza",
      options: opts(["debit", "credit"]),
      required: true,
    },
    { key: "valid_from", label: "Vigente desde", type: "date", required: true },
    { key: "valid_to", label: "Vigente hasta", type: "date" },
    { key: "pcge_reference_code", label: "Referencia PCGE (opcional)" },
    ...[
      "allows_posting",
      "requires_cost_center",
      "requires_project",
      "requires_third_party",
    ].map((key, i) => ({
      key,
      label: [
        "Acepta movimientos",
        "Exige CECO",
        "Exige proyecto",
        "Exige tercero",
        "Activo",
      ][i]!,
      type: "checkbox",
    })),
  ];
  const editAccount = (row?: Row) =>
    action(
      row ? "Editar cuenta" : "Nueva cuenta",
      accountFields,
      (d) =>
        row
          ? api("/accounting/accounts/" + row.id, "PATCH", {
              ...d,
              parent_id: d.parent_id || null,
              company_id: company,
            })
          : request("accounts", { ...d, company_id: company }),
      row || { allows_posting: true },
    );
  const reason = [{ key: "reason", label: "Motivo", required: true }];
  const inspect = async (row: Row, edit = false) => {
    setError("");
    try {
      const d = await api("/accounting/" + def.endpoint + "/" + row.id);
      if (def.endpoint === "journals")
        d.lines = d.lines.map((l: Row) => ({
          ...l,
          dimensions: l.journal_line_dimensions || [],
        }));
      if (edit) {
        setEditor({
          kind: def.endpoint === "journals" ? "journal" : "rule",
          record: d.record,
          lines: d.lines,
        });
      } else {
        d.history = await all("/accounting/history", {
          company_id: company,
          entity_id: row.id,
        });
        setDetail(d);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const runReport = async (pageNumber = 1) => {
    setLoading(true);
    setError("");
    try {
      const clean = Object.fromEntries(
        Object.entries(filter).filter(([, v]) => v !== ""),
      );
      if (clean.source_party) {
        const [type, id] = String(clean.source_party).split(":");
        clean.third_party_type = type;
        clean.third_party_id = id;
        delete clean.source_party;
      }
      const r = await request("reports/" + def.endpoint, {
        ...clean,
        company_id: company,
        page: pageNumber,
        limit: 100,
      });
      setRows(r.data);
      setReportMeta({ ...r, page: pageNumber });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <section>
      <div className="page-heading">
        <div>
          <h1>{def.title}</h1>
          <p>Contexto empresarial · trazabilidad contable</p>
        </div>
        <div className="actions">
          {page === "accounting-accounts" &&
            can("accounting_account.create") && (
              <button className="primary" onClick={() => editAccount()}>
                Nueva cuenta
              </button>
            )}
          {page === "accounting-accounts" &&
            can("accounting_account.import") && (
              <button onClick={() => setImporting(true)}>
                Importar CSV / XLSX
              </button>
            )}
          {page === "accounting-periods" && can("accounting_period.manage") && (
            <>
              <button
                onClick={() =>
                  action(
                    "Configuración contable",
                    [
                      select(
                        "functional_currency_id",
                        "Moneda funcional",
                        "currencies",
                        true,
                      ),
                      {
                        key: "number_prefix",
                        label: "Prefijo de numeración",
                        required: true,
                      },
                      {
                        key: "number_digits",
                        label: "Dígitos de correlativo",
                        type: "number",
                        required: true,
                      },
                    ],
                    (d) =>
                      options.settings
                        ? api(
                            "/accounting/settings/" + options.settings.id,
                            "PATCH",
                            { ...d, company_id: company },
                          )
                        : request("settings", { ...d, company_id: company }),
                    options.settings || {},
                  )
                }
              >
                Configuración
              </button>
              <button
                onClick={() =>
                  action(
                    "Tipo de asiento",
                    [
                      { key: "code", label: "Código", required: true },
                      { key: "name", label: "Nombre", required: true },
                    ],
                    (d) =>
                      request("entry-types", { ...d, company_id: company }),
                  )
                }
              >
                Nuevo tipo
              </button>
              <button
                onClick={() =>
                  action(
                    "Tipo de cambio explícito",
                    [
                      {
                        key: "date",
                        label: "Fecha",
                        type: "date",
                        required: true,
                      },
                      select(
                        "currency_from",
                        "Moneda origen",
                        "currencies",
                        true,
                      ),
                      select(
                        "currency_to",
                        "Moneda destino",
                        "currencies",
                        true,
                      ),
                      ...["buy_rate", "sell_rate", "accounting_rate"].map(
                        (key, i) => ({
                          key,
                          label: ["Compra", "Venta", "Contable"][i]!,
                          type: "number",
                          required: true,
                        }),
                      ),
                      { key: "source", label: "Fuente", required: true },
                    ],
                    (d) =>
                      request("exchange-rates", { ...d, company_id: company }),
                  )
                }
              >
                Tipo de cambio
              </button>
              <button
                className="primary"
                onClick={() =>
                  action(
                    "Nuevo período",
                    [
                      {
                        key: "year",
                        label: "Año",
                        type: "number",
                        required: true,
                      },
                      {
                        key: "month",
                        label: "Mes",
                        type: "number",
                        required: true,
                      },
                      {
                        key: "start_date",
                        label: "Desde",
                        type: "date",
                        required: true,
                      },
                      {
                        key: "end_date",
                        label: "Hasta",
                        type: "date",
                        required: true,
                      },
                    ],
                    (d) => request("periods", { ...d, company_id: company }),
                  )
                }
              >
                Nuevo período
              </button>
            </>
          )}
          {page === "accounting-journals" && can("journal.create") && (
            <button
              className="primary"
              onClick={() => setEditor({ kind: "journal" })}
            >
              Nuevo asiento
            </button>
          )}
          {page === "accounting-rules" && can("accounting_rule.create") && (
            <button
              className="primary"
              onClick={() => setEditor({ kind: "rule" })}
            >
              Nueva regla
            </button>
          )}
        </div>
      </div>
      <ErrorBox error={error} />
      {!options.settings && !loading && (
        <p className="notice">
          Configure moneda funcional y numeración en Períodos contables antes de
          crear asientos o simular reglas.
        </p>
      )}
      {page === "accounting-simulation" && (
        <p>
          Las propuestas no se guardan ni contabilizan. Solo se utilizan reglas
          activadas para simulación.
        </p>
      )}
      {report && (
        <>
          <div className="form-grid">
            {[
              select("accounting_period_id", "Período", "periods"),
              select("account_id", "Cuenta", "accounts"),
              { key: "account_from", label: "Código desde", type: "text" },
              { key: "account_to", label: "Código hasta", type: "text" },
              { key: "date_from", label: "Desde", type: "date" },
              { key: "date_to", label: "Hasta", type: "date" },
              select("cost_center_id", "CECO", "cost_centers"),
              select("project_id", "Proyecto", "projects"),
              select("currency_id", "Moneda de transacción", "currencies"),
              {
                key: "source_party",
                label: "Tercero",
                options: [
                  ...["suppliers", "customers", "employees"].flatMap(
                    (list, i) =>
                      (options[list] || []).map((p: Row) => ({
                        id:
                          ["supplier", "customer", "employee"][i] + ":" + p.id,
                        name:
                          ["Proveedor", "Cliente", "Colaborador"][i] +
                          " · " +
                          p.name,
                      })),
                  ),
                ],
              },
            ].map((f) => (
              <label key={f.key}>
                {f.label}
                {"options" in f ? (
                  <select
                    value={filter[f.key] || ""}
                    onChange={(e) =>
                      setFilter({ ...filter, [f.key]: e.target.value })
                    }
                  >
                    <option value="">Todas</option>
                    {f.options?.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={f.type}
                    value={filter[f.key] || ""}
                    onChange={(e) =>
                      setFilter({ ...filter, [f.key]: e.target.value })
                    }
                  />
                )}
              </label>
            ))}
          </div>
          <button disabled={loading} onClick={() => void runReport()}>
            Consultar
          </button>
          <p>
            Importes en moneda funcional. Saldo = debe − haber. Solo movimientos
            contabilizados; el original y su reverso se conservan. Este reporte
            no es un estado financiero legal.
          </p>
          {reportMeta.count > 0 && (
            <div className="actions">
              <button
                disabled={loading || reportMeta.page <= 1}
                onClick={() => void runReport(reportMeta.page - 1)}
              >
                Anterior
              </button>
              <span>
                Página {reportMeta.page} · {reportMeta.count} registros
              </span>
              <button
                disabled={loading || reportMeta.page * 100 >= reportMeta.count}
                onClick={() => void runReport(reportMeta.page + 1)}
              >
                Siguiente
              </button>
            </div>
          )}
        </>
      )}
      {loading ? (
        <p role="status">Cargando…</p>
      ) : rows.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {def.columns.map((k) => (
                  <th key={k}>{labels[k] || k}</th>
                ))}
                {!report && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.id || row.line_id || row.account_id || i}>
                  {def.columns.map((k) => (
                    <td key={k}>
                      {typeof row[k] === "boolean"
                        ? row[k]
                          ? "Sí"
                          : "No"
                        : states[row[k]] || String(row[k] ?? "—")}
                    </td>
                  ))}
                  {!report && (
                    <td>
                      {page === "accounting-accounts" && (
                        <>
                          {can("accounting_account.edit") && (
                            <button onClick={() => editAccount(row)}>
                              Editar
                            </button>
                          )}
                          {can("accounting_account.disable") && row.active && (
                            <button
                              onClick={() =>
                                action("Desactivar cuenta", reason, (d) =>
                                  request("accounts/" + row.id + "/disable", d),
                                )
                              }
                            >
                              Desactivar
                            </button>
                          )}
                        </>
                      )}
                      {page === "accounting-periods" && (
                        <>
                          {can("accounting_period.close") &&
                            ["open", "reopened", "soft_closed"].includes(
                              row.status,
                            ) && (
                              <button
                                onClick={() =>
                                  action("Cerrar período", reason, (d) =>
                                    request("periods/" + row.id + "/action", {
                                      ...d,
                                      action: "close",
                                    }),
                                  )
                                }
                              >
                                Cerrar
                              </button>
                            )}
                          {can("accounting_period.reopen") &&
                            ["closed", "soft_closed"].includes(row.status) && (
                              <button
                                onClick={() =>
                                  action("Reabrir período", reason, (d) =>
                                    request("periods/" + row.id + "/action", {
                                      ...d,
                                      action: "reopen",
                                    }),
                                  )
                                }
                              >
                                Reabrir
                              </button>
                            )}
                        </>
                      )}
                      {page === "accounting-journals" && (
                        <>
                          <button onClick={() => void inspect(row)}>
                            Detalle
                          </button>
                          {can("journal.edit_draft") &&
                            ["draft", "validated"].includes(row.status) && (
                              <button onClick={() => void inspect(row, true)}>
                                Editar borrador
                              </button>
                            )}
                          {can("journal.validate") &&
                            row.status === "draft" && (
                              <button
                                onClick={() =>
                                  action("Validar asiento", [], () =>
                                    request(
                                      "journals/" + row.id + "/validate",
                                      {},
                                    ),
                                  )
                                }
                              >
                                Validar
                              </button>
                            )}
                          {can("journal.post") &&
                            row.status === "validated" && (
                              <button
                                onClick={() =>
                                  action(
                                    "Contabilizar · requiere actor independiente",
                                    [],
                                    () =>
                                      request(
                                        "journals/" + row.id + "/post",
                                        {},
                                      ),
                                  )
                                }
                              >
                                Contabilizar
                              </button>
                            )}
                          {can("journal.reverse") &&
                            can("journal.post") &&
                            row.status === "posted" &&
                            !row.original_entry_id && (
                              <button
                                onClick={() =>
                                  action(
                                    "Reversar asiento",
                                    [
                                      ...reason,
                                      {
                                        key: "entry_date",
                                        label: "Fecha del reverso",
                                        type: "date",
                                        required: true,
                                      },
                                      select(
                                        "accounting_period_id",
                                        "Período destino",
                                        "periods",
                                        true,
                                      ),
                                      select(
                                        "entry_type_id",
                                        "Tipo",
                                        "entry_types",
                                        true,
                                      ),
                                    ],
                                    (d) =>
                                      request(
                                        "journals/" + row.id + "/reverse",
                                        d,
                                      ),
                                  )
                                }
                              >
                                Reversar
                              </button>
                            )}
                        </>
                      )}
                      {page === "accounting-rules" && (
                        <>
                          <button onClick={() => void inspect(row)}>
                            Detalle
                          </button>
                          {can("accounting_rule.edit") && (
                            <button onClick={() => void inspect(row, true)}>
                              Nueva versión
                            </button>
                          )}
                          {can("accounting_rule.activate") && (
                            <button
                              onClick={() =>
                                action(
                                  "Activar para simulación · actor independiente",
                                  reason,
                                  (d) =>
                                    request("rules/" + row.id + "/action", {
                                      ...d,
                                      action: "activate_simulation",
                                    }),
                                )
                              }
                            >
                              Activar simulación
                            </button>
                          )}
                        </>
                      )}
                      {page === "accounting-simulation" &&
                        row.status === "simulation_active" && (
                          <button
                            onClick={() =>
                              setModal({
                                title: "Simular regla",
                                fields: [
                                  {
                                    key: "entry_date",
                                    label: "Fecha",
                                    type: "date",
                                    required: true,
                                  },
                                  select(
                                    "currency_id",
                                    "Moneda",
                                    "currencies",
                                    true,
                                  ),
                                  select(
                                    "exchange_rate_id",
                                    "Tipo de cambio explícito",
                                    "exchange_rates",
                                  ),
                                  {
                                    key: "amount",
                                    label: "Importe",
                                    type: "number",
                                    required: true,
                                  },
                                  {
                                    key: "net_amount",
                                    label: "Neto",
                                    type: "number",
                                  },
                                  {
                                    key: "tax_amount",
                                    label: "Impuesto",
                                    type: "number",
                                  },
                                  {
                                    key: "source_party",
                                    label: "Tercero",
                                    options: [
                                      ...(options.suppliers || []).map(
                                        (x: Row) => ({
                                          id: "supplier:" + x.id,
                                          name: "Proveedor · " + x.name,
                                        }),
                                      ),
                                      ...(options.customers || []).map(
                                        (x: Row) => ({
                                          id: "customer:" + x.id,
                                          name: "Cliente · " + x.name,
                                        }),
                                      ),
                                      ...(options.employees || []).map(
                                        (x: Row) => ({
                                          id: "employee:" + x.id,
                                          name: "Colaborador · " + x.name,
                                        }),
                                      ),
                                    ],
                                  },
                                  select("cost_center", "CECO", "cost_centers"),
                                  select("project", "Proyecto", "projects"),
                                  select(
                                    "subproject",
                                    "Subproyecto",
                                    "subprojects",
                                  ),
                                  select("area", "Área", "areas"),
                                ],
                                save: async (d) => {
                                  const {
                                    amount,
                                    net_amount,
                                    tax_amount,
                                    source_party,
                                    cost_center,
                                    project,
                                    subproject,
                                    area,
                                    ...rest
                                  } = d;
                                  if (source_party) {
                                    const [type, id] =
                                      String(source_party).split(":");
                                    rest.third_party_type = type;
                                    rest.third_party_id = id;
                                  }
                                  rest.dimensions = Object.fromEntries(
                                    Object.entries({
                                      cost_center,
                                      project,
                                      subproject,
                                      area,
                                    }).filter(([, v]) => v),
                                  );
                                  const result = await request(
                                    "rules/" + row.id + "/preview",
                                    {
                                      ...rest,
                                      source_event: row.source_event,
                                      amounts: {
                                        amount,
                                        ...(net_amount !== undefined
                                          ? { net_amount }
                                          : {}),
                                        ...(tax_amount !== undefined
                                          ? { tax_amount }
                                          : {}),
                                      },
                                    },
                                  );
                                  setModal(null);
                                  setDetail({
                                    record: {
                                      description: "Propuesta sin persistencia",
                                      status: result.valid
                                        ? "Válida"
                                        : "Revisar",
                                      ...result,
                                    },
                                    lines: result.lines,
                                  });
                                },
                              })
                            }
                          >
                            Simular
                          </button>
                        )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          text={
            report
              ? "Seleccione filtros y consulte los movimientos reales."
              : "No hay registros contables en esta empresa."
          }
        />
      )}
      {modal && <Form {...modal} close={() => setModal(null)} />}
      {importing && (
        <AccountingImport
          company={company}
          close={() => setImporting(false)}
          complete={async () => {
            setImporting(false);
            await load();
          }}
        />
      )}
      {editor && (
        <EntryEditor
          {...editor}
          options={options}
          company={company}
          close={() => setEditor(null)}
          complete={complete}
        />
      )}
      {detail && (
        <Modal
          title={
            detail.record.entry_number ||
            detail.record.name ||
            "Detalle contable"
          }
          close={() => setDetail(null)}
        >
          {detail.record.accounting_event_id && <p>Evento de origen: <a href={'/app/accounting-events?event_id='+encodeURIComponent(detail.record.accounting_event_id)}>{detail.record.accounting_event_id}</a></p>}
          <p>
            {detail.record.description} ·{" "}
            {states[detail.record.status] || detail.record.status}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Cuenta</th>
                  <th>Descripción</th>
                  <th>Debe</th>
                  <th>Haber</th>
                  <th>Tercero y dimensiones históricas</th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((l: Row, i: number) => (
                  <tr key={l.id || i}>
                    <td>
                      {l.account_snapshot?.code ||
                        l.account_code ||
                        options.accounts?.find(
                          (a: Row) => a.id === l.account_id,
                        )?.name}
                    </td>
                    <td>{l.description}</td>
                    <td>
                      {l.debit ?? (l.side === "debit" ? l.amount_key : "—")}
                    </td>
                    <td>
                      {l.credit ?? (l.side === "credit" ? l.amount_key : "—")}
                    </td>
                    <td>
                      {l.third_party_snapshot?.name ||
                        l.third_party?.name ||
                        "—"}
                      {l.dimensions?.map((d: Row) => (
                        <div key={d.dimension_type}>
                          {d.snapshot_code} · {d.snapshot_name}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {detail.history?.length > 0 && (
            <>
              <h3>Historial</h3>
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Acción</th>
                    <th>Actor</th>
                    <th>Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.history.map((h: Row) => (
                    <tr key={h.id}>
                      <td>{new Date(h.created_at).toLocaleString()}</td>
                      <td>{h.action}</td>
                      <td>{h.actor_id}</td>
                      <td>{h.reason || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {detail.record.errors?.length > 0 && (
            <ErrorBox
              error={detail.record.errors.map((e: Row) => e.error).join(", ")}
            />
          )}
        </Modal>
      )}
    </section>
  );
}
function EntryEditor({
  kind,
  record,
  lines: initial,
  options,
  company,
  close,
  complete,
}: {
  kind: "journal" | "rule";
  record?: Row;
  lines?: Row[];
  options: Row;
  company: string;
  close: () => void;
  complete: () => Promise<void>;
}) {
  const [lines, setLines] = useState<Row[]>(
    initial?.map((l) => ({ ...l })) || [
      {
        description: "",
        debit: 0,
        credit: 0,
        side: "debit",
        amount_key: "amount",
      },
      {
        description: "",
        debit: 0,
        credit: 0,
        side: "credit",
        amount_key: "amount",
      },
    ],
  );
  const idempotency = React.useRef(crypto.randomUUID());
  const fields: Field[] =
    kind === "journal"
      ? [
          { key: "entry_date", label: "Fecha", type: "date", required: true },
          {
            key: "accounting_period_id",
            label: "Período",
            options: options.periods,
            required: true,
          },
          {
            key: "entry_type_id",
            label: "Tipo",
            options: options.entry_types,
            required: true,
          },
          ...(!record || ["manual", "opening"].includes(record.source_type)
            ? [
                {
                  key: "source_type",
                  label: "Origen",
                  options: [
                    { id: "manual", name: "Manual" },
                    { id: "opening", name: "Apertura explícita" },
                  ],
                },
              ]
            : []),
          { key: "description", label: "Descripción", required: true },
          {
            key: "currency_id",
            label: "Moneda",
            options: options.currencies,
            required: true,
          },
          {
            key: "exchange_rate_id",
            label: "Tipo de cambio explícito",
            options: options.exchange_rates,
          },
        ]
      : [
          { key: "code", label: "Código de regla", required: true },
          { key: "name", label: "Nombre", required: true },
          { key: "source_event", label: "Evento", required: true },
          {
            key: "valid_from",
            label: "Vigente desde",
            type: "date",
            required: true,
          },
          { key: "valid_to", label: "Vigente hasta", type: "date" },
          { key: "priority", label: "Prioridad", type: "number" },
          {
            key: "condition_currency_id",
            label: "Condición: moneda",
            options: options.currencies,
          },
          { key: "minimum_amount", label: "Importe mínimo", type: "number" },
          { key: "maximum_amount", label: "Importe máximo", type: "number" },
          {
            key: "condition_third_party_type",
            label: "Condición: tipo de tercero",
            options: [
              { id: "supplier", name: "Proveedor" },
              { id: "customer", name: "Cliente" },
              { id: "employee", name: "Colaborador" },
            ],
          },
        ];
  const update = (i: number, key: string, value: unknown) =>
    setLines(lines.map((l, n) => (n === i ? { ...l, [key]: value } : l)));
  return (
    <Form
      title={
        kind === "journal"
          ? "Asiento · validación y posteo separados"
          : "Regla versionada · solo simulación"
      }
      fields={fields}
      initial={
        record
          ? {
              ...record,
              condition_currency_id: record.conditions?.currency_id,
              minimum_amount: record.conditions?.minimum_amount,
              maximum_amount: record.conditions?.maximum_amount,
              condition_third_party_type: record.conditions?.third_party_type,
            }
          : undefined
      }
      close={close}
      save={async (header) => {
        if (kind === "rule") {
          const {
            condition_currency_id,
            minimum_amount,
            maximum_amount,
            condition_third_party_type,
            ...rest
          } = header;
          header = {
            ...rest,
            conditions: {
              ...(condition_currency_id
                ? { currency_id: condition_currency_id }
                : {}),
              ...(minimum_amount !== undefined ? { minimum_amount } : {}),
              ...(maximum_amount !== undefined ? { maximum_amount } : {}),
              ...(condition_third_party_type
                ? { third_party_type: condition_third_party_type }
                : {}),
            },
          };
        }
        const clean = lines.map((l) =>
          kind === "journal"
            ? {
                account_id: l.account_id,
                description: l.description,
                debit: Number(l.debit || 0),
                credit: Number(l.credit || 0),
                ...(l.foreign_amount != null && l.foreign_amount !== ""
                  ? { foreign_amount: Number(l.foreign_amount) }
                  : {}),
                ...(l.third_party_type
                  ? {
                      third_party_type: l.third_party_type,
                      third_party_id: l.third_party_id,
                    }
                  : {}),
                dimensions: (l.dimensions || []).map((d: Row) => ({
                  dimension_type: d.dimension_type,
                  dimension_id: d.dimension_id,
                })),
              }
            : {
                account_id: l.account_id,
                description: l.description,
                side: l.side,
                amount_key: l.amount_key,
                multiplier: Number(l.multiplier || 1),
                use_third_party: Boolean(l.use_third_party),
                dimension_types: l.dimension_types || [],
              },
        );
        await api(
          "/accounting/" +
            (kind === "journal" ? "journals" : "rules") +
            (record ? "/" + record.id + "/versions" : ""),
          "POST",
          {
            ...header,
            ...(kind === "journal"
              ? {
                  source_type:
                    record?.source_type || header.source_type || "manual",
                  source_id: record?.source_id || null,
                }
              : {}),
            company_id: company,
            lines: clean,
          },
          { "Idempotency-Key": idempotency.current },
        );
        await complete();
      }}
    >
      <h3>Líneas</h3>
      {lines.map((l, i) => (
        <fieldset key={i}>
          <legend>Línea {i + 1}</legend>
          <div className="form-grid">
            <label>
              Cuenta
              <select
                aria-label="Cuenta"
                required
                value={l.account_id || ""}
                onChange={(e) => update(i, "account_id", e.target.value)}
              >
                <option value="">Seleccione</option>
                {options.accounts?.map((a: Row) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Descripción
              <input
                required
                value={l.description || ""}
                onChange={(e) => update(i, "description", e.target.value)}
              />
            </label>
            {kind === "journal" ? (
              <>
                {["debit", "credit", "foreign_amount"].map((k, n) => (
                  <label key={k}>
                    {
                      [
                        "Debe funcional",
                        "Haber funcional",
                        "Importe en moneda de transacción",
                      ][n]
                    }
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={l[k] ?? ""}
                      onChange={(e) => update(i, k, e.target.value)}
                    />
                  </label>
                ))}
                <label>
                  Tipo de tercero
                  <select
                    value={l.third_party_type || ""}
                    onChange={(e) => {
                      setLines(
                        lines.map((x, n) =>
                          n === i
                            ? {
                                ...x,
                                third_party_type: e.target.value,
                                third_party_id: "",
                              }
                            : x,
                        ),
                      );
                    }}
                  >
                    <option value="">Sin tercero</option>
                    <option value="supplier">Proveedor</option>
                    <option value="customer">Cliente</option>
                    <option value="employee">Colaborador</option>
                  </select>
                </label>
                {l.third_party_type && (
                  <label>
                    Tercero
                    <select
                      required
                      value={l.third_party_id || ""}
                      onChange={(e) =>
                        update(i, "third_party_id", e.target.value)
                      }
                    >
                      <option value="">Seleccione</option>
                      {options[
                        l.third_party_type === "supplier"
                          ? "suppliers"
                          : l.third_party_type === "customer"
                            ? "customers"
                            : "employees"
                      ]?.map((p: Row) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {[
                  ["cost_center", "cost_centers", "CECO"],
                  ["project", "projects", "Proyecto"],
                  ["subproject", "subprojects", "Subproyecto"],
                  ["area", "areas", "Área"],
                ].map(([type, list, label]) => (
                  <label key={type}>
                    {label}
                    <select
                      value={
                        l.dimensions?.find(
                          (d: Row) => d.dimension_type === type,
                        )?.dimension_id || ""
                      }
                      onChange={(e) =>
                        update(i, "dimensions", [
                          ...(l.dimensions || []).filter(
                            (d: Row) => d.dimension_type !== type,
                          ),
                          ...(e.target.value
                            ? [
                                {
                                  dimension_type: type,
                                  dimension_id: e.target.value,
                                },
                              ]
                            : []),
                        ])
                      }
                    >
                      <option value="">Sin dimensión</option>
                      {options[list!]?.map((d: Row) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </>
            ) : (
              <>
                <label>
                  Lado
                  <select
                    value={l.side}
                    onChange={(e) => update(i, "side", e.target.value)}
                  >
                    <option value="debit">Debe</option>
                    <option value="credit">Haber</option>
                  </select>
                </label>
                <label>
                  Importe origen
                  <select
                    value={l.amount_key}
                    onChange={(e) => update(i, "amount_key", e.target.value)}
                  >
                    <option value="amount">Total</option>
                    <option value="net_amount">Neto</option>
                    <option value="tax_amount">Impuesto</option>
                  </select>
                </label>
                <label>
                  Multiplicador
                  <input
                    type="number"
                    step="any"
                    value={l.multiplier ?? 1}
                    onChange={(e) => update(i, "multiplier", e.target.value)}
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(l.use_third_party)}
                    onChange={(e) =>
                      update(i, "use_third_party", e.target.checked)
                    }
                  />
                  Usar tercero del origen
                </label>
                {[
                  ["cost_center", "CECO"],
                  ["project", "Proyecto"],
                  ["subproject", "Subproyecto"],
                  ["area", "Área"],
                ].map(([type, label]) => (
                  <label key={type}>
                    <input
                      type="checkbox"
                      checked={(l.dimension_types || []).includes(type)}
                      onChange={(e) =>
                        update(
                          i,
                          "dimension_types",
                          e.target.checked
                            ? [...(l.dimension_types || []), type]
                            : (l.dimension_types || []).filter(
                                (x: string) => x !== type,
                              ),
                        )
                      }
                    />
                    {label} del origen
                  </label>
                ))}
              </>
            )}
          </div>
          <button
            type="button"
            disabled={lines.length <= 2}
            onClick={() => setLines(lines.filter((_, n) => n !== i))}
          >
            Quitar línea
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        onClick={() =>
          setLines([
            ...lines,
            {
              description: "",
              debit: 0,
              credit: 0,
              side: "debit",
              amount_key: "amount",
            },
          ])
        }
      >
        Añadir línea
      </button>
      <p>
        El sistema verifica balance exacto, período, cuenta, tercero y
        dimensiones antes de contabilizar. No aplica redondeos implícitos.
      </p>
    </Form>
  );
}
