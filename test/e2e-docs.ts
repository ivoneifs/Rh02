// E2E da pasta do colaborador. OpenAI falso na :3999; servidor com OPENAI_BASE_URL=http://127.0.0.1:3999/v1
//   BASE=http://127.0.0.1:3911 node --experimental-strip-types --no-warnings test/e2e-docs.ts
import assert from 'node:assert/strict';
import http from 'node:http';
const BASE = process.env.BASE ?? 'http://127.0.0.1:3911';
let ultimo: any = null, resposta: any = { legivel: true, tipo_detectado: 'ASO', titular: 'JOAO DA SILVA', data_emissao: '2024-01-10', data_validade: '2024-12-31', entidade: 'Clínica X', resultado: 'apto' };
const fake = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { ultimo = JSON.parse(b); res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(resposta) } }], usage: { total_tokens: 5 } })); }); });
await new Promise<void>(r => fake.listen(3999, '127.0.0.1', r));
class Cli { cookie = ''; async r(m: string, p: string, b?: unknown, raw = false) { const res = await fetch(BASE + p, { method: m, headers: { ...(b !== undefined ? { 'content-type': 'application/json' } : {}), ...(this.cookie ? { cookie: this.cookie } : {}) }, body: b !== undefined ? JSON.stringify(b) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; if (raw) return { s: res.status, h: res.headers, buf: Buffer.from(await res.arrayBuffer()) } as any; return { s: res.status, j: await res.json().catch(() => ({})) } as any; } }
const sfx = Date.now().toString(36), A = new Cli(), B = new Cli(), SENHA = 'Senha12345x';
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
try {
  let r = await A.r('POST', '/auth/cadastro', { nome: 'Ana', escritorio: 'Docs ' + sfx, email: `d.${sfx}@t.com`, senha: SENHA }); assert.equal(r.s, 201);
  await A.r('PUT', '/v1/ia/config', { apiKey: 'sk-TesteAbCdEf1234567890abcdefGHIJ', modelo: 'gpt-4o-mini' });
  r = await A.r('POST', '/v1/admin/empresas', { cnpj: '11.222.333/0001-81', razaoSocial: 'Empresa Docs', uf: 'BA', regime: 'SIMPLES_NACIONAL' }); const emp = r.j.id;
  r = await A.r('POST', `/v1/empresas/${emp}/funcionarios`, { matricula: '1', nome: 'João da Silva', cpf: '529.982.247-25', data_nascimento: '1990-05-20', sexo: 'M', data_admissao: '2023-03-01', funcao: 'Eletricista', dependentes: 1, whatsapp: '(71) 99999-1234' }); assert.equal(r.s, 201, JSON.stringify(r.j)); const fid = r.j.id;
  r = await A.r('GET', `/v1/funcionarios/${fid}/docs`); assert.equal(r.s, 200, JSON.stringify(r.j));
  const tipos = r.j.itens.map((i: any) => i.tipo); for (const t of ['RG', 'ASO_PERIODICO', 'DEP_CERTIDAO', 'RESERVISTA']) assert.ok(tipos.includes(t), t);
  assert.equal(r.j.resumo.completos, 0); assert.ok(r.j.itens.every((i: any) => i.situacao === 'PENDENTE')); assert.equal(r.j.funcionario.whatsapp, '(71) 99999-1234');
  // upload
  r = await A.r('POST', `/v1/funcionarios/${fid}/docs`, { tipo: 'ASO_PERIODICO', nome: 'aso.pdf', base64: Buffer.from('MZ-nao-e-pdf-nem-imagem').toString('base64') }); assert.equal(r.s, 415);
  r = await A.r('POST', `/v1/funcionarios/${fid}/docs`, { tipo: 'aso periodico!', nome: 'aso.pdf', base64: pdf }); assert.equal(r.s, 422);
  r = await A.r('POST', `/v1/funcionarios/${fid}/docs`, { tipo: 'ASO_PERIODICO', nome: 'aso.pdf', base64: pdf }); assert.equal(r.s, 201, JSON.stringify(r.j)); const did = r.j.id; assert.equal(r.j.mime, 'application/pdf'); assert.ok(!('dados' in r.j));
  r = await A.r('GET', `/v1/funcionarios/${fid}/docs`); const it = r.j.itens.find((i: any) => i.tipo === 'ASO_PERIODICO'); assert.equal(it.situacao, 'ENVIADO'); assert.equal(r.j.resumo.completos, 1);
  // IA: vencido
  r = await A.r('POST', `/v1/docs/${did}/analisar`, {}); assert.equal(r.s, 200, JSON.stringify(r.j)); assert.equal(r.j.nivel, 'ERRO'); assert.equal(r.j.situacao, 'VENCIDO');
  const part = ultimo.messages.at(-1).content; assert.ok(Array.isArray(part) && part.some((p: any) => p.type === 'file' && /^data:application\/pdf;base64,/.test(p.file.file_data)), 'PDF enviado à IA como arquivo');
  r = await A.r('GET', `/v1/funcionarios/${fid}/docs`); const it2 = r.j.itens.find((i: any) => i.tipo === 'ASO_PERIODICO'); assert.equal(it2.situacao, 'VENCIDO'); assert.equal(it2.doc.data_validade, '2024-12-31'); assert.ok(it2.doc.analise.alertas.length);
  // IA: nome diferente
  resposta = { ...resposta, titular: 'Maria Souza', data_validade: '2099-01-01' };
  r = await A.r('POST', `/v1/docs/${did}/analisar`, {}); assert.equal(r.s, 200); assert.equal(r.j.nivel, 'ERRO'); assert.ok(r.j.alertas.some((a: any) => /não parece ser do colaborador/.test(a.texto)));
  // edição de datas, status
  r = await A.r('PATCH', `/v1/docs/${did}`, { data_validade: '2099-01-01' }); assert.equal(r.s, 200); assert.equal(r.j.data_validade, '2099-01-01');
  r = await A.r('PATCH', `/v1/docs/${did}`, { data_validade: '31/12/2099' }); assert.equal(r.s, 422);
  // arquivo e zip
  r = await A.r('GET', `/v1/docs/${did}`, undefined, true); assert.equal(r.s, 200); assert.equal(r.h.get('content-type'), 'application/pdf'); assert.equal(r.h.get('x-content-type-options'), 'nosniff'); assert.ok(r.buf.subarray(0, 5).toString() === '%PDF-');
  r = await A.r('GET', `/v1/funcionarios/${fid}/docs.zip`, undefined, true); assert.equal(r.s, 200); assert.equal(r.buf.readUInt32LE(0), 0x04034b50); assert.ok(r.buf.includes(Buffer.from('aso.pdf'))); require_zip(r.buf);
  // resumo
  r = await A.r('GET', `/v1/empresas/${emp}/docs-resumo`); assert.equal(r.s, 200); assert.equal(r.j[0].completos, 1);
  // isolamento
  r = await B.r('POST', '/auth/cadastro', { nome: 'Bia', escritorio: 'Outro ' + sfx, email: `o.${sfx}@t.com`, senha: SENHA }); assert.equal(r.s, 201);
  r = await B.r('GET', `/v1/docs/${did}`, undefined, true); assert.equal(r.s, 404); r = await B.r('GET', `/v1/funcionarios/${fid}/docs`); assert.equal(r.s, 404);
  r = await B.r('DELETE', `/v1/docs/${did}`); assert.equal(r.s, 404);
  // somente leitura
  r = await A.r('POST', '/v1/admin/usuarios', { nome: 'Leitor', email: `l.${sfx}@t.com`, papel: 'CLIENTE_LEITURA', senha: SENHA }); assert.equal(r.s, 201);
  const L = new Cli(); await L.r('POST', '/auth/login', { email: `l.${sfx}@t.com`, senha: SENHA });
  r = await L.r('GET', `/v1/funcionarios/${fid}/docs`); assert.equal(r.s, 200); r = await L.r('POST', `/v1/funcionarios/${fid}/docs`, { tipo: 'RG', nome: 'x.pdf', base64: pdf }); assert.equal(r.s, 403);
  r = await L.r('DELETE', `/v1/docs/${did}`); assert.equal(r.s, 403); r = await L.r('POST', `/v1/docs/${did}/analisar`, {}); assert.equal(r.s, 403);
  // sem login
  r = await new Cli().r('GET', `/v1/funcionarios/${fid}/docs`); assert.equal(r.s, 401);
  r = await A.r('DELETE', `/v1/docs/${did}`); assert.equal(r.s, 200);
  console.log('E2E docs OK');
} finally { fake.close(); }
function require_zip(b: Buffer) { // pasta única na raiz + subpasta por grupo
  const nome = b.subarray(30, 30 + b.readUInt16LE(26)).toString('utf8'); assert.match(nome, /^João da Silva \(1\)\/Saúde ocupacional\/ASO periódico - \d{8} - aso\.pdf$/, nome); assert.ok(b.readUInt16LE(12) > 0, 'data DOS'); }
