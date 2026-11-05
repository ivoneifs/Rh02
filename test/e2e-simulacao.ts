// E2E do "Gerar simulação com IA". Sobe um OpenAI falso na :3999; o servidor deve iniciar com OPENAI_BASE_URL=http://127.0.0.1:3999/v1
//   BASE=http://127.0.0.1:3911 node --experimental-strip-types --no-warnings test/e2e-simulacao.ts
import assert from 'node:assert/strict';
import http from 'node:http';
import { sanear } from '../api/src/simulacao.ts';
const BASE = process.env.BASE ?? 'http://127.0.0.1:3911';
// saneamento
const campos: any[] = [{ n: 'a', l: 'A', t: 'num' }, { n: 'b', l: 'B', t: 'sel', op: [['x', 'X'], ['y', 'Y']] }, { n: 'c', l: 'C', t: 'data' }, { n: 'd', l: 'D', t: 'bool' }, { n: 'e', l: 'E', t: 'txt' }];
const o: any = sanear(campos, { a: '12,5', b: 'z', c: '2026-13-45x', d: 'true', e: 'ok', extra: 1 });
assert.deepEqual(o, { a: 12.5, d: true, e: 'ok' });
let modo = 'ok';
const fake = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { res.setHeader('content-type', 'application/json');
  const conteudo = modo === 'ok' ? JSON.stringify({ valores: { salario: 3500, perc: 6, meses: 4, lixo: 9 }, explicacao: [{ campo: 'salario', como: 'Salário atual bruto' }, { campo: 'naoexiste', como: 'x' }], resumo: 'Reajuste de 6%.' }) : 'não é json';
  res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: conteudo } }], usage: { total_tokens: 10 } })); }); });
await new Promise<void>(r => fake.listen(3999, '127.0.0.1', r));
class Cli { cookie = ''; async r(m: string, p: string, b?: unknown) { const res = await fetch(BASE + p, { method: m, headers: { ...(b !== undefined ? { 'content-type': 'application/json' } : {}), ...(this.cookie ? { cookie: this.cookie } : {}) }, body: b !== undefined ? JSON.stringify(b) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; return { s: res.status, j: await res.json().catch(() => ({})) }; } }
const sfx = Date.now().toString(36), A = new Cli(), SENHA = 'Senha12345x';
try {
  let r = await A.r('POST', '/auth/cadastro', { nome: 'Ana', escritorio: 'Sim ' + sfx, email: `s.${sfx}@t.com`, senha: SENHA }); assert.equal(r.s, 201);
  r = await A.r('POST', '/v1/ferramentas/reajuste/simular', {}); assert.equal(r.s, 400, 'sem chave: ' + JSON.stringify(r.j)); assert.match(r.j.erro, /chave/i);
  r = await A.r('PUT', '/v1/ia/config', { apiKey: 'sk-TesteAbCdEf1234567890abcdefGHIJ', modelo: 'gpt-4o-mini' }); assert.equal(r.s, 200);
  r = await A.r('POST', '/v1/ferramentas/reajuste/simular', { cenario: 'metalúrgico' }); assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.deepEqual(r.j.valores, { salario: 3500, perc: 6, meses: 4 }); assert.equal(r.j.explicacao.length, 1); assert.equal(r.j.resumo, 'Reajuste de 6%.');
  assert.equal(r.j.modo, 'exemplo');
  r = await A.r('POST', '/v1/ferramentas/reajuste/simular', { atual: { salario: 5000 } }); assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.equal(r.j.modo, 'completar'); assert.deepEqual(r.j.valores, { perc: 6, meses: 4 }, 'não sobrescreve o que o usuário preencheu');
  r = await A.r('POST', '/v1/ferramentas/reajuste', { salario: 3500, perc: 6, meses: 4 }); assert.equal(r.s, 200, 'os valores simulados calculam');
  r = await A.r('POST', '/v1/ferramentas/reajuste/explicar', { salario: 3500, perc: 6, meses: 4 }); assert.equal(r.s, 200, JSON.stringify(r.j)); assert.ok(typeof r.j.explicacao === 'string' && r.j.explicacao.length > 0);
  r = await A.r('POST', '/v1/ferramentas/aso/explicar', {}); assert.equal(r.s, 400);
  r = await A.r('POST', '/v1/ferramentas/reajuste/explicar', { salario: 'abc' }); assert.equal(r.s, 422);
  r = await A.r('POST', '/v1/ferramentas/nao_existe/simular', {}); assert.equal(r.s, 404);
  modo = 'ruim'; r = await A.r('POST', '/v1/ferramentas/reajuste/simular', {}); assert.equal(r.s, 502);
  const sem = new Cli(); r = await sem.r('POST', '/v1/ferramentas/reajuste/simular', {}); assert.equal(r.s, 401);
  console.log('e2e-simulacao OK');
} finally { fake.close(); }
