// Validação pura de lançamentos de partida dobrada. Sem dependências: roda na API e nos workers.
// Valores monetários trafegam como string decimal ("1234.56") e são somados em CENTAVOS (BigInt)
// para eliminar erro de ponto flutuante — ΣD == ΣC tem que ser exato.

export type DC = 'D' | 'C';
export interface PartidaInput { contaId: string; dc: DC; valor: string; centroCustoId?: string; historico?: string }
export interface LancamentoInput { empresaId: string; data: string; documento?: string; partidas: PartidaInput[] }
export type Formato = '1:1' | '1:N' | 'N:1' | 'N:N';
export interface ContaInfo { id: string; tipo: 'S' | 'A'; ativa: boolean; aceitaCC: boolean }

export function paraCentavos(v: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(v.trim());
  if (!m) throw new Error(`Valor inválido: "${v}" (use ponto decimal, até 2 casas, positivo)`);
  return BigInt(m[1]) * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0');
}

export interface ResultadoValidacao { ok: boolean; erros: string[]; formato?: Formato; totalCentavos?: bigint }

export function validarLancamento(l: LancamentoInput, contas: Map<string, ContaInfo>): ResultadoValidacao {
  const erros: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(l.data)) erros.push('Data inválida (AAAA-MM-DD).');
  if (l.partidas.length < 2) erros.push('Lançamento precisa de ao menos 2 partidas.');

  let d = 0n, c = 0n, nd = 0, nc = 0;
  l.partidas.forEach((p, i) => {
    let cent: bigint;
    try { cent = paraCentavos(p.valor); } catch (e) { erros.push(`Partida ${i + 1}: ${(e as Error).message}`); return; }
    if (cent === 0n) erros.push(`Partida ${i + 1}: valor zero não é permitido.`);
    const conta = contas.get(p.contaId);
    if (!conta) erros.push(`Partida ${i + 1}: conta inexistente.`);
    else {
      if (conta.tipo !== 'A') erros.push(`Partida ${i + 1}: conta sintética não aceita lançamento.`);
      if (!conta.ativa) erros.push(`Partida ${i + 1}: conta inativa.`);
      if (p.centroCustoId && !conta.aceitaCC) erros.push(`Partida ${i + 1}: conta não admite centro de custo.`);
    }
    if (p.dc === 'D') { d += cent; nd++; } else { c += cent; nc++; }
  });

  if (nd === 0 || nc === 0) erros.push('É necessário ao menos um débito e um crédito.');
  if (d !== c) erros.push(`Lançamento desbalanceado: débitos=${fmt(d)} créditos=${fmt(c)} (diferença ${fmt(d > c ? d - c : c - d)}).`);

  const formato: Formato = nd === 1 && nc === 1 ? '1:1' : nd === 1 ? '1:N' : nc === 1 ? 'N:1' : 'N:N';
  return { ok: erros.length === 0, erros, formato, totalCentavos: d };
}

export const fmt = (cent: bigint) => `${cent / 100n}.${(cent % 100n).toString().padStart(2, '0')}`;
