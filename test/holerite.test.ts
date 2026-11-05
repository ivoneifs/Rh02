import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PADROES } from '../api/src/normas.ts';
import { calcularHolerite } from '../api/src/holerite.ts';
import { inss } from '../api/src/ferramentas.ts';

const P: Record<string, any> = {}; for (const p of PADROES) P[p.codigo] = p.valor;
const emp = { razao_social: 'Metalúrgica Horizonte Ltda', cnpj: '11222333000181' };
const f = { id: 'x', nome: 'Carlos Eduardo Souza Lima', matricula: '000127', cpf: '11144477735', salario: 2500, funcao: 'Operador', setor: 'Produção', data_admissao: '2024-03-12', dependentes: 0 };

test('holerite simples: salário, INSS e IRRF pelas tabelas vigentes; líquido = vencimentos − descontos', () => {
  const h = calcularHolerite(f, emp, '2026-03', {}, P);
  assert.equal(h.linhas[0].cod, '101'); assert.equal(h.linhas[0].venc, 2500);
  const i = h.linhas.find(x => x.cod === '973')!; assert.equal(i.descto, inss(2500, P));
  assert.equal(h.total_venc, 2500); assert.equal(h.liquido, Math.round((h.total_venc - h.total_desc) * 100) / 100);
  assert.equal(h.bases.fgts_mes, Math.round(2500 * P.FGTS_ALIQUOTAS.geral * 100) / 100); assert.equal(h.bases.salario_base, 2500);
});
test('horas extras, periculosidade, vale-transporte, proventos e descontos extras', () => {
  const h = calcularHolerite(f, emp, '2026-03', { he50: 10, peric: true, vt: true, dias: 30, proventos: [{ desc: 'Prêmio produção', valor: 300 }], descontos: [{ desc: 'Adiantamento', valor: '100,00' }] }, P);
  const c = (k: string) => h.linhas.find(x => x.cod === k)!;
  assert.equal(c('102').venc, Math.round(2500 / 220 * (1 + P.ADICIONAIS.hora_extra) * 10 * 100) / 100);
  assert.equal(c('104').venc, Math.round(2500 * P.ADICIONAIS.periculosidade * 100) / 100);
  assert.equal(c('201').venc, 300); assert.equal(c('901').descto, 100); assert.ok(c('974').descto > 0);
  assert.equal(h.bases.base_fgts, h.total_venc);
});
test('validações: competência, salário ausente e entradas sujas', () => {
  assert.throws(() => calcularHolerite(f, emp, '2026-13', {}, P), /Competência/);
  assert.throws(() => calcularHolerite({ ...f, salario: null }, emp, '2026-03', {}, P), /salário/);
  const h = calcularHolerite(f, emp, '2026-03', { he50: -5, proventos: [{ desc: '', valor: 10 }, { desc: 'ok', valor: 'abc' }] }, P);
  assert.equal(h.linhas.filter(x => x.cod.startsWith('2')).length, 0);
});
