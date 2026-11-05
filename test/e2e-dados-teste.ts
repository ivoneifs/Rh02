// E2E dos dados de teste:  BASE=http://127.0.0.1:3911 node --experimental-strip-types --no-warnings test/e2e-dados-teste.ts
import assert from 'node:assert/strict';
const BASE = process.env.BASE ?? 'http://127.0.0.1:3911';
class Cli { cookie = ''; async r(m: string, p: string, b?: unknown) { const res = await fetch(BASE + p, { method: m, headers: { ...(b !== undefined ? { 'content-type': 'application/json' } : {}), ...(this.cookie ? { cookie: this.cookie } : {}) }, body: b !== undefined ? JSON.stringify(b) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; return { s: res.status, j: await res.json().catch(() => ({})) }; } }
const sfx = Date.now().toString(36), A = new Cli(), C = new Cli(), SENHA = 'Senha12345x';
let r = await A.r('POST', '/auth/cadastro', { nome: 'Ana', escritorio: 'DT ' + sfx, email: `d.${sfx}@t.com`, senha: SENHA }); assert.equal(r.s, 201);
r = await A.r('POST', '/v1/admin/usuarios', { nome: 'Cont', email: `dc.${sfx}@t.com`, papel: 'CONTADOR', senha: SENHA }); assert.equal(r.s, 201);
await C.r('POST', '/auth/login', { email: `dc.${sfx}@t.com`, senha: SENHA });
assert.equal((await C.r('POST', '/v1/admin/dados-teste', {})).s, 403);
r = await A.r('POST', '/v1/admin/dados-teste', {}); assert.equal(r.s, 201, JSON.stringify(r.j)); assert.deepEqual([r.j.empresas, r.j.funcionarios], [5, 60]); assert.ok(r.j.registros >= 20);
assert.equal((await A.r('POST', '/v1/admin/dados-teste', {})).s, 409);
r = await A.r('GET', '/v1/admin/dados-teste'); assert.deepEqual(r.j, { empresas: 5, funcionarios: 60 });
r = await A.r('GET', '/v1/empresas'); assert.equal(r.j.filter((e: any) => e.razao_social.startsWith('TESTE - ')).length, 5);
const emp = r.j[0].id; r = await A.r('GET', `/v1/empresas/${emp}/funcionarios`); assert.equal(r.j.length, 12);
r = await A.r('GET', '/v1/registros/vencimentos?dias=60'); assert.ok(r.j.length > 0, 'painel de vencimentos tem itens');
// empresa real do usuário não é afetada
r = await A.r('POST', '/v1/admin/empresas', { cnpj: '11.222.333/0001-81', razaoSocial: 'Empresa Real', uf: 'SP', regime: 'SIMPLES_NACIONAL' }); assert.equal(r.s, 201);
assert.equal((await C.r('DELETE', '/v1/admin/dados-teste')).s, 403);
r = await A.r('DELETE', '/v1/admin/dados-teste'); assert.equal(r.s, 200); assert.equal(r.j.removidas, 5);
r = await A.r('GET', '/v1/empresas'); assert.deepEqual(r.j.map((e: any) => e.razao_social), ['Empresa Real']);
r = await A.r('GET', '/v1/admin/dados-teste'); assert.deepEqual(r.j, { empresas: 0, funcionarios: 0 });
assert.equal((await A.r('POST', '/v1/admin/dados-teste', {})).s, 201, 'pode gerar de novo após remover');
assert.equal((await A.r('DELETE', '/v1/admin/dados-teste')).s, 200);
console.log('e2e-dados-teste OK');
