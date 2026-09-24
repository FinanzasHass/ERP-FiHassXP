import React, { useEffect, useRef, useState } from "react";
import { api, type Row } from "./api";
import { ErrorBox } from "./components";
import { configurationTemplates } from "./configuration-import-parser";
const kinds: Record<string, { name: string; permission: string }> = {
  afe: { name: "AFE · dimensión configurable", permission: "afe.import" },
  project: { name: "Proyectos", permission: "project.create" },
  subproject: { name: "Subproyectos", permission: "subproject.create" },
  entry_type: {
    name: "Tipos contables",
    permission: "accounting_period.manage",
  },
  legacy_mapping: {
    name: "Diccionarios legacy",
    permission: "legacy_mapping.import",
  },
  rule: {
    name: "Reglas y mapeos explícitos",
    permission: "accounting_rule.create",
  },
};
export function AccountingConfigurationPage({
  company,
  can,
}: {
  company: string;
  can: (p: string) => boolean;
}) {
  const available = Object.entries(kinds).filter(([, v]) => can(v.permission));
  const [kind, setKind] = useState(available[0]?.[0] || ""),
    [rows, setRows] = useState<Row[]>([]),
    [result, setResult] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [key, setKey] = useState(""),
    [filename, setFilename] = useState(""),
    [demoReason, setDemoReason] = useState(""),
    [demoEnabled, setDemoEnabled] = useState(false),
    [demoNotice, setDemoNotice] = useState("");
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);
  function reset() {
    worker.current?.terminate();
    worker.current = null;
    setRows([]);
    setResult(null);
    setError("");
    setFilename("");
    setBusy(false);
  }
  async function read(file: File) {
    reset();
    setBusy(true);
    setFilename(file.name);
    try {
      if (file.size > 2 * 1024 * 1024)
        throw new Error("Máximo 2 MB por archivo.");
      const buffer = await file.arrayBuffer();
      const w = new Worker(
        new URL("./configuration-import-worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.current = w;
      w.onmessage = (e) => {
        setBusy(false);
        w.terminate();
        worker.current = null;
        if (e.data.error) setError(e.data.error);
        else {
          setRows(e.data.rows);
          setKey(crypto.randomUUID());
        }
      };
      w.onerror = () => {
        setBusy(false);
        setError("No se pudo interpretar el archivo.");
        w.terminate();
        worker.current = null;
      };
      w.postMessage({ kind, name: file.name, buffer }, [buffer]);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  async function run(confirm: boolean) {
    setBusy(true);
    setError("");
    try {
      setResult(
        await api(
          "/accounting/configuration-import/" + kind,
          "POST",
          { company_id: company, rows, confirm },
          { "Idempotency-Key": key },
        ),
      );
    } catch (e) {
      setError((e as Error).message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  }
  function template() {
    const blob = new Blob([configurationTemplates[kind] || ""], {
        type: kind === "rule" ? "application/json" : "text/csv;charset=utf-8",
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = kind + "-template." + (kind === "rule" ? "json" : "csv");
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function designateDemo(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setDemoNotice("");
    try {
      await api("/accounting/demo/designate-company", "POST", {
        company_id: company,
        reason: demoReason,
      });
      setDemoNotice(
        "Empresa designada DEMO. Esta designación queda auditada e inmutable.",
      );
      setDemoReason("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function configureDemo(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setDemoNotice("");
    try {
      await api("/accounting/demo/configure", "POST", {
        company_id: company,
        enabled: demoEnabled,
        reason: demoReason,
      });
      setDemoNotice(
        `Modo DEMO ${demoEnabled ? "habilitado" : "deshabilitado"}; no hay auto-generación ni auto-post.`,
      );
      setDemoReason("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <nav aria-label="Ruta">Contabilidad / Configuración e importación</nav>
      <h1>Configuración e importación</h1>
      <p>
        Los códigos, relaciones y significados deben proporcionarse
        explícitamente. Las reglas importadas quedan en borrador; no se activan
        ni se designan DEMO automáticamente.
      </p>
      <p>
        El plan de cuentas y CECO conservan sus importadores en sus propias
        pantallas.
      </p>
      <ErrorBox error={error} />
      {can("accounting_configuration.manage") && (
        <form className="context-card" onSubmit={designateDemo}>
          <h2>Designar empresa DEMO</h2>
          <p>
            Solo para una empresa sintética dedicada. Esta acción es inmutable y
            habilita, posteriormente, la configuración DEMO manual; no habilita
            contabilidad productiva.
          </p>
          <label>
            Motivo de designación
            <input
              required
              minLength={1}
              maxLength={2000}
              value={demoReason}
              onChange={(e) => setDemoReason(e.target.value)}
            />
          </label>
          <button className="primary" disabled={busy}>
            Designar como DEMO
          </button>
          {demoNotice && <p role="status">{demoNotice}</p>}
        </form>
      )}
      {can("accounting_configuration.manage") && (
        <form className="context-card" onSubmit={configureDemo}>
          <h2>Configuración DEMO</h2>
          <p>
            Requiere una empresa designada DEMO. La generación de borradores
            continúa siendo manual, con reglas DEMO y segregación de funciones.
          </p>
          <label>
            Motivo
            <input
              required
              minLength={1}
              maxLength={2000}
              value={demoReason}
              onChange={(e) => setDemoReason(e.target.value)}
            />
          </label>
          <label>
            Habilitar modo DEMO
            <input
              type="checkbox"
              checked={demoEnabled}
              onChange={(e) => setDemoEnabled(e.target.checked)}
            />
          </label>
          <button disabled={busy}>Guardar configuración DEMO</button>
        </form>
      )}
      {!available.length ? (
        <p>No tiene permisos para importar estos catálogos.</p>
      ) : (
        <>
          <label>
            Catálogo
            <select
              aria-label="Catálogo"
              value={kind}
              disabled={busy}
              onChange={(e) => {
                reset();
                setKind(e.target.value);
              }}
            >
              {available.map(([k, v]) => (
                <option key={k} value={k}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <button onClick={template}>Descargar plantilla</button>
          <label>
            Archivo
            <input
              key={kind}
              type="file"
              disabled={busy}
              accept={kind === "rule" ? ".json" : ".csv,.xlsx,.json"}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void read(file);
              }}
            />
          </label>
          <p>
            {filename} {rows.length > 0 && `· ${rows.length} registros`}
          </p>
          {busy && <p role="status">Procesando…</p>}
          {rows.length > 0 && (
            <>
              <details>
                <summary>Contenido interpretado · primeras 20 filas</summary>
                <pre>{JSON.stringify(rows.slice(0, 20), null, 2)}</pre>
              </details>
              <button
                disabled={busy || result?.persisted === true}
                onClick={() => void run(false)}
              >
                Preview sin persistencia
              </button>
            </>
          )}
          {result && (
            <div role="status">
              <p>
                {result.status === "preview"
                  ? "Validación correcta. Ninguna fila persistida."
                  : result.status === "imported"
                    ? "Importación confirmada."
                    : "El lote contiene errores y no fue importado."}
              </p>
              {result.errors && (
                <ul>
                  {result.errors.map((e: Row, i: number) => (
                    <li key={i}>
                      Fila {e.row}: datos inválidos, duplicados o relaciones
                      ambiguas.
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {result?.status === "preview" && result.persisted === false && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => void run(true)}
            >
              Confirmar importación de {rows.length} registros
            </button>
          )}
        </>
      )}
    </section>
  );
}
