import { FERRAMENTAS, ErroCalc, type Ferr } from './ferramentas.ts';
import { FERR_SST } from './ferramentas-sst.ts';
import { FERR_EXTRA } from './ferramentas-extra.ts';
export const TODAS: Ferr[] = [...FERRAMENTAS.map(f => ({ ...f, tipo: 'calc' as const })), ...FERR_SST, ...FERR_EXTRA];
export const catalogo = () => TODAS.map(({ calc, ...c }) => c);
export function executar(id: string, entrada: any, P: any) {
  const f = TODAS.find(x => x.id === id); if (!f) throw new ErroCalc('Ferramenta desconhecida.');
  if (f.tipo === 'registro') throw new ErroCalc('Esta ferramenta é um registro (use Salvar).');
  try { return f.calc(entrada ?? {}, P); } catch (e) { if (e instanceof ErroCalc) throw e; throw new ErroCalc('Não foi possível calcular com esses dados.'); }
}
