// Regras de entrega e alertas de EPI (NR-6). Puro e testável; o serviço aplica dentro de transação com
// SELECT ... FOR UPDATE nos lotes para evitar entrega concorrente do mesmo saldo.
export interface Epi { id: string; nome: string; numeroCA: string; validadeCA: string /*AAAA-MM-DD*/; vidaUtilDias?: number; estoqueMinimo: number }
export interface Lote { id: string; lote: string; saldo: number; validadeLote?: string }
export interface Entrega { loteId: string; qtd: number }
export type ResultadoEntrega = { ok: true; baixas: Entrega[]; validadeUso?: string; caNoAto: string } | { ok: false; erro: string };

const dias = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** FEFO: consome primeiro o lote que vence antes (lotes sem validade vão por último). */
export function planejarEntrega(epi: Epi, lotes: Lote[], qtd: number, hoje: string): ResultadoEntrega {
  if (qtd <= 0) return { ok: false, erro: 'Quantidade deve ser positiva.' };
  if (epi.validadeCA < hoje) return { ok: false, erro: `CA ${epi.numeroCA} vencido em ${epi.validadeCA}: entrega bloqueada.` };
  const validos = lotes.filter(l => l.saldo > 0 && (!l.validadeLote || l.validadeLote >= hoje))
    .sort((a, b) => (a.validadeLote ?? '9999-12-31').localeCompare(b.validadeLote ?? '9999-12-31'));
  let falta = qtd; const baixas: Entrega[] = [];
  for (const l of validos) { if (falta <= 0) break; const q = Math.min(l.saldo, falta); baixas.push({ loteId: l.id, qtd: q }); falta -= q; }
  if (falta > 0) return { ok: false, erro: `Estoque insuficiente (faltam ${falta}).` };
  return { ok: true, baixas, caNoAto: epi.numeroCA, validadeUso: epi.vidaUtilDias ? dias(hoje, epi.vidaUtilDias) : undefined };
}

export interface Alerta { tipo: 'CA_VENCIDO' | 'CA_VENCENDO' | 'ESTOQUE_MINIMO' | 'REPOSICAO_COLABORADOR'; epiId?: string; mensagem: string }
export function alertasEpi(epis: (Epi & { saldoTotal: number })[], hoje: string, diasAviso = 30): Alerta[] {
  const out: Alerta[] = [];
  for (const e of epis) {
    if (e.validadeCA < hoje) out.push({ tipo: 'CA_VENCIDO', epiId: e.id, mensagem: `${e.nome}: CA ${e.numeroCA} vencido.` });
    else if (e.validadeCA <= dias(hoje, diasAviso)) out.push({ tipo: 'CA_VENCENDO', epiId: e.id, mensagem: `${e.nome}: CA ${e.numeroCA} vence em ${e.validadeCA}.` });
    if (e.saldoTotal < e.estoqueMinimo) out.push({ tipo: 'ESTOQUE_MINIMO', epiId: e.id, mensagem: `${e.nome}: saldo ${e.saldoTotal} abaixo do mínimo ${e.estoqueMinimo}.` });
  }
  return out;
}
