// E2E de funcionários, cargos, ambientes e registros de SST:  BASE=http://127.0.0.1:3911 node --experimental-strip-types --no-warnings test/e2e-pessoal.ts
import assert from 'node:assert/strict';
const BASE = process.env.BASE ?? 'http://127.0.0.1:3911';
class Cli { cookie = '';
  async r(m: string, p: string, b?: unknown) { const res = await fetch(BASE + p, { method: m, headers: { ...(b !== undefined ? { 'content-type': 'application/json' } : {}), ...(this.cookie ? { cookie: this.cookie } : {}) }, body: b !== undefined ? JSON.stringify(b) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0]; return { s: res.status, j: await res.json().catch(() => ({})) }; } }
const sfx = Date.now().toString(36), A = new Cli(), B = new Cli(), SENHA = 'Senha12345x';
let r = await A.r('POST', '/auth/cadastro', { nome: 'Ana', escritorio: 'Esc ' + sfx, email: `p.${sfx}@t.com`, senha: SENHA }); assert.equal(r.s, 201);
r = await A.r('POST', '/v1/admin/empresas', { cnpj: '11.222.333/0001-81', razaoSocial: 'Empresa Teste', uf: 'BA', regime: 'SIMPLES_NACIONAL' }); assert.equal(r.s, 201, JSON.stringify(r.j)); const emp = r.j.id;
r = await A.r('GET', '/v1/ferramentas'); assert.ok(r.j.length >= 100, 'catálogo ≥ 100: ' + r.j.length); assert.ok(r.j.filter((f: any) => f.cat.startsWith('SST')).length >= 80, 'SST ≥ 80');
for (const id of ['apr', 'pt', 'inv_risco', 'ag_fisico', 'ag_quimico', 'ag_biologico', 'es_2210', 'es_2220', 'es_2240']) assert.ok(r.j.some((f: any) => f.id === id), 'falta ' + id);
// cargo + ambiente
r = await A.r('POST', `/v1/empresas/${emp}/cargos`, { codigo: 'C01', nome: 'Soldador', cbo: '724315' }); assert.equal(r.s, 201); const cargo = r.j.id;
r = await A.r('POST', `/v1/empresas/${emp}/cargos`, { codigo: 'C01', nome: 'Dup' }); assert.equal(r.s, 409);
r = await A.r('POST', `/v1/empresas/${emp}/ambientes`, { nome: 'Galpão 1', tipo: 'ESTABELECIMENTO_PROPRIO' }); assert.equal(r.s, 201); const amb = r.j.id;
// funcionário
const base = { matricula: '1001', nome: 'João da Silva', cpf: '529.982.247-25', data_nascimento: '1990-05-20', sexo: 'M', data_admissao: '2023-03-01', cargo_id: cargo, ambiente_id: amb, funcao: 'Soldador MIG', setor: 'Produção', salario: '3500,50', dependentes: 2, pis_nis: '12345678900', uf: 'ba', cep: '40.000-000', email: 'JOAO@x.com' };
r = await A.r('POST', `/v1/empresas/${emp}/funcionarios`, { ...base, cpf: '111.111.111-11' }); assert.equal(r.s, 422, 'CPF inválido');
r = await A.r('POST', `/v1/empresas/${emp}/funcionarios`, { ...base, pis_nis: '12345678901' }); assert.equal(r.s, 422, 'PIS inválido');
r = await A.r('POST', `/v1/empresas/${emp}/funcionarios`, { ...base, data_nascimento: '2030-01-01' }); assert.equal(r.s, 422);
r = await A.r('POST', `/v1/empresas/${emp}/funcionarios`, base); assert.equal(r.s, 201, JSON.stringify(r.j)); const fid = r.j.id;
r = await A.r('POST', `/v1/empresas/${emp}/funcionarios`, { ...base, matricula: '1002' }); assert.equal(r.s, 409, 'CPF duplicado');
r = await A.r('GET', `/v1/empresas/${emp}/funcionarios?q=silva`); assert.equal(r.j.length, 1); const f = r.j[0];
assert.equal(f.cargo_nome, 'Soldador'); assert.equal(f.uf, 'BA'); assert.equal(f.email, 'joao@x.com'); assert.ok(f.idade >= 36, 'idade calculada: ' + f.idade); assert.equal(Number(f.salario), 3500.5);
r = await A.r('PATCH', `/v1/funcionarios/${fid}`, { setor: 'Manutenção', pcd: true }); assert.equal(r.s, 200);
r = await A.r('GET', `/v1/funcionarios/${fid}`); assert.equal(r.j.setor, 'Manutenção'); assert.equal(r.j.pcd, true);
// registros: ASO + PT + vencimentos
const ontem = new Date(Date.now() - 864e5).toISOString().slice(0, 10), em10 = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10), em200 = new Date(Date.now() + 200 * 864e5).toISOString().slice(0, 10);
r = await A.r('POST', '/v1/registros', { ferramenta: 'aso', funcionario_id: fid, titulo: 'ASO periódico', data_evento: '2025-01-10', data_validade: ontem, dados: { tipo: 'periodico', resultado: 'apto' } }); assert.equal(r.s, 201, JSON.stringify(r.j)); const aso = r.j.id;
r = await A.r('POST', '/v1/registros', { ferramenta: 'treinamento', funcionario_id: fid, titulo: 'NR-35', data_validade: em10, dados: { curso: 'NR-35' } }); assert.equal(r.s, 201);
r = await A.r('POST', '/v1/registros', { ferramenta: 'treinamento', funcionario_id: fid, titulo: 'NR-10', data_validade: em200, dados: {} }); assert.equal(r.s, 201);
r = await A.r('POST', '/v1/registros', { ferramenta: 'pt', empresa_id: emp, titulo: 'PT altura', dados: { tipo: 'altura', apr_anexa: true } }); assert.equal(r.s, 201);
r = await A.r('POST', '/v1/registros', { ferramenta: 'naoexiste', empresa_id: emp }); assert.equal(r.s, 422);
r = await A.r('POST', '/v1/registros', { ferramenta: 'pt' }); assert.equal(r.s, 201, 'sem vínculo é permitido? ' + JSON.stringify(r.j));
r = await A.r('GET', '/v1/registros/vencimentos?dias=30'); assert.equal(r.j.length, 2, 'vencido + vence em 10d (não o de 200d)'); assert.ok(r.j.some((x: any) => x.vencido));
r = await A.r('GET', `/v1/registros?funcionario=${fid}`); assert.equal(r.j.length, 3); assert.equal(r.j[0].funcionario_nome, 'João da Silva');
r = await A.r('PATCH', `/v1/registros/${aso}`, { status: 'CONCLUIDO' }); assert.equal(r.s, 200);
r = await A.r('GET', '/v1/registros/vencimentos?dias=30'); assert.equal(r.j.length, 1, 'concluído sai do painel');
// isolamento + papel somente leitura
r = await B.r('POST', '/auth/cadastro', { nome: 'Bia', escritorio: 'Outro ' + sfx, email: `q.${sfx}@t.com`, senha: SENHA }); assert.equal(r.s, 201);
r = await B.r('GET', `/v1/funcionarios/${fid}`); assert.equal(r.s, 404); r = await B.r('GET', `/v1/empresas/${emp}/funcionarios`); assert.equal(r.s, 404);
r = await B.r('GET', `/v1/registros?funcionario=${fid}`); assert.equal(r.j.length, 0);
r = await B.r('PATCH', `/v1/registros/${aso}`, { status: 'CANCELADO' }); assert.equal(r.s, 404);
r = await A.r('POST', '/v1/admin/usuarios', { nome: 'Leitor', email: `l.${sfx}@t.com`, papel: 'CLIENTE_LEITURA', senha: SENHA }); assert.equal(r.s, 201);
const L = new Cli(); r = await L.r('POST', '/auth/login', { email: `l.${sfx}@t.com`, senha: SENHA }); assert.equal(r.s, 200);
r = await L.r('GET', `/v1/empresas/${emp}/funcionarios`); assert.equal(r.s, 200);
r = await L.r('POST', `/v1/empresas/${emp}/funcionarios`, { ...base, matricula: '9', cpf: '52998224725' }); assert.equal(r.s, 403);
r = await L.r('POST', '/v1/registros', { ferramenta: 'pt', empresa_id: emp }); assert.equal(r.s, 403);
r = await L.r('DELETE', `/v1/funcionarios/${fid}`); assert.equal(r.s, 403);
// ferramentas novas
r = await A.r('POST', '/v1/ferramentas/s_prazos', { fato: '2026-11-06', evento: '2210', obito: false }); assert.equal(r.j.linhas[0].v, '2026-11-09');
r = await A.r('POST', '/v1/ferramentas/s_matriz', { p: '4', s: '4', pr: '2', sr: '3' }); assert.equal(r.j.linhas[1].v, 'Alto');
r = await A.r('POST', '/v1/ferramentas/aso', {}); assert.equal(r.s, 422, 'registro não calcula');
r = await A.r('POST', '/v1/ferramentas/s_check_2220', { cpf: true }); assert.equal(r.j.linhas[0].v, 'NÃO');
// excluir: admin exclui e registros caem junto
r = await A.r('DELETE', `/v1/funcionarios/${fid}`); assert.equal(r.s, 200);
r = await A.r('GET', `/v1/registros?funcionario=${fid}`); assert.equal(r.j.length, 0);
console.log('e2e-pessoal OK');
