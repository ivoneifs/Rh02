import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogo } from '../api/src/modelos-catalogo.ts';

test('catálogo de modelos: mais de 200, ids únicos, variáveis declaradas', () => {
  const l = catalogo();
  assert.ok(l.length >= 200, 'mínimo de 200 modelos');
  assert.equal(new Set(l.map(m => m.id)).size, l.length);
  const auto = new Set('empresa cnpj uf funcionario cpf rg matricula cargo funcao setor admissao salario hoje cidade resp regresp'.split(' '));
  for (const m of l) {
    const ns = new Set(m.campos.map(c => c.n));
    for (const v of m.texto.matchAll(/\{\{([^}]+)\}\}/g)) assert.ok(ns.has(v[1]) || auto.has(v[1]), `${m.nome}: variável ${v[1]} sem campo`);
    assert.ok(['SST', 'DP e RH', 'Contábil', 'Gestão'].includes(m.area));
  }
});
