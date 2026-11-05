import { FERRAMENTAS, ErroCalc, type Ferr } from './ferramentas.ts';
import { FERR_SST } from './ferramentas-sst.ts';
import { FERR_EXTRA } from './ferramentas-extra.ts';
import { FERR_DP } from './ferramentas-dp.ts';
import { FERR_CTB } from './ferramentas-contabil.ts';
import { FERR_JUR } from './ferramentas-juridico.ts';
// Subgrupos do bloco fiscal/contábil (a área "Fiscal e contábil" ganha sub-filtros úteis)
const SUB_FISCAL: Record<string, string> = Object.fromEntries([
  ...['simples', 'fatorr', 'mei', 'presumido', 'pcc', 'iss'].map(i => [i, 'Fiscal · Tributos e regimes']),
  ...['cnpj', 'cpf', 'calendario'].map(i => [i, 'Fiscal · Validadores e calendário']),
  ...['atraso', 'correcao', 'deprec', 'price', 'markup', 'porDentro', 'equilibrio', 'vpl', 'roi_sst', 'dre', 'prazo_medio', 'margem'].map(i => [i, 'Fiscal · Contabilidade e finanças']),
]);
export const TODAS: Ferr[] = [...FERRAMENTAS.map(f => ({ ...f, tipo: 'calc' as const })), ...FERR_SST, ...FERR_EXTRA, ...FERR_DP, ...FERR_JUR, ...FERR_CTB].map(f => (f.cat === 'Fiscal e contábil' ? { ...f, cat: SUB_FISCAL[f.id] ?? 'Fiscal · Contabilidade e finanças' } : f));
export const catalogo = () => TODAS.map(({ calc, ...c }) => c);
export function executar(id: string, entrada: any, P: any) {
  const f = TODAS.find(x => x.id === id); if (!f) throw new ErroCalc('Ferramenta desconhecida.');
  if (f.tipo === 'registro') throw new ErroCalc('Esta ferramenta é um registro (use Salvar).');
  try { return f.calc(entrada ?? {}, P); } catch (e) { if (e instanceof ErroCalc) throw e; throw new ErroCalc('Não foi possível calcular com esses dados.'); }
}
