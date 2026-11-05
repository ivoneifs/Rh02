import type { Db } from '../../src/lancamentos/lancamento.service.ts';
import { validarLancamento, type ContaInfo } from '../../src/lancamentos/validar.ts';
import { sugerir, ClassificadorHistorico, type Regra } from '../../src/conciliacao/motor-regras.ts';
import { cifrar, decifrar, criptografiaDisponivel } from './crypto.ts';
import { executarAgente, ErroLLM, type Ferramenta, type Msg } from './agente.ts';
import { SQL_BALANCETE, SQL_RAZAO } from './sql.ts';

const dataOk = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const KEY_RE = /^[A-Za-z0-9_\-.]{20,300}$/;

export async function lerConfig(db: Db) {
  return db.transaction(async tx => {
    const c = (await tx.query(`SELECT key_ultimos4, modelo, limite_tokens_mes, (api_key_enc IS NOT NULL) AS tem FROM tenant_ia_config`)).rows[0];
    const uso = Number((await tx.query(`SELECT COALESCE(SUM(tokens),0) AS t FROM ia_uso WHERE em >= date_trunc('month', now())`)).rows[0].t);
    const doAmbiente = !!process.env.OPENAI_API_KEY;
    return { configurado: !!c?.tem || doAmbiente, origemChave: c?.tem ? 'tenant' : doAmbiente ? 'ambiente' : null, chaveFinal: c?.key_ultimos4 ?? null,
      modelo: c?.modelo ?? 'gpt-4o-mini', limiteTokensMes: c?.limite_tokens_mes ?? 200000, usoTokensMes: uso, criptografiaDisponivel: criptografiaDisponivel() };
  });
}

export async function salvarConfig(db: Db, tenant: string, b: any) {
  const modelo = b.modelo != null ? String(b.modelo) : null;
  if (modelo != null && !/^[A-Za-z0-9._:-]{2,60}$/.test(modelo)) throw new RangeError('modelo inválido');
  const lim = b.limiteTokensMes != null ? Number(b.limiteTokensMes) : null;
  if (lim != null && (!Number.isInteger(lim) || lim < 0 || lim > 1e9)) throw new RangeError('limiteTokensMes inválido');
  let enc: Buffer | null = null, ult4: string | null = null;
  if (b.apiKey != null) {
    if (typeof b.apiKey !== 'string' || !KEY_RE.test(b.apiKey.trim())) throw new RangeError('formato de chave inválido');
    if (!criptografiaDisponivel()) throw new RangeError('servidor sem IA_MASTER_KEY: não é possível guardar a chave com segurança');
    enc = cifrar(b.apiKey.trim()); ult4 = b.apiKey.trim().slice(-4);
  }
  await db.transaction(async tx => tx.query(
    `INSERT INTO tenant_ia_config (tenant_id, api_key_enc, key_ultimos4, modelo, limite_tokens_mes)
     VALUES ($1, $2, $3, COALESCE($4,'gpt-4o-mini'), COALESCE($5,200000))
     ON CONFLICT (tenant_id) DO UPDATE SET
       api_key_enc = COALESCE($2, tenant_ia_config.api_key_enc), key_ultimos4 = COALESCE($3, tenant_ia_config.key_ultimos4),
       modelo = COALESCE($4, tenant_ia_config.modelo), limite_tokens_mes = COALESCE($5, tenant_ia_config.limite_tokens_mes), atualizado_em = now()`,
    [tenant, enc, ult4, modelo, lim]));
}
export const removerChave = (db: Db) => db.transaction(async tx => { await tx.query(`UPDATE tenant_ia_config SET api_key_enc=NULL, key_ultimos4=NULL, atualizado_em=now()`); });

