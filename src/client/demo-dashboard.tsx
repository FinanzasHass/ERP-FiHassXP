import React, { useEffect, useState } from "react";
import { api, query, type Row } from "./api";
import { ErrorBox, Empty } from "./components";
const money = (rows: Row[] | undefined) =>
  !rows?.length
    ? "—"
    : rows
        .map((x) => `${x.currency_code} ${Number(x.amount).toFixed(2)}`)
        .join(" · ");
export function DemoDashboard({
  company,
  can,
}: {
  company: string;
  can: (permission: string) => boolean;
}) {
  const [data, setData] = useState<Row | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!can("demo_dashboard.view")) return;
    let active = true;
    api("/accounting/demo-dashboard" + query({ company_id: company }))
      .then((d) => active && setData(d))
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [company]);
  if (!can("demo_dashboard.view")) return null;
  return (
    <section className="demo-dashboard">
      <div className="section-heading">
        <div>
          <h2>Panel ejecutivo DEMO</h2>
          <span>Datos persistidos, sintéticos y agrupados por moneda</span>
        </div>
        <a href="/app/accounting-events">Operaciones contables</a>
      </div>
      <ErrorBox error={error} />
      {!data && !error ? (
        <p role="status">Cargando métricas DEMO…</p>
      ) : data ? (
        <>
          <div className="dashboard-grid">
            {[
              ["CxP pendiente", money(data.payables_outstanding)],
              ["CxC pendiente", money(data.receivables_outstanding)],
              ["Cobros aplicados", money(data.collections)],
              ["Banco registrado", money(data.registered_bank)],
              ["Viáticos pendientes", String(data.travel_pending)],
              ["Operaciones por contabilizar", String(data.accounting_pending)],
              ["Asientos posteados", String(data.journals_posted)],
              [
                "Período abierto",
                data.open_period
                  ? `${data.open_period.year}-${String(data.open_period.month).padStart(2, "0")}`
                  : "Sin período abierto",
              ],
            ].map(([label, value]) => (
              <section className="metric" key={label}>
                <h3>{label}</h3>
                <strong className="finance-number">{value}</strong>
              </section>
            ))}
          </div>
          <h3>Pagos próximos</h3>
          {data.upcoming_payments?.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Vencimiento</th>
                    <th>Moneda</th>
                    <th>Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {data.upcoming_payments.map((x: Row, i: number) => (
                    <tr key={i}>
                      <td>{x.due_date}</td>
                      <td>{x.currency_code}</td>
                      <td>{x.amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty text="No hay obligaciones DEMO próximas en los siguientes 30 días." />
          )}
        </>
      ) : null}
    </section>
  );
}
