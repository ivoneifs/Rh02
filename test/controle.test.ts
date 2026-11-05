import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avaliarControle } from '../api/src/controle.ts';
const R = (o: any) => ({ id: Math.random().toString(), status: 'CONCLUIDO', dados: {}, data_evento: '2026-01-01', data_validade: null, ...o });
test('controle SST: ASO, exame e EPI com CA', () => {
  const hoje = '2026-11-05';
  const { linhas, resumo } = avaliarControle([
    R({ ferramenta: 'aso', dados: { tipo: 'periodico' }, data_validade: '2026-12-01' }),
    R({ ferramenta: 'exame_comp', dados: { exame: 'Audiometria' }, data_validade: '2026-10-01' }),
    R({ ferramenta: 'epi_entrega', dados: { epi: 'Luva', ca: '123', validade_ca: '2027-01-01' }, data_validade: '2027-03-01' }),
    R({ ferramenta: 'epi_entrega', dados: { epi: 'Capacete', ca: '', validade_ca: '2028-01-01' }, data_validade: '2027-03-01' }),
    R({ ferramenta: 'epi_entrega', dados: { epi: 'Bota', ca: '9', validade_ca: '2026-08-01' }, data_validade: '2027-03-01' }),
    R({ ferramenta: 'epi_entrega', status: 'ABERTO', dados: { epi: 'Óculos' }, data_evento: '2026-11-01' }),
  ] as any, hoje);
  const s = (n: string) => linhas.find(l => l.nome === n)!.situacao;
  assert.equal(s('ASO periodico'), 'VENCENDO'); assert.equal(s('Audiometria'), 'VENCIDO'); assert.equal(s('Luva'), 'EM_DIA');
  assert.equal(s('Capacete'), 'PENDENTE'); assert.equal(s('Bota'), 'VENCIDO'); assert.equal(s('Óculos'), 'PENDENTE');
  assert.equal(resumo.VENCIDO, 2);
});
