// Indicadores (semáforo verde/amarelo/vermelho) por funcionário para o DP/RH e para o SST.
// Regras objetivas e transparentes, calculadas a partir do cadastro e dos registros. São alertas de gestão, não parecer jurídico.
import { dbDoTenant, isUuid } from './db.ts';
import { ErroAuth, type Sessao } from './auth.ts';
import { TODAS } from './catalogo.ts';

export type Nivel = 'VERDE' | 'AMARELO' | 'VERMELHO' | 'CINZA';
export interface Ind { nivel: Nivel; motivos: string[] }
const ORD: Record<Nivel, number> = { CINZA: 0, VERDE: 1, AMARELO: 2, VERMELHO: 3 };
const pior = (a: Nivel, b: Nivel): Nivel => (ORD[a] >= ORD[b] ? a : b);
const DIA = 864e5;
const SST_IDS = new Set(TODAS.filter(f => f.cat.startsWith('SST') && f.tipo === 'registro').map(f => f.id));
const DP_IDS = new Set(TODAS.filter(f => !f.cat.startsWith('SST') && f.tipo === 'registro' && f.registro?.func).map(f => f.id));

export interface Col { id: string; data_admissao: string | null; data_demissao: string | null; ativo: boolean; tipo_contrato: string | null; pis_nis: string | null; ctps: string | null; data_nascimento: string | null; cargo_id: string | null; salario: string | number | null }
export interface Reg { funcionario_id: string; ferramenta: string; status: string; data_evento: string | null; data_validade: string | null; curso?: string }
const dia = (v: any) => v ? Math.floor(Date.parse(String(v).slice(0, 10)) / DIA) : null;
const rotulo = (n: number) => n < 0 ? `vencido há ${-n} dia(s)` : n === 0 ? 'vence hoje' : `vence em ${n} dia(s)`;

/** Avalia um funcionário. `hoje` em dias desde 1970 (injetável para teste). */
export function avaliar(c: Col, regs: Reg[], hoje = Math.floor(Date.now() / DIA)): { dp: Ind; sst: Ind; geral: Nivel } {
  if (c.data_demissao || !c.ativo) return { dp: { nivel: 'CINZA', motivos: ['Desligado/inativo'] }, sst: { nivel: 'CINZA', motivos: ['Desligado/inativo'] }, geral: 'CINZA' };
  const dp: Ind = { nivel: 'VERDE', motivos: [] }, sst: Ind = { nivel: 'VERDE', motivos: [] };
  const add = (i: Ind, n: Nivel, m: string) => { i.nivel = pior(i.nivel, n); i.motivos.push(m); };
  const ativos = regs.filter(r => r.status !== 'CANCELADO');
  // ---- DP: cadastro ----
  const falta = [!c.pis_nis && 'PIS/NIS', !c.ctps && 'CTPS', !c.data_nascimento && 'nascimento', !c.cargo_id && 'cargo', !(Number(c.salario) > 0) && 'salário'].filter(Boolean) as string[];
  if (falta.length) add(dp, falta.length >= 3 ? 'VERMELHO' : 'AMARELO', 'Cadastro incompleto: ' + falta.join(', '));
  // ---- DP: contrato de experiência ----
  const adm = dia(c.data_admissao);
  if (c.tipo_contrato === 'EXPERIENCIA' && adm != null) { const fim = adm + 89, d = fim - hoje;
    if (d < 0) add(dp, 'VERMELHO', `Experiência (90 dias) encerrada há ${-d} dia(s) sem efetivação registrada`); else if (d <= 15) add(dp, 'AMARELO', `Experiência termina em ${d} dia(s): decidir efetivação`); }
  // ---- DP: férias (estimativa pelo último gozo registrado ou pela admissão) ----
  if (adm != null && c.tipo_contrato !== 'ESTAGIO') {
    const gozos = ativos.filter(r => r.ferramenta === 'ferias_dp' && r.data_evento).map(r => dia(r.data_evento)!);
    const base = gozos.length ? Math.max(...gozos) : adm, meses = (hoje - base) / 30.4375;
    if (hoje - adm >= 365) { if (meses >= 23) add(dp, 'VERMELHO', `Férias possivelmente vencidas: ${Math.floor(meses)} meses sem gozo ${gozos.length ? 'desde o último registrado' : 'registrado'} (risco de dobra)`);
      else if (meses >= 18) add(dp, 'AMARELO', `Programar férias: ${Math.floor(meses)} meses desde ${gozos.length ? 'o último gozo' : 'a admissão'}`); } }
  // ---- pendências com prazo (ABERTO) ----
  const pend = (ids: Set<string>, ind: Ind, nome: string) => { const l = ativos.filter(r => ids.has(r.ferramenta) && r.status === 'ABERTO' && r.data_validade && !(ind === sst && r.ferramenta === 'aso'));
    const venc = l.filter(r => dia(r.data_validade)! < hoje), prox = l.filter(r => { const d = dia(r.data_validade)!; return d >= hoje && d - hoje <= 30; });
    if (venc.length) add(ind, 'VERMELHO', `${venc.length} pendência(s) de ${nome} vencida(s)`); if (prox.length) add(ind, 'AMARELO', `${prox.length} pendência(s) de ${nome} a vencer em 30 dias`); };
  pend(DP_IDS, dp, 'DP'); pend(SST_IDS, sst, 'SST');
  // ---- SST: reciclagem de treinamentos (vale o registro concluído mais recente de cada curso) ----
  const ult = new Map<string, number>(); for (const r of ativos) if (r.ferramenta === 'treinamento' && r.status === 'CONCLUIDO' && r.data_validade) { const k = (r.curso ?? '').toLowerCase().trim() || '?', d = dia(r.data_validade)!; ult.set(k, Math.max(ult.get(k) ?? -Infinity, d)); }
  const recVenc = [...ult.values()].filter(d => d < hoje).length; if (recVenc) add(sst, 'VERMELHO', `${recVenc} treinamento(s) com reciclagem vencida`);
  // ---- SST: ASO ----
  const asos = ativos.filter(r => r.ferramenta === 'aso');
  if (!asos.length) add(sst, 'VERMELHO', 'Sem ASO registrado');
  else { const vs = asos.map(r => dia(r.data_validade)).filter((x): x is number => x != null);
    if (!vs.length) add(sst, 'AMARELO', 'ASO sem validade informada'); else { const d = Math.max(...vs) - hoje; if (d < 0) add(sst, 'VERMELHO', 'ASO ' + rotulo(d)); else if (d <= 30) add(sst, 'AMARELO', 'ASO ' + rotulo(d)); } }
  return { dp, sst, geral: pior(dp.nivel, sst.nivel) };
}

