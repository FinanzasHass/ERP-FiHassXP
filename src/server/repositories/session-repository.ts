import { createClient } from '@supabase/supabase-js';
import type { Config } from '../config/env.js';
import type { Profile } from '../../shared/contracts.js';
import { databaseError } from '../middleware/errors.js';
export type ListQuery = { page: number; limit: number; company_id?: string; user_id?: string; category?: string; from?:string;to?:string;search?:string;code?:string;name?:string;category_id?:string;active?:string;project_id?:string };
export interface SessionRepository {
  profile(id: string): Promise<Profile | null>;
  rpc<T>(name: string, args: Record<string, unknown>): Promise<T>;
  list(table: string, query: ListQuery, filters?: Record<string, string>): Promise<{ data: unknown[]; count: number }>;
}
export function createSessionRepository(config: Pick<Config, 'SUPABASE_URL' | 'SUPABASE_PUBLISHABLE_KEY'>, token: string): SessionRepository {
  const db = createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return {
    async profile(id) {
      const { data, error } = await db.from('profiles').select('id,email,username,full_name,status,area_id,position_id,manager_id').eq('id', id).maybeSingle();
      if (error) databaseError(error);
      return data as Profile | null;
    },
    async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
      const { data, error } = await db.rpc(name, args);
      if (error) databaseError(error);
      return data as T;
    },
    async list(table, query, filters = {}) {
      let builder = db.from(table).select('*', { count: 'exact' });
      if(table==='journal_entry_lines')builder=db.from(table).select('*,journal_line_dimensions(*)',{count:'exact'});
      if(table==='supplier_companies')builder=db.from(table).select('*,suppliers(id,tax_id_type,tax_id,country_code,legal_name)',{count:'exact'});
      if(table==='profiles') {
        builder=db.from(table).select(query.company_id?'*,user_companies!inner(company_id,active)':'*,user_companies(company_id,active)',{count:'exact'});
        if(query.company_id) builder=builder.eq('user_companies.company_id',query.company_id).eq('user_companies.active',true);
      }
      if(table==='audit_logs') {
        if(query.from) builder=builder.gte('created_at',query.from+'T00:00:00Z');
        if(query.to) builder=builder.lt('created_at',new Date(Date.parse(query.to+'T00:00:00Z')+86400000).toISOString());
      }
      for (const [key, value] of Object.entries(filters)) builder = builder.eq(key, value);
      if(table==='accounting_event_queue'){
        if(query.from)builder=builder.gte('event_date',query.from);
        if(query.to)builder=builder.lte('event_date',query.to);
      }
      if(query.search){const fields=table==='profiles'?['full_name','username','email']:table==='companies'?['code','legal_name']:['code','name'];builder=builder.or(fields.map(f=>`${f}.ilike.%${query.search}%`).join(','));}
      if(['cost_centers','cost_center_categories','projects','subprojects'].includes(table)){
        if(query.code)builder=builder.eq('code',query.code);
        if(query.name)builder=builder.ilike('name','%'+query.name.replaceAll('%','\\%').replaceAll('_','\\_')+'%');
        if(query.active&&table.startsWith('cost_center'))builder=builder.eq('active',query.active==='true');
        if(query.category_id&&table==='cost_centers')builder=builder.eq('category_id',query.category_id);
        if(query.project_id&&table==='subprojects')builder=builder.eq('project_id',query.project_id);
      }
      const order = table === 'accounting_event_sources'?'entity_id':table === 'audit_logs'?'created_at':table === 'permissions' ? 'code' : table === 'role_permissions' ? 'permission_id' : table === 'user_companies' ? 'company_id' : 'id';
      if (table.endsWith('_history')) builder=builder.order('created_at',{ascending:true});
      const { data, error, count } = await builder.order(order,{ascending:table!=='audit_logs'}).range((query.page - 1) * query.limit, query.page * query.limit - 1);
      if (error) databaseError(error);
      return { data: data ?? [], count: count ?? 0 };
    },
  };
}
