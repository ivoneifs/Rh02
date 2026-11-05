// Holerite (recibo de pagamento de salário): o cálculo usa o cadastro do funcionário e as tabelas vigentes do sistema (INSS, IRRF, FGTS,
// adicionais), sem valores fixos no código. A gravação/edição/exclusão usa a tabela de registros (ferramenta "holerite").
import { dbDoTenant, isUuid } from './db.ts';
import { ErroAuth, type Sessao } from './auth.ts';
import { inss, irrf, r2 } from './ferramentas.ts';
import { listarFuncionarios, obterFuncionario } from './pessoal.ts';

export interface Item { desc: string; ref?: string; valor: number }
export interface Entrada { dias?: number; he50?: number; he100?: number; peric?: boolean; vt?: boolean; deps?: number; divisor?: number; proventos?: Item[]; descontos?: Item[] }
export interface Linha { cod: string; desc: string; ref: string; venc: number; descto: number }
export interface Holerite {
  competencia: string; empresa: { razao_social: string; cnpj: string };
  func: { id: string; matricula: string; nome: string; cpf: string; cargo: string; cbo: string; setor: string; admissao: string; dependentes: number };
  linhas: Linha[]; total_venc: number; total_desc: number; liquido: number;
  bases: { salario_base: number; sal_contr_inss: number; base_fgts: number; fgts_mes: number; base_irrf: number; faixa_irrf: number };
  entrada: Entrada; aviso: string;
}
const AVISO = 'Cálculo de apoio com as tabelas vigentes cadastradas no sistema (INSS, IRRF, FGTS e adicionais). Confira com a folha oficial antes de entregar ao colaborador.';
const num = (v: unknown, max = 1e9) => { const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) && n >= 0 && n <= max ? n : 0; };
const txt = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const lista = (v: unknown): Item[] => (Array.isArray(v) ? v : []).slice(0, 10).map((x: any) => ({ desc: txt(x?.desc, 60), ref: txt(x?.ref, 20), valor: r2(num(x?.valor)) })).filter(x => x.desc && x.valor > 0);
const dia = (d: unknown) => d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : d ? String(d).slice(0, 10) : '';
const pct = (v: number) => (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%';

export function sanearEntrada(e: any): Entrada {
  return { dias: Math.min(31, Math.max(1, Math.round(num(e?.dias, 31) || 30))), he50: num(e?.he50, 400), he100: num(e?.he100, 400), peric: !!e?.peric, vt: !!e?.vt,
    deps: e?.deps === undefined || e?.deps === '' || e?.deps === null ? undefined : Math.min(30, Math.round(num(e.deps, 30))), divisor: num(e?.divisor, 300) || 220, proventos: lista(e?.proventos), descontos: lista(e?.descontos) };
}

export function calcularHolerite(f: any, emp: { razao_social: string; cnpj: string }, competencia: string, entrada: any, P: any): Holerite {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia)) throw new ErroAuth(422, 'Competência inválida (use AAAA-MM).');
  const salario = Number(f.salario); if (!Number.isFinite(salario) || salario <= 0) throw new ErroAuth(422, `Informe o salário no cadastro de ${f.nome}.`);
  if (!P?.INSS_EMPREGADO?.faixas || !P?.IRRF_MENSAL?.faixas || !P?.ADICIONAIS || P?.FGTS_ALIQUOTAS?.geral == null) throw new ErroAuth(500, 'Tabelas de INSS, IRRF, FGTS ou adicionais não encontradas em Normas e tabelas.');
  const e = sanearEntrada(entrada), L: Linha[] = [];
  const venc = (cod: string, desc: string, ref: string, v: number) => { if (v > 0) L.push({ cod, desc, ref, venc: r2(v), descto: 0 }); };
  const dsc = (cod: string, desc: string, ref: string, v: number) => { if (v > 0) L.push({ cod, desc, ref, venc: 0, descto: r2(v) }); };
  const hora = salario / (e.divisor as number);
  venc('101', 'SALÁRIO', (e.dias as number).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + 'd', salario / 30 * (e.dias as number));
  if (e.he50) venc('102', 'HORAS EXTRAS 50%', (e.he50).toLocaleString('pt-BR') + 'h', hora * (1 + P.ADICIONAIS.hora_extra) * e.he50);
  if (e.he100) venc('103', 'HORAS EXTRAS 100%', (e.he100).toLocaleString('pt-BR') + 'h', hora * (1 + P.ADICIONAIS.hora_extra_domingo) * e.he100);
  if (e.peric) venc('104', 'ADICIONAL DE PERICULOSIDADE', pct(P.ADICIONAIS.periculosidade), salario * P.ADICIONAIS.periculosidade);
  (e.proventos as Item[]).forEach((x, i) => venc(String(201 + i), x.desc.toUpperCase(), x.ref ?? '', x.valor));
  const bruto = r2(L.reduce((a, x) => a + x.venc, 0));
  const vInss = inss(bruto, P), deps = e.deps ?? Number(f.dependentes ?? 0), ir = irrf(bruto, vInss, deps, P);
  const teto = P.INSS_EMPREGADO.faixas.at(-1)[0];
  dsc('973', 'INSS', bruto ? pct(vInss / Math.min(bruto, teto)) : '', vInss);
  const fx: any[] = P.IRRF_MENSAL.faixas, idx = Math.max(0, fx.findIndex(x => x[0] == null || ir.base <= x[0]));
  dsc('987', 'IRRF', ir.imposto > 0 ? pct(fx[idx][1]) : 'isento', ir.imposto);
  if (e.vt) dsc('974', 'VALE-TRANSPORTE', pct(P.ADICIONAIS.vale_transporte), salario * P.ADICIONAIS.vale_transporte);
  (e.descontos as Item[]).forEach((x, i) => dsc(String(901 + i), x.desc.toUpperCase(), x.ref ?? '', x.valor));
  const tv = r2(L.reduce((a, x) => a + x.venc, 0)), td = r2(L.reduce((a, x) => a + x.descto, 0));
  const aliqFgts = String(f.tipo_contrato ?? '').toUpperCase().includes('APRENDIZ') && P.FGTS_ALIQUOTAS.aprendiz != null ? P.FGTS_ALIQUOTAS.aprendiz : P.FGTS_ALIQUOTAS.geral;
  return { competencia, empresa: { razao_social: emp.razao_social, cnpj: emp.cnpj },
    func: { id: f.id, matricula: f.matricula, nome: f.nome, cpf: f.cpf, cargo: f.funcao || f.cargo_nome || '', cbo: f.cbo || f.cargo_cbo || '', setor: f.setor || '', admissao: dia(f.data_admissao), dependentes: deps },
    linhas: L, total_venc: tv, total_desc: td, liquido: r2(tv - td),
    bases: { salario_base: r2(salario), sal_contr_inss: r2(Math.min(bruto, teto)), base_fgts: bruto, fgts_mes: r2(bruto * aliqFgts), base_irrf: ir.base, faixa_irrf: ir.imposto > 0 ? idx + 1 : 0 },
    entrada: { ...e, deps }, aviso: AVISO };
}