function ferramentas(db: Db, empresa: string): Ferramenta[] {
  const q = <T>(fn: (tx: any) => Promise<T>) => db.transaction(fn);   // transação curta por ferramenta (não segura conexão durante a chamada ao LLM)
  const contaPorCodigo = async (tx: any, codigo: string) => (await tx.query(`SELECT id, tipo, ativa, aceita_cc FROM plano_contas WHERE empresa_id=$1 AND codigo=$2`, [empresa, codigo])).rows[0];
  return [
    { name: 'consultar_balancete', description: 'Balancete do período: contas com movimento ou saldo (saldo_final positivo = devedor, negativo = credor).',
      parameters: { type: 'object', properties: { de: { type: 'string', description: 'AAAA-MM-DD' }, ate: { type: 'string', description: 'AAAA-MM-DD' } }, required: ['de', 'ate'] },
      exec: async a => { if (!dataOk(a.de) || !dataOk(a.ate)) throw new Error('datas inválidas');
        const rows = await q(async tx => (await tx.query(SQL_BALANCETE, [empresa, a.de, a.ate, a.de])).rows);
        return rows.filter((r: any) => r.tem_movimento || Number(r.saldo_final) !== 0).map((r: any) => ({ codigo: r.codigo, titulo: r.titulo, tipo: r.tipo, saldo_anterior: r.saldo_anterior, debito: r.total_debito, credito: r.total_credito, saldo_final: r.saldo_final })); } },
    { name: 'consultar_razao', description: 'Razão analítico de uma conta (pelo código contábil) com saldo acumulado.',
      parameters: { type: 'object', properties: { conta_codigo: { type: 'string' }, de: { type: 'string' }, ate: { type: 'string' } }, required: ['conta_codigo', 'de', 'ate'] },
      exec: async a => { if (!dataOk(a.de) || !dataOk(a.ate)) throw new Error('datas inválidas');
        return q(async tx => { const c = await contaPorCodigo(tx, String(a.conta_codigo)); if (!c) return { erro: 'conta não encontrada' };
          return (await tx.query(SQL_RAZAO, [empresa, c.id, a.de, a.ate])).rows.slice(0, 200).map((r: any) => ({ data: String(r.data).slice(0, 10), numero: r.numero, documento: r.documento, contrapartida: r.conta_contrapartida, debito: r.debito, credito: r.credito, saldo: r.saldo_acumulado })); }); } },
    { name: 'asos_vencendo', description: 'Colaboradores com ASO vencido ou a vencer nos próximos N dias.',
      parameters: { type: 'object', properties: { dias: { type: 'integer', minimum: 1, maximum: 365 } }, required: ['dias'] },
      exec: async a => q(async tx => (await tx.query(`SELECT c.nome, a.tipo, a.proximo_exame FROM asos a JOIN colaboradores c ON c.id=a.colaborador_id
          WHERE a.empresa_id=$1 AND a.proximo_exame <= current_date + $2::int ORDER BY a.proximo_exame LIMIT 100`, [empresa, Math.min(Math.max(a.dias | 0, 1), 365)])).rows) },
    { name: 'validar_lancamento', description: 'Valida (sem gravar) um lançamento de partidas dobradas. Informe contas pelo código contábil. Devolve ok/erros e o rascunho.',
      parameters: { type: 'object', properties: { data: { type: 'string' }, documento: { type: 'string' }, partidas: { type: 'array', items: { type: 'object', properties: { conta_codigo: { type: 'string' }, dc: { type: 'string', enum: ['D', 'C'] }, valor: { type: 'string', description: 'decimal com ponto, ex.: 1234.56' } }, required: ['conta_codigo', 'dc', 'valor'] } } }, required: ['data', 'partidas'] },
      exec: async a => q(async tx => { const mapa = new Map<string, ContaInfo>(); const ps: any[] = [];
        for (const p of a.partidas ?? []) { const c = await contaPorCodigo(tx, String(p.conta_codigo));
          if (c) mapa.set(c.id, { id: c.id, tipo: c.tipo, ativa: c.ativa, aceitaCC: c.aceita_cc });
          ps.push({ contaId: c?.id ?? `?${p.conta_codigo}`, dc: p.dc, valor: String(p.valor) }); }
        const v = validarLancamento({ empresaId: empresa, data: a.data, documento: a.documento, partidas: ps }, mapa);
        return { ok: v.ok, erros: v.erros, formato: v.formato, rascunho: { data: a.data, documento: a.documento, partidas: a.partidas }, aviso: 'NÃO gravado. O contador deve revisar e confirmar.' }; }) },
    { name: 'sugerir_contrapartida', description: 'Sugere a conta contábil de contrapartida para uma linha de extrato bancário (regras do escritório + aprendizado).',
      parameters: { type: 'object', properties: { descricao: { type: 'string' }, valor: { type: 'number', description: 'positivo = entrada, negativo = saída' } }, required: ['descricao', 'valor'] },
      exec: async a => q(async tx => {
        const regras: Regra[] = (await tx.query(`SELECT id, prioridade, tipo_match, padrao, sinal, valor_min, valor_max, conta_contrapartida_id, auto_confirmar FROM conciliacao_bancaria_regras WHERE empresa_id=$1 AND ativa`, [empresa])).rows
          .map((r: any) => ({ id: r.id, prioridade: r.prioridade, tipoMatch: r.tipo_match, padrao: r.padrao, sinal: r.sinal, valorMin: r.valor_min != null ? Number(r.valor_min) : undefined, valorMax: r.valor_max != null ? Number(r.valor_max) : undefined, contaContrapartidaId: r.conta_contrapartida_id, autoConfirmar: r.auto_confirmar }));
        const ml = new ClassificadorHistorico(); for (const f of (await tx.query(`SELECT descricao_norm, sinal, conta_id FROM conciliacao_feedback WHERE empresa_id=$1 ORDER BY id DESC LIMIT 20000`, [empresa])).rows) ml.treinar(f.descricao_norm, f.sinal, f.conta_id);
        const s = sugerir(String(a.descricao).slice(0, 300), Number(a.valor), regras, ml); if (!s) return { sugestao: null };
        const c = (await tx.query(`SELECT codigo, descricao FROM plano_contas WHERE id=$1`, [s.contaId])).rows[0]; return { sugestao: { conta: c?.codigo, titulo: c?.descricao, confianca: s.confianca, origem: s.origem } }; }) },
  ];
}

