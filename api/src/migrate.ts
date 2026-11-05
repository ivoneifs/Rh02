// Migrações idempotentes + role da aplicação. Roda no start do container (antes da API).
import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const admin = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
const appPass = process.env.APP_DB_PASSWORD;
if (!process.env.DATABASE_ADMIN_URL || !appPass) { console.error('Defina DATABASE_ADMIN_URL e APP_DB_PASSWORD'); process.exit(1); }

await admin.connect();
await admin.query(`CREATE TABLE IF NOT EXISTS schema_migrations (nome text PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())`);
const arquivos = readdirSync(join(raiz, 'db')).filter(f => /^\d+_.*\.sql$/.test(f)).sort();
for (const f of arquivos) {
  if ((await admin.query('SELECT 1 FROM schema_migrations WHERE nome=$1', [f])).rowCount) continue;
  console.log('aplicando', f);
  try {
    await admin.query('BEGIN'); await admin.query(readFileSync(join(raiz, 'db', f), 'utf8'));
    await admin.query('INSERT INTO schema_migrations(nome) VALUES ($1)', [f]); await admin.query('COMMIT');
  } catch (e) { await admin.query('ROLLBACK'); console.error('FALHA em', f, e); process.exit(1); }
}
// Role da aplicação: sem superuser e sem BYPASSRLS → o RLS vale de verdade.
const esc = (s: string) => s.replace(/'/g, "''");
await admin.query(`DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='erp_app') THEN CREATE ROLE erp_app LOGIN NOSUPERUSER NOBYPASSRLS; END IF;
END $$`);
await admin.query(`ALTER ROLE erp_app PASSWORD '${esc(appPass)}'`);
await admin.query(`GRANT USAGE ON SCHEMA public TO erp_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO erp_app;
  GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_app; REVOKE INSERT,UPDATE,DELETE ON schema_migrations FROM erp_app`);
if (process.env.SEED_DEMO === 'true') {
  if (!(await admin.query(`SELECT 1 FROM tenants WHERE id='00000000-0000-0000-0000-0000000000a1'`)).rowCount) {
    console.log('carregando dados de demonstração'); await admin.query(readFileSync(join(raiz, 'db', 'seed', 'demo.sql'), 'utf8'));
  }
}
await admin.end(); console.log('migrações ok');
