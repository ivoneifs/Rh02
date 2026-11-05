import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avaliar, type Col, type Reg } from '../api/src/semaforo.ts';
import { sanearAnalise } from '../api/src/selecao.ts';
const D = 864e5, hoje = Math.floor(Date.parse('2026-11-05') / D), iso = (n: number) => new Date((hoje + n) * D).toISOString().slice(0, 10);
const col = (o: Partial<Col> = {}): Col => ({ id: 'x', data_admissao: iso(-200), data_demissao: null, ativo: true, tipo_contrato: 'CLT_INDETERMINADO', pis_nis: '1', ctps: '1', data_nascimento: '1990-01-01', cargo_id: 'c', salario: 3000, ...o });
const aso = (d: number): Reg => ({ funcionario_id: 'x', ferramenta: 'aso', status: 'ABERTO', data_evento: iso(d - 365), data_validade: iso(d) });
test('tudo em dia = verde/verde', () => { const r = avaliar(col(), [aso(200)], hoje); assert.equal(r.dp.nivel, 'VERDE'); assert.equal(r.sst.nivel, 'VERDE'); assert.equal(r.geral, 'VERDE'); });
test('ASO: sem registro vermelho; vencido vermelho; a vencer amarelo', () => {
  assert.equal(avaliar(col(), [], hoje).sst.nivel, 'VERMELHO');
  assert.equal(avaliar(col(), [aso(-1)], hoje).sst.nivel, 'VERMELHO');
  assert.equal(avaliar(col(), [aso(30)], hoje).sst.nivel, 'AMARELO');
  assert.equal(avaliar(col(), [aso(31)], hoje).sst.nivel, 'VERDE'); });
test('cadastro incompleto: 1-2 amarelo, 3+ vermelho', () => {
  assert.equal(avaliar(col({ pis_nis: null }), [aso(200)], hoje).dp.nivel, 'AMARELO');
  assert.equal(avaliar(col({ pis_nis: null, ctps: null, cargo_id: null }), [aso(200)], hoje).dp.nivel, 'VERMELHO'); });
test('experiência: termina em 15 dias amarelo, vencida vermelho', () => {
  assert.equal(avaliar(col({ tipo_contrato: 'EXPERIENCIA', data_admissao: iso(-80) }), [aso(200)], hoje).dp.nivel, 'AMARELO');
  assert.equal(avaliar(col({ tipo_contrato: 'EXPERIENCIA', data_admissao: iso(-100) }), [aso(200)], hoje).dp.nivel, 'VERMELHO'); });
test('férias: >=23 meses vermelho, >=18 amarelo, gozo registrado zera', () => {
  assert.equal(avaliar(col({ data_admissao: iso(-30 * 24) }), [aso(200)], hoje).dp.nivel, 'VERMELHO');
  assert.equal(avaliar(col({ data_admissao: iso(-30 * 19) }), [aso(200)], hoje).dp.nivel, 'AMARELO');
  const g: Reg = { funcionario_id: 'x', ferramenta: 'ferias_dp', status: 'CONCLUIDO', data_evento: iso(-90), data_validade: null };
  assert.equal(avaliar(col({ data_admissao: iso(-30 * 40) }), [aso(200), g], hoje).dp.nivel, 'VERDE'); });
test('pendência SST vencida deixa SST vermelho; DP vencida deixa DP vermelho; cancelado é ignorado', () => {
  const p = (f: string, d: number, st = 'ABERTO'): Reg => ({ funcionario_id: 'x', ferramenta: f, status: st, data_evento: null, data_validade: iso(d) });
  assert.equal(avaliar(col(), [aso(200), p('treinamento', -3)], hoje).sst.nivel, 'VERMELHO');
  assert.equal(avaliar(col(), [aso(200), p('advertencia', -3)], hoje).dp.nivel, 'VERMELHO');
  assert.equal(avaliar(col(), [aso(200), p('treinamento', -3, 'CANCELADO')], hoje).sst.nivel, 'VERDE'); });
test('desligado fica cinza', () => { const r = avaliar(col({ data_demissao: iso(-1) }), [], hoje); assert.equal(r.geral, 'CINZA'); });
test('saneamento da análise da IA', () => {
  const a = sanearAnalise({ indicador: 'roxo', pontuacao: 250, resumo: 'x', pontos_fortes: ['a', 3, 'b'], alertas_sst: 'não é lista' });
  assert.equal(a.indicador, 'AMARELO'); assert.equal(a.pontuacao, 100); assert.deepEqual(a.pontos_fortes, ['a', 'b']); assert.deepEqual(a.alertas_sst, []); assert.match(a.aviso, /decisão/); });
test('semáforo: reciclagem de treinamento vencida deixa SST vermelho; reciclado depois fica verde', () => {
  const t = (curso: string, d: number): Reg => ({ funcionario_id: 'x', ferramenta: 'treinamento', status: 'CONCLUIDO', data_evento: null, data_validade: iso(d), curso });
  assert.equal(avaliar(col(), [aso(200), t('NR-35', -10)], hoje).sst.nivel, 'VERMELHO');
  assert.equal(avaliar(col(), [aso(200), t('NR-35', -10), t('NR-35', 300)], hoje).sst.nivel, 'VERDE');
  assert.equal(avaliar(col(), [aso(200), t('NR-35', 300)], hoje).sst.nivel, 'VERDE'); });
