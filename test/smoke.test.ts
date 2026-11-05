import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarLancamento, type ContaInfo } from '../src/lancamentos/validar.ts';
import { parseOFX } from '../src/conciliacao/ofx-parser.ts';
import { ClassificadorHistorico, sugerir, type Regra } from '../src/conciliacao/motor-regras.ts';
import { lintContabil, bloqueiaGeracao, type Conta } from '../src/sped/linter.ts';
import { gerarECD } from '../src/sped/ecd-generator.ts';

const contas = new Map<string, ContaInfo>([
  ['cx', { id: 'cx', tipo: 'A', ativa: true, aceitaCC: false }], ['fo', { id: 'fo', tipo: 'A', ativa: true, aceitaCC: false }],
  ['sint', { id: 'sint', tipo: 'S', ativa: true, aceitaCC: false }],
]);
const P = (contaId: string, dc: 'D' | 'C', valor: string) => ({ contaId, dc, valor });

test('lançamentos 1:1, 1:N, N:N e rejeições', () => {
  assert.equal(validarLancamento({ empresaId: 'e', data: '2025-01-10', partidas: [P('cx', 'D', '100.00'), P('fo', 'C', '100.00')] }, contas).formato, '1:1');
  assert.equal(validarLancamento({ empresaId: 'e', data: '2025-01-10', partidas: [P('cx', 'D', '100.00'), P('fo', 'C', '60.00'), P('fo', 'C', '40.00')] }, contas).formato, '1:N');
  assert.equal(validarLancamento({ empresaId: 'e', data: '2025-01-10', partidas: [P('cx', 'D', '50'), P('cx', 'D', '50'), P('fo', 'C', '60'), P('fo', 'C', '40')] }, contas).formato, 'N:N');
  // 0.1 + 0.2 = 0.3 exato (em float seria 0.30000000000000004)
  assert.ok(validarLancamento({ empresaId: 'e', data: '2025-01-10', partidas: [P('cx', 'D', '0.30'), P('fo', 'C', '0.10'), P('fo', 'C', '0.20')] }, contas).ok);
  assert.ok(!validarLancamento({ empresaId: 'e', data: '2025-01-10', partidas: [P('cx', 'D', '100.00'), P('fo', 'C', '99.99')] }, contas).ok);
  assert.ok(!validarLancamento({ empresaId: 'e', data: '2025-01-10', partidas: [P('sint', 'D', '1'), P('fo', 'C', '1')] }, contas).ok);
});

