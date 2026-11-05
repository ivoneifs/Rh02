import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { executarAgente, ErroLLM, type Ferramenta } from '../api/src/agente.ts';
import { cifrar, decifrar } from '../api/src/crypto.ts';

process.env.IA_MASTER_KEY = 'ab'.repeat(32);

// OpenAI simulada: 1ª chamada pede ferramenta; 2ª responde texto com base no resultado da ferramenta.
function mock(modo: 'ok' | '401' = 'ok') {
  const vistos: any[] = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', c => b += c); req.on('end', () => {
    const body = JSON.parse(b); vistos.push({ auth: req.headers.authorization, body }); res.setHeader('content-type', 'application/json');
    if (modo === '401') { res.statusCode = 401; return res.end(JSON.stringify({ error: { message: 'Incorrect API key provided: sk-proj-ABCDEFGHIJ123456' } })); }
    const ultimo = body.messages.at(-1);
    if (ultimo.role === 'tool') return res.end(JSON.stringify({ choices: [{ message: { content: 'Resultado: ' + body.messages.filter((x: any) => x.role === 'tool').map((x: any) => x.content).join(' | ') } }], usage: { total_tokens: 40 } }));
    res.end(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [
      { id: 'c1', type: 'function', function: { name: 'saldo', arguments: '{"conta":"1.1"}' } },
      { id: 'c2', type: 'function', function: { name: 'inexistente', arguments: '{}' } }] } }], usage: { total_tokens: 60 } }));
  }); });
  return new Promise<{ url: string; vistos: any[]; fechar: () => void }>(ok => srv.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${(srv.address() as any).port}/v1`, vistos, fechar: () => srv.close() })));
}
const ferr: Ferramenta[] = [{ name: 'saldo', description: 'x', parameters: { type: 'object', properties: {} }, exec: async a => ({ conta: a.conta, saldo: '10000.00' }) }];

test('agente: laço de ferramentas, ferramenta desconhecida e soma de tokens', async () => {
  const m = await mock();
  const r = await executarAgente({ apiKey: 'sk-teste-1234567890abcdef', baseUrl: m.url, modelo: 'm', mensagens: [{ role: 'user', content: 'saldo do caixa?' }], ferramentas: ferr });
  m.fechar();
  assert.equal(r.tokens, 100); assert.deepEqual(r.chamadas.map(c => c.nome), ['saldo', 'inexistente']);
  assert.match(r.resposta, /10000\.00/); assert.match(r.resposta, /ferramenta desconhecida/);
  assert.equal(m.vistos[0].auth, 'Bearer sk-teste-1234567890abcdef');
  assert.equal(m.vistos[0].body.messages[0].role, 'system');                       // prompt de sistema sempre primeiro
  assert.equal(m.vistos[0].body.tools[0].function.name, 'saldo');
});

test('agente: erro 401 não vaza a chave', async () => {
  const m = await mock('401');
  await assert.rejects(executarAgente({ apiKey: 'sk-x', baseUrl: m.url, modelo: 'm', mensagens: [{ role: 'user', content: 'oi' }], ferramentas: [] }),
    (e: any) => e instanceof ErroLLM && e.status === 401 && !/ABCDEFGHIJ/.test(e.message) && /sk-\*\*\*/.test(e.message));
  m.fechar();
});

test('agente: limite de rodadas evita laço infinito', async () => {
  const srv = http.createServer((_, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: 'x', function: { name: 'saldo', arguments: '{}' } }] } }], usage: { total_tokens: 1 } })); });
  await new Promise<void>(ok => srv.listen(0, '127.0.0.1', ok));
  const r = await executarAgente({ apiKey: 'k', baseUrl: `http://127.0.0.1:${(srv.address() as any).port}/v1`, modelo: 'm', mensagens: [{ role: 'user', content: 'a' }], ferramentas: ferr, maxRodadas: 3 });
  srv.close(); assert.equal(r.chamadas.length, 3); assert.match(r.resposta, /limite de etapas/);
});

test('cofre: AES-GCM ida e volta, IV aleatório, adulteração detectada', () => {
  const k = 'sk-proj-segredo-1234567890'; const a = cifrar(k), b = cifrar(k);
  assert.equal(decifrar(a), k); assert.notDeepEqual(a, b); assert.ok(!a.toString('utf8').includes('segredo'));
  const t = Buffer.from(a); t[t.length - 1] ^= 1; assert.throws(() => decifrar(t));
});
