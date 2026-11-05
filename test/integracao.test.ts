import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exigidos, situacoes, norm } from '../api/src/integracao.ts';
import { PADROES } from '../api/src/normas.ts';
const cfg = (PADROES.find(p => p.codigo === 'TREINAMENTOS_FUNCAO') as any).valor, cat = (PADROES.find(p => p.codigo === 'TREINAMENTOS_NR') as any).valor;
test('normalização ignora acento e caixa', () => assert.equal(norm('  Técnico DE Enfermagem!'), 'tecnico de enfermagem'));
test('perfil por função: eletricista → NR-10 e NR-35 além da base', () => {
  const r = exigidos('Eletricista de manutenção', cfg, cat); const cods = r.itens.map(i => i.cod);
  assert.deepEqual(cods.slice(0, 3), ['INTEGRACAO', 'EPI', 'INCENDIO']); assert.ok(cods.includes('NR10') && cods.includes('NR35')); assert.ok(r.perfis.includes('Eletricidade')); });
test('administrativo recebe ergonomia e não NR-35', () => { const c = exigidos('Assistente administrativo', cfg, cat).itens.map(i => i.cod); assert.ok(c.includes('ERGONOMIA')); assert.ok(!c.includes('NR35')); });
test('função sem perfil recebe só a base', () => assert.equal(exigidos('Cargo exótico', cfg, cat).itens.length, 3));
test('sem duplicar quando dois perfis pedem o mesmo curso (pedreiro: altura + construção)', () => { const c = exigidos('Pedreiro', cfg, cat).itens.map(i => i.cod); assert.equal(c.filter(x => x === 'NR35').length, 1); assert.ok(c.includes('NR18')); });
test('situações: ok, vencido, agendado, pendente', () => {
  const it = exigidos('Eletricista', cfg, cat).itens; const hoje = '2026-11-05';
  const regs = [{ id: 'a', ferramenta: 'treinamento', status: 'CONCLUIDO', curso: 'NR-10 Básico', validade: '2027-01-01' }, { id: 'b', ferramenta: 'treinamento', status: 'CONCLUIDO', curso: 'NR 35 Trabalho em altura', validade: '2026-01-01' },
    { id: 'c', ferramenta: 'integracao', status: 'CONCLUIDO', curso: '', validade: null }, { id: 'd', ferramenta: 'treinamento', status: 'ABERTO', curso: 'Combate a incêndio', validade: '2026-12-01' }];
  const m = Object.fromEntries(situacoes(it, regs, hoje).map(x => [x.cod, x.situacao]));
  assert.equal(m.NR10, 'OK'); assert.equal(m.NR35, 'VENCIDO'); assert.equal(m.INTEGRACAO, 'OK'); assert.equal(m.INCENDIO, 'AGENDADO'); assert.equal(m.EPI, 'PENDENTE'); });
test('cancelado não conta', () => { const it = exigidos('Eletricista', cfg, cat).itens; const m = situacoes(it, [{ id: 'a', ferramenta: 'treinamento', status: 'CANCELADO', curso: 'NR10', validade: null }], '2026-11-05').find(x => x.cod === 'NR10')!; assert.equal(m.situacao, 'PENDENTE'); });