const tx = <R>(s: Sessao, fn: (t: any) => Promise<R>) => dbDoTenant(s.tenantId, s.papel).transaction(fn);
async function empresaDe(s: Sessao, id: string) { const r = await tx(s, async t => (await t.query('SELECT razao_social, cnpj FROM empresas WHERE id=$1', [id])).rows[0]); if (!r) throw new ErroAuth(404, 'Empresa não encontrada.'); return r; }

/** Calcula (sem gravar). Com {funcionario_id}: um holerite; com {empresa_id, todos:true}: todos os ativos com salário. */
export async function calcular(s: Sessao, b: any, P: any): Promise<{ holerites: Holerite[]; ignorados: string[] }> {
  const comp = String(b?.competencia ?? '');
  if (b?.funcionario_id) {
    if (!isUuid(b.funcionario_id)) throw new ErroAuth(400, 'id inválido');
    const f = await obterFuncionario(s, b.funcionario_id); return { holerites: [calcularHolerite(f, await empresaDe(s, f.empresa_id), comp, b.entrada, P)], ignorados: [] };
  }
  if (b?.todos && isUuid(b?.empresa_id)) {
    const emp = await empresaDe(s, b.empresa_id), out: Holerite[] = [], ign: string[] = [];
    for (const f of await listarFuncionarios(s, b.empresa_id, undefined, true)) { if (!(Number(f.salario) > 0)) { ign.push(`${f.nome}: sem salário no cadastro`); continue; } out.push(calcularHolerite(f, emp, comp, {}, P)); }
    return { holerites: out, ignorados: ign };
  }
  throw new ErroAuth(422, 'Informe o funcionário (ou a empresa com todos=true) e a competência.');
}
