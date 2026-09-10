begin;

insert into public.permissions(module,resource,action,code,description)
select v.module, v.resource, a.action, v.resource || '.' || a.action,
       v.resource || ': ' || replace(a.action,'_',' ')
from (values
  ('dashboard','dashboard','view'),
  ('operaciones','request','view_own view_all create edit_own review approve reject cancel'),
  ('maestros','supplier','view create edit bank_change bank_change_approve'),
  ('operaciones','invoice','view create edit validate'),
  ('operaciones','payment','view create review approve schedule execute cancel'),
  ('gastos','advance','view_own view_all create approve disburse'),
  ('gastos','expense_report','create review approve close'),
  ('gastos','sworn_declaration','create sign review approve'),
  ('gastos','vendor_refund','view create record_payment approve_closure'),
  ('control','budget','view manage'),
  ('reportes','report','operational financial managerial export'),
  ('administracion','audit','view'),
  ('administracion','user','view create edit disable'),
  ('administracion','role','view create edit assign'),
  ('administracion','permission','manage'),
  ('administracion','settings','manage'),
  ('maestros','area','view create edit disable'),
  ('administracion','position','view create edit disable'),
  ('operaciones','purchase_order','view'),
  ('tesoreria','payable','view'),
  ('tesoreria','bank','view'),
  ('tesoreria','reconciliation','view'),
  ('control','recurring_service','view'),
  ('control','contract','view'),
  ('maestros','cost_center','view'),
  ('maestros','project','view'),
  ('gastos','expense_report','view'),
  ('gastos','sworn_declaration','view')
) as v(module,resource,actions)
cross join lateral unnest(string_to_array(v.actions,' ')) as a(action);

insert into public.roles(name,code,description,is_system) values
('System Administrator','system_administrator','Administración técnica; sin poderes financieros implícitos',true),
('Solicitante','solicitante','Pendiente de configurar según funciones aprobadas',false),
('Finanzas','finanzas','Pendiente de configurar según funciones aprobadas',false),
('Tesorería','tesoreria','Pendiente de configurar según funciones aprobadas',false),
('Aprobador','aprobador','Pendiente de configurar según funciones aprobadas',false),
('Gerencia de Finanzas','gerencia_finanzas','Pendiente de configurar según funciones aprobadas',false),
('Auditor','auditor','Pendiente de configurar según funciones aprobadas',false);

insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r cross join public.permissions p
where r.code = 'system_administrator'
  and (p.module = 'administracion' or p.resource = 'area' or p.code = 'dashboard.view');

insert into public.areas(name,code) values
('Finanzas','FIN'),('TI','TI'),('Recursos Humanos','RRHH'),
('Comercial','COM'),('Operaciones','OPS'),('Compras','COMP'),('Administración','ADM');

insert into public.positions(name,area_id)
select v.name,a.id from (values
('Asistente de Finanzas','FIN'),('Analista de Finanzas','FIN'),
('Coordinador de Finanzas','FIN'),('Jefe de Finanzas','FIN'),('Gerente de Finanzas','FIN'),
('Analista TI','TI'),('Coordinador TI','TI'),('Gerente de Proyectos','OPS')
) v(name,code) join public.areas a on a.code = v.code;

commit;
