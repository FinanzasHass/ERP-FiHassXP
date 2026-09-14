import React, { useEffect, useRef, useState } from "react";
import { api, type Row } from "./api";
import { Modal, ErrorBox } from "./components";
export function AccountingImport({
  company,
  close,
  complete,
}: {
  company: string;
  close: () => void;
  complete: () => Promise<void>;
}) {
  const [rows, setRows] = useState<Row[]>([]),
    [preview, setPreview] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const worker = useRef<Worker | null>(null),
    key = useRef(crypto.randomUUID());
  useEffect(() => () => worker.current?.terminate(), []);
  const load = async (file: File) => {
    setError("");
    setRows([]);
    setPreview(null);
    key.current = crypto.randomUUID();
    if (!/\.(csv|xlsx)$/i.test(file.name) || file.size > 5 * 1024 * 1024) {
      setError("Seleccione CSV o XLSX de hasta 5 MB.");
      return;
    }
    setBusy(true);
    worker.current?.terminate();
    const w = new Worker(
      new URL("./accounting-import-worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.current = w;
    const timer = setTimeout(() => {
      w.terminate();
      setBusy(false);
      setError("El archivo excedió el tiempo de procesamiento.");
    }, 20000);
    w.onmessage = (e) => {
      clearTimeout(timer);
      w.terminate();
      setBusy(false);
      if (e.data.error) setError(e.data.error);
      else setRows(e.data.rows);
    };
    w.onerror = () => {
      clearTimeout(timer);
      w.terminate();
      setBusy(false);
      setError("No se pudo interpretar el archivo.");
    };
    try {
      w.postMessage({ name: file.name, buffer: await file.arrayBuffer() });
    } catch (e) {
      clearTimeout(timer);
      w.terminate();
      setBusy(false);
      setError((e as Error).message);
    }
  };
  const send = async (confirm: boolean) => {
    setBusy(true);
    setError("");
    try {
      const result = await api(
        "/accounting/accounts/import",
        "POST",
        { company_id: company, rows, confirm },
        { "Idempotency-Key": key.current },
      );
      if (confirm) await complete();
      else setPreview(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Importar plan de cuentas" close={close}>
      <p>
        La empresa activa recibe el lote completo. El preview valida sin
        persistir. No se reemplazan cuentas existentes.
      </p>
      <p>
        Columnas obligatorias: code, name, account_type, normal_balance,
        allows_posting, valid_from. Opcionales: parent_code, valid_to,
        pcge_reference_code, requires_cost_center, requires_project,
        requires_third_party, active. Booleanos: true/false. Fechas: AAAA-MM-DD.
        Códigos como texto.
      </p>
      <input
        aria-label="Archivo de cuentas"
        type="file"
        accept=".csv,.xlsx"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void load(f);
        }}
      />
      <ErrorBox error={error} />
      {rows.length > 0 && (
        <>
          <p>{rows.length} cuentas interpretadas. Vista de las primeras 20:</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Nombre</th>
                  <th>Padre</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 20).map((r, i) => (
                  <tr key={i}>
                    <td>{r.code}</td>
                    <td>{r.name}</td>
                    <td>{r.parent_code || "Raíz"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button disabled={busy} onClick={() => void send(false)}>
            Validar preview sin persistencia
          </button>
        </>
      )}
      {preview?.status === "preview" && (
        <div role="status">
          <p>{preview.validated_rows} cuentas validadas sin persistencia.</p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void send(true)}
          >
            Confirmar importación
          </button>
        </div>
      )}
      {preview?.errors && (
        <div role="alert">
          <h3>Inconsistencias · lote sin persistir</h3>
          <table>
            <thead>
              <tr>
                <th>Fila</th>
                <th>Código</th>
                <th>Observación</th>
              </tr>
            </thead>
            <tbody>
              {preview.errors.map((e: Row, i: number) => (
                <tr key={i}>
                  <td>{e.row}</td>
                  <td>{e.code}</td>
                  <td>
                    {e.error === "duplicate_code"
                      ? "Código duplicado"
                      : e.error === "unresolved_hierarchy"
                        ? "Padre no encontrado o ciclo"
                        : "Revise campos, fechas y restricciones de la cuenta"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
