// Gerador ECD (Escrituração Contábil Digital) — texto delimitado por pipe, uma linha por registro.
// Regras do arquivo (Guia Prático / Manual de Orientação): ISO-8859-1, linhas terminadas em CRLF,
// cada registro iniciado e finalizado por "|", decimais com vírgula, datas DDMMAAAA, sem "|" nos textos.
// ⚠ Os layouts de campo abaixo seguem o leiaute vigente na data desta especificação; ANTES de produção,
//   versione o leiaute por ano-calendário (a RFB altera campos a cada ECD) e confira com o PVA.
import type { Conta } from './linter.ts';

export interface SaldoPeriodo {            // um registro I155 (saldo periódico por conta) por mês
  contaId: string; mes: string;            // 'AAAA-MM'
  ini: bigint; deb: bigint; cred: bigint;  // ini assinado (D+/C−), centavos
}
export interface PartidaECD { contaId: string; dc: 'D' | 'C'; valor: bigint; ccusto?: string; historico?: string; codHistPad?: string }
export interface LancamentoECD { numero: number; data: string /* AAAA-MM-DD */; tipo: 'N' | 'E' | 'X'; partidas: PartidaECD[] }
export interface EmpresaECD { nome: string; cnpj: string; uf: string; ie?: string; codMun: string; im?: string; nire?: string }
export interface EntradaECD {
  empresa: EmpresaECD; dtIni: string; dtFim: string; contas: Conta[]; saldos: SaldoPeriodo[]; lancamentos: LancamentoECD[];
  nivel: Map<string, number>; paiCodigo: Map<string, string>;    // nível e código da conta pai, por contaId
}

const limpa = (s = '') => s.replace(/[|\r\n]+/g, ' ').trim();
const dt = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;
const money = (c: bigint) => { const n = c < 0n ? -c : c; return `${n / 100n},${(n % 100n).toString().padStart(2, '0')}`; };
const dcOf = (c: bigint): 'D' | 'C' => (c >= 0n ? 'D' : 'C');
const reg = (...campos: (string | number | undefined)[]) => `|${campos.map(c => c ?? '').join('|')}|`;

