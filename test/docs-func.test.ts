import test from 'node:test'; import assert from 'node:assert/strict';
import { slotsNecessarios, montarChecklist, situacaoDoc, veredito, mesmoNome, mimePorBytes } from '../api/src/docs-func.ts';
test('slots por perfil', () => {
  const s = slotsNecessarios({ sexo: 'M', dependentes: 2, funcao: 'Motorista' }, [{ cod: 'NR35', nome: 'NR-35', horas: 8, reciclagem_meses: 24 }]);
  const t = s.map(x => x.tipo); for (const k of ['RG', 'RESERVISTA', 'CNH', 'DEP_CERTIDAO', 'ASO_ADMISSIONAL', 'TREIN:NR35']) assert.ok(t.includes(k), k);
  assert.ok(!slotsNecessarios({ sexo: 'F', dependentes: 0 }, []).some(x => x.tipo === 'RESERVISTA' || x.tipo === 'DEP_CPF'));
});
test('situação por prazo', () => {
  assert.equal(situacaoDoc(null, '2026-01-10'), 'PENDENTE'); assert.equal(situacaoDoc({}, '2026-01-10'), 'ENVIADO');
  assert.equal(situacaoDoc({ data_validade: '2026-01-09' }, '2026-01-10'), 'VENCIDO'); assert.equal(situacaoDoc({ data_validade: '2026-02-05' }, '2026-01-10'), 'A_VENCER'); assert.equal(situacaoDoc({ data_validade: '2026-06-01' }, '2026-01-10'), 'EM_DIA');
});
test('checklist usa o mais recente', () => {
  const sl = slotsNecessarios({}, []), r = montarChecklist(sl, [{ id: 'a', tipo: 'RG', criado_em: '2026-01-01', status: 'ENVIADO' }, { id: 'b', tipo: 'RG', criado_em: '2026-02-01', status: 'ENVIADO' }, { id: 'c', tipo: 'XX', titulo: 'Avulso', criado_em: '2026-02-01', status: 'ENVIADO' }], '2026-03-01');
  assert.equal(r.itens.find(i => i.tipo === 'RG')!.doc.id, 'b'); assert.ok(r.itens.some(i => i.tipo === 'XX')); assert.ok(r.resumo.pendentes > 0);
});
test('veredito', () => {
  const v = veredito({ legivel: true, tipo_detectado: 'ASO', titular: 'JOAO DA SILVA', data_validade: '25/12/2025' }, { tipo: 'ASO_PERIODICO', nome_funcionario: 'João da Silva', hoje: '2026-01-10' });
  assert.equal(v.nivel, 'ERRO'); assert.equal(v.situacao, 'VENCIDO');
  const w = veredito({ titular: 'Maria Souza', tipo_detectado: 'RG' }, { tipo: 'ASO_PERIODICO', nome_funcionario: 'João da Silva', hoje: '2026-01-10' });
  assert.ok(w.alertas.some(a => /não parece ser do colaborador/.test(a.texto)) && w.alertas.some(a => /diferente do item/.test(a.texto)));
  const c = veredito({ titular: 'João Silva', data_emissao: '2025-06-01', curso: 'NR-35' }, { tipo: 'TREIN:NR35', nome_funcionario: 'João da Silva', hoje: '2026-01-10', reciclagem_meses: 24 });
  assert.equal(c.data_validade, '2027-06-01'); assert.equal(c.situacao, 'EM_DIA');
  assert.equal(veredito({ resultado: 'Inapto', titular: 'João da Silva' }, { tipo: 'ASO_PERIODICO', nome_funcionario: 'João da Silva', hoje: '2026-01-10' }).nivel, 'ERRO');
});
test('nome e bytes', () => { assert.ok(mesmoNome('JOSE A. SANTOS', 'José Antonio Santos')); assert.ok(!mesmoNome('Maria Souza', 'João da Silva'));
  assert.equal(mimePorBytes(Buffer.from('%PDF-1.7\n.........')), 'application/pdf'); assert.equal(mimePorBytes(Buffer.from('MZ..............')), null); });
test('frente e verso', () => {
  const sl = slotsNecessarios({ funcao: 'Motorista' }, []), rg = (docs: any[]) => montarChecklist(sl, docs, '2026-03-01').itens.find(i => i.tipo === 'RG')!;
  assert.ok(rg([]).frente_verso && sl.find(s => s.tipo === 'CNH')!.frente_verso);
  const f = { id: 'f', tipo: 'RG', lado: 'FRENTE', criado_em: '2026-01-01', status: 'ENVIADO' }, v = { id: 'v', tipo: 'RG', lado: 'VERSO', criado_em: '2026-01-02', status: 'ENVIADO' };
  assert.equal(rg([f]).situacao, 'INCOMPLETO'); assert.equal(rg([f]).falta, 'verso'); assert.equal(rg([v]).falta, 'frente');
  assert.equal(rg([f, v]).situacao, 'ENVIADO'); assert.equal(rg([{ ...f, lado: 'UNICO' }]).situacao, 'ENVIADO');
  const c = montarChecklist(sl, [f], '2026-03-01').resumo; assert.equal(c.incompletos, 1); assert.equal(c.completos, 0);
  const cnh = montarChecklist(sl, [{ id: 'a', tipo: 'CNH', lado: 'FRENTE', data_validade: '2020-01-01', criado_em: 'x', status: 'ENVIADO' }, { id: 'b', tipo: 'CNH', lado: 'VERSO', criado_em: 'y', status: 'ENVIADO' }], '2026-03-01').itens.find(i => i.tipo === 'CNH')!;
  assert.equal(cnh.situacao, 'VENCIDO');
  assert.ok(!veredito({ legivel: true }, { tipo: 'RG', nome_funcionario: 'A B', hoje: '2026-03-01', lado: 'VERSO' }).alertas.some(a => /titular|validade/.test(a.texto)));
});
