import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularRisco, matrizPadrao5x5, validarConfig, type MatrizConfig } from '../src/sst/matriz-risco.ts';
import { planejarEntrega, alertasEpi } from '../src/sst/epi.ts';
import { somarMeses, proximoExame, situacaoASO } from '../src/sst/aso.ts';
import { prazoS2210, prazoS2220, prazoS2240, podeTransitar, situacaoPrazo } from '../src/sst/esocial-prazos.ts';
import { apurar, type Instrumento } from '../src/sst/psicossocial.ts';

test('matriz: 5x5 produto, tabela e validação', () => {
  assert.equal(calcularRisco(matrizPadrao5x5, { severidade: 5, probabilidade: 5 }).rotulo, 'Intolerável');
  assert.equal(calcularRisco(matrizPadrao5x5, { severidade: 2, probabilidade: 2 }).rotulo, 'Trivial');
  assert.throws(() => calcularRisco(matrizPadrao5x5, { severidade: 9, probabilidade: 1 }));
  const tri: MatrizConfig = { metodo: 'SOMA', faixas: [{ ate: 4, rotulo: 'Baixo', cor: 'g' }, { ate: 7, rotulo: 'Alto', cor: 'r' }],
    dimensoes: ['a', 'b', 'c'].map(id => ({ id, niveis: [{ valor: 1, rotulo: '1' }, { valor: 2, rotulo: '2' }, { valor: 3, rotulo: '3' }] })) };   // multidimensional
  assert.equal(calcularRisco(tri, { a: 3, b: 2, c: 2 }).rotulo, 'Alto');
  assert.ok(validarConfig({ ...matrizPadrao5x5, faixas: [{ ate: 5, rotulo: 'x', cor: '' }, { ate: 5, rotulo: 'y', cor: '' }] }).length > 0);
});

test('EPI: CA vencido bloqueia, FEFO, estoque, alertas', () => {
  const epi = { id: 'e', nome: 'Luva', numeroCA: '123', validadeCA: '2026-12-31', vidaUtilDias: 90, estoqueMinimo: 10 };
  const lotes = [{ id: 'L2', lote: 'B', saldo: 5, validadeLote: '2027-06-01' }, { id: 'L1', lote: 'A', saldo: 3, validadeLote: '2027-01-01' }, { id: 'L0', lote: 'X', saldo: 9, validadeLote: '2026-01-01' }];
  const r = planejarEntrega(epi, lotes, 6, '2026-11-05');
  assert.ok(r.ok && r.baixas[0].loteId === 'L1' && r.baixas[1].loteId === 'L2' && r.baixas[1].qtd === 3);   // L0 vencido é ignorado
  assert.ok(r.ok && r.validadeUso === '2027-02-03');
  assert.ok(!planejarEntrega(epi, lotes, 99, '2026-11-05').ok);
  assert.ok(!planejarEntrega({ ...epi, validadeCA: '2026-11-04' }, lotes, 1, '2026-11-05').ok);
  const a = alertasEpi([{ ...epi, saldoTotal: 4 }], '2026-12-10');
  assert.deepEqual(a.map(x => x.tipo).sort(), ['CA_VENCENDO', 'ESTOQUE_MINIMO']);
});

test('ASO: meses com fim de mês, menor periodicidade, situação', () => {
  assert.equal(somarMeses('2025-01-31', 1), '2025-02-28'); assert.equal(somarMeses('2024-01-31', 1), '2024-02-29');
  assert.equal(proximoExame('2026-01-10', [12, 6, null]), '2026-07-10'); assert.equal(proximoExame('2026-01-10', [null]), null);
  assert.equal(situacaoASO(undefined, '2026-11-05'), 'SEM_ASO');
  assert.equal(situacaoASO({ proximoExame: '2026-11-20', resultado: 'APTO' }, '2026-11-05'), 'VENCENDO');
  assert.equal(situacaoASO({ proximoExame: '2026-10-01', resultado: 'APTO' }, '2026-11-05'), 'VENCIDO');
});

test('eSocial: prazos e máquina de estados', () => {
  assert.equal(prazoS2210('2026-11-06', false), '2026-11-09');            // sexta → segunda
  assert.equal(prazoS2210('2026-11-06', true), '2026-11-06');             // óbito: imediato
  assert.equal(prazoS2210('2026-11-12', false, new Set(['2026-11-13'])), '2026-11-16');
  assert.equal(prazoS2220('2026-12-20'), '2027-01-15');
  assert.equal(prazoS2240('2026-11-05', 'DIA15_MES_SEGUINTE'), '2026-12-15'); assert.equal(prazoS2240('2026-11-05', 'ANTES_INICIO_EXPOSICAO'), '2026-11-05');
  assert.ok(podeTransitar('ENVIADO', 'REJEITADO') && !podeTransitar('PENDENTE', 'ENVIADO') && podeTransitar('REJEITADO', 'PENDENTE'));
  assert.equal(situacaoPrazo('2026-11-01', 'PENDENTE', '2026-11-05'), 'ATRASADO'); assert.equal(situacaoPrazo('2026-11-01', 'PROCESSADO', '2026-11-05'), 'CONCLUIDO');
});

test('psicossocial: k-anonimato, item invertido, classificação', () => {
  const ins: Instrumento = { escalaMin: 1, escalaMax: 5, faixasRisco: { moderado: 40, alto: 60, critico: 80 },
    itens: [{ id: 'q1', dimensao: 'DEMANDAS' }, { id: 'q2', dimensao: 'DEMANDAS', invertido: true }, { id: 'q3', dimensao: 'APOIO' }], dimensoesPositivas: ['APOIO'] };
  const g = (grupoId: string, n: number, v: Record<string, number>) => Array.from({ length: n }, () => ({ grupoId, valores: v }));
  const rs = [...g('A', 5, { q1: 5, q2: 1, q3: 5 }), ...g('B', 3, { q1: 5, q2: 1, q3: 1 })];
  const out = apurar(ins, rs, 5);
  const a = out.filter(x => x.grupoId === 'A'), b = out.filter(x => x.grupoId === 'B');
  assert.equal(a.find(x => x.dimensao === 'DEMANDAS')!.media, 100); assert.equal(a.find(x => x.dimensao === 'DEMANDAS')!.classe, 'CRITICO');
  assert.equal(a.find(x => x.dimensao === 'APOIO')!.classe, 'BAIXO');            // apoio alto = risco baixo
  assert.ok(b.every(x => x.suprimido && x.media === null));                      // 3 < k=5: nada exibido
});

import { renderizar, variaveisDoModelo } from '../src/sst/modelos-documento.ts';
test('modelos: substitui, escapa HTML e falha se faltar variável', () => {
  assert.deepEqual(variaveisDoModelo('<p>{{nome}} - {{ cargo }}</p>').sort(), ['cargo', 'nome']);
  assert.equal(renderizar('<p>{{nome}}</p>', { nome: '<script>x</script>' }), '<p>&lt;script&gt;x&lt;/script&gt;</p>');
  assert.throws(() => renderizar('{{nome}} {{cargo}}', { nome: 'A' }), /cargo/);
});
