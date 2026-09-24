import React, { useEffect, useState } from "react";
import { api, query, type Row } from "./api";
import { Empty, ErrorBox, Modal } from "./components";
const statuses: Record<string, string> = {
  pending_mapping: "Pendiente de regla",
  ready: "Preparado",
  previewed: "Previsualizado",
  draft_generated: "Borrador generado",
  posted: "Posteado",
  ignored_authorized: "Excluido con autorización",
  error: "Requiere revisión",
};
export function AccountingEventsPage({
  company,
  can,
}: {
  company: string;
  can: (permission: string) => boolean;
}) {
  const [rows, setRows] = useState<Row[]>([]),
    [status, setStatus] = useState(""),
    [eventType, setEventType] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [thirdParty, setThirdParty] = useState(""),
    [costCenter, setCostCenter] = useState(""),
    [project, setProject] = useState(""),
    [page, setPage] = useState(1),
    [count, setCount] = useState(0),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [detail, setDetail] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [options, setOptions] = useState<Row>({}),
    [period, setPeriod] = useState(""),
    [entryType, setEntryType] = useState(""),
    [generationKey, setGenerationKey] = useState("");
  async function load() {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams(window.location.search),
        entity_type = params.get("entity_type"),
        entity_id = params.get("entity_id");
      const result = await api(
        (entity_type && entity_id
          ? "/accounting/trace"
          : "/accounting/events") +
          query({
            company_id: company,
            page,
            limit: 30,
            ...(entity_type && entity_id
              ? { entity_type, entity_id }
              : status
                ? { status }
                : {}),
            ...(eventType ? { event_type: eventType } : {}),
            ...(from ? { from } : {}),
            ...(to ? { to } : {}),
            ...(thirdParty ? { third_party_id: thirdParty } : {}),
            ...(costCenter ? { cost_center_id: costCenter } : {}),
            ...(project ? { project_id: project } : {}),
          }),
      );
      setRows(result.data);
      setCount(result.count);
    } catch (e) {
      setRows([]);
      setCount(0);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [
    company,
    status,
    eventType,
    from,
    to,
    thirdParty,
    costCenter,
    project,
    page,
  ]);
  async function open(id: string) {
    setError("");
    try {
      setDetail(await api("/accounting/events/" + id));
      setGenerationKey(crypto.randomUUID());
      setPeriod("");
      setEntryType("");
      if (can("journal.create"))
        setOptions(
          await api("/accounting/options" + query({ company_id: company })),
        );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function action(name: string, body: Row = {}) {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      await api(
        "/accounting/events/" + detail.record.id + "/" + name,
        "POST",
        body,
        name === "generate" ? { "Idempotency-Key": generationKey } : {},
      );
      setDetail(await api("/accounting/events/" + detail.record.id));
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const linked = new URLSearchParams(window.location.search).get("event_id");
    if (linked) void open(linked);
  }, [company]);
  const event = detail?.record;
  return (
    <section>
      <nav aria-label="Ruta">Contabilidad / Operaciones pendientes</nav>
      <h1>Operaciones pendientes</h1>
      <p>
        Los eventos conservan la operación original. Una operación sin regla
        queda pendiente de configuración.
      </p>
      <ErrorBox error={error} />
      <label>
        Estado{" "}
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Todos</option>
          {Object.entries(statuses).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label>
        Evento{" "}
        <input
          value={eventType}
          maxLength={80}
          placeholder="PAYABLE_RECOGNIZED"
          onChange={(e) => {
            setEventType(e.target.value.toUpperCase());
            setPage(1);
          }}
        />
      </label>
      <label>
        Desde{" "}
        <input
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(1);
          }}
        />
      </label>
      <label>
        Hasta{" "}
        <input
          type="date"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPage(1);
          }}
        />
      </label>
      <label>
        Tercero (ID){" "}
        <input
          value={thirdParty}
          placeholder="UUID"
          onChange={(e) => {
            setThirdParty(e.target.value);
            setPage(1);
          }}
        />
      </label>
      <label>
        CECO (ID){" "}
        <input
          value={costCenter}
          placeholder="UUID"
          onChange={(e) => {
            setCostCenter(e.target.value);
            setPage(1);
          }}
        />
      </label>
      <label>
        Proyecto (ID){" "}
        <input
          value={project}
          placeholder="UUID"
          onChange={(e) => {
            setProject(e.target.value);
            setPage(1);
          }}
        />
      </label>
      <button onClick={() => void load()} disabled={loading}>
        Actualizar
      </button>
      {loading ? (
        <p role="status">Cargando operaciones…</p>
      ) : !rows.length ? (
        <Empty text="No hay operaciones contables para esta empresa y filtro." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {[
                  "Fecha",
                  "Evento",
                  "Origen",
                  "Importe",
                  "Moneda",
                  "Estado",
                  "Acción",
                ].map((x) => (
                  <th key={x}>{x}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.event_date}</td>
                  <td>{r.event_type}</td>
                  <td>{r.source_type}</td>
                  <td>{r.amount}</td>
                  <td>{r.source_snapshot?.currency_code || r.currency_id}</td>
                  <td>
                    <span className="badge">
                      {statuses[r.status] || r.status}
                    </span>
                  </td>
                  <td>
                    <button onClick={() => void open(r.id)}>
                      Ver trazabilidad
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p>
        {count} operaciones · Página {page}
      </p>
      <button
        disabled={page === 1 || loading}
        onClick={() => setPage((p) => p - 1)}
      >
        Anterior
      </button>
      <button
        disabled={page * 30 >= count || loading}
        onClick={() => setPage((p) => p + 1)}
      >
        Siguiente
      </button>
      {event && (
        <Modal title="Trazabilidad contable" close={() => setDetail(null)}>
          <ErrorBox error={error} />
          {event.demo_configuration && (
            <p className="environment-banner">
              CONFIGURACIÓN DEMO - NO PRODUCTIVA
            </p>
          )}
          <p>
            {event.event_type} · {statuses[event.status]} · {event.event_date}
          </p>
          <dl>
            <dt>Operación original</dt>
            <dd>
              {event.source_type} / {event.source_id}
            </dd>
            <dt>Versión de origen</dt>
            <dd>{event.source_revision}</dd>
            <dt>Empresa</dt>
            <dd>{event.company_id}</dd>
            <dt>Importe</dt>
            <dd>{event.amount}</dd>
            <dt>Regla</dt>
            <dd>{event.rule_id || "Sin regla asignada"}</dd>
          </dl>
          <details>
            <summary>Evidencia original y dimensiones</summary>
            <pre>
              {JSON.stringify(
                {
                  source: event.source_snapshot,
                  dimensions: event.dimensions,
                  sources: detail?.sources,
                },
                null,
                2,
              )}
            </pre>
          </details>
          {event.journal_entry_id ? (
            <p>
              Asiento vinculado:{" "}
              <a
                href={
                  "/app/accounting-journals?journal_id=" +
                  encodeURIComponent(event.journal_entry_id)
                }
              >
                {event.journal_entry_id}
              </a>
            </p>
          ) : (
            <>
              <p>
                La generación crea un borrador y exige actores independientes
                para validarlo y postearlo.
              </p>
              {can("accounting_event.resolve") && (
                <button disabled={busy} onClick={() => void action("resolve")}>
                  Resolver regla
                </button>
              )}
              {can("accounting_event.preview") && (
                <button
                  disabled={busy || !event.rule_id}
                  onClick={() => void action("preview")}
                >
                  Previsualizar
                </button>
              )}
              {can("accounting_event.generate") && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action("generate", {
                      period_id: period,
                      entry_type_id: entryType,
                    });
                  }}
                >
                  <label>
                    Período
                    <select
                      required
                      value={period}
                      aria-label="Período"
                      onChange={(e) => setPeriod(e.target.value)}
                    >
                      <option value="">Seleccionar</option>
                      {(options.periods || [])
                        .filter((p: Row) => p.status === "open")
                        .map((p: Row) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Tipo de asiento
                    <select
                      required
                      value={entryType}
                      aria-label="Tipo de asiento"
                      onChange={(e) => setEntryType(e.target.value)}
                    >
                      <option value="">Seleccionar</option>
                      {(options.entry_types || []).map((p: Row) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    disabled={
                      busy || !["ready", "previewed"].includes(event.status)
                    }
                  >
                    Generar borrador DEMO
                  </button>
                </form>
              )}
            </>
          )}
          {event.preview_result && (
            <>
              <h3>Preview conservado</h3>
              <p>Regla: {event.rule_id}. No constituye posteo.</p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Cuenta</th>
                      <th>Debe</th>
                      <th>Haber</th>
                      <th>Dimensiones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(event.preview_result.lines || []).map(
                      (l: Row, i: number) => (
                        <tr key={i}>
                          <td>
                            {l.account_code || l.account_id} {l.account_name}
                          </td>
                          <td>{l.debit}</td>
                          <td>{l.credit}</td>
                          <td>{JSON.stringify(l.dimensions)}</td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Modal>
      )}
    </section>
  );
}