test('OFX 1.x SGML', () => {
  const ofx = `OFXHEADER:100\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL<BANKACCTFROM><BANKID>001<ACCTID>123-4</BANKACCTFROM>
<BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20250115120000[-3:BRT]<TRNAMT>-1.234,56<FITID>A1<MEMO>PIX ENVIADO ENERGISA 12345678</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20250116<TRNAMT>500.00<FITID>A2<MEMO>TED RECEBIDO CLIENTE SILVA</STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  const r = parseOFX(ofx);
  assert.equal(r.itens.length, 2); assert.equal(r.itens[0].valor, '-1234.56'); assert.equal(r.itens[0].data, '2025-01-15'); assert.equal(r.banco, '001');
});

test('motor: regra vence; ML aprende com feedback', () => {
  const regras: Regra[] = [{ id: 'r1', prioridade: 10, tipoMatch: 'CONTEM', padrao: 'ENERGISA', sinal: 'SAIDA', contaContrapartidaId: 'energia', autoConfirmar: true }];
  const ml = new ClassificadorHistorico();
  for (let i = 0; i < 5; i++) { ml.treinar('PAGTO BOLETO POSTO IPIRANGA', 'S', 'combustivel'); ml.treinar('TARIFA MANUTENCAO CONTA', 'S', 'tarifas'); }
  assert.equal(sugerir('PIX ENVIADO ENERGISA 998877', -300, regras, ml)?.origem, 'REGRA');
  const s = sugerir('POSTO IPIRANGA FILIAL', -80, regras, ml);
  assert.equal(s?.contaId, 'combustivel'); assert.equal(s?.origem, 'ML');
  assert.equal(sugerir('XYZ DESCONHECIDO', -80, regras, ml), null);
});

const C = (id: string, codigo: string, nat: Conta['codNatureza'], ns: 'D' | 'C', ref: string | null = 'X', extra: Partial<Conta> = {}): Conta =>
  ({ id, codigo, descricao: id.toUpperCase(), tipo: 'A', codNatureza: nat, naturezaSaldo: ns, redutora: false, ativa: true, codCtaRef: ref, ...extra });

test('linter: saldo invertido, sem referencial, órfão, DRE divergente', () => {
  const cs = [C('banco', '1.1', '01', 'D'), C('cap', '3.1', '03', 'C'), C('rec', '4.1', '04', 'C'), C('sem', '1.2', '01', 'D', null)];
  const ref = new Map([['X', { codCtaRef: 'X', analitica: true, natureza: 'D' as const }]]);
  const saldos = new Map([['banco', -500n], ['cap', -1000n], ['rec', -200n]]);           // banco credor → invertido
  const partidas = [{ lancamentoId: 'L1', contaId: 'banco', dc: 'D' as const, valor: 100n }, { lancamentoId: 'L1', contaId: 'fantasma', dc: 'C' as const, valor: 100n }];
  const a = lintContabil({ contas: cs, saldos, partidas, referencial: ref, resultadoDRE: 150n });
  const regras = new Set(a.map(x => x.regra));
  for (const r of ['SALDO_INVERTIDO', 'SEM_REFERENCIAL', 'LCTO_CONTA_INEXISTENTE', 'BALANCETE_X_DRE', 'EQUACAO_PATRIMONIAL']) assert.ok(regras.has(r), r);
  assert.ok(bloqueiaGeracao(a));
});

test('ECD: estrutura, bloco 9 consistente, latin1/CRLF', () => {
  const cs = [C('cx', '1.1.1', '01', 'D', '1.01.01'), C('fo', '2.1.1', '02', 'C', '2.01.01')];
  const { conteudo, totaisPorRegistro: t } = gerarECD({
    empresa: { nome: 'AÇÚCAR & CIA', cnpj: '22.222.222/0001-22', uf: 'SP', codMun: '3550308' }, dtIni: '2025-01-01', dtFim: '2025-12-31',
    contas: cs, nivel: new Map([['cx', 3], ['fo', 3]]), paiCodigo: new Map([['cx', '1.1'], ['fo', '2.1']]),
    saldos: [{ contaId: 'cx', mes: '2025-01', ini: 0n, deb: 10000n, cred: 0n }],
    lancamentos: [{ numero: 1, data: '2025-01-10', tipo: 'N', partidas: [{ contaId: 'cx', dc: 'D', valor: 10000n }, { contaId: 'fo', dc: 'C', valor: 10000n, historico: 'Compra | teste' }] }],
  });
  const txt = conteudo.toString('latin1'); const linhas = txt.trimEnd().split('\r\n');
  assert.ok(linhas[0].startsWith('|0000|LECD|01012025|31122025|AÇÚCAR & CIA|22222222000122|SP|'));
  assert.ok(linhas.every(l => l.startsWith('|') && l.endsWith('|')));
  assert.ok(!linhas.find(l => l.startsWith('|I250|'))!.includes('Compra | teste'));            // pipe escapado
  assert.equal(linhas.at(-1), `|9999|${linhas.length}|`);
  // 9900 deve declarar a contagem real de cada tipo
  for (const l of linhas.filter(x => x.startsWith('|9900|'))) { const [, , tipo, n] = l.split('|'); assert.equal(+n, t[tipo], `9900 de ${tipo}`); }
  assert.equal(linhas.find(l => l.startsWith('|I990|')), `|I990|${linhas.filter(l => l[1] === 'I').length}|`);
});
