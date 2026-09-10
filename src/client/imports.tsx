import React, { useState } from "react";
import { api, type Row } from "./api";
import { recordsFromRows } from "./import-parser";
import { DataTable, ErrorBox } from "./components";
type ImportAdapter = {
  template: string;
  parse: (rows: string[][]) => Row[];
  validate: (rows: Row[], commit: boolean, update: boolean) => Promise<Row>;
};
export function MasterImport({
  adapter,
  onComplete,
}: {
  adapter: ImportAdapter;
  onComplete: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]),
    [report, setReport] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [update, setUpdate] = useState(false);
  async function fileSelected(file: File) {
    setError("");
    setRows([]);
    setReport(null);
    setBusy(true);
    try {
      if (file.size > 2 * 1024 * 1024 || !/\.(csv|xlsx)$/i.test(file.name))
        throw new Error("Seleccione CSV UTF-8 o XLSX, máximo 2 MB");
      const buffer = await file.arrayBuffer();
      const parsed = await new Promise<string[][]>((resolve, reject) => {
        const worker = new Worker(
          new URL("./import-worker.ts", import.meta.url),
          { type: "module" },
        );
        const timer = setTimeout(() => {
          worker.terminate();
          reject(new Error("El archivo tardó demasiado en procesarse"));
        }, 15000);
        worker.onmessage = (e) => {
          clearTimeout(timer);
          worker.terminate();
          e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.rows);
        };
        worker.onerror = () => {
          clearTimeout(timer);
          worker.terminate();
          reject(new Error("No se pudo leer el archivo"));
        };
        worker.postMessage({ name: file.name, buffer }, [buffer]);
      });
      setRows(adapter.parse(parsed));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function validate(commit: boolean) {
    setBusy(true);
    setError("");
    try {
      const r = await adapter.validate(rows, commit, update);
      setReport(r);
      if (r.committed) onComplete();
    } catch (e) {
      setError((e as Error).message);
      setReport(null);
    } finally {
      setBusy(false);
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([adapter.template], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "plantilla-ceco.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="panel import-panel">
      <h2>Importación de maestros</h2>
      <p>
        Archivo → validación → vista previa → confirmación. Hasta 200 filas por
        lote; no se eliminan registros.
      </p>
      <div className="toolbar wrap">
        <button onClick={download}>Descargar plantilla CSV</button>
        <label>
          Archivo CSV / Excel
          <input
            type="file"
            accept=".csv,.xlsx"
            disabled={busy}
            onChange={(e) => {
              if (e.target.files?.[0]) void fileSelected(e.target.files[0]);
            }}
          />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={update}
            onChange={(e) => {
              setUpdate(e.target.checked);
              setReport(null);
            }}
          />
          Actualizar explícitamente datos de códigos existentes
        </label>
      </div>
      <ErrorBox error={error} />
      {rows.length > 0 && (
        <>
          <DataTable
            rows={rows}
            columns={[
              "company_code",
              "code",
              "name",
              "parent_code",
              "category",
              "active",
            ]}
          />
          <div className="toolbar">
            <button disabled={busy} onClick={() => void validate(false)}>
              Validar y previsualizar
            </button>
            {report && !report.errors.length && !report.committed && (
              <button
                disabled={busy}
                className="primary"
                onClick={() => void validate(true)}
              >
                Confirmar importación del lote
              </button>
            )}
          </div>
        </>
      )}
      {report && (
        <>
          <p className="notice">
            {report.committed
              ? "Importación confirmada"
              : "Vista previa · sin escrituras"}{" "}
            · {report.created} creados · {report.updated} actualizados ·{" "}
            {report.ignored} ignorados · {report.errors.length} errores
          </p>
          {report.errors.length > 0 && (
            <DataTable rows={report.errors} columns={["line", "error"]} />
          )}
        </>
      )}
      {busy && <p role="status">Procesando archivo…</p>}
    </section>
  );
}
export function CostCenterImport({
  company,
  companyCode,
  onComplete,
}: {
  company: string;
  companyCode: string;
  onComplete: () => void;
}) {
  return (
    <MasterImport
      adapter={{
        template: `company_code,code,name,parent_code,category,description,active\n${companyCode},CENTRO01,Nombre del centro,,,,true\n`,
        parse: recordsFromRows,
        validate: (rows, commit, update) =>
          api("/cost-centers/import", "POST", {
            company_id: company,
            rows,
            commit,
            update_existing: update,
          }),
      }}
      onComplete={onComplete}
    />
  );
}
