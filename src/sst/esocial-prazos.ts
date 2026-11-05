// Prazos legais e máquina de estados dos eventos eSocial de SST.
// ⚠ Prazos são REGRA LEGAL e mudam: ficam parametrizados e devem ser conferidos no Manual de Orientação do eSocial vigente.
// O prazo do S-2240 NÃO tem default: as fontes consultadas divergem; o cliente/contador deve escolher e registrar a regra.
export type RegraS2240 = 'DIA15_MES_SEGUINTE' | 'ANTES_INICIO_EXPOSICAO';

const iso = (d: Date) => d.toISOString().slice(0, 10);
export function proximoDiaUtil(data: string, feriados: Set<string>, incluiHoje = false): string {
  const d = new Date(data + 'T00:00:00Z'); if (!incluiHoje) d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6 || feriados.has(iso(d))) d.setUTCDate(d.getUTCDate() + 1);
  return iso(d);
}
/** S-2210 (CAT): até o 1º dia útil seguinte ao acidente; em caso de óbito, imediatamente (mesmo dia). */
export const prazoS2210 = (ocorridoEm: string, obito: boolean, feriados = new Set<string>()) =>
  obito ? ocorridoEm : proximoDiaUtil(ocorridoEm, feriados);
/** S-2220 (monitoramento da saúde / ASO): até o dia 15 do mês seguinte ao do exame. */
export function prazoS2220(dataExame: string): string {
  const [y, m] = dataExame.split('-').map(Number); return iso(new Date(Date.UTC(y, m, 15)));
}
/** S-2240 (condições ambientais): regra obrigatoriamente informada. */
export function prazoS2240(inicioOuAlteracao: string, regra: RegraS2240): string {
  if (regra === 'ANTES_INICIO_EXPOSICAO') return inicioOuAlteracao;
  const [y, m] = inicioOuAlteracao.split('-').map(Number); return iso(new Date(Date.UTC(y, m, 15)));
}

export type StatusEvento = 'PENDENTE' | 'VALIDADO' | 'ASSINADO' | 'ENVIADO' | 'PROCESSADO' | 'ADVERTENCIA' | 'REJEITADO' | 'RETIFICADO';
const T: Record<StatusEvento, StatusEvento[]> = {
  PENDENTE: ['VALIDADO'], VALIDADO: ['ASSINADO', 'PENDENTE'], ASSINADO: ['ENVIADO'], ENVIADO: ['PROCESSADO', 'ADVERTENCIA', 'REJEITADO'],
  PROCESSADO: ['RETIFICADO'], ADVERTENCIA: ['RETIFICADO'], REJEITADO: ['PENDENTE'], RETIFICADO: [],   // rejeitado volta p/ correção e reenvio
};
export const podeTransitar = (de: StatusEvento, para: StatusEvento) => T[de].includes(para);
export function situacaoPrazo(prazo: string | null, status: StatusEvento, hoje: string): 'NO_PRAZO' | 'ATRASADO' | 'CONCLUIDO' {
  if (['PROCESSADO', 'ADVERTENCIA', 'RETIFICADO'].includes(status)) return 'CONCLUIDO';
  return prazo && prazo < hoje ? 'ATRASADO' : 'NO_PRAZO';
}
