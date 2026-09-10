export type Profile = {
  id: string; email: string; username: string; full_name: string;
  status: 'active' | 'inactive' | 'blocked';
  area_id: string | null; position_id: string | null; manager_id: string | null;
};
export type Permission = { code: string; scope: string; requires_company: boolean };
export type ResourceContext = { company_id: string; owner_id: string; area_id: string | null };
