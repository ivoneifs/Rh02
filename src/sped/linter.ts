// Linter contábil pré-PVA: roda ANTES de gerar o arquivo. Severidade ERRO bloqueia a geração
// (o PVA da RFB rejeitaria); AVISO/INFO vão para o "Relatório de Advertências".
export interface Conta {
  id: string; codigo: string; descricao: string; tipo: 'S' | 'A'; codNatureza: '01' | '02' | '03' | '04' | '05' | '09';
  naturezaSaldo: 'D' | 'C'; redutora: boolean; ativa: boolean; codCtaRef?: string | null;
}
/** Saldo assinado em centavos: positivo = devedor, negativo = credor (Σdébitos − Σcréditos até a data-base). */
export type SaldoFinal = Map<string, bigint>;
export interface PartidaL { lancamentoId: string; contaId: string; dc: 'D' | 'C'; valor: bigint }
export interface RefRFB { codCtaRef: string; analitica: boolean; natureza: 'D' | 'C' }

export type Severidade = 'ERRO' | 'AVISO' | 'INFO';
export interface Advertencia { regra: string; severidade: Severidade; mensagem: string; contaId?: string; lancamentoId?: string }

export interface EntradaLinter {
  contas: Conta[]; saldos: SaldoFinal; partidas: PartidaL[];
  referencial: Map<string, RefRFB>;                 // plano referencial vigente p/ o tipo da empresa
  resultadoDRE: bigint;                             // lucro(+)/prejuízo(−) apurado pelo relatório DRE, em centavos
}
const brl = (c: bigint) => `${c < 0n ? '-' : ''}${(c < 0n ? -c : c) / 100n},${((c < 0n ? -c : c) % 100n).toString().padStart(2, '0')}`;

export function lintContabil(e: EntradaLinter): Advertencia[] {
  const out: Advertencia[] = []; const porId = new Map(e.contas.map(c => [c.id, c]));

  // R1 — Saldo invertido em relação à natureza (exceto contas redutoras e de resultado, que zeram no encerramento)
  for (const c of e.contas) {
    if (c.tipo !== 'A' || c.redutora || c.codNatureza === '04') continue;
    const s = e.saldos.get(c.id) ?? 0n; if (s === 0n) continue;
    const inv = (c.naturezaSaldo === 'D' && s < 0n) || (c.naturezaSaldo === 'C' && s > 0n);
    if (inv) out.push({ regra: 'SALDO_INVERTIDO', severidade: 'AVISO', contaId: c.id,
      mensagem: `${c.codigo} ${c.descricao}: natureza ${c.naturezaSaldo} mas saldo final ${brl(s < 0n ? -s : s)} ${s < 0n ? 'C' : 'D'}.` });
  }

  // R2 — Amarração com o plano referencial RFB (I051): ausente ou apontando p/ conta sintética/inexistente
  for (const c of e.contas) {
    if (c.tipo !== 'A' || !c.ativa || c.codNatureza === '05' || c.codNatureza === '09') continue;
    if (!c.codCtaRef) { out.push({ regra: 'SEM_REFERENCIAL', severidade: 'ERRO', contaId: c.id, mensagem: `${c.codigo} ${c.descricao}: sem conta referencial (ECD I051 / ECF K/L).` }); continue; }
    const r = e.referencial.get(c.codCtaRef);
    if (!r) out.push({ regra: 'REFERENCIAL_INEXISTENTE', severidade: 'ERRO', contaId: c.id, mensagem: `${c.codigo}: referencial ${c.codCtaRef} não existe/vigente no plano da RFB.` });
    else if (!r.analitica) out.push({ regra: 'REFERENCIAL_SINTETICO', severidade: 'ERRO', contaId: c.id, mensagem: `${c.codigo}: referencial ${c.codCtaRef} é sintético; amarre a uma conta analítica da RFB.` });
    else if (r.natureza !== c.naturezaSaldo && !c.redutora) out.push({ regra: 'REFERENCIAL_NATUREZA', severidade: 'AVISO', contaId: c.id, mensagem: `${c.codigo}: natureza ${c.naturezaSaldo} difere da referencial ${c.codCtaRef} (${r.natureza}).` });
  }

  // R3 — Lançamentos órfãos: conta inexistente/sintética/inativa, ou ΣD≠ΣC (corrupção por carga externa)
  const porLcto = new Map<string, { d: bigint; c: bigint }>();
  for (const p of e.partidas) {
    const conta = porId.get(p.contaId); const t = porLcto.get(p.lancamentoId) ?? { d: 0n, c: 0n };
    p.dc === 'D' ? (t.d += p.valor) : (t.c += p.valor); porLcto.set(p.lancamentoId, t);
    if (!conta) out.push({ regra: 'LCTO_CONTA_INEXISTENTE', severidade: 'ERRO', lancamentoId: p.lancamentoId, mensagem: `Lançamento ${p.lancamentoId}: conta ${p.contaId} inexistente.` });
    else if (conta.tipo === 'S') out.push({ regra: 'LCTO_CONTA_SINTETICA', severidade: 'ERRO', lancamentoId: p.lancamentoId, contaId: conta.id, mensagem: `Lançamento ${p.lancamentoId} usa conta sintética ${conta.codigo}.` });
    else if (!conta.ativa) out.push({ regra: 'LCTO_CONTA_INATIVA', severidade: 'AVISO', lancamentoId: p.lancamentoId, contaId: conta.id, mensagem: `Lançamento ${p.lancamentoId} usa conta inativa ${conta.codigo}.` });
    else if (!conta.codCtaRef && conta.codNatureza !== '05' && conta.codNatureza !== '09')
      out.push({ regra: 'LCTO_SEM_REFERENCIAL', severidade: 'ERRO', lancamentoId: p.lancamentoId, contaId: conta.id, mensagem: `Lançamento ${p.lancamentoId} movimenta ${conta.codigo} sem amarração referencial.` });
  }
  for (const [id, t] of porLcto) if (t.d !== t.c)
    out.push({ regra: 'LCTO_DESBALANCEADO', severidade: 'ERRO', lancamentoId: id, mensagem: `Lançamento ${id}: D=${brl(t.d)} ≠ C=${brl(t.c)}.` });

  // R4 — Balancete de encerramento × DRE, e equação patrimonial
  let res = 0n, ativo = 0n, passPL = 0n;
  for (const c of e.contas) {
    if (c.tipo !== 'A') continue; const s = e.saldos.get(c.id) ?? 0n;
    if (c.codNatureza === '04') res += -s;                       // crédito (receita) soma, débito (despesa) subtrai
    if (c.codNatureza === '01') ativo += s;
    if (c.codNatureza === '02' || c.codNatureza === '03') passPL += -s;
  }
  if (res !== e.resultadoDRE)
    out.push({ regra: 'BALANCETE_X_DRE', severidade: 'ERRO', mensagem: `Resultado do balancete (${brl(res)}) difere da DRE (${brl(e.resultadoDRE)}).` });
  // Pré-encerramento: Ativo = Passivo + PL + resultado do período; pós-encerramento res = 0 e a igualdade é direta.
  if (ativo !== passPL + res)
    out.push({ regra: 'EQUACAO_PATRIMONIAL', severidade: 'ERRO', mensagem: `Ativo (${brl(ativo)}) ≠ Passivo+PL+Resultado (${brl(passPL + res)}).` });

  return out;
}

export const bloqueiaGeracao = (a: Advertencia[]) => a.some(x => x.severidade === 'ERRO');
