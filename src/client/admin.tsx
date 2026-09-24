import React, { useEffect, useState } from "react";
import { all, api, query, type Row } from "./api";
import { catalogs, permissionLabel } from "./catalog";
import { DataTable, Empty, ErrorBox, Form, Modal } from "./components";
export function PermissionMatrix({
  role,
  can,
  close,
}: {
  role: Row;
  can: (p: string) => boolean;
  close: () => void;
}) {
  const [permissions, setPermissions] = useState<Row[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true);
  useEffect(() => {
    Promise.all([all("/permissions"), all(`/roles/${role.id}/permissions`)])
      .then(([p, g]) => {
        setPermissions(p);
        setSelected(g.map((x) => x.permission_id));
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  }, [role.id]);
  const groups = [...new Set(permissions.map((p) => p.resource))];
  const names: Record<string, string> = {
    payment: "Pagos",
    user: "Usuarios",
    role: "Roles",
    permission: "Permisos",
    cost_center: "Centros de costo",
    project: "Proyectos",
    subproject: "Subproyectos",
    currency: "Monedas",
    company: "Empresas",
    audit: "Auditoría",
    area: "Áreas",
    position: "Cargos",
    settings: "Configuración",
    supplier: "Proveedores",
    request: "Solicitudes",
    budget: "Presupuestos",
    advance: "Anticipos",
    expense_report: "Rendiciones",
    bank: "Bancos",
    dashboard: "Dashboard",
    invoice: "Documentos de compra",
    sworn_declaration: "Declaraciones juradas",
    vendor_refund: "Recuperaciones de proveedores",
    employee_return: "Devoluciones de colaboradores",
    employee_reimbursement: "Reembolsos a colaboradores",
    service_acceptance: "Conformidad de servicios",
    payment_batch: "Lotes de pago",
    purchase_order: "Órdenes de compra",
    payable: "Cuentas por pagar",
    reconciliation: "Conciliación bancaria",
    recurring_service: "Servicios recurrentes",
    contract: "Contratos",
    report: "Reportes",
    exchange_rate: "Tipos de cambio",
  };
  return (
    <Modal title={"Permisos · " + role.name} close={close}>
      <p className="muted">
        Las capacidades sensibles están señaladas. El servidor impide modificar
        los permisos de un rol que usted posee.
      </p>
      <ErrorBox error={error} />
      {busy ? (
        <p>Cargando…</p>
      ) : (
        <>
          <div className="permission-grid">
            {groups.map((group) => (
              <section className="permission-group" key={group}>
                <h3>{names[group] || group.replaceAll("_", " ")}</h3>
                {can("permission.assign") && (
                  <div className="small-actions">
                    <button
                      onClick={() =>
                        setSelected([
                          ...new Set([
                            ...selected,
                            ...permissions
                              .filter(
                                (p) =>
                                  p.resource === group &&
                                  p.active &&
                                  !(role.is_system && p.requires_company),
                              )
                              .map((p) => p.id),
                          ]),
                        ])
                      }
                    >
                      Seleccionar todos
                    </button>
                    <button
                      onClick={() =>
                        setSelected(
                          selected.filter(
                            (id) =>
                              !permissions.some(
                                (p) => p.id === id && p.resource === group,
                              ),
                          ),
                        )
                      }
                    >
                      Quitar todos
                    </button>
                  </div>
                )}
                {permissions
                  .filter((p) => p.resource === group)
                  .map((p) => (
                    <label className="check-row" title={p.code} key={p.id}>
                      <input
                        type="checkbox"
                        disabled={
                          !can("permission.assign") ||
                          !p.active ||
                          (role.is_system && p.requires_company)
                        }
                        checked={selected.includes(p.id)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, p.id]
                              : selected.filter((id) => id !== p.id),
                          )
                        }
                      />
                      <span>
                        {permissionLabel(p as any)}{" "}
                        {p.is_sensitive && (
                          <small className="sensitive">Sensible</small>
                        )}
                      </span>
                    </label>
                  ))}
              </section>
            ))}
          </div>
          {can("permission.assign") && (
            <footer className="form-actions">
              <button
                className="primary"
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api(`/roles/${role.id}/permissions`, "PUT", {
                      permission_ids: selected,
                    });
                    close();
                  } catch (e) {
                    setError((e as Error).message);
                    setBusy(false);
                  }
                }}
              >
                Guardar permisos
              </button>
            </footer>
          )}
        </>
      )}
    </Modal>
  );
}
export function AuditPage({
  company,
  can,
  userId,
  entityId,
}: {
  company: string;
  can: (p: string) => boolean;
  userId?: string;
  entityId?: string;
}) {
  const [companyFilter, setCompanyFilter] = useState(company),
    [companyOptions, setCompanyOptions] = useState<Row[]>([]),
    [actors, setActors] = useState<Row[]>([]);
  useEffect(() => {
    if (can("company.view"))
      all("/companies")
        .then(setCompanyOptions)
        .catch(() => {});
    if (can("user.view"))
      all("/users")
        .then(setActors)
        .catch(() => {});
  }, []);
  const [filters, setFilters] = useState<Row>({
      user_id: userId || "",
      entity_id: entityId || "",
      category: can("audit.view") ? "" : "finance",
    }),
    [page, setPage] = useState(1),
    [rows, setRows] = useState<Row[]>([]),
    [count, setCount] = useState(0),
    [error, setError] = useState(""),
    [detail, setDetail] = useState<Row | null>(null),
    [applied, setApplied] = useState<Row>(filters);
  useEffect(() => {
    let valid = true;
    setRows([]);
    api(
      "/audit" +
        query({
          ...applied,
          company_id: companyFilter || undefined,
          page,
          limit: 25,
        }),
    )
      .then((r) => {
        if (valid) {
          setRows(r.data);
          setCount(r.count);
        }
      })
      .catch((e) => {
        if (valid) setError(e.message);
      });
    return () => {
      valid = false;
    };
  }, [companyFilter, page, applied]);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">TRAZABILIDAD</p>
          <h1>Auditoría administrativa</h1>
          <p>Eventos registrados por el servidor. Fechas del filtro en UTC.</p>
        </div>
      </div>
      <section className="panel">
        <form
          className="toolbar wrap"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setError("");
            setApplied({ ...filters });
          }}
        >
          {[
            ["from", "Desde", "date"],
            ["to", "Hasta", "date"],
            ["user_id", "Actor (UUID)", "text"],
            ["action", "Acción", "text"],
            ["entity_type", "Entidad", "text"],
          ].map(([key, label, type]) => (
            <label key={key}>
              {label}
              <input
                type={type}
                value={filters[key] || ""}
                onChange={(e) =>
                  setFilters({ ...filters, [key]: e.target.value })
                }
              />
            </label>
          ))}
          <label>
            Empresa
            <select
              value={companyFilter}
              onChange={(e) => {
                setCompanyFilter(e.target.value);
                setPage(1);
              }}
            >
              {can("audit.view") && (
                <option value="">Todas las autorizadas / plataforma</option>
              )}
              {companyOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.legal_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Categoría
            <select
              value={filters.category}
              onChange={(e) =>
                setFilters({ ...filters, category: e.target.value })
              }
            >
              {can("audit.view") && (
                <>
                  <option value="">Administrativa y accesible</option>
                  {[
                    "authentication",
                    "security",
                    "administration",
                    "system",
                  ].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </>
              )}
              {can("audit.finance_view") && (
                <option value="finance">finance</option>
              )}
            </select>
          </label>
          <button className="primary">Aplicar filtros</button>
        </form>
        <ErrorBox error={error} />
        <DataTable
          rows={rows}
          columns={[
            "created_at",
            "user_id",
            "action",
            "entity_type",
            "company_id",
            "reason",
          ]}
          onSelect={setDetail}
          display={(r, k) =>
            k === "created_at"
              ? new Date(r[k]).toLocaleString("es-PE")
              : k === "user_id"
                ? actors.find((a) => a.id === r.user_id)?.full_name
                : k === "company_id"
                  ? companyOptions.find((c) => c.id === r.company_id)
                      ?.legal_name
                  : undefined
          }
        />
        <footer className="pagination">
          <span>{count} eventos</span>
          <button disabled={page === 1} onClick={() => setPage(page - 1)}>
            Anterior
          </button>
          <button
            disabled={page * 25 >= count}
            onClick={() => setPage(page + 1)}
          >
            Siguiente
          </button>
        </footer>
      </section>
      {detail && (
        <Modal title="Detalle del evento" close={() => setDetail(null)}>
          <p>
            {detail.action} · {detail.entity_type} · {detail.created_at}
          </p>
          <div className="diff">
            <section>
              <h3>Antes</h3>
              <pre>{JSON.stringify(detail.old_values, null, 2) || "—"}</pre>
            </section>
            <section>
              <h3>Después</h3>
              <pre>{JSON.stringify(detail.new_values, null, 2) || "—"}</pre>
            </section>
          </div>
        </Modal>
      )}
    </>
  );
}
export function UserDetail({
  user,
  actorId,
  company,
  can,
  close,
}: {
  user: Row;
  actorId: string;
  company: string;
  can: (p: string) => boolean;
  close: () => void;
}) {
  const [tab, setTab] = useState("Información"),
    [error, setError] = useState(""),
    [roles, setRoles] = useState<Row[]>([]),
    [companies, setCompanies] = useState<Row[]>([]),
    [permissions, setPermissions] = useState<Row[]>([]),
    [links, setLinks] = useState<Row[]>([]),
    [role, setRole] = useState(""),
    [scope, setScope] = useState(company),
    [permission, setPermission] = useState(""),
    [effect, setEffect] = useState("deny"),
    [reason, setReason] = useState(""),
    [temporaryPassword, setTemporaryPassword] = useState(""),
    [passwordConfirmation, setPasswordConfirmation] = useState(""),
    [notice, setNotice] = useState(""),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false);
  const self = user.id === actorId;
  useEffect(() => {
    let valid = true;
    setLinks([]);
    setError("");
    const path =
      tab === "Roles"
        ? "roles"
        : tab === "Empresas"
          ? "companies"
          : tab === "Permisos especiales"
            ? "overrides"
            : null;
    if (path)
      all(`/users/${user.id}/${path}`)
        .then((r) => {
          if (valid) setLinks(r);
        })
        .catch((e) => setError(e.message));
    if (can("role.view"))
      all("/roles")
        .then(setRoles)
        .catch(() => {});
    if (can("company.view"))
      all("/companies")
        .then(setCompanies)
        .catch(() => {});
    if (can("role.view"))
      all("/permissions")
        .then(setPermissions)
        .catch(() => {});
    return () => {
      valid = false;
    };
  }, [tab, user.id, revision]);
  async function change(path: string, data: Row) {
    setBusy(true);
    setError("");
    try {
      await api(`/users/${user.id}/${path}`, "PUT", data);
      setRevision(revision + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const tabs = [
    "Información",
    ...(!self && can("user.edit") ? ["Seguridad"] : []),
    ...(can("user.view") ? ["Roles"] : []),
    ...(can("permission.assign") ? ["Permisos especiales"] : []),
    ...(can("company.assign") ? ["Empresas"] : []),
    ...(can("audit.view") ? ["Actividad"] : []),
  ];
  return (
    <Modal title={user.full_name} close={close}>
      <div className="tabs">
        {tabs.map((t) => (
          <button
            key={t}
            className={tab === t ? "selected" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <ErrorBox error={error} />
      {notice && <p className="notice" role="status">{notice}</p>}
      {self && (
        <p className="notice">
          Las modificaciones de sus propios accesos están protegidas por el
          servidor.
        </p>
      )}
      {tab === "Información" &&
        (can("user.edit") ? (
          <>
            <Form
              fields={catalogs.users.fields.filter(
                (f) =>
                  f.key !== "email" &&
                  (f.key !== "status" || (can("user.disable") && !self)) &&
                  (!self ||
                    !["area_id", "position_id", "manager_id"].includes(f.key)),
              )}
              initial={user}
              company={company}
              close={close}
              onSave={async (d) => {
                for (const k of Object.keys(d))
                  if (d[k] === user[k]) delete d[k];
                if (Object.keys(d).length)
                  await api("/users/" + user.id, "PATCH", d);
              }}
            />
            {!self && (
              <details>
                <summary>Cambiar correo de identidad</summary>
                <Form
                  fields={[
                    {
                      key: "email",
                      label: "Nuevo correo",
                      type: "email",
                      required: true,
                    },
                  ]}
                  initial={{ email: user.email }}
                  company={company}
                  close={close}
                  onSave={async (d) => {
                    await api(`/users/${user.id}/email`, "PATCH", d);
                  }}
                />
              </details>
            )}
          </>
        ) : (
          <pre>{JSON.stringify(user, null, 2)}</pre>
        ))}
      {tab === "Roles" && (
        <>
          <DataTable
            rows={links}
            columns={["role_id", "company_id", "assigned_at"]}
            display={(r, k) =>
              k === "role_id"
                ? roles.find((x) => x.id === r.role_id)?.name
                : k === "company_id"
                  ? companies.find((x) => x.id === r.company_id)?.legal_name ||
                    "Global"
                  : undefined
            }
          />
          {!self && can("role.assign") && (
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                void change("roles", {
                  role_id: role,
                  company_id: scope || null,
                  assign: true,
                });
              }}
            >
              <label>
                Rol configurado
                <select
                  required
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                >
                  <option value="">Seleccionar</option>
                  {roles
                    .filter((r) => r.active)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Alcance
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                >
                  <option value="">Global · plataforma</option>
                  {companies
                    .filter((c) => c.active)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.legal_name}
                      </option>
                    ))}
                </select>
              </label>
              <button className="primary" disabled={busy}>
                Asignar rol
              </button>
              <button
                type="button"
                disabled={busy || !role}
                onClick={() =>
                  void change("roles", {
                    role_id: role,
                    company_id: scope || null,
                    assign: false,
                  })
                }
              >
                Retirar rol seleccionado
              </button>
              <p className="muted full">
                La asignación empresarial requiere membresía activa. El alcance
                financiero no se extiende a otras empresas.
              </p>
            </form>
          )}
        </>
      )}
      {tab === "Seguridad" && (
        <form className="form-grid" onSubmit={async (event) => {
          event.preventDefault();
          setError(""); setNotice("");
          if (temporaryPassword !== passwordConfirmation) { setError("Las contraseñas no coinciden."); return; }
          setBusy(true);
          try {
            await api(`/users/${user.id}/temporary-password`, 'PUT', {password: temporaryPassword});
            setTemporaryPassword(""); setPasswordConfirmation("");
            setNotice("Contraseña provisional establecida. Las sesiones anteriores fueron cerradas y el usuario deberá cambiarla una sola vez.");
          } catch (reason) { setError((reason as Error).message); }
          finally { setBusy(false); }
        }}>
          <p className="notice full">La contraseña no se guarda en la base administrativa ni en auditoría. Al confirmar se cerrarán las sesiones actuales del usuario.</p>
          <label>Contraseña provisional · mínimo 12 caracteres<input required minLength={12} maxLength={128} type="password" autoComplete="new-password" value={temporaryPassword} onChange={(e)=>setTemporaryPassword(e.target.value)}/></label>
          <label>Confirmar contraseña provisional<input required minLength={12} maxLength={128} type="password" autoComplete="new-password" value={passwordConfirmation} onChange={(e)=>setPasswordConfirmation(e.target.value)}/></label>
          <button className="primary" disabled={busy}>{busy?'Aplicando…':'Establecer contraseña provisional'}</button>
        </form>
      )}
      {tab === "Empresas" && (
        <>
          <DataTable
            rows={links}
            columns={["company_id", "active", "assigned_at"]}
            display={(r, k) =>
              k === "company_id"
                ? companies.find((c) => c.id === r.company_id)?.legal_name
                : undefined
            }
          />
          {!self && (
            <div className="toolbar">
              <select
                aria-label="Empresa a asignar"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
              >
                <option value="">Empresa</option>
                {companies
                  .filter((c) => c.active)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.legal_name}
                    </option>
                  ))}
              </select>
              <button
                disabled={busy || !scope}
                onClick={() =>
                  void change("companies", { company_id: scope, active: true })
                }
              >
                Dar acceso
              </button>
              <button
                disabled={busy || !scope}
                onClick={() =>
                  void change("companies", { company_id: scope, active: false })
                }
              >
                Revocar acceso
              </button>
            </div>
          )}
        </>
      )}
      {tab === "Permisos especiales" && (
        <>
          <DataTable
            rows={links}
            columns={["permission_id", "company_id", "effect", "reason"]}
            display={(r, k) =>
              k === "permission_id"
                ? permissions.find((p) => p.id === r.permission_id)?.description
                : k === "company_id"
                  ? companies.find((c) => c.id === r.company_id)?.legal_name ||
                    "Global"
                  : undefined
            }
          />
          {!self && (
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                void change("overrides", {
                  permission_id: permission,
                  company_id: scope || null,
                  effect,
                  reason,
                });
              }}
            >
              <label>
                Permiso existente
                <select
                  required
                  value={permission}
                  onChange={(e) => setPermission(e.target.value)}
                >
                  <option value="">Seleccionar</option>
                  {permissions
                    .filter((p) => p.active)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.resource} · {permissionLabel(p as any)}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Empresa
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                >
                  <option value="">Global</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.legal_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Efecto
                <select
                  value={effect}
                  onChange={(e) => setEffect(e.target.value)}
                >
                  <option value="deny">Denegar</option>
                  <option value="allow">Permitir</option>
                  <option value="inherit">Retirar excepción</option>
                </select>
              </label>
              <label>
                Motivo
                <input
                  required
                  maxLength={2000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button disabled={busy} className="primary">
                Guardar excepción
              </button>
            </form>
          )}
        </>
      )}
      {tab === "Actividad" && (
        <AuditPage company="" can={can} userId={user.id} />
      )}
    </Modal>
  );
}
