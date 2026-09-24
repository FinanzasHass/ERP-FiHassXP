import React, { useEffect, useState } from "react";
import { api, query, type Row } from "./api";
import { Empty, ErrorBox, Modal } from "./components";
const emptyAfe = {
  code: "",
  name: "",
  valid_from: new Date().toISOString().slice(0, 10),
  active: true,
};
export function AfePage({
  company,
  can,
}: {
  company: string;
  can: (p: string) => boolean;
}) {
  const [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [form, setForm] = useState<Row | null>(null),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      const r = await api(
        "/accounting/afes" +
          query({ company_id: company, page: 1, limit: 100 }),
      );
      setRows(r.data);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [company]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    try {
      await api("/accounting/afes", "POST", { company_id: company, ...form });
      setForm(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <nav aria-label="Ruta">Contabilidad / AFE</nav>
      <h1>AFE</h1>
      <p>
        Dimensión configurable sin significado empresarial asumido. Los cambios
        de identidad después de su primer uso están protegidos.
      </p>
      <ErrorBox error={error} />
      {can("afe.manage") && (
        <button className="primary" onClick={() => setForm(emptyAfe)}>
          Nuevo AFE
        </button>
      )}
      {!rows.length ? (
        <Empty text="No hay AFE configurados para esta empresa." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Nombre</th>
                <th>Vigencia</th>
                <th>Activo</th>
                <th>Primer uso</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.code}</td>
                  <td>{r.name}</td>
                  <td>
                    {r.valid_from}{" "}
                    {r.valid_to ? `a ${r.valid_to}` : "en adelante"}
                  </td>
                  <td>{r.active ? "Sí" : "No"}</td>
                  <td>{r.first_used_at || "Sin uso"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {form && (
        <Modal title="Nuevo AFE" close={() => setForm(null)}>
          <form onSubmit={save} className="form-grid">
            <label>
              Código
              <input
                required
                maxLength={60}
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
              />
            </label>
            <label>
              Nombre
              <input
                required
                maxLength={200}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              Válido desde
              <input
                required
                type="date"
                value={form.valid_from}
                onChange={(e) =>
                  setForm({ ...form, valid_from: e.target.value })
                }
              />
            </label>
            <label>
              Válido hasta
              <input
                type="date"
                value={form.valid_to || ""}
                onChange={(e) =>
                  setForm({ ...form, valid_to: e.target.value || null })
                }
              />
            </label>
            <label>
              Activo
              <input
                type="checkbox"
                checked={Boolean(form.active)}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? "Guardando…" : "Guardar"}
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}
