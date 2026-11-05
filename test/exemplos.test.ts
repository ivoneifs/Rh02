import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogo } from '../api/src/modelos-catalogo.ts';
import { exemploDoModelo } from '../api/src/exemplos.ts';

test('todo modelo tem exemplo fictício completo, sem campo genérico ou vazio', () => {
  const mods = catalogo(); assert.ok(mods.length >= 250);
  for (const m of mods) {
    const v = exemploDoModelo(m);
    for (const c of m.campos) {
      const x = v[c.n];
      assert.ok(typeof x === 'string' && x.trim() !== '', `${m.nome}: ${c.n} vazio`);
      assert.ok(!/^Exemplo( fictício para|\s–)/.test(x), `${m.nome}: ${c.n} genérico`);
      assert.ok(!/^\d{4}-\d{2}-\d{2}$/.test(x), `${m.nome}: ${c.n} com data ISO`);
    }
    for (const k of ['empresa', 'cnpj', 'cidade', 'resp', 'regresp', 'hoje']) assert.ok(v[k], `${m.nome}: falta ${k}`);
  }
});
test('os dados de exemplo são identificados como fictícios e não usam CPF/CNPJ reais conhecidos', () => {
  const v = exemploDoModelo(catalogo()[0]);
  assert.equal(v.cnpj, '11.222.333/0001-81'); assert.equal(v.cpf, '111.444.777-35');
});
