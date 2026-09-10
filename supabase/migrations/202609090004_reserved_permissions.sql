begin;
insert into public.permissions(module,resource,action,code,description,scope)
select v.module,v.resource,a.action,v.resource || '.' || a.action,
  v.resource || ': ' || replace(a.action,'_',' '),
  case a.action when 'view_own' then 'own' when 'view_area' then 'area'
    when 'view_company' then 'company' when 'view_all' then 'all_authorized' else 'none' end
from (values
  ('operaciones','request','view_area view_company'),
  ('administracion','permission','assign'),
  ('administracion','company','view create edit disable assign'),
  ('auditoria_financiera','audit','finance_view'),
  ('gastos','employee_return','view create record_payment approve_closure'),
  ('gastos','employee_reimbursement','view create review approve pay'),
  ('operaciones','service_acceptance','view create review approve reject'),
  ('tesoreria','payment_batch','view create review approve execute cancel')
) v(module,resource,actions)
cross join lateral unnest(string_to_array(v.actions,' ')) a(action);

-- Preserve historical code; remove obsolete grant, never rename/reuse it.
update public.permissions set active=false,
  description='Retirado: usar permission.assign para asignación; catálogo exclusivo de migraciones'
where code='permission.manage';
delete from public.role_permissions where permission_id in
  (select id from public.permissions where code='permission.manage');
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r cross join public.permissions p
where r.code='system_administrator' and
  (p.code='permission.assign' or p.resource='company');
-- No actual companies or company memberships are invented by the seed.
commit;
