// E2E de login/cadastro/admin contra um servidor em execução:  BASE=http://127.0.0.1:3911 node --experimental-strip-types --no-warnings test/e2e-auth.ts
import assert from 'node:assert/strict';
const BASE = process.env.BASE ?? 'http://127.0.0.1:3911';
class Cli {
  cookie = '';
  async r(m: string, p: string, b?: unknown, extra: Record<string, string> = {}) {
    const res = await fetch(BASE + p, { method: m, redirect: 'manual', headers: { ...(b !== undefined ? { 'content-type': 'application/json' } : {}), ...(this.cookie ? { cookie: this.cookie } : {}), ...extra }, body: b !== undefined ? JSON.stringify(b) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    return { s: res.status, j: await res.json().catch(() => ({})), sc };
  }
}
const sfx = Date.now().toString(36);
const A = new Cli(), B = new Cli(), U = new Cli();
const emailA = `adm.${sfx}@teste.com`, emailB = `outro.${sfx}@teste.com`, emailU = `aux.${sfx}@teste.com`;
const SENHA = 'Senha12345x';

let r = await A.r('GET', '/v1/empresas'); assert.equal(r.s, 401, 'sem login = 401');
r = await A.r('POST', '/auth/cadastro', { nome: 'Ana', email: 'x', senha: SENHA }); assert.equal(r.s, 422);
r = await A.r('POST', '/auth/cadastro', { nome: 'Ana', email: emailA, senha: 'curta1' }); assert.equal(r.s, 422);
r = await A.r('POST', '/auth/cadastro', { nome: 'Ana', email: emailA, senha: 'somenteletras' }); assert.equal(r.s, 422);
r = await A.r('POST', '/auth/cadastro', { nome: 'Ana', escritorio: 'Escritório A', email: emailA, senha: SENHA });
assert.equal(r.s, 201); assert.match(r.sc!, /HttpOnly/); assert.match(r.sc!, /SameSite=Strict/);
r = await A.r('POST', '/auth/cadastro', { nome: 'Ana2', email: emailA.toUpperCase(), senha: SENHA }); assert.equal(r.s, 409, 'e-mail duplicado (case-insensitive)');
r = await A.r('GET', '/auth/me'); assert.equal(r.s, 200); assert.equal(r.j.papel, 'ADMIN'); assert.equal(r.j.email, emailA);

// CSRF: mutação sem JSON é recusada
{ const res = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' }); assert.equal(res.status, 415); }

// Empresas (admin)
r = await A.r('POST', '/v1/admin/empresas', { cnpj: '11111111111111', razaoSocial: 'Falsa', uf: 'SP', regime: 'LUCRO_REAL' }); assert.equal(r.s, 422, 'CNPJ inválido');
r = await A.r('POST', '/v1/admin/empresas', { cnpj: '11.222.333/0001-81', razaoSocial: 'Empresa Teste Ltda', uf: 'ba', regime: 'SIMPLES_NACIONAL' }); assert.equal(r.s, 201, JSON.stringify(r.j));
const empId = r.j.id;
r = await A.r('POST', '/v1/admin/empresas', { cnpj: '11222333000181', razaoSocial: 'Dup', uf: 'SP', regime: 'LUCRO_REAL' }); assert.equal(r.s, 409);
r = await A.r('PATCH', '/v1/admin/empresas/' + empId, { razaoSocial: 'Empresa Teste S/A', uf: 'SP' }); assert.equal(r.s, 200);
r = await A.r('GET', '/v1/admin/empresas'); assert.equal(r.j.length, 1); assert.equal(r.j[0].razao_social, 'Empresa Teste S/A'); assert.equal(r.j[0].uf, 'SP');
r = await A.r('GET', '/v1/empresas'); assert.equal(r.j.length, 1);

// Isolamento entre tenants
r = await B.r('POST', '/auth/cadastro', { nome: 'Bia', email: emailB, senha: SENHA }); assert.equal(r.s, 201);
r = await B.r('GET', '/v1/empresas'); assert.deepEqual(r.j, [], 'B não enxerga empresas de A');
r = await B.r('GET', '/v1/admin/usuarios'); assert.equal(r.j.length, 1);
r = await B.r('PATCH', '/v1/admin/empresas/' + empId, { ativa: false }); assert.equal(r.s, 404, 'B não edita empresa de A');
const idA = (await A.r('GET', '/v1/admin/usuarios')).j[0].id;
r = await B.r('PATCH', '/v1/admin/usuarios/' + idA, { nome: 'hack' }); assert.equal(r.s, 404, 'B não edita usuário de A');

// Usuários (CRUD)
r = await A.r('POST', '/v1/admin/usuarios', { nome: 'Auxiliar', email: emailU, papel: 'AUXILIAR', senha: SENHA }); assert.equal(r.s, 201);
const idU = r.j.id;
r = await A.r('POST', '/v1/admin/usuarios', { nome: 'Dup', email: emailB, papel: 'AUXILIAR', senha: SENHA }); assert.equal(r.s, 409, 'e-mail de outro tenant também é único');
r = await U.r('POST', '/auth/login', { email: emailU, senha: 'errada12345' }); assert.equal(r.s, 401);
r = await U.r('POST', '/auth/login', { email: emailU, senha: SENHA }); assert.equal(r.s, 200);
r = await U.r('GET', '/v1/admin/usuarios'); assert.equal(r.s, 403, 'auxiliar não acessa admin');
r = await U.r('POST', '/v1/admin/empresas', { cnpj: '11222333000181', razaoSocial: 'x', uf: 'SP', regime: 'LUCRO_REAL' }); assert.equal(r.s, 403);
r = await U.r('GET', '/v1/empresas'); assert.equal(r.s, 200); assert.equal(r.j.length, 1, 'auxiliar vê empresas do próprio tenant');
r = await A.r('PATCH', '/v1/admin/usuarios/' + idU, { papel: 'CLIENTE_LEITURA', nome: 'Cliente Leitura' }); assert.equal(r.s, 200);
r = await U.r('POST', '/v1/empresas/' + empId + '/ia/chat', { mensagens: [{ role: 'user', content: 'oi' }] }); assert.equal(r.s, 403, 'somente leitura não faz POST (papel atualizado na sessão ativa)');
r = await A.r('PATCH', '/v1/admin/usuarios/' + idU, { ativo: false }); assert.equal(r.s, 200);
r = await U.r('GET', '/auth/me'); assert.equal(r.s, 401, 'desativar derruba a sessão');
r = await U.r('POST', '/auth/login', { email: emailU, senha: SENHA }); assert.equal(r.s, 403, 'usuário desativado não entra');
r = await A.r('PATCH', '/v1/admin/usuarios/' + idU, { ativo: true, novaSenha: 'NovaSenha999z' }); assert.equal(r.s, 200);
r = await U.r('POST', '/auth/login', { email: emailU, senha: SENHA }); assert.equal(r.s, 401, 'senha antiga não vale mais');
r = await U.r('POST', '/auth/login', { email: emailU, senha: 'NovaSenha999z' }); assert.equal(r.s, 200);

// Regras de segurança do ADMIN
r = await A.r('PATCH', '/v1/admin/usuarios/' + idA, { ativo: false }); assert.equal(r.s, 409, 'não desativa a si mesmo');
r = await A.r('PATCH', '/v1/admin/usuarios/' + idA, { papel: 'AUXILIAR' }); assert.equal(r.s, 409, 'não rebaixa o único admin');
r = await A.r('DELETE', '/v1/admin/usuarios/' + idA); assert.equal(r.s, 409, 'não exclui a si mesmo');
r = await A.r('DELETE', '/v1/admin/usuarios/' + idU); assert.equal(r.s, 200);
r = await U.r('GET', '/auth/me'); assert.equal(r.s, 401, 'excluir derruba a sessão');
r = await A.r('DELETE', '/v1/admin/empresas/' + empId); assert.equal(r.s, 200);

// Trocar senha; logout; bloqueio por tentativas
r = await A.r('POST', '/auth/senha', { senhaAtual: 'errada', novaSenha: 'Outra12345y' }); assert.equal(r.s, 403);
r = await A.r('POST', '/auth/senha', { senhaAtual: SENHA, novaSenha: 'Outra12345y' }); assert.equal(r.s, 200);
r = await A.r('POST', '/auth/logout', {}); assert.equal(r.s, 200); r = await A.r('GET', '/auth/me'); assert.equal(r.s, 401);
for (let i = 0; i < 5; i++) { r = await A.r('POST', '/auth/login', { email: emailA, senha: 'errada12345' }); assert.equal(r.s, 401); }
r = await A.r('POST', '/auth/login', { email: emailA, senha: 'Outra12345y' }); assert.equal(r.s, 429, 'conta bloqueada após 5 falhas, mesmo com a senha certa');

// Token de integração continua funcionando (Bearer + X-Tenant-Id)
const tk = process.env.API_TOKEN;
if (tk) { const res = await fetch(BASE + '/v1/empresas', { headers: { authorization: 'Bearer ' + tk, 'x-tenant-id': '00000000-0000-0000-0000-0000000000a1' } }); assert.equal(res.status, 200); }
console.log('E2E auth/admin: OK');
