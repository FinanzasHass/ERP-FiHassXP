export type Row = Record<string, any>;
type Tokens = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};
let tokens: Tokens | null = null;
try {
  tokens = JSON.parse(sessionStorage.getItem("erp.session") || "null");
} catch {
  /* Invalid tab storage is treated as logged out. */
}
let refreshing: Promise<void> | null = null;
export function setSession(value: Tokens | null) {
  tokens = value;
  if (value) sessionStorage.setItem("erp.session", JSON.stringify(value));
  else sessionStorage.removeItem("erp.session");
}
export function hasSession() {
  return !!tokens;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(
      messages[code] ||
        "No se pudo completar la operación. Revise los datos y vuelva a intentarlo.",
    );
  }
}
const messages: Record<string, string> = {
  INVALID_CREDENTIALS: "Correo, usuario o contraseña incorrectos.",
  PROFILE_DISABLED:
    "Su cuenta está inactiva o bloqueada. Contacte al administrador.",
  ACCESS_DENIED: "No tiene permiso para esta operación.",
  COMPANY_ACCESS_DENIED: "Ya no tiene acceso a esta empresa.",
  INTEGRITY_CONFLICT:
    "Los datos entran en conflicto: revise códigos, referencias, jerarquía y estado.",
  INVALID_INPUT: "Revise los campos y formatos del formulario.",
  AUTH_RATE_LIMIT: "Demasiados intentos. Inténtelo más tarde.",
  DATABASE_UNAVAILABLE: "No se pudo conectar con la base de datos.",
  AUTH_UNAVAILABLE: "El servicio de autenticación no está disponible.",
};
export async function api(
  path: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
  retry = true,
): Promise<any> {
  const response = await fetch("/api" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(tokens ? { Authorization: `Bearer ${tokens.access_token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (
    response.status === 401 &&
    tokens &&
    retry &&
    !["/auth/login", "/auth/refresh", "/auth/verify", "/auth/recover"].some(
      (p) => path.startsWith(p),
    )
  ) {
    if (!refreshing)
      refreshing = api(
        "/auth/refresh",
        "POST",
        { refresh_token: tokens.refresh_token },
        {},
        false,
      )
        .then(setSession)
        .catch((e) => {
          setSession(null);
          window.dispatchEvent(new Event("session-expired"));
          throw e;
        })
        .finally(() => {
          refreshing = null;
        });
    await refreshing;
    return api(path, method, body, headers, false);
  }
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) {
    if (data.error === "PROFILE_DISABLED") {
      setSession(null);
      window.dispatchEvent(new Event("session-expired"));
    }
    throw new ApiError(response.status, data.error);
  }
  return data;
}
export const query = (params: Record<string, unknown>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== "" && v !== null && v !== undefined) q.set(k, String(v));
  return q.size ? "?" + q : "";
};
export async function all(
  path: string,
  params: Record<string, unknown> = {},
): Promise<Row[]> {
  let rows: Row[] = [];
  for (let page = 1; page <= 100; page++) {
    const r = await api(path + query({ ...params, page, limit: 100 }));
    rows.push(...r.data);
    if (rows.length >= r.count) return rows;
  }
  throw new Error(
    "El catálogo supera el límite de selección. Reduzca el alcance.",
  );
}
export function chooseCompany(companies: Row[], preferred: string | null) {
  return (
    companies.find((c) => c.id === preferred)?.id || companies[0]?.id || ""
  );
}
