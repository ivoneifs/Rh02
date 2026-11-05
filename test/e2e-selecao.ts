// E2E do semáforo e da análise de candidatos. Sobe um OpenAI falso na :3999 (servidor com OPENAI_BASE_URL=http://127.0.0.1:3999/v1)
import assert from 'node:assert/strict';
import http from 'node:http';
const BASE = process.env.BASE ?? 'http://127.0.0.1:3911';
let ultimoPedido = '', modo = 'ok';
const fake = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { ultimoPedido = b; res.setHeader('content-type', 'application/json');
  const c = modo === 'ok' ? JSON.stringify({ indicador: 'VERDE', pontuacao: 88, resumo: 'Atende aos requisitos.', pontos_fortes: ['5 anos de solda'], pontos_atencao: [], perguntas_entrevista: ['Conte um caso de solda em altura'], alertas_sst: ['Prever audiometria no ASO admissional'], alertas_dp: ['Pretensão dentro da faixa'] }) : 'texto solto';
  res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: c } }], usage: { total_tokens: 7 } })); }); });
await new Promise<void>(r => fake.listen(3999, '127.0.0.1', r));
class Cli { cookie = ''; async r(m: string, p: string, b?: unknown) { const res = await fetch(BASE + p, { method: m, headers: { ...(b !== undefined ? { 'content-type': 'application/json' } : {}), ...(this.cookie ? { cookie: this.cookie } : {}) }, body: b !== undefined ? JSON.stringify(b) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; return { s: res.status, j: await res.json().catch(() => ({})) }; } }
const sfx = Date.now().toString(36), A = new Cli(), L = new Cli(), SENHA = 'Senha12345x';
try {
  let r = await A.r('POST', '/auth/cadastro', { nome: 'Ana', escritorio: 'Sel ' + sfx, email: `s.${sfx}@t.com`, senha: SENHA }); assert.equal(r.s, 201);
  assert.equal((await new Cli().r('GET', '/v1/semaforo')).s, 401);
  r = await A.r('POST', '/v1/admin/dados-teste', {}); assert.equal(r.s, 201, JSON.stringify(r.j));
  r = await A.r('GET', '/v1/semaforo'); assert.equal(r.s, 200);
  const rs = r.j.resumo; for (const k of ['dp', 'sst', 'geral']) assert.equal(rs[k].VERDE + rs[k].AMARELO + rs[k].VERMELHO, 60, k);
  for (const n of ['VERDE', 'AMARELO', 'VERMELHO']) { assert.ok(rs.sst[n] > 0, 'sst ' + n); assert.ok(rs.dp[n] > 0, 'dp ' + n); }
  const emp = (await A.r('GET', '/v1/empresas')).j.find((e: any) => e.razao_social.startsWith('TESTE - Alfa')).id;
  r = await A.r('GET', `/v1/semaforo?empresa=${emp}`); assert.equal(Object.keys(r.j.itens).length, 12);
  assert.equal((await A.r('GET', '/v1/semaforo?empresa=xx')).s, 400);
  // candidatos
  r = await A.r('GET', '/v1/registros?ferramenta=candidato'); assert.equal(r.j.length, 3); const cand = r.j[0];
  r = await A.r('POST', `/v1/registros/${cand.id}/analisar`, {}); assert.equal(r.s, 400); assert.match(r.j.erro, /chave/i);
  r = await A.r('PUT', '/v1/ia/config', { apiKey: 'sk-TesteAbCdEf1234567890abcdefGHIJ', modelo: 'gpt-4o-mini' }); assert.equal(r.s, 200);
  r = await A.r('POST', `/v1/registros/${cand.id}/analisar`, {}); assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.equal(r.j.indicador, 'VERDE'); assert.equal(r.j.pontuacao, 88); assert.equal(r.j.vaga_encontrada, true); assert.ok(r.j.alertas_sst.length === 1);
  assert.ok(!ultimoPedido.includes('Candidato Exemplo'), 'nome do candidato não vai para a IA'); assert.match(ultimoPedido, /PROIBIDO/); assert.match(ultimoPedido, /NR-35/); assert.match(ultimoPedido, /Fumos/);
  r = await A.r('GET', '/v1/registros?ferramenta=candidato'); const salvo = r.j.find((x: any) => x.id === cand.id); assert.equal(salvo.dados.indicador_ia, 'VERDE'); assert.equal(salvo.dados.vaga, 'Soldador (teste)', 'dados originais preservados'); assert.ok(salvo.dados.analise_ia.em);
  modo = 'ruim'; r = await A.r('POST', `/v1/registros/${cand.id}/analisar`, {}); assert.equal(r.s, 502);
  const aso = (await A.r('GET', '/v1/registros?ferramenta=aso')).j[0]; r = await A.r('POST', `/v1/registros/${aso.id}/analisar`, {}); assert.equal(r.s, 400);
  assert.equal((await A.r('POST', '/v1/registros/00000000-0000-0000-0000-000000000000/analisar', {})).s, 404);
  r = await A.r('POST', '/v1/admin/usuarios', { nome: 'Leitor', email: `l.${sfx}@t.com`, papel: 'CLIENTE_LEITURA', senha: SENHA }); assert.equal(r.s, 201);
  await L.r('POST', '/auth/login', { email: `l.${sfx}@t.com`, senha: SENHA }); modo = 'ok';
  assert.equal((await L.r('POST', `/v1/registros/${cand.id}/analisar`, {})).s, 403);
  assert.equal((await L.r('GET', '/v1/semaforo')).s, 200, 'leitura pode consultar o semáforo');
  await A.r('DELETE', '/v1/admin/dados-teste');
  console.log('e2e-selecao OK');
} finally { fake.close(); }
