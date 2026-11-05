import http from 'node:http';
import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, dbDoTenant, isUuid } from './db.ts';
import { criarLancamento, ErroDeNegocio } from '../../src/lancamentos/lancamento.service.ts';
import { parseOFX } from '../../src/conciliacao/ofx-parser.ts';
import { sugerir, ClassificadorHistorico, type Regra } from '../../src/conciliacao/motor-regras.ts';
import { SQL_BALANCETE, SQL_RAZAO } from './sql.ts';
import { lerConfig, salvarConfig, removerChave, conversar } from './ia-rotas.ts';
import { ErroLLM } from './agente.ts';
import * as auth from './auth.ts';
import * as normas from './normas.ts';
import * as pessoal from './pessoal.ts';
import * as registros from './registros.ts';
import { catalogo, executar } from './catalogo.ts';
import { ErroCalc } from './ferramentas.ts';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOKEN = process.env.API_TOKEN ?? '';
if (TOKEN.length < 24) { console.error('API_TOKEN ausente ou curto (mín. 24 caracteres).'); process.exit(1); }
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
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',').pop()!.trim();
    const mutante = req.method !== 'GET' && req.method !== 'HEAD';
    const setCookie = (token: string, apagar = false) => res.setHeader('set-cookie', auth.cookieSessao(req, token, apagar));
    // Defesa extra de CSRF além do SameSite=Strict: requisições que alteram dados exigem JSON.
    if (mutante && (p.startsWith('/auth/') || p.startsWith('/v1/')) && !/^application\/json/i.test(String(req.headers['content-type'] ?? '')) && !req.headers.authorization && !/\/conciliacao\/ofx$/.test(p) && req.method !== 'DELETE')
      return json(res, 415, { erro: 'content-type deve ser application/json' });

    if (p === '/auth/cadastro' && req.method === 'POST') {
      if (process.env.PERMITIR_CADASTRO === 'false') return json(res, 403, { erro: 'Cadastro público desativado. Peça um convite ao administrador.' });
      const { token } = await auth.cadastrar(JSON.parse(await lerCorpo(req, 20_000))); setCookie(token); return json(res, 201, { ok: true });
    }
    if (p === '/auth/login' && req.method === 'POST') { const { token } = await auth.entrar(JSON.parse(await lerCorpo(req, 20_000)), ip); setCookie(token); return json(res, 200, { ok: true }); }
    if (p === '/auth/logout' && req.method === 'POST') { await auth.sair(req); setCookie('', true); return json(res, 200, { ok: true }); }
    if (p === '/auth/config' && req.method === 'GET') return json(res, 200, { cadastroAberto: process.env.PERMITIR_CADASTRO !== 'false' });
    if (p === '/auth/me' && req.method === 'GET') { const s = await auth.sessaoDe(req); return s ? json(res, 200, { nome: s.nome, email: s.email, papel: s.papel }) : json(res, 401, { erro: 'não autenticado' }); }
    if (p === '/auth/senha' && req.method === 'POST') {
      const s = await auth.sessaoDe(req); if (!s) return json(res, 401, { erro: 'não autenticado' });
      await auth.trocarSenha(s, JSON.parse(await lerCorpo(req, 20_000)), req); return json(res, 200, { ok: true });
    }

    if (!p.startsWith('/v1/')) return json(res, 404, { erro: 'não encontrado' });

    let m: RegExpExecArray | null;
    // Ferramentas de cálculo (qualquer papel logado) e Normas (leitura: todos; alteração: ADMIN)
    if (p.startsWith('/v1/ferramentas') || p.startsWith('/v1/normas') || p.startsWith('/v1/registros') || p.startsWith('/v1/funcionarios') || p.startsWith('/v1/cargos') || p.startsWith('/v1/ambientes') || /^\/v1\/empresas\/[^/]+\/(funcionarios|cargos|ambientes)$/.test(p)) {
      const s = await auth.sessaoDe(req); if (!s) return json(res, 401, { erro: 'não autenticado' });
      const corpo = async () => JSON.parse(await lerCorpo(req, 200_000));
      const qp = url.searchParams;
      if ((m = /^\/v1\/empresas\/([^/]+)\/funcionarios$/.exec(p))) { if (req.method === 'GET') return json(res, 200, await pessoal.listarFuncionarios(s, m[1], qp.get('q') ?? undefined, qp.get('ativos') === '1')); if (req.method === 'POST') return json(res, 201, await pessoal.criarFuncionario(s, m[1], await corpo())); }
      if ((m = /^\/v1\/funcionarios\/([^/]+)$/.exec(p))) { if (req.method === 'GET') return json(res, 200, await pessoal.obterFuncionario(s, m[1])); if (req.method === 'PATCH') return json(res, 200, await pessoal.editarFuncionario(s, m[1], await corpo())); if (req.method === 'DELETE') return json(res, 200, await pessoal.excluirFuncionario(s, m[1])); }
      for (const [rota, mod] of [['cargos', pessoal.cargos], ['ambientes', pessoal.ambientes]] as const) {
        if (req.method !== 'GET' && new RegExp(`^/v1/(empresas/[^/]+/)?${rota}(/|$)`).test(p) && s.papel !== 'ADMIN') return json(res, 403, { erro: 'Apenas administradores alteram cargos e ambientes (configuração).' });
        if ((m = new RegExp(`^/v1/empresas/([^/]+)/${rota}$`).exec(p))) { if (req.method === 'GET') return json(res, 200, await mod.listar(s, m[1])); if (req.method === 'POST') return json(res, 201, await mod.criar(s, m[1], await corpo())); }
        if ((m = new RegExp(`^/v1/${rota}/([^/]+)$`).exec(p))) { if (req.method === 'PATCH') return json(res, 200, await mod.editar(s, m[1], await corpo())); if (req.method === 'DELETE') return json(res, 200, await mod.excluir(s, m[1])); }
      }
      if (p === '/v1/registros/vencimentos' && req.method === 'GET') return json(res, 200, await registros.vencimentos(s, Number(qp.get('dias') ?? 30) || 30, qp.get('empresa') ?? undefined));
      if (p === '/v1/registros' && req.method === 'GET') return json(res, 200, await registros.listar(s, { ferramenta: qp.get('ferramenta') ?? undefined, empresa: qp.get('empresa') ?? undefined, funcionario: qp.get('funcionario') ?? undefined, status: qp.get('status') ?? undefined }));
      if (p === '/v1/registros' && req.method === 'POST') return json(res, 201, await registros.criar(s, await corpo()));
      if ((m = /^\/v1\/registros\/([^/]+)$/.exec(p))) { if (req.method === 'PATCH') return json(res, 200, await registros.editar(s, m[1], await corpo())); if (req.method === 'DELETE') return json(res, 200, await registros.excluir(s, m[1])); }
      if (p === '/v1/ferramentas' && req.method === 'GET') return json(res, 200, catalogo());
      if ((m = /^\/v1\/ferramentas\/([a-z0-9_]+)$/i.exec(p)) && req.method === 'POST') return json(res, 200, executar(m[1], await corpo(), await normas.vigentes(s)));
      if (p === '/v1/normas/categorias' && req.method === 'GET') return json(res, 200, Object.entries(normas.CATEGORIAS).map(([id, c]) => ({ id, ...c })));
      if (p === '/v1/normas' && req.method === 'GET') return json(res, 200, await normas.listar(s, url.searchParams.get('categoria') ?? undefined));
      if (p === '/v1/normas' && req.method === 'POST') return json(res, 201, await normas.criar(s, await corpo()));
      if (p === '/v1/normas/historico' && req.method === 'GET') return json(res, 200, await normas.historico(s, url.searchParams.get('codigo') ?? undefined));
      if (p === '/v1/normas/restaurar' && req.method === 'POST') return json(res, 200, await normas.restaurarPadroes(s));
      if ((m = /^\/v1\/normas\/atualizar\/([A-Z_]+)$/.exec(p)) && req.method === 'POST') return json(res, 200, await normas.atualizar(s, m[1]));
      if ((m = /^\/v1\/normas\/([^/]+)\/aprovar$/.exec(p)) && req.method === 'POST') return json(res, 200, await normas.aprovar(s, m[1]));
      if ((m = /^\/v1\/normas\/([^/]+)$/.exec(p))) { if (req.method === 'PATCH') return json(res, 200, await normas.editar(s, m[1], await corpo())); if (req.method === 'DELETE') return json(res, 200, await normas.excluir(s, m[1])); }
      return json(res, 404, { erro: 'rota não encontrada' });
    }

    // Administração (somente sessão de usuário ADMIN)
    if (p.startsWith('/v1/admin/')) {
      const s = await auth.sessaoDe(req); if (!s) return json(res, 401, { erro: 'não autenticado' });
      const corpo = async () => JSON.parse(await lerCorpo(req, 20_000));
      if (p === '/v1/admin/usuarios') { if (req.method === 'GET') return json(res, 200, await auth.listarUsuarios(s)); if (req.method === 'POST') return json(res, 201, await auth.criarUsuario(s, await corpo())); }
      if ((m = /^\/v1\/admin\/usuarios\/([^/]+)$/.exec(p))) { if (req.method === 'PATCH') return json(res, 200, await auth.editarUsuario(s, m[1], await corpo())); if (req.method === 'DELETE') return json(res, 200, await auth.excluirUsuario(s, m[1])); }
      if (p === '/v1/admin/empresas') { if (req.method === 'GET') return json(res, 200, await auth.listarEmpresasAdmin(s)); if (req.method === 'POST') return json(res, 201, await auth.criarEmpresa(s, await corpo())); }
      if ((m = /^\/v1\/admin\/empresas\/([^/]+)$/.exec(p))) { if (req.method === 'PATCH') return json(res, 200, await auth.editarEmpresa(s, m[1], await corpo())); if (req.method === 'DELETE') return json(res, 200, await auth.excluirEmpresa(s, m[1])); }
      return json(res, 404, { erro: 'rota não encontrada' });
    }

    // Dados: token de integração (Bearer + X-Tenant-Id) OU sessão de usuário (tenant e papel vêm da sessão)
    let tenant: string, papel: string = 'ADMIN', usuarioSessao: string | null = null;
    if (req.headers.authorization) {
      if (!autorizado(req)) return json(res, 401, { erro: 'token inválido' });
      tenant = String(req.headers['x-tenant-id'] ?? '');
      if (!isUuid(tenant)) return json(res, 400, { erro: 'X-Tenant-Id (uuid) obrigatório' });
    } else {
      const s = await auth.sessaoDe(req); if (!s) return json(res, 401, { erro: 'não autenticado' });
      if (mutante && s.papel === 'CLIENTE_LEITURA') return json(res, 403, { erro: 'Perfil somente leitura.' });
      if (p === '/v1/ia/config' && mutante && s.papel !== 'ADMIN') return json(res, 403, { erro: 'Apenas administradores configuram a IA.' });
      tenant = s.tenantId; papel = s.papel; usuarioSessao = s.usuarioId;
    }
    const db = dbDoTenant(tenant, papel);

    if (p === '/v1/ia/config') {
      if (req.method === 'GET') return json(res, 200, await lerConfig(db));
      if (req.method === 'PUT') { await salvarConfig(db, tenant, JSON.parse(await lerCorpo(req, 20_000))); return json(res, 200, await lerConfig(db)); }
      if (req.method === 'DELETE') { await removerChave(db); return json(res, 200, await lerConfig(db)); }
    }
    if (req.method === 'POST' && (m = /^\/v1\/empresas\/([^/]+)\/ia\/chat$/.exec(p))) {
      if (!isUuid(m[1])) return json(res, 400, { erro: 'empresa inválida' });
      return json(res, 200, await conversar(db, m[1], JSON.parse(await lerCorpo(req, 100_000))));
    }
    if (req.method === 'GET' && p === '/v1/empresas')
      return json(res, 200, await db.transaction(async tx => (await tx.query('SELECT id, cnpj, razao_social, regime_tributario FROM empresas ORDER BY razao_social')).rows));

    if (req.method === 'POST' && p === '/v1/lancamentos') {
      const b = JSON.parse(await lerCorpo(req));
      if (!isUuid(b.empresaId)) return json(res, 400, { erro: 'empresaId inválido' });
      return json(res, 201, await criarLancamento(db, tenant, usuarioSessao ?? (isUuid(b.usuarioId) ? b.usuarioId : null as any), b));
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
    if (e instanceof ErroCalc) return json(res, 422, { erro: e.message });
    if (e instanceof auth.ErroAuth) return json(res, e.status, { erro: e.message });
    if (e instanceof ErroDeNegocio) return json(res, 422, { codigo: e.codigo, detalhes: e.detalhes });
    if (e instanceof ErroLLM) return json(res, e.status === 401 ? 502 : e.status >= 500 ? 502 : e.status, { erro: e.status === 401 ? 'A OpenAI rejeitou a chave. Cadastre uma chave válida.' : e.message });
    if (e instanceof RangeError) return json(res, 400, { erro: e.message });
    if (e instanceof SyntaxError) return json(res, 400, { erro: 'JSON inválido' });
    if (e?.code === '23514' || e?.code === '23505' || e?.code === 'P0001') return json(res, 422, { erro: e.message });   // check/unique/trigger do banco
    console.error(e); return json(res, 500, { erro: 'erro interno' });
  }
});
const porta = Number(process.env.PORT ?? 3000);
server.listen(porta, '0.0.0.0', () => console.log(`ERP Contábil API em :${porta}`));
process.on('SIGTERM', () => server.close(() => pool.end().then(() => process.exit(0))));
