import React, { useEffect, useState, useRef } from "react";
import { all, api, query, type Row } from "./api";
import { type Catalog, type Field, labels, stateLabels } from "./catalog";
export const Empty = ({
  text = "No hay datos disponibles todavía",
}: {
  text?: string;
}) => (
  <div className="empty">
    <span className="empty-icon">▤</span>
    <p>{text}</p>
  </div>
);
export const ErrorBox = ({ error }: { error: string }) =>
  error ? (
    <div role="alert" className="error">
      {error}
    </div>
  ) : null;
export function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const container = useRef<HTMLElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    container.current?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const items = Array.from(
          container.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
          ) || [],
        ).filter((el) => el.getClientRects().length);
        const first = items[0],
          last = items.at(-1);
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === container.current)
        ) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", listener);
    return () => {
      document.removeEventListener("keydown", listener);
      previous?.focus();
    };
  }, []);
  return (
    <div className="overlay">
      <section
        ref={container}
        tabIndex={-1}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button aria-label="Cerrar" onClick={close}>
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function Form({
  fields,
  initial,
  onSave,
  company,
  close,
}: {
  fields: Field[];
  initial: Row;
  onSave: (data: Row) => Promise<void>;
  company: string;
  close: () => void;
}) {
  const [values, setValues] = useState<Row>(initial),
    [options, setOptions] = useState<Record<string, Row[]>>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let valid = true;
    Promise.all(
      fields
        .filter((f) => f.source)
        .map(
          async (f) =>
            [
              f.key,
              await all(
                "/" + f.source,
                [
                  "cost-centers",
                  "cost-center-categories",
                  "projects",
                  "subprojects",
                ].includes(f.source!)
                  ? { company_id: company }
                  : {},
              ),
            ] as const,
        ),
    )
      .then((entries) => {
        if (valid) setOptions(Object.fromEntries(entries));
      })
      .catch((e) => setError(e.message));
    return () => {
      valid = false;
    };
  }, [fields, company]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data: Row = {};
      for (const f of fields) {
        const v = values[f.key];
        if (f.type === "checkbox") data[f.key] = v ?? true;
        else if (f.type === "number")
          data[f.key] = v === "" || v == null ? null : Number(v);
        else if (f.source || f.type === "date") data[f.key] = v || null;
        else data[f.key] = v ?? (f.required ? "" : null);
      }
      await onSave(data);
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <ErrorBox error={error} />
      <div className="form-grid">
        {fields.map((f) => (
          <label key={f.key} className={f.type === "textarea" ? "full" : ""}>
            {f.label}
            {f.required ? " *" : ""}
            {f.type === "checkbox" ? (
              <input
                type="checkbox"
                checked={values[f.key] ?? true}
                onChange={(e) =>
                  setValues({ ...values, [f.key]: e.target.checked })
                }
              />
            ) : f.source || f.options ? (
              <select
                required={f.required}
                value={values[f.key] ?? ""}
                onChange={(e) =>
                  setValues({ ...values, [f.key]: e.target.value })
                }
              >
                <option value="">Seleccionar</option>
                {f.options?.map((v) => (
                  <option key={v} value={v}>
                    {stateLabels[v] || v}
                  </option>
                ))}
                {options[f.key]
                  ?.filter((r) => r.id !== initial.id)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code ? `${r.code} · ` : ""}
                      {r.name || r.full_name || r.legal_name}
                    </option>
                  ))}
              </select>
            ) : f.type === "textarea" ? (
              <textarea
                maxLength={2000}
                value={values[f.key] ?? ""}
                onChange={(e) =>
                  setValues({ ...values, [f.key]: e.target.value })
                }
              />
            ) : (
              <input
                autoComplete="off"
                required={f.required}
                type={f.type || "text"}
                maxLength={f.key === "description" ? 2000 : 254}
                min={f.type === "number" ? 0 : undefined}
                value={values[f.key] ?? ""}
                onChange={(e) =>
                  setValues({ ...values, [f.key]: e.target.value })
                }
              />
            )}
          </label>
        ))}
      </div>
      <footer className="form-actions">
        <button type="button" onClick={close}>
          Cancelar
        </button>
        <button className="primary" disabled={busy}>
          {busy ? "Guardando…" : "Guardar cambios"}
        </button>
      </footer>
    </form>
  );
}
export function DataTable({
  rows,
  columns,
  onSelect,
  display,
}: {
  rows: Row[];
  columns: string[];
  onSelect?: (r: Row) => void;
  display?: (r: Row, k: string) => React.ReactNode;
}) {
  return rows.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((k) => (
              <th key={k}>{labels[k] || k}</th>
            ))}
            {onSelect && <th>Detalle</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id || i}>
              {columns.map((k) => (
                <td key={k}>
                  {display?.(r, k) ??
                    (typeof r[k] === "boolean" ? (
                      <span className={"badge " + (r[k] ? "green" : "")}>
                        {r[k] ? "Activo" : "Inactivo"}
                      </span>
                    ) : (
                      stateLabels[r[k]] || String(r[k] ?? "—")
                    ))}
                </td>
              ))}
              {onSelect && (
                <td>
                  <button className="link" onClick={() => onSelect(r)}>
                    Abrir ↗
                  </button>
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
export function ProjectHierarchy({ company }: { company: string }) {
  const [projects, setProjects] = useState<Row[]>([]),
    [subs, setSubs] = useState<Row[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let valid = true;
    Promise.all([
      all("/projects", { company_id: company }),
      all("/subprojects", { company_id: company }),
    ])
      .then(([p, s]) => {
        if (valid) {
          setProjects(p);
          setSubs(s);
        }
      })
      .catch((e) => {
        if (valid) setError(e.message);
      });
    return () => {
      valid = false;
    };
  }, [company]);
  return (
    <details className="panel">
      <summary className="toolbar">
        Jerarquía de proyectos y subproyectos
      </summary>
      <ErrorBox error={error} />
      <ul className="tree">
        {projects.map((p) => (
          <li key={p.id}>
            <p>
              <span className="mono">{p.code}</span>
              {p.name} · {stateLabels[p.status]}
            </p>
            <ul>
              {subs
                .filter((s) => s.project_id === p.id)
                .map((s) => (
                  <li key={s.id}>
                    <p>
                      <span className="mono">{s.code}</span>
                      {s.name} · {stateLabels[s.status]}
                    </p>
                  </li>
                ))}
            </ul>
          </li>
        ))}
      </ul>
    </details>
  );
}
export function EntityPage({
  config,
  company,
  can,
  onDetail,
  extra,
  refreshKey = 0,
}: {
  config: Catalog;
  company: string;
  can: (p: string) => boolean;
  onDetail?: (r: Row) => void;
  extra?: React.ReactNode;
  refreshKey?: number;
}) {
  const [filters, setFilters] = useState<Row>({}),
    [applied, setApplied] = useState<Row>({});
  const [rows, setRows] = useState<Row[]>([]),
    [count, setCount] = useState(0),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true),
    [edit, setEdit] = useState<Row | null>(null),
    [refresh, setRefresh] = useState(0),
    [search, setSearch] = useState(""),
    [state, setState] = useState(""),
    [tree, setTree] = useState(false),
    [lookups, setLookups] = useState<Record<string, Row[]>>({});
  useEffect(() => {
    setPage(1);
    setSearch("");
    setState("");
    setFilters({});
    setApplied({});
  }, [config, company]);
  useEffect(() => {
    let valid = true;
    setRows([]);
    setBusy(true);
    setError("");
    const params = config.scoped ? { company_id: company } : {};
    const load =
      tree && config.permission === "cost_center"
        ? all(config.endpoint, { ...params, ...applied }).then((data) => ({
            data,
            count: data.length,
          }))
        : api(
            config.endpoint + query({ ...params, ...applied, page, limit: 25 }),
          );
    load
      .then((r) => {
        if (valid) {
          setRows(r.data);
          setCount(r.count);
        }
      })
      .catch((e) => {
        if (valid) setError(e.message);
      })
      .finally(() => {
        if (valid) setBusy(false);
      });
    for (const f of config.fields.filter((f) => f.source))
      all(
        "/" + f.source,
        ["cost-centers", "cost-center-categories", "projects"].includes(
          f.source!,
        )
          ? { company_id: company }
          : {},
      )
        .then((r) => {
          if (valid) setLookups((v) => ({ ...v, [f.key]: r }));
        })
        .catch(() => {});
    if (config.permission === "user" && can("company.view"))
      all("/companies")
        .then((r) => {
          if (valid) setLookups((v) => ({ ...v, company_id: r }));
        })
        .catch(() => {});
    return () => {
      valid = false;
    };
  }, [config, company, page, refresh, refreshKey, tree, applied]);
  const filtered = rows.filter(
    (r) =>
      (!search ||
        [r.code, r.name, r.legal_name, r.full_name, r.email].some((v) =>
          String(v || "")
            .toLowerCase()
            .includes(search.toLowerCase()),
        )) &&
      (!state || String(r.active ?? r.status) === state),
  );
  const fields = config.fields.filter(
    (f) =>
      !(edit?.id && f.key === "email") &&
      !(edit?.is_system && f.key === "code") &&
      (!edit?.id ||
        f.key !== "active" ||
        can(
          config.permission === "role"
            ? "permission.assign"
            : config.permission + ".disable",
        )) &&
      (!edit?.id || f.key !== "status" || can(config.permission + ".disable")),
  );
  const display = (r: Row, k: string) =>
    lookups[k]?.find((x) => x.id === r[k])?.name ??
    (k === "user_companies"
      ? (r[k] || [])
          .filter((m: Row) => m.active)
          .map(
            (m: Row) =>
              lookups.company_id?.find((c) => c.id === m.company_id)
                ?.legal_name || m.company_id,
          )
          .join(", ") || "Sin empresas"
      : undefined);
  function branch(
    parent: string | null,
    seen = new Set<string>(),
  ): React.ReactNode {
    return rows
      .filter((r) => (r.parent_id || null) === parent)
      .map((r) => {
        if (seen.has(r.id)) return null;
        const next = new Set(seen).add(r.id);
        return (
          <li key={r.id}>
            <button onClick={() => (onDetail ? onDetail(r) : setEdit(r))}>
              <span className="mono">{r.code}</span> {r.name}{" "}
              <span className="muted">{r.active ? "" : "· Inactivo"}</span>
            </button>
            <ul>{branch(r.id, next)}</ul>
          </li>
        );
      });
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">MAESTROS / ADMINISTRACIÓN</p>
          <h1>{config.title}</h1>
          <p>{config.description}</p>
        </div>
        {can(config.permission + ".create") && (
          <button
            className="primary"
            onClick={() =>
              setEdit({
                active: true,
                status: config.permission === "user" ? "inactive" : "active",
                valid_from: new Date().toISOString().slice(0, 10),
                country_code: "PE",
                decimal_places: 2,
              })
            }
          >
            ＋ {config.permission === "user" ? "Nuevo usuario" : "Crear nuevo"}
          </button>
        )}
      </div>
      {extra}
      <section className="panel">
        <div className="toolbar">
          <input
            aria-label="Buscar en página"
            placeholder="Buscar código o nombre en esta página…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            aria-label="Estado"
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            <option value="">Todos los estados</option>
            {config.fields.some((f) => f.key === "active") ? (
              <>
                <option value="true">Activo</option>
                <option value="false">Inactivo</option>
              </>
            ) : (
              Object.entries(stateLabels).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))
            )}
          </select>
          {config.permission === "cost_center" &&
            config.endpoint === "/cost-centers" && (
              <button onClick={() => setTree(!tree)}>
                {tree ? "Vista tabla" : "Vista árbol"}
              </button>
            )}
          <button onClick={() => setRefresh(refresh + 1)}>Actualizar</button>
        </div>
        <form
          className="toolbar wrap"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setApplied({ ...filters });
          }}
        >
          {config.permission === "user" &&
            ["company_id", "area_id", "position_id"].map((k) => (
              <label key={k}>
                {labels[k]}
                <select
                  value={filters[k] || ""}
                  onChange={(e) =>
                    setFilters({ ...filters, [k]: e.target.value })
                  }
                >
                  <option value="">Todos</option>
                  {lookups[k]?.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name || r.legal_name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          {config.permission === "user" && (
            <label>
              Estado global
              <select
                value={filters.status || ""}
                onChange={(e) =>
                  setFilters({ ...filters, status: e.target.value })
                }
              >
                <option value="">Todos</option>
                {["active", "inactive", "blocked"].map((v) => (
                  <option key={v} value={v}>
                    {stateLabels[v]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {config.permission === "cost_center" &&
            config.endpoint === "/cost-centers" && (
              <>
                <label>
                  Código exacto
                  <input
                    value={filters.code || ""}
                    onChange={(e) =>
                      setFilters({ ...filters, code: e.target.value })
                    }
                  />
                </label>
                <label>
                  Nombre
                  <input
                    value={filters.name || ""}
                    onChange={(e) =>
                      setFilters({ ...filters, name: e.target.value })
                    }
                  />
                </label>
                <label>
                  Categoría
                  <select
                    value={filters.category_id || ""}
                    onChange={(e) =>
                      setFilters({ ...filters, category_id: e.target.value })
                    }
                  >
                    <option value="">Todas</option>
                    {lookups.category_id?.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Estado global
                  <select
                    value={filters.active || ""}
                    onChange={(e) =>
                      setFilters({ ...filters, active: e.target.value })
                    }
                  >
                    <option value="">Todos</option>
                    <option value="true">Activo</option>
                    <option value="false">Inactivo</option>
                  </select>
                </label>
              </>
            )}
          {["user", "cost_center"].includes(config.permission) && (
            <button>Aplicar filtros globales</button>
          )}
        </form>
        <ErrorBox error={error} />
        {busy ? (
          <p className="loading">Cargando registros…</p>
        ) : tree &&
          !search &&
          !state &&
          !Object.values(applied).some(Boolean) ? (
          <ul className="tree">{branch(null)}</ul>
        ) : (
          <DataTable
            rows={filtered}
            columns={config.columns}
            display={display}
            onSelect={(r) => (onDetail ? onDetail(r) : setEdit(r))}
          />
        )}
        <footer className="pagination">
          <span>
            {count} registros · {tree ? "jerarquía completa" : `Página ${page}`}
          </span>
          {!tree && (
            <div>
              <button disabled={page === 1} onClick={() => setPage(page - 1)}>
                Anterior
              </button>
              <button
                disabled={page * 25 >= count}
                onClick={() => setPage(page + 1)}
              >
                Siguiente
              </button>
            </div>
          )}
        </footer>
      </section>
      {edit && (
        <Modal
          title={edit.id ? "Detalle y edición" : "Nuevo registro"}
          close={() => setEdit(null)}
        >
          {edit.id && !can(config.permission + ".edit") ? (
            <pre>{JSON.stringify(edit, null, 2)}</pre>
          ) : (
            <Form
              fields={fields}
              initial={edit}
              company={company}
              close={() => setEdit(null)}
              onSave={async (data) => {
                if (edit.id) {
                  for (const k of Object.keys(data))
                    if (data[k] === edit[k]) delete data[k];
                  if (!Object.keys(data).length) return;
                }
                await api(
                  config.endpoint +
                    (edit.id ? "/" + edit.id : "") +
                    query(config.scoped ? { company_id: company } : {}),
                  edit.id ? "PATCH" : "POST",
                  data,
                  config.permission === "user"
                    ? { "Idempotency-Key": crypto.randomUUID() }
                    : {},
                );
                setRefresh(refresh + 1);
              }}
            />
          )}
        </Modal>
      )}
    </>
  );
}
