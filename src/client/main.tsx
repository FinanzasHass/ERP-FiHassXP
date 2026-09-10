import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  api,
  hasSession,
  setSession,
  chooseCompany,
  query,
  type Row,
} from "./api";
import { catalogs, futureGroups } from "./catalog";
import {
  Empty,
  EntityPage,
  ErrorBox,
  Form,
  Modal,
  ProjectHierarchy,
} from "./components";
import { AuditPage, PermissionMatrix, UserDetail } from "./admin";
import { CostCenterImport } from "./imports";
import "./styles.css";

function Login({ onLogin }: { onLogin: () => void }) {
  const [identity, setIdentity] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [recover, setRecover] = useState(false),
    [notice, setNotice] = useState("");
  return (
    <div className="login-shell">
      <section className="login-brand">
        <div className="brand">
          <span className="brand-mark">N</span>
          <span>
            NEXO <small>GESTIÓN CORPORATIVA</small>
          </span>
        </div>
        <div>
          <p className="eyebrow">FINANZAS CON VISIÓN DE CONJUNTO</p>
          <h1>
            Una plataforma.
            <br />
            Cada empresa,
            <br />
            <em>en su contexto.</em>
          </h1>
          <p>
            Administración, organización y control para construir una operación
            conectada.
          </p>
        </div>
        <footer>
          Mini ERP Financiero <span>Acceso corporativo</span>
        </footer>
      </section>
      <main className="login-form">
        <span className="badge">PORTAL INTERNO</span>
        <h2>{recover ? "Recuperar acceso" : "Bienvenido de nuevo"}</h2>
        <p>
          {recover
            ? "Recibirá instrucciones en su correo registrado."
            : "Ingrese con sus credenciales corporativas."}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            setNotice("");
            try {
              if (recover) {
                await api("/auth/recover", "POST", { email: identity });
                setNotice(
                  "Si la cuenta existe, recibirá instrucciones en su correo.",
                );
              } else {
                setSession(
                  await api("/auth/login", "POST", {
                    email: identity,
                    password,
                  }),
                );
                onLogin();
              }
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            {recover ? "Correo electrónico" : "Correo o usuario"}
            <input
              autoFocus
              required
              type={recover ? "email" : "text"}
              autoComplete="username"
              value={identity}
              onChange={(e) => setIdentity(e.target.value)}
              placeholder="usuario@empresa.com"
            />
          </label>
          {!recover && (
            <label>
              Contraseña
              <input
                required
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Ingrese su contraseña"
              />
            </label>
          )}
          <ErrorBox error={error} />
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          <button disabled={busy} className="primary">
            {busy
              ? "Conectando…"
              : recover
                ? "Enviar instrucciones"
                : "Ingresar a la plataforma →"}
          </button>
          <button
            type="button"
            className="link"
            onClick={() => {
              setRecover(!recover);
              setError("");
              setNotice("");
            }}
          >
            {recover ? "Volver al inicio de sesión" : "¿Olvidó su contraseña?"}
          </button>
        </form>
        <p className="login-foot">
          El acceso está sujeto a los permisos asignados por su organización.
        </p>
      </main>
    </div>
  );
}
function Callback({ done }: { done: () => void }) {
  const [params] = useState(() => {
    const p = new URLSearchParams(location.search);
    history.replaceState({}, "", location.pathname);
    return p;
  });
  const [verified, setVerified] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="callback panel">
      <h1>Restablecer contraseña</h1>
      <ErrorBox error={error} />
      {!verified ? (
        <>
          <p>Continúe para verificar el enlace y establecer su contraseña.</p>
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setSession(
                  await api("/auth/verify", "POST", {
                    token_hash: params.get("token_hash"),
                    type: params.get("type"),
                  }),
                );
                setVerified(true);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Verificar enlace
          </button>
        </>
      ) : (
        <Form
          fields={[
            {
              key: "password",
              label: "Nueva contraseña · mínimo 12 caracteres",
              type: "password",
              required: true,
            },
          ]}
          initial={{}}
          company=""
          close={done}
          onSave={async (d) => {
            await api("/auth/password", "POST", d);
          }}
        />
      )}
    </main>
  );
}
function App() {
  const [signed, setSigned] = useState(hasSession()),
    [path, setPath] = useState(location.pathname),
    [workspace, setWorkspace] = useState<Row | null>(null),
    [me, setMe] = useState<Row | null>(null),
    [company, setCompany] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [drawer, setDrawer] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [selected, setSelected] = useState<Row | null>(null),
    [matrix, setMatrix] = useState<Row | null>(null),
    [mode, setMode] = useState("main"),
    [revision, setRevision] = useState(0);
  const navigate = (next: string) => {
    history.pushState({}, "", next);
    setPath(next);
    setDrawer(false);
    setSelected(null);
    setMode("main");
  };
  useEffect(() => {
    const pop = () => {
      setPath(location.pathname);
      setSelected(null);
      setMode("main");
    };
    const expired = () => {
      setSigned(false);
      setMe(null);
      setWorkspace(null);
    };
    addEventListener("popstate", pop);
    addEventListener("session-expired", expired);
    return () => {
      removeEventListener("popstate", pop);
      removeEventListener("session-expired", expired);
    };
  }, []);
  useEffect(() => {
    if (!signed) return;
    let valid = true;
    setLoading(true);
    setError("");
    setMe(null);
    Promise.all([api("/auth/workspace"), api("/auth/me")])
      .then(async ([w, p]) => {
        const id = chooseCompany(
          w?.companies || [],
          localStorage.getItem("erp.company." + p.profile.id),
        );
        const scoped = id
          ? await api("/auth/me" + query({ company_id: id }))
          : p;
        if (valid) {
          setWorkspace(w);
          setCompany(id);
          setMe(scoped);
        }
      })
      .catch((e) => {
        if (valid) setError(e.message);
      })
      .finally(() => {
        if (valid) setLoading(false);
      });
    return () => {
      valid = false;
    };
  }, [signed, revision]);
  useEffect(() => {
    if (!signed) return;
    const refresh = () => setRevision((x) => x + 1);
    const timer = setInterval(refresh, 120000);
    addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      removeEventListener("focus", refresh);
    };
  }, [signed]);
  const can = (p: string) => !!me?.permissions?.some((x: Row) => x.code === p);
  if (path === "/auth/callback")
    return (
      <Callback
        done={() => {
          setSigned(true);
          setRevision((x) => x + 1);
          navigate("/app/dashboard");
        }}
      />
    );
  if (!signed)
    return (
      <Login
        onLogin={() => {
          setSigned(true);
          navigate("/app/dashboard");
        }}
      />
    );
  const activeCompany = workspace?.companies?.find(
    (c: Row) => c.id === company,
  );
  const key = path.split("/")[2] || "dashboard";
  const future = path.split("/")[3];
  let config = catalogs[key];
  if (mode === "categories") config = catalogs["cost-center-categories"];
  if (mode === "subprojects") config = catalogs.subprojects;
  const nav = (label: string, url: string, icon = "▫") => (
    <button
      key={url}
      aria-label={label}
      title={label}
      className={"nav-item " + (path === url ? "current" : "")}
      onClick={() => navigate(url)}
    >
      <span>{icon}</span>
      <span>{label}</span>
      {url.includes("/future/") && <small>Próximo</small>}
    </button>
  );
  const adminLinks = [
    ["Usuarios", "users", "user.view"],
    ["Áreas", "areas", "area.view"],
    ["Cargos", "positions", "position.view"],
    ["Roles y permisos", "roles", "role.view"],
    ["Auditoría", "audit", "audit.view", "audit.finance_view"],
    ["Configuración", "settings", "settings.manage"],
  ];
  const masterLinks = [
    ["Empresas", "companies", "company.view"],
    ["Centros de costo", "cost-centers", "cost_center.view"],
    ["Proyectos", "projects", "project.view"],
    ["Monedas", "currencies", "currency.view"],
  ];
  const futureItem = [
    ...futureGroups.flatMap((g) => g.items),
    ["Proveedores", "suppliers", "supplier.view"],
    ["Clientes", "customers", "customer.view"],
  ].find((i) => i[1] === future);
  return (
    <div
      className={
        "app-shell " +
        (collapsed ? "collapsed " : "") +
        (drawer ? "drawer-open" : "")
      }
    >
      <button
        className="scrim"
        aria-label="Cerrar menú"
        onClick={() => setDrawer(false)}
      />
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">N</span>
          <span>
            NEXO<small>GESTIÓN CORPORATIVA</small>
          </span>
        </div>
        <div className="workspace-label">ESPACIO DE TRABAJO</div>
        <nav>
          {nav("Dashboard", "/app/dashboard", "◈")}
          {futureGroups.map(
            (group) =>
              group.items.some((i) => i.slice(2).some(can)) && (
                <div className="nav-group" key={group.title}>
                  <p>{group.title}</p>
                  {group.items
                    .filter((i) => i.slice(2).some(can))
                    .map((i) => nav(i[0], "/app/future/" + i[1]))}
                </div>
              ),
          )}
          <div className="nav-group">
            <p>MAESTROS</p>
            {masterLinks
              .filter((i) => can(i[2]))
              .map((i) => nav(i[0], "/app/" + i[1]))}
            {can("supplier.view") &&
              nav("Proveedores", "/app/future/suppliers")}
            {can("customer.view") && nav("Clientes", "/app/future/customers")}
          </div>
          <div className="nav-group">
            <p>ADMINISTRACIÓN</p>
            {adminLinks
              .filter((i) => i.slice(2).some(can))
              .map((i) => nav(i[0], "/app/" + i[1]))}
          </div>
        </nav>
        <div className="sidebar-foot">
          <span className="status-dot" /> Plataforma administrativa{" "}
          <small>Fase 3</small>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <button
            aria-label="Alternar menú"
            className="menu-toggle"
            onClick={() => {
              if (innerWidth < 900) setDrawer(!drawer);
              else setCollapsed(!collapsed);
            }}
          >
            ☰
          </button>
          <label className="company-select">
            <small>EMPRESA ACTIVA</small>
            <select
              aria-label="Empresa activa"
              value={company}
              disabled={loading}
              onChange={(e) => {
                localStorage.setItem(
                  "erp.company." + me?.profile.id,
                  e.target.value,
                );
                setMe(null);
                setSelected(null);
                setMode("main");
                setRevision((x) => x + 1);
              }}
            >
              {!workspace?.companies?.length && (
                <option value="">Sin empresa asignada</option>
              )}
              {workspace?.companies?.map((c: Row) => (
                <option key={c.id} value={c.id}>
                  {c.legal_name}
                </option>
              ))}
            </select>
          </label>
          <div className="topbar-end">
            <span className="environment">PORTAL INTERNO</span>
            <details className="user-menu">
              <summary>
                <span className="avatar">
                  {me?.profile?.full_name?.slice(0, 2).toUpperCase() || "••"}
                </span>
                <span>
                  {me?.profile?.full_name || "Mi sesión"}
                  <small>{workspace?.position || "Colaborador"}</small>
                </span>
              </summary>
              <button
                onClick={async () => {
                  try {
                    await api("/auth/logout", "POST");
                  } finally {
                    setSession(null);
                    setSigned(false);
                    setMe(null);
                    navigate("/login");
                  }
                }}
              >
                Cerrar sesión
              </button>
            </details>
          </div>
        </header>
        <main className="content">
          <ErrorBox error={error} />
          {error && (
            <button onClick={() => setRevision((x) => x + 1)}>
              Reintentar conexión
            </button>
          )}
          {loading ? (
            <p className="loading">Verificando contexto y permisos…</p>
          ) : (
            me && (
              <div key={company + key + mode}>
                {key === "dashboard" && (
                  <>
                    <div className="page-heading">
                      <div>
                        <p className="eyebrow">VISIÓN GENERAL</p>
                        <h1>Su espacio de gestión</h1>
                        <p>
                          Bienvenido, {me.profile.full_name.split(" ")[0]}. Esta
                          es la base de su operación.
                        </p>
                      </div>
                      <span className="date-chip">
                        {new Date().toLocaleDateString("es-PE", {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })}
                      </span>
                    </div>
                    <section className="context-card">
                      <div>
                        <span className="badge">CONTEXTO EMPRESARIAL</span>
                        <h2>
                          {activeCompany?.legal_name ||
                            "Seleccione una empresa para comenzar"}
                        </h2>
                        <p>
                          La información y las acciones dependen de sus accesos
                          en cada empresa.
                        </p>
                      </div>
                      <dl>
                        <div>
                          <dt>Colaborador</dt>
                          <dd>{me.profile.full_name}</dd>
                        </div>
                        <div>
                          <dt>Área</dt>
                          <dd>{workspace?.area || "Sin asignar"}</dd>
                        </div>
                        <div>
                          <dt>Cargo</dt>
                          <dd>{workspace?.position || "Sin asignar"}</dd>
                        </div>
                      </dl>
                    </section>
                    <div className="section-heading">
                      <h2>Control operativo</h2>
                      <span>Los módulos se habilitarán progresivamente</span>
                    </div>
                    <div className="dashboard-grid">
                      {[
                        "Pendientes de aprobación",
                        "Pagos pendientes",
                        "Cuentas por pagar",
                        "Cobranzas",
                        "Anticipos por rendir",
                        "Alertas",
                      ].map((label, i) => (
                        <section className="metric" key={label}>
                          <div>
                            <span className="metric-icon">
                              {["✓", "↗", "▤", "↙", "◷", "◇"][i]}
                            </span>
                            <small>EN PREPARACIÓN</small>
                          </div>
                          <h3>{label}</h3>
                          <Empty />
                        </section>
                      ))}
                    </div>
                    <section className="roadmap-note">
                      <span>◈</span>
                      <div>
                        <h3>Una base preparada para crecer</h3>
                        <p>
                          Configure empresas, organización y maestros. Los
                          módulos financieros se incorporarán en las siguientes
                          fases.
                        </p>
                      </div>
                    </section>
                  </>
                )}
                {config &&
                  (can(config.permission + ".view") ? (
                    !config.scoped || company ? (
                      <EntityPage
                        config={config}
                        company={company}
                        can={can}
                        refreshKey={revision}
                        onDetail={
                          ["users", "roles"].includes(key) ||
                          (key === "cost-centers" && mode !== "categories")
                            ? setSelected
                            : undefined
                        }
                        extra={
                          <>
                            {key === "cost-centers" && (
                              <div className="tabs">
                                <button onClick={() => setMode("main")}>
                                  Centros de costo
                                </button>
                                <button onClick={() => setMode("categories")}>
                                  Categorías
                                </button>
                                {can("cost_center.create") && (
                                  <button
                                    onClick={() =>
                                      setMode(
                                        mode === "import" ? "main" : "import",
                                      )
                                    }
                                  >
                                    Importar Excel / CSV
                                  </button>
                                )}
                              </div>
                            )}
                            {key === "projects" && (
                              <div className="tabs">
                                <button onClick={() => setMode("main")}>
                                  Proyectos
                                </button>
                                {can("subproject.view") && (
                                  <button
                                    onClick={() => setMode("subprojects")}
                                  >
                                    Subproyectos
                                  </button>
                                )}
                              </div>
                            )}
                            {key === "projects" && can("subproject.view") && (
                              <ProjectHierarchy company={company} />
                            )}{" "}
                            {mode === "import" && (
                              <CostCenterImport
                                company={company}
                                companyCode={activeCompany?.code}
                                onComplete={() => setRevision((x) => x + 1)}
                              />
                            )}
                          </>
                        }
                      />
                    ) : (
                      <Empty text="Necesita una membresía empresarial activa para consultar este maestro." />
                    )
                  ) : (
                    <Empty text="No tiene permiso para acceder a este módulo." />
                  ))}
                {key === "audit" &&
                  (can("audit.view") || can("audit.finance_view") ? (
                    <AuditPage company={company} can={can} />
                  ) : (
                    <Empty text="Acceso denegado" />
                  ))}
                {key === "settings" &&
                  (can("settings.manage") ? (
                    <Settings company={company} />
                  ) : (
                    <Empty text="Acceso denegado" />
                  ))}
                {key === "future" &&
                  (futureItem && futureItem.slice(2).some(can) ? (
                    <section className="placeholder panel">
                      <span className="badge">PRÓXIMAS FASES</span>
                      <h1>{futureItem[0]}</h1>
                      <Empty text="Módulo en preparación" />
                      <p>
                        Las operaciones de este módulo aún no están habilitadas.
                      </p>
                    </section>
                  ) : (
                    <Empty text="No tiene permiso para acceder a este módulo." />
                  ))}
              </div>
            )
          )}
        </main>
        <footer className="app-footer">
          Mini ERP Financiero <span>Administración y maestros · Fase 3</span>
        </footer>
      </div>
      {selected && key === "users" && (
        <UserDetail
          user={selected}
          actorId={me?.profile.id}
          company={company}
          can={can}
          close={() => {
            setSelected(null);
            setRevision((x) => x + 1);
          }}
        />
      )}
      {selected && key === "roles" && (
        <Modal title={selected.name} close={() => setSelected(null)}>
          <div className="toolbar">
            <button
              onClick={() => {
                setMatrix(selected);
                setSelected(null);
              }}
            >
              Matriz de permisos
            </button>
          </div>
          {can("role.edit") ? (
            <Form
              fields={catalogs.roles.fields.filter(
                (f) =>
                  !(selected.is_system && f.key === "code") &&
                  (f.key !== "active" || can("permission.assign")),
              )}
              initial={selected}
              company={company}
              close={() => setSelected(null)}
              onSave={async (d) => {
                for (const k of Object.keys(d))
                  if (d[k] === selected[k]) delete d[k];
                if (Object.keys(d).length)
                  await api("/roles/" + selected.id, "PATCH", d);
                setRevision((x) => x + 1);
              }}
            />
          ) : (
            <p>{selected.description}</p>
          )}
        </Modal>
      )}
      {matrix && (
        <PermissionMatrix
          role={matrix}
          can={can}
          close={() => {
            setMatrix(null);
            setRevision((x) => x + 1);
          }}
        />
      )}
      {selected && key === "cost-centers" && (
        <Modal
          title={
            selected.id
              ? selected.code + " · " + selected.name
              : "Nuevo subcentro"
          }
          close={() => setSelected(null)}
        >
          <div className="toolbar">
            {can("cost_center.create") && selected.id && (
              <button
                onClick={() =>
                  setSelected({
                    parent_id: selected.id,
                    active: true,
                    valid_from: new Date().toISOString().slice(0, 10),
                  })
                }
              >
                Nuevo subcentro
              </button>
            )}
            {can("audit.view") && selected.id && (
              <button
                onClick={() => setMode(mode === "history" ? "main" : "history")}
              >
                Ver historial
              </button>
            )}
          </div>
          {mode === "history" ? (
            <AuditPage company={company} can={can} entityId={selected.id} />
          ) : can(selected.id ? "cost_center.edit" : "cost_center.create") ? (
            <Form
              key={
                (selected.id ? "edit:" : "new:") +
                (selected.id || selected.parent_id)
              }
              fields={catalogs["cost-centers"].fields.filter(
                (f) =>
                  !selected.id ||
                  f.key !== "active" ||
                  can("cost_center.disable"),
              )}
              initial={selected}
              company={company}
              close={() => setSelected(null)}
              onSave={async (d) => {
                if (selected.id)
                  for (const k of Object.keys(d))
                    if (d[k] === selected[k]) delete d[k];
                if (Object.keys(d).length)
                  await api(
                    "/cost-centers" +
                      (selected.id ? "/" + selected.id : "") +
                      query({ company_id: company }),
                    selected.id ? "PATCH" : "POST",
                    d,
                  );
                setRevision((x) => x + 1);
              }}
            />
          ) : (
            <pre>{JSON.stringify(selected, null, 2)}</pre>
          )}
        </Modal>
      )}
    </div>
  );
}
function Settings({ company }: { company: string }) {
  const [data, setData] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    api("/settings")
      .then((r) => setData(r.data[0] || {}))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="panel settings">
      <h1>Configuración</h1>
      <ErrorBox error={error} />
      {notice && <p className="notice">{notice}</p>}
      {data && (
        <Form
          fields={[
            { key: "system_name", label: "Nombre del sistema", required: true },
            { key: "timezone", label: "Zona horaria", required: true },
          ]}
          initial={data}
          company={company}
          close={() => {}}
          onSave={async (d) => {
            await api("/settings", "PATCH", d);
            setNotice("Configuración guardada");
          }}
        />
      )}
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