export async function semaforo(s: Sessao, empresa?: string) {
  if (empresa && !isUuid(empresa)) throw new ErroAuth(400, 'empresa inválida');
  return dbDoTenant(s.tenantId, s.papel).transaction(async t => {
    const cols: Col[] = (await t.query(`SELECT id, to_char(data_admissao,'YYYY-MM-DD') AS data_admissao, to_char(data_demissao,'YYYY-MM-DD') AS data_demissao, ativo, tipo_contrato, pis_nis, ctps, to_char(data_nascimento,'YYYY-MM-DD') AS data_nascimento, cargo_id, salario FROM colaboradores WHERE ($1::uuid IS NULL OR empresa_id=$1)`, [empresa ?? null])).rows;
    const regs: Reg[] = cols.length ? (await t.query(`SELECT funcionario_id, ferramenta, status, to_char(data_evento,'YYYY-MM-DD') AS data_evento, to_char(data_validade,'YYYY-MM-DD') AS data_validade, COALESCE(dados->>'curso','') AS curso FROM registros WHERE funcionario_id = ANY($1::uuid[])`, [cols.map(c => c.id)])).rows : [];
    const por = new Map<string, Reg[]>(); for (const r of regs) (por.get(r.funcionario_id) ?? por.set(r.funcionario_id, []).get(r.funcionario_id)!).push(r);
    const itens: Record<string, ReturnType<typeof avaliar>> = {}; const resumo = { dp: { VERDE: 0, AMARELO: 0, VERMELHO: 0 }, sst: { VERDE: 0, AMARELO: 0, VERMELHO: 0 }, geral: { VERDE: 0, AMARELO: 0, VERMELHO: 0 } };
    for (const c of cols) { const a = avaliar(c, por.get(c.id) ?? []); itens[c.id] = a; if (a.geral === 'CINZA') continue; resumo.dp[a.dp.nivel as 'VERDE']++; resumo.sst[a.sst.nivel as 'VERDE']++; resumo.geral[a.geral as 'VERDE']++; }
    return { resumo, itens };
  });
}