export async function conversar(db: Db, empresa: string, entrada: any) {
  const ms = entrada?.mensagens; if (!Array.isArray(ms) || !ms.length || ms.length > 20) throw new RangeError('mensagens: 1 a 20');
  const mensagens: Msg[] = ms.map((m: any) => {
    if (!['user', 'assistant'].includes(m?.role) || typeof m.content !== 'string' || m.content.length > 4000) throw new RangeError('mensagem inválida (role user/assistant, até 4000 caracteres)');
    return { role: m.role, content: m.content };
  });
  const cfg = await db.transaction(async tx => (await tx.query(`SELECT api_key_enc, modelo, limite_tokens_mes FROM tenant_ia_config`)).rows[0]);
  let apiKey: string | undefined; try { if (cfg?.api_key_enc) apiKey = decifrar(cfg.api_key_enc); } catch { throw new ErroLLM(500, 'Não foi possível ler a chave guardada (IA_MASTER_KEY mudou?). Cadastre a chave novamente.'); }
  apiKey ??= process.env.OPENAI_API_KEY;
  if (!apiKey) throw new ErroLLM(412, 'Chave da OpenAI não configurada.');
  const uso = Number((await db.transaction(async tx => (await tx.query(`SELECT COALESCE(SUM(tokens),0) AS t FROM ia_uso WHERE em >= date_trunc('month', now())`)).rows[0])).t);
  const limite = cfg?.limite_tokens_mes ?? 200000; if (uso >= limite) throw new ErroLLM(429, 'Limite mensal de tokens atingido.');
  const r = await executarAgente({ apiKey, baseUrl: process.env.OPENAI_BASE_URL, modelo: cfg?.modelo ?? 'gpt-4o-mini', mensagens, ferramentas: ferramentas(db, empresa) });
  await db.transaction(async tx => tx.query(`INSERT INTO ia_uso (tenant_id, funcao, tokens) VALUES (app_tenant(), 'AGENTE', $1)`, [r.tokens]));
  return { resposta: r.resposta, ferramentasUsadas: r.chamadas.map(c => c.nome), tokens: r.tokens };
}
