import pg from 'pg';
import type { Db, Tx } from '../../src/lancamentos/lancamento.service.ts';

// Conexão da APLICAÇÃO: role sem BYPASSRLS (criada pela migração). Nunca use o superusuário aqui,
// senão o isolamento por tenant (RLS) deixa de valer.
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DB_POOL_MAX ?? 10) });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID.test(s);

export function dbDoTenant(tenantId: string, papel = 'ADMIN'): Db {
  if (!isUuid(tenantId)) throw new Error('tenant inválido');
  return {
    async transaction<R>(fn: (tx: Tx) => Promise<R>): Promise<R> {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query(`SELECT set_config('app.tenant_id',$1,true), set_config('app.papel',$2,true)`, [tenantId, papel]);
        const r = await fn({ query: (sql, p) => c.query(sql, p as any[]) as any });
        await c.query('COMMIT'); return r;
      } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
      finally { c.release(); }
    },
  };
}
