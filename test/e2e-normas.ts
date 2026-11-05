// E2E de ferramentas e normas:  BASE=http://127.0.0.1:3911 node --experimental-strip-types --no-warnings test/e2e-normas.ts
import assert from 'node:assert/strict';
const BASE = process.env.BASE ?? 'http://127.0.0.1:3911';
class Cli { cookie = '';
  async r(m: string, p: string, b?: unknown) { const res = await fetch(BASE + p, { method: m, headers: { ...(b !== undefined ? { 'content-type': 'application/json' } : {}), ...(this.cookie ? { cookie: this.cookie } : {}) }, body: b !== undefined ? JSON.stringify(b) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; return { s: res.status, j: await res.json().catch(() => ({})) }; } }
const sfx = Date.now().toString(36), A = new Cli(), B = new Cli(), SENHA = 'Senha12345x';
let r = await A.r('GET', '/v1/ferramentas'); assert.equal(r.s, 401);
r = await A.r('POST', '/auth/cadastro', { nome: 'Ana', escritorio: 'Esc ' + sfx, email: `n.${sfx}@t.com`, senha: SENHA }); assert.equal(r.s, 201, JSON.stringify(r.j));
r = await A.r('GET', '/v1/ferramentas'); assert.equal(r.s, 200); assert.ok(r.j.length >= 40, 'mín. 40 ferramentas: ' + r.j.length);
r = await A.r('POST', '/v1/ferramentas/inss', { base: '3000' }); assert.equal(r.s, 200); assert.equal(r.j.linhas[0].v, 248.6);
r = await A.r('POST', '/v1/ferramentas/inss', { base: 'abc' }); assert.equal(r.s, 422);
r = await A.r('POST', '/v1/ferramentas/naoexiste', {}); assert.equal(r.s, 422);
r = await A.r('GET', '/v1/normas'); assert.equal(r.s, 200); assert.ok(r.j.length >= 15); const inssN = r.j.find((n: any) => n.codigo === 'INSS_EMPREGADO');
// CRUD: nova vigência com teto diferente; ferramenta passa a usar
r = await A.r('POST', '/v1/normas', { categoria: 'INSS', codigo: 'INSS_EMPREGADO', descricao: 'teste', valor: { faixas: [[2000, 0.1]] }, vigencia_ini: '2020-01-01', status: 'VIGENTE' }); assert.equal(r.s, 201, JSON.stringify(r.j));
r = await A.r('POST', '/v1/normas', { categoria: 'INSS', codigo: 'INSS_EMPREGADO', descricao: 'teste', valor: {}, vigencia_ini: '2020-01-01', status: 'VIGENTE' }); assert.equal(r.s, 409);
r = await A.r('POST', '/v1/normas', { categoria: 'XX', codigo: 'A_B', descricao: 'teste', valor: {}, vigencia_ini: '2020-01-01' }); assert.equal(r.s, 422);
r = await A.r('POST', '/v1/normas', { categoria: 'INSS', codigo: 'x', descricao: 'teste', valor: '{', vigencia_ini: '2020-01-01' }); assert.equal(r.s, 422);
r = await A.r('GET', '/v1/normas'); const nova = r.j.find((n: any) => n.codigo === 'INSS_EMPREGADO' && n.vigencia_ini.startsWith('2020'));
r = await A.r('POST', '/v1/ferramentas/inss', { base: '3000' }); assert.equal(r.j.linhas[0].v, 248.6, 'vigência mais recente (2026) prevalece');
r = await A.r('PATCH', `/v1/normas/${nova.id}`, { status: 'ARQUIVADO', observacao: 'obs' }); assert.equal(r.s, 200);
r = await A.r('DELETE', `/v1/normas/${nova.id}`); assert.equal(r.s, 200);
r = await A.r('DELETE', `/v1/normas/${nova.id}`); assert.equal(r.s, 404);
// rascunho → aprovar arquiva a anterior
r = await A.r('POST', '/v1/normas', { categoria: 'INSS', codigo: 'SALARIO_FAMILIA', descricao: 'salário-família rascunho', valor: { cota: 70, limite: 2000 }, vigencia_ini: '2026-07-01', status: "RASCUNHO" }); assert.equal(r.s, 201, JSON.stringify(r.j)); const rasc = r.j.id;
r = await A.r('POST', '/v1/ferramentas/salfam', { salario: '1900', filhos: '1' }); assert.equal(r.j.linhas.at(-1).v, 67.54);
r = await A.r('POST', `/v1/normas/${rasc}/aprovar`, {}); assert.equal(r.s, 200);
r = await A.r('POST', '/v1/ferramentas/salfam', { salario: '1900', filhos: '1' }); assert.equal(r.j.linhas.at(-1).v, 70, 'rascunho aprovado passa a valer');
r = await A.r('GET', '/v1/normas/historico'); assert.ok(r.j.length >= 5);
r = await A.r('POST', '/v1/normas/atualizar/INSS', {}); assert.equal(r.s, 200); assert.match(r.j.mensagem, /OpenAI|fonte|Nenhuma|rascunho|IA/i);
r = await A.r('POST', '/v1/normas/atualizar/XXX', {}); assert.equal(r.s, 422);
// isolamento e papéis
r = await B.r('POST', '/auth/cadastro', { nome: 'Bia', escritorio: 'Outro ' + sfx, email: `b.${sfx}@t.com`, senha: SENHA }); assert.equal(r.s, 201);
r = await B.r('GET', '/v1/normas'); assert.ok(!r.j.some((n: any) => n.id === rasc), 'tenant B não vê normas de A');
r = await A.r('POST', '/v1/admin/usuarios', { nome: 'Aux', email: `a.${sfx}@t.com`, papel: 'AUXILIAR', senha: SENHA }); assert.equal(r.s, 201);
const U = new Cli(); r = await U.r('POST', '/auth/login', { email: `a.${sfx}@t.com`, senha: SENHA }); assert.equal(r.s, 200);
r = await U.r('GET', '/v1/normas'); assert.equal(r.s, 200);
r = await U.r('POST', '/v1/normas', { categoria: 'INSS', codigo: 'ZZ_ZZ', descricao: 'teste', valor: {}, vigencia_ini: '2020-01-01' }); assert.equal(r.s, 403);
r = await U.r('POST', '/v1/normas/restaurar', {}); assert.equal(r.s, 403);
r = await U.r('POST', '/v1/ferramentas/rescisao', { salario: 3000, adm: '2023-03-01', dem: '2026-06-15', tipo: 'sem_justa', aviso: 'indenizado', feriasVenc: 0, saldoFgts: 20000, deps: 0 }); assert.equal(r.s, 200);
r = await U.r('POST', '/v1/ferramentas/rescisao', { salario: 3000, adm: '2023-02-30', dem: '2026-06-15', tipo: 'sem_justa' }); assert.equal(r.s, 422);
console.log('e2e-normas OK');