export function gerarECD(e: EntradaECD): { conteudo: Buffer; totaisPorRegistro: Record<string, number> } {
  const L: string[] = [];
  const cnpj = e.empresa.cnpj.replace(/\D/g, '');

  // ---- Bloco 0: abertura e identificação ----
  L.push(reg('0000', 'LECD', dt(e.dtIni), dt(e.dtFim), limpa(e.empresa.nome), cnpj, e.empresa.uf, e.empresa.ie, e.empresa.codMun, e.empresa.im, '', '0', e.empresa.nire, '0' /*IND_FIN_ESC: original*/, '', '', 'N', '0', ''));
  L.push(reg('0001', 0));                                  // IND_DAD=0 (com dados)
  L.push(reg('0990', 0));                                  // QTD_LIN_0 — preenchido no pós-processamento

  // ---- Bloco I: lançamentos contábeis ----
  L.push(reg('I001', 0));
  L.push(reg('I010', 'G', '1.00'));                        // G = livro diário geral
  L.push(reg('I030', 'TERMO DE ABERTURA', 1, 'DIARIO', '', limpa(e.empresa.nome), e.empresa.nire ?? '', cnpj, '', e.empresa.uf, '', dt(e.dtFim), ''));
  const porId = new Map(e.contas.map(c => [c.id, c]));
  const ordenadas = [...e.contas].sort((a, b) => a.codigo.localeCompare(b.codigo, 'en', { numeric: true }));
  for (const c of ordenadas) {                             // I050: plano de contas (pai sempre antes do filho)
    L.push(reg('I050', dt(e.dtIni), c.codNatureza, c.tipo, e.nivel.get(c.id) ?? 1, c.codigo, e.paiCodigo.get(c.id) ?? '', limpa(c.descricao)));
    if (c.tipo === 'A' && c.codCtaRef) L.push(reg('I051', '', c.codCtaRef));   // I051: amarração referencial
  }
  const porMes = new Map<string, SaldoPeriodo[]>();
  for (const s of e.saldos) (porMes.get(s.mes) ?? porMes.set(s.mes, []).get(s.mes)!).push(s);
  for (const mes of [...porMes.keys()].sort()) {           // I150 (período) + I155 (saldos por conta)
    const [a, m] = mes.split('-'); const last = new Date(Date.UTC(+a, +m, 0)).getUTCDate();
    L.push(reg('I150', `01${m}${a}`, `${String(last).padStart(2, '0')}${m}${a}`));
    for (const s of porMes.get(mes)!) {
      const c = porId.get(s.contaId)!; const fin = s.ini + s.deb - s.cred;
      L.push(reg('I155', c.codigo, '', money(s.ini), dcOf(s.ini), money(s.deb), money(s.cred), money(fin), dcOf(fin)));
    }
  }
  for (const l of e.lancamentos) {                         // I200 (cabeçalho) + I250 (partidas)
    const total = l.partidas.filter(p => p.dc === 'D').reduce((a, p) => a + p.valor, 0n);
    const totC = l.partidas.filter(p => p.dc === 'C').reduce((a, p) => a + p.valor, 0n);
    if (total !== totC) throw new Error(`Lançamento ${l.numero} desbalanceado — o linter deveria ter bloqueado.`);
    L.push(reg('I200', l.numero, dt(l.data), money(total), l.tipo));
    for (const p of l.partidas) L.push(reg('I250', porId.get(p.contaId)!.codigo, p.ccusto, money(p.valor), p.dc, '', p.codHistPad, limpa(p.historico), ''));
  }
  L.push(reg('I990', 0));

  // ---- Bloco J: demonstrações (J005 cabeçalho; J100 balanço; J150 DRE) são gerados por geradores próprios ----
  // e inseridos aqui na mesma estrutura; J800 = termo de encerramento / outras informações.
  L.push(reg('J001', 1));                                  // 1 = sem dados neste exemplo reduzido
  L.push(reg('J990', 2));

  // ---- Bloco 9: totalizadores — a contagem declarada em cada 9900 deve ser exata (erro clássico no PVA) ----
  const fecha = (tipo: string, bloco: string) => {          // xxx990 = nº de linhas do bloco, incluindo ele mesmo
    const i = L.findIndex(r => r.startsWith(`|${tipo}|`));
    L[i] = reg(tipo, L.filter(r => r.split('|')[1][0] === bloco).length);
  };
  fecha('0990', '0'); fecha('I990', 'I'); fecha('J990', 'J');

  const cont = new Map<string, number>();
  for (const r of L) { const k = r.split('|')[1]; cont.set(k, (cont.get(k) ?? 0) + 1); }
  for (const k of ['9001', '9990', '9999']) cont.set(k, 1);
  cont.set('9900', cont.size + 1);                           // um 9900 por tipo distinto, inclusive o do próprio 9900
  // (cont.size aqui já inclui 9001/9990/9999 e ainda não o 9900; +1 o inclui)
  const l9900 = [...cont.keys()].sort();
  const linhasAntesBloco9 = L.length;
  L.push(reg('9001', 0));
  for (const k of l9900) L.push(reg('9900', k, cont.get(k)));
  L.push(reg('9990', 1 + l9900.length + 2));                 // 9001 + todos os 9900 + 9990 + 9999
  L.push(reg('9999', linhasAntesBloco9 + 1 + l9900.length + 2));

  const totais: Record<string, number> = {}; for (const r of L) { const k = r.split('|')[1]; totais[k] = (totais[k] ?? 0) + 1; }
  return { conteudo: Buffer.from(L.join('\r\n') + '\r\n', 'latin1'), totaisPorRegistro: totais };
}
