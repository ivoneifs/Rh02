import { test } from 'node:test';
import assert from 'node:assert/strict';
import { camposDoCadastro } from '../api/src/cadastro-auto.ts';

test('cadastro automático: mudança de cargo/salário, transferência, contrato, retorno e desligamento', () => {
  assert.deepEqual(camposDoCadastro('mudanca_cargo', { cargo_novo: 'Supervisor', sal_novo: 4500 }).cols, { salario: 4500, funcao: 'Supervisor' });
  assert.deepEqual(camposDoCadastro('transferencia_ds', { destino: 'Logística', definitiva: true }).cols, { setor: 'Logística' });
  assert.deepEqual(camposDoCadastro('transferencia_ds', { destino: 'Logística', definitiva: false }).cols, {});
  assert.deepEqual(camposDoCadastro('contrato_trab', { tipo: 'DETERMINADO' }).cols, { tipo_contrato: 'CLT_DETERMINADO' });
  assert.deepEqual(camposDoCadastro('contrato_trab', { tipo: 'APRENDIZ' }).cols, { tipo_contrato: 'APRENDIZ', aprendiz: true });
  assert.deepEqual(camposDoCadastro('retorno', { nova_funcao: 'Auxiliar' }).cols, { funcao: 'Auxiliar' });
  assert.deepEqual(camposDoCadastro('deslig_chk', {}, '2026-11-05').cols, { data_demissao: '2026-11-05' });
  assert.deepEqual(camposDoCadastro('deslig_chk', {}, 'lixo').cols, {});
  assert.deepEqual(camposDoCadastro('mudanca_cargo', { sal_novo: -5 }).cols, {});
  assert.deepEqual(camposDoCadastro('aso', { x: 1 }).cols, {});
});
