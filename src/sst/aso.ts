// Periodicidade de ASO a partir do PCMSO. O PRÓXIMO exame periódico é o menor intervalo entre os exames do cargo.
export type TipoASO = 'ADMISSIONAL' | 'PERIODICO' | 'RETORNO_AO_TRABALHO' | 'MUDANCA_DE_RISCO' | 'DEMISSIONAL';

/** Soma meses preservando fim de mês (31/01 + 1 mês = 28/02 ou 29/02). */
export function somarMeses(iso: string, meses: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const alvo = new Date(Date.UTC(y, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo)); return alvo.toISOString().slice(0, 10);
}
export function proximoExame(dataExame: string, periodicidadesMeses: (number | null)[]): string | null {
  const ps = periodicidadesMeses.filter((p): p is number => p != null && p > 0);
  return ps.length ? somarMeses(dataExame, Math.min(...ps)) : null;
}
export type SituacaoASO = 'SEM_ASO' | 'EM_DIA' | 'VENCENDO' | 'VENCIDO' | 'INAPTO';
export function situacaoASO(ultimo: { proximoExame: string | null; resultado: string } | undefined, hoje: string, diasAviso = 30): SituacaoASO {
  if (!ultimo) return 'SEM_ASO';
  if (ultimo.resultado === 'INAPTO') return 'INAPTO';
  if (!ultimo.proximoExame) return 'EM_DIA';
  if (ultimo.proximoExame < hoje) return 'VENCIDO';
  return ultimo.proximoExame <= new Date(Date.parse(hoje) + diasAviso * 864e5).toISOString().slice(0, 10) ? 'VENCENDO' : 'EM_DIA';
}
