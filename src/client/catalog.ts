export type Field = {
  key: string;
  label: string;
  type?: string;
  options?: string[];
  source?: string;
  required?: boolean;
};
export type Catalog = {
  title: string;
  description: string;
  endpoint: string;
  permission: string;
  scoped?: boolean;
  fields: Field[];
  columns: string[];
};
const code: Field = { key: "code", label: "Código", required: true };
const name: Field = { key: "name", label: "Nombre", required: true };
const description: Field = {
  key: "description",
  label: "Descripción",
  type: "textarea",
};
const active: Field = { key: "active", label: "Activo", type: "checkbox" };
const status: Field = {
  key: "status",
  label: "Estado",
  options: ["active", "inactive", "completed", "cancelled"],
};
export const catalogs: Record<string, Catalog> = {
  companies: {
    title: "Empresas",
    description: "Razones sociales y configuración de acceso empresarial.",
    endpoint: "/companies",
    permission: "company",
    fields: [
      code,
      { key: "legal_name", label: "Razón social", required: true },
      { key: "tax_id", label: "RUC / identificación fiscal", required: true },
      { key: "country_code", label: "País (ISO)", required: true },
      active,
    ],
    columns: ["code", "legal_name", "tax_id", "country_code", "active"],
  },
  areas: {
    title: "Áreas",
    description: "Estructura organizativa de la plataforma.",
    endpoint: "/areas",
    permission: "area",
    fields: [code, name, description, active],
    columns: ["code", "name", "description", "active"],
  },
  positions: {
    title: "Cargos",
    description:
      "Cargos globales o asociados a un área. El cargo no concede permisos.",
    endpoint: "/positions",
    permission: "position",
    fields: [
      name,
      {
        key: "area_id",
        label: "Área · vacío para cargo global",
        source: "areas",
      },
      description,
      { key: "hierarchy_level", label: "Nivel jerárquico", type: "number" },
      active,
    ],
    columns: ["name", "area_id", "hierarchy_level", "active"],
  },
  "cost-centers": {
    title: "Centros de costo",
    description:
      "Organice la imputación futura por empresa, categoría y jerarquía.",
    endpoint: "/cost-centers",
    permission: "cost_center",
    scoped: true,
    fields: [
      code,
      name,
      description,
      {
        key: "category_id",
        label: "Categoría",
        source: "cost-center-categories",
      },
      { key: "parent_id", label: "Centro padre", source: "cost-centers" },
      {
        key: "valid_from",
        label: "Vigente desde",
        type: "date",
        required: true,
      },
      { key: "valid_to", label: "Vigente hasta", type: "date" },
      active,
    ],
    columns: ["code", "name", "category_id", "parent_id", "level", "active"],
  },
  "cost-center-categories": {
    title: "Categorías CECO",
    description: "Catálogo configurable para la empresa activa.",
    endpoint: "/cost-center-categories",
    permission: "cost_center",
    scoped: true,
    fields: [code, name, description, active],
    columns: ["code", "name", "description", "active"],
  },
  projects: {
    title: "Proyectos",
    description: "Proyectos y subproyectos de la empresa activa.",
    endpoint: "/projects",
    permission: "project",
    scoped: true,
    fields: [
      code,
      name,
      description,
      status,
      { key: "start_date", label: "Fecha de inicio", type: "date" },
      { key: "end_date", label: "Fecha de fin", type: "date" },
    ],
    columns: ["code", "name", "status", "start_date", "end_date"],
  },
  subprojects: {
    title: "Subproyectos",
    description:
      "Cada subproyecto pertenece a un proyecto de la misma empresa.",
    endpoint: "/subprojects",
    permission: "subproject",
    scoped: true,
    fields: [
      {
        key: "project_id",
        label: "Proyecto",
        source: "projects",
        required: true,
      },
      code,
      name,
      description,
      status,
    ],
    columns: ["project_id", "code", "name", "status"],
  },
  currencies: {
    title: "Monedas",
    description:
      "Catálogo global. Las tasas de cambio están preparadas estructuralmente.",
    endpoint: "/currencies",
    permission: "currency",
    fields: [
      code,
      name,
      { key: "symbol", label: "Símbolo", required: true },
      {
        key: "decimal_places",
        label: "Decimales",
        type: "number",
        required: true,
      },
      active,
    ],
    columns: ["code", "name", "symbol", "decimal_places", "active"],
  },
  roles: {
    title: "Roles y permisos",
    description:
      "Configure responsabilidades y asigne permisos existentes del sistema.",
    endpoint: "/roles",
    permission: "role",
    fields: [code, name, description, active],
    columns: ["name", "description", "is_system", "active"],
  },
  users: {
    title: "Usuarios",
    description: "Identidad, organización y accesos de los colaboradores.",
    endpoint: "/users",
    permission: "user",
    fields: [
      { key: "full_name", label: "Nombre completo", required: true },
      { key: "username", label: "Usuario", required: true },
      { key: "email", label: "Correo", type: "email", required: true },
      { key: "temporary_password", label: "Contraseña provisional · mínimo 12 caracteres", type: "password", required: true },
      { key: "temporary_password_confirmation", label: "Confirmar contraseña provisional", type: "password", required: true },
      { key: "area_id", label: "Área", source: "areas" },
      { key: "position_id", label: "Cargo", source: "positions" },
      { key: "manager_id", label: "Jefe directo", source: "users" },
      {
        key: "status",
        label: "Estado",
        options: ["inactive", "active", "blocked"],
      },
    ],
    columns: [
      "full_name",
      "username",
      "email",
      "area_id",
      "position_id",
      "user_companies",
      "status",
    ],
  },
};
export const labels: Record<string, string> = {
  code: "Código",
  name: "Nombre",
  legal_name: "Razón social",
  tax_id: "RUC",
  country_code: "País",
  active: "Estado",
  description: "Descripción",
  area_id: "Área",
  position_id: "Cargo",
  hierarchy_level: "Nivel",
  category_id: "Categoría",
  parent_id: "Centro padre",
  level: "Nivel",
  status: "Estado",
  start_date: "Inicio",
  end_date: "Fin",
  project_id: "Proyecto",
  symbol: "Símbolo",
  decimal_places: "Decimales",
  is_system: "Sistema",
  full_name: "Nombre",
  username: "Usuario",
  email: "Correo",
  user_companies: "Empresas",
  created_at: "Fecha",
  user_id: "Actor",
  action: "Acción",
  entity_type: "Entidad",
  company_id: "Empresa",
  reason: "Motivo",
};
export const stateLabels: Record<string, string> = {
  active: "Activo",
  inactive: "Inactivo",
  blocked: "Bloqueado",
  completed: "Completado",
  cancelled: "Cancelado",
};
export const futureGroups = [
  {
    title: "OPERACIONES",
    items: [
      [
        "Solicitudes",
        "requests",
        "request.view_own",
        "request.view_all",
        "request.view_area",
        "request.view_company",
      ],
    ],
  },
  {
    title: "FINANZAS",
    items: [
      ["Cuentas por pagar", "payables", "payable.view"],
      ["Pagos", "payments", "payment.view"],
      ["Tesorería", "treasury", "bank.view"],
      ["Cobranzas", "collections", "collection.view"],
    ],
  },
  {
    title: "CONTABILIDAD",
    items: [
      ["Provisiones", "provisions", "journal.view"],
      ["Asientos", "journals", "journal.view"],
      ["Cierre contable", "close", "accounting_close.view"],
      ["Estados financieros", "statements", "financial_statement.view"],
    ],
  },
  {
    title: "CONTROL",
    items: [
      ["AFE", "afe", "afe.view"],
      ["Presupuestos", "budgets", "budget.view"],
      ["Proyecciones", "forecasts", "projection.view"],
    ],
  },
];
const actionNames: Record<string, string> = {
  view: "Ver",
  view_own: "Ver propios",
  view_all: "Ver todos",
  view_area: "Ver del área",
  view_company: "Ver de empresa",
  create: "Crear",
  edit: "Editar",
  disable: "Desactivar",
  assign: "Asignar",
  manage: "Administrar",
  approve: "Aprobar",
  execute: "Ejecutar",
  schedule: "Programar",
  review: "Revisar",
  reject: "Rechazar",
  cancel: "Cancelar",
  post: "Contabilizar",
  reverse: "Reversar",
  bank_change: "Modificar cuenta bancaria",
  bank_change_approve: "Aprobar cuenta bancaria",
  finance_view: "Ver auditoría financiera",
  edit_own: "Editar propios",
  disburse: "Desembolsar",
  validate: "Validar",
  close: "Cerrar",
  sign: "Firmar",
  pay: "Pagar",
  record_payment: "Registrar devolución recibida",
  approve_closure: "Aprobar cierre",
  operational: "Ver reportes operativos",
  financial: "Ver reportes financieros",
  managerial: "Ver reportes gerenciales",
  export: "Exportar",
};
export function permissionLabel(p: { action: string; description: string }) {
  return actionNames[p.action] || p.description;
}
