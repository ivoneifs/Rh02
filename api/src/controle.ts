// Controle de SST por colaborador: ASO, exames complementares e EPI (com CA e troca), lidos dos registros e classificados em dia / vencendo / vencido.
import { dbDoTenant, isUuid } from './db.ts';
import { ErroAuth, type Sessao } from './auth.ts';

export type Sit = 'EM_DIA' | 'VENCENDO' | 'VENCIDO' | 'PENDENTE';
export interface Linha { id: string; tipo: 'ASO' | 'EXAME' | 'EPI'; nome: string; data: string | null; validade: string | null; ca?: string | null; validade_ca?: string | null; situacao: Sit; motivo: string }
interface Reg { id: string; ferramenta: string; status: string; dados: any; data_evento: string | null; data_validade: string | null }
const D = 864e5, dias = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / D);
const pior = (...s: Sit[]): Sit => (['VENCIDO', 'PENDENTE', 'VENCENDO', 'EM_DIA'] as Sit[]).find(x => s.includes(x))!;
const sitData = (val: string | null, hoje: string, aviso = 30): Sit | null => (!val ? null : val < hoje ? 'VENCIDO' : dias(val, hoje) <= aviso ? 'VENCENDO' : 'EM_DIA');
const chave = (r: Reg) => String(r.dados?.exame ?? r.dados?.epi ?? r.ferramenta).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Puro: classifica os registros do colaborador. Mantém só o item mais recente concluído de cada exame/EPI e aponta os itens ainda abertos como pendentes. */
export function avaliarControle(regs: Reg[], hoje: string, aviso = 30): { linhas: Linha[]; resumo: Record<Sit, number> } {
  const linhas: Linha[] = [];
  const ativos = regs.filter(r => r.status !== 'CANCELADO' && ['aso', 'exame_comp', 'epi_entrega'].includes(r.ferramenta));
  const grupos = new Map<string, Reg[]>();
  for (const r of ativos) { const k = r.ferramenta + '|' + (r.ferramenta === 'aso' ? String(r.dados?.tipo ?? '') + (r.status === 'ABERTO' ? '|a' : '') : chave(r)); (grupos.get(k) ?? grupos.set(k, []).get(k)!).push(r); }
  for (const [, g] of grupos) {
    const feitos = g.filter(r => r.status === 'CONCLUIDO').sort((a, b) => String(b.data_evento).localeCompare(String(a.data_evento)));
    const abertos = g.filter(r => r.status === 'ABERTO'), r0 = feitos[0] ?? abertos[0], f = r0.ferramenta;
    const tipo = f === 'aso' ? 'ASO' : f === 'exame_comp' ? 'EXAME' : 'EPI';
    const nome = f === 'aso' ? `ASO ${r0.dados?.tipo ?? ''}`.trim() : String(r0.dados?.exame ?? r0.dados?.epi ?? f);
    if (!feitos.length) { linhas.push({ id: r0.id, tipo, nome, data: null, validade: r0.data_validade, ca: r0.dados?.ca ?? null, situacao: 'PENDENTE', motivo: f === 'epi_entrega' ? 'A entregar (sem recibo concluído)' : 'A realizar (registro em aberto)' }); continue; }
    const sv = sitData(r0.data_validade, hoje, aviso), sca = f === 'epi_entrega' ? sitData(r0.dados?.validade_ca ?? null, hoje, aviso) : null;
    const semCa = f === 'epi_entrega' && !String(r0.dados?.ca ?? '').trim();
    const sit = pior(...[sv, sca, semCa ? 'PENDENTE' : null].filter(Boolean) as Sit[], 'EM_DIA');
    const mot = [sv === 'VENCIDO' ? (f === 'epi_entrega' ? 'Troca prevista vencida' : 'Validade vencida') : sv === 'VENCENDO' ? 'Vence em ' + dias(r0.data_validade!, hoje) + ' dia(s)' : '', sca === 'VENCIDO' ? 'CA vencido' : sca === 'VENCENDO' ? 'CA vence em breve' : '', semCa ? 'CA não informado' : '', r0.data_validade ? '' : 'Sem validade informada'].filter(Boolean).join('; ');
    linhas.push({ id: r0.id, tipo, nome, data: r0.data_evento, validade: r0.data_validade, ca: r0.dados?.ca ?? null, validade_ca: r0.dados?.validade_ca ?? null, situacao: sit, motivo: mot || 'Em dia' });
  }
  const ordem: Record<Sit, number> = { VENCIDO: 0, PENDENTE: 1, VENCENDO: 2, EM_DIA: 3 };
  linhas.sort((a, b) => ordem[a.situacao] - ordem[b.situacao] || a.nome.localeCompare(b.nome));
  const resumo = { EM_DIA: 0, VENCENDO: 0, VENCIDO: 0, PENDENTE: 0 } as Record<Sit, number>; for (const l of linhas) resumo[l.situacao]++;
  return { linhas, resumo };
}

export async function controle(s: Sessao, id: string) {
  if (!isUuid(id)) throw new ErroAuth(400, 'id inválido');
  const regs: Reg[] = await dbDoTenant(s.tenantId, s.papel).transaction(async t => (await t.query(
    `SELECT id, ferramenta, status, dados, to_char(data_evento,'YYYY-MM-DD') AS data_evento, to_char(data_validade,'YYYY-MM-DD') AS data_validade FROM registros WHERE funcionario_id=$1 AND ferramenta IN ('aso','exame_comp','epi_entrega')`, [id])).rows);
  return { ...avaliarControle(regs, new Date().toISOString().slice(0, 10)), aviso: 'Controle baseado nos registros de ASO, exames complementares e fichas de EPI. Registre o nº do CA e a validade do CA em cada entrega de EPI.' };
}
