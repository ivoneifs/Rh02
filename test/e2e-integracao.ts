// E2E do checklist de treinamentos da integração por função:  BASE=http://127.0.0.1:3911 node --experimental-strip-types --no-warnings test/e2e-integracao.ts
import assert from 'node:assert/strict';
const BASE = process.env.BASE ?? 'http://127.0.0.1:3911';
class Cli { cookie = ''; async r(m: string, p: string, b?: unknown) { const res = await fetch(BASE + p, { method: m, headers: { ...(b !== undefined ? { 'content-type': 'application/json' } : {}), ...(this.cookie ? { cookie: this.cookie } : {}) }, body: b !== undefined ? JSON.stringify(b) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; return { s: res.status, j: await res.json().catch(() => ({})) }; } }
const sfx = Date.now().toString(36), A = new Cli(), L = new Cli(), SENHA = 'Senha12345x';
let r = await A.r('POST', '/auth/cadastro', { nome: 'Ana', escritorio: 'Int ' + sfx, email: `i.${sfx}@t.com`, senha: SENHA }); assert.equal(r.s, 201);
r = await A.r('POST', '/v1/admin/empresas', { cnpj: '11.222.333/0001-81', razaoSocial: 'Empresa Int', uf: 'SP', regime: 'SIMPLES_NACIONAL' }); const emp = r.j.id;
const novo = async (mat: string, cpf: string, funcao: string) => { const x = await A.r('POST', `/v1/empresas/${emp}/funcionarios`, { matricula: mat, nome: 'Func ' + funcao, cpf, data_admissao: '2026-10-01', funcao, setor: 'Teste' }); assert.equal(x.s, 201, JSON.stringify(x.j)); return x.j.id as string; };
const elet = await novo('1', '529.982.247-25', 'Eletricista de manutenção'), adm = await novo('2', '111.444.777-35', 'Assistente administrativo');
r = await A.r('GET', `/v1/funcionarios/${elet}/integracao`); assert.equal(r.s, 200, JSON.stringify(r.j));
let cods = r.j.itens.map((i: any) => i.cod); assert.ok(cods.includes('NR10') && cods.includes('NR35') && cods.includes('INTEGRACAO')); assert.equal(r.j.resumo.pendentes, r.j.itens.length); assert.ok(r.j.perfis.includes('Eletricidade'));
r = await A.r('GET', `/v1/funcionarios/${adm}/integracao`); cods = r.j.itens.map((i: any) => i.cod); assert.ok(cods.includes('ERGONOMIA') && !cods.includes('NR35'));
assert.equal((await A.r('GET', '/v1/funcionarios/xx/integracao')).s, 400);
assert.equal((await A.r('POST', `/v1/funcionarios/${elet}/integracao/gerar`, { prazo_dias: 0 })).s, 422);
// gera pendências
r = await A.r('POST', `/v1/funcionarios/${elet}/integracao/gerar`, { prazo_dias: 10 }); assert.equal(r.s, 201); const n = r.j.criados; assert.ok(n >= 5, 'criou ' + n);
r = await A.r('POST', `/v1/funcionarios/${elet}/integracao/gerar`, { prazo_dias: 10 }); assert.equal(r.j.criados, 0, 'idempotente');
r = await A.r('GET', `/v1/funcionarios/${elet}/integracao`); assert.equal(r.j.resumo.agendados, n); assert.equal(r.j.resumo.pendentes, 0);
r = await A.r('GET', `/v1/registros?funcionario=${elet}&ferramenta=treinamento`); assert.equal(r.j.length, n); assert.ok(r.j.every((x: any) => x.status === 'ABERTO' && x.data_validade));
// conclui NR-35 com validade e NR-10 vencida
const reg35 = r.j.find((x: any) => /NR-35/.test(x.titulo)), reg10 = r.j.find((x: any) => /NR-10/.test(x.titulo));
assert.equal((await A.r('PATCH', `/v1/registros/${reg35.id}`, { status: 'CONCLUIDO', data_validade: '2099-01-01' })).s, 200);
assert.equal((await A.r('PATCH', `/v1/registros/${reg10.id}`, { status: 'CONCLUIDO', data_validade: '2020-01-01' })).s, 200);
r = await A.r('GET', `/v1/funcionarios/${elet}/integracao`); const por = Object.fromEntries(r.j.itens.map((i: any) => [i.cod, i.situacao])); assert.equal(por.NR35, 'OK'); assert.equal(por.NR10, 'VENCIDO');
r = await A.r('GET', `/v1/semaforo?empresa=${emp}`); assert.equal(r.j.itens[elet].sst.nivel, 'VERMELHO'); assert.ok(r.j.itens[elet].sst.motivos.some((m: string) => /reciclagem vencida/.test(m)));
// perfis editáveis nas normas: a edição vale no checklist
r = await A.r('GET', '/v1/normas?categoria=SST'); const base = r.j.find((x: any) => x.codigo === 'TREINAMENTOS_FUNCAO'); assert.ok(base, 'padrão semeado listado');
// leitura
r = await A.r('POST', '/v1/admin/usuarios', { nome: 'Leitor', email: `l.${sfx}@t.com`, papel: 'CLIENTE_LEITURA', senha: SENHA }); assert.equal(r.s, 201); await L.r('POST', '/auth/login', { email: `l.${sfx}@t.com`, senha: SENHA });
assert.equal((await L.r('GET', `/v1/funcionarios/${adm}/integracao`)).s, 200); assert.equal((await L.r('POST', `/v1/funcionarios/${adm}/integracao/gerar`, {})).s, 403);
console.log('e2e-integracao OK');
