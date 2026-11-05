import http from 'node:http';
import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, dbDoTenant, isUuid } from './db.ts';
import { criarLancamento, ErroDeNegocio } from '../../src/lancamentos/lancamento.service.ts';
import { parseOFX } from '../../src/conciliacao/ofx-parser.ts';
import { sugerir, ClassificadorHistorico, type Regra } from '../../src/conciliacao/motor-regras.ts';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOKEN = process.env.API_TOKEN ?? '';
if (TOKEN.length < 24) { console.error('API_TOKEN ausente ou curto (mín. 24 caracteres).'); process.exit(1); }
const sqls = readFileSync(join(raiz, 'src/relatorios/balancete.sql'), 'utf8').split(';').filter(q => /SELECT/.test(q)).map(q => q.trim());
const [SQL_BALANCETE, SQL_RAZAO] = sqls;
const INDEX = readFileSync(join(raiz, 'api/public/index.html'));

const json = (res: http.ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
};
const lerCorpo = (req: http.IncomingMessage, max = 5_000_000) => new Promise<string>((ok, ko) => {
  let n = 0; const ch: Buffer[] = [];
  req.on('data', c => { n += c.length; if (n > max) { ko(new Error('corpo muito grande')); req.destroy(); } else ch.push(c); });
  req.on('end', () => ok(Buffer.concat(ch).toString('utf8'))); req.on('error', ko);
});
const autorizado = (req: http.IncomingMessage) => {
  const h = (req.headers.authorization ?? '').replace(/^Bearer /, ''); const a = Buffer.from(h), b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
};
const dataOk = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://x'); const p = url.pathname;
    if (p === '/' || p === '/index.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'" }); return res.end(INDEX); }
    if (p === '/health') { await pool.query('SELECT 1'); return json(res, 200, { ok: true }); }
    if (!p.startsWith('/v1/')) return json(res, 404, { erro: 'não encontrado' });
    if (!autorizado(req)) return json(res, 401, { erro: 'token inválido' });
    const tenant = String(req.headers['x-tenant-id'] ?? '');
    if (!isUuid(tenant)) return json(res, 400, { erro: 'X-Tenant-Id (uuid) obrigatório' });
    const db = dbDoTenant(tenant);
    let m: RegExpExecArray | null;

    if (req.method === 'GET' && p === '/v1/empresas')
      return json(res, 200, await db.transaction(async tx => (await tx.query('SELECT id, cnpj, razao_social, regime_tributario FROM empresas ORDER BY razao_social')).rows));

    if (req.method === 'POST' && p === '/v1/lancamentos') {
      const b = JSON.parse(await lerCorpo(req));
      if (!isUuid(b.empresaId)) return json(res, 400, { erro: 'empresaId inválido' });
      return json(res, 201, await criarLancamento(db, tenant, isUuid(b.usuarioId) ? b.usuarioId : null as any, b));
    }

    if (req.method === 'GET' && (m = /^\/v1\/empresas\/([^/]+)\/balancete$/.exec(p))) {
      const de = url.searchParams.get('de'), ate = url.searchParams.get('ate'), ex = url.searchParams.get('exercicio') ?? de;
      if (!isUuid(m[1]) || !dataOk(de) || !dataOk(ate) || !dataOk(ex)) return json(res, 400, { erro: 'parâmetros: de, ate (AAAA-MM-DD), [exercicio]' });
      return json(res, 200, await db.transaction(async tx => (await tx.query(SQL_BALANCETE, [m![1], de, ate, ex])).rows));
    }
    if (req.method === 'GET' && (m = /^\/v1\/empresas\/([^/]+)\/razao$/.exec(p))) {
      const conta = url.searchParams.get('conta'), de = url.searchParams.get('de'), ate = url.searchParams.get('ate');
      if (!isUuid(m[1]) || !isUuid(conta) || !dataOk(de) || !dataOk(ate)) return json(res, 400, { erro: 'parâmetros: conta (uuid), de, ate' });
      return json(res, 200, await db.transaction(async tx => (await tx.query(SQL_RAZAO, [m![1], conta, de, ate])).rows));
    }
    if (req.method === 'POST' && (m = /^\/v1\/empresas\/([^/]+)\/conciliacao\/ofx$/.exec(p))) {
      if (!isUuid(m[1])) return json(res, 400, { erro: 'empresa inválida' });
      const ext = parseOFX(await lerCorpo(req, 10_000_000));
      const out = await db.transaction(async tx => {
        const rs = (await tx.query(`SELECT id, prioridade, tipo_match, padrao, sinal, valor_min, valor_max, conta_contrapartida_id, auto_confirmar
          FROM conciliacao_bancaria_regras WHERE empresa_id=$1 AND ativa`, [m![1]])).rows;
        const regras: Regra[] = rs.map((r: any) => ({ id: r.id, prioridade: r.prioridade, tipoMatch: r.tipo_match, padrao: r.padrao, sinal: r.sinal,
          valorMin: r.valor_min != null ? Number(r.valor_min) : undefined, valorMax: r.valor_max != null ? Number(r.valor_max) : undefined,
          contaContrapartidaId: r.conta_contrapartida_id, autoConfirmar: r.auto_confirmar }));
        const ml = new ClassificadorHistorico();
        for (const f of (await tx.query(`SELECT descricao_norm, sinal, conta_id FROM conciliacao_feedback WHERE empresa_id=$1 ORDER BY id DESC LIMIT 20000`, [m![1]])).rows)
          ml.treinar(f.descricao_norm, f.sinal, f.conta_id);
        return ext.itens.map(i => ({ ...i, sugestao: sugerir(i.descricao, Number(i.valor), regras, ml) }));
      });
      return json(res, 200, { banco: ext.banco, conta: ext.conta, itens: out });
    }
    if (req.method === 'GET' && (m = /^\/v1\/empresas\/([^/]+)\/sst\/asos-vencendo$/.exec(p))) {
      const dias = Math.min(Math.max(Number(url.searchParams.get('dias') ?? 30) | 0, 1), 365);
      return json(res, 200, await db.transaction(async tx => (await tx.query(
        `SELECT c.nome, a.tipo, a.proximo_exame FROM asos a JOIN colaboradores c ON c.id=a.colaborador_id
          WHERE a.empresa_id=$1 AND a.proximo_exame <= current_date + $2::int ORDER BY a.proximo_exame`, [m![1], dias])).rows));
    }
    return json(res, 404, { erro: 'rota não encontrada' });
  } catch (e: any) {
    if (e instanceof ErroDeNegocio) return json(res, 422, { codigo: e.codigo, detalhes: e.detalhes });
    if (e instanceof SyntaxError) return json(res, 400, { erro: 'JSON inválido' });
    if (e?.code === '23514' || e?.code === '23505' || e?.code === 'P0001') return json(res, 422, { erro: e.message });   // check/unique/trigger do banco
    console.error(e); return json(res, 500, { erro: 'erro interno' });
  }
});
const porta = Number(process.env.PORT ?? 3000);
server.listen(porta, '0.0.0.0', () => console.log(`ERP Contábil API em :${porta}`));
process.on('SIGTERM', () => server.close(() => pool.end().then(() => process.exit(0))));
