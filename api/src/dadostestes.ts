// Dados fictícios para testes/treinamento: 5 empresas e 60 funcionários (com cargos, ambientes e alguns registros de SST).
// Tudo é marcado com o prefixo "TESTE - " na razão social para poder ser removido de uma vez (somente ADMIN).
import { dbDoTenant } from './db.ts';
import { ErroAuth, criarEmpresa, type Sessao } from './auth.ts';
import * as pessoal from './pessoal.ts';
import * as registros from './registros.ts';

export const PREFIXO = 'TESTE - ';
const dv = (nums: number[], pesos: number[]) => { const r = nums.reduce((a, n, i) => a + n * pesos[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
export function cnpjGerado(n: number) { const b = [9, 9, 0, 0, 0, 0 + Math.floor(n / 10) % 10, n % 10, 0, 0, 0, 1]; b.unshift(); const base = [...String(10000000 + n).padStart(8, '0').split('').map(Number), 0, 0, 0, 1];
  const d1 = dv(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]); const d2 = dv([...base, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]); return [...base, d1, d2].join(''); }
export function cpfGerado(n: number) { const base = String(100000000 + n * 7919).slice(0, 9).split('').map(Number); if (/^(\d)\1+$/.test(base.join(''))) base[8] = (base[8] + 1) % 10;
  const f = (arr: number[]) => { const r = arr.reduce((a, x, i) => a + x * (arr.length + 1 - i), 0) % 11; return r < 2 ? 0 : 11 - r; }; const d1 = f(base), d2 = f([...base, d1]); return [...base, d1, d2].join(''); }
export function pisGerado(n: number) { const base = String(12000000000 + n * 104729).slice(0, 10).split('').map(Number); const w = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const r = 11 - (base.reduce((a, x, i) => a + x * w[i], 0) % 11); return [...base, r >= 10 ? 0 : r].join(''); }

const EMPRESAS = [['Alfa Metalúrgica Ltda', 'SP', 'SIMPLES_NACIONAL'], ['Beta Construções e Obras Ltda', 'MG', 'LUCRO_PRESUMIDO'], ['Gama Alimentos S.A.', 'BA', 'LUCRO_REAL'], ['Delta Clínica Médica Ltda', 'RJ', 'SIMPLES_NACIONAL'], ['Ômega Transportes Ltda', 'PR', 'LUCRO_PRESUMIDO']] as const;
const NOMES = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Fábio', 'Giovana', 'Hugo', 'Isabela', 'João', 'Karina', 'Lucas', 'Marina', 'Nelson', 'Olívia', 'Paulo', 'Queila', 'Rafael', 'Sofia', 'Thiago', 'Úrsula', 'Vitor', 'Wanda', 'Xavier', 'Yara', 'Zeca'];
const SOBR = ['Silva', 'Souza', 'Oliveira', 'Santos', 'Lima', 'Pereira', 'Costa', 'Ribeiro', 'Almeida', 'Carvalho', 'Gomes', 'Martins', 'Rocha', 'Barbosa', 'Moreira'];
const CARGOS = [['Auxiliar de produção', '841005', 'Produção'], ['Operador de máquinas', '721010', 'Produção'], ['Assistente administrativo', '411010', 'Administrativo'], ['Soldador', '724315', 'Manutenção'], ['Motorista', '782510', 'Logística'], ['Técnico de segurança do trabalho', '351605', 'SST']] as const;
const iso = (d: Date) => d.toISOString().slice(0, 10), somaDias = (n: number) => iso(new Date(Date.now() + n * 864e5));

export async function resumo(s: Sessao) {
  if (s.papel !== 'ADMIN') throw new ErroAuth(403, 'Apenas administradores.');
  return dbDoTenant(s.tenantId, s.papel).transaction(async t => ({ empresas: +(await t.query(`SELECT count(*) FROM empresas WHERE razao_social LIKE $1`, [PREFIXO + '%'])).rows[0].count,
    funcionarios: +(await t.query(`SELECT count(*) FROM colaboradores c JOIN empresas e ON e.id=c.empresa_id WHERE e.razao_social LIKE $1`, [PREFIXO + '%'])).rows[0].count }));
}

export async function gerar(s: Sessao) {
  if (s.papel !== 'ADMIN') throw new ErroAuth(403, 'Apenas administradores.');
  if ((await resumo(s)).empresas) throw new ErroAuth(409, 'Já existem dados de teste. Remova-os antes de gerar novamente.');
  let nf = 0, nr = 0; let seq = 0;
  for (const [i, [nome, uf, regime]] of EMPRESAS.entries()) {
    const emp = await criarEmpresa(s, { cnpj: cnpjGerado(i + 1), razaoSocial: PREFIXO + nome, uf, regime });
    const cargos: string[] = [];
    for (const [k, [cn, cbo]] of CARGOS.entries()) cargos.push((await pessoal.cargos.criar(s, emp.id, { codigo: 'C' + String(k + 1).padStart(2, '0'), nome: cn, cbo })).id);
    const amb: string[] = [];
    for (const [k, an] of ['Fábrica / produção', 'Escritório'].entries()) amb.push((await pessoal.ambientes.criar(s, emp.id, { nome: an, tipo: k ? 'ESTABELECIMENTO_PROPRIO' : 'ESTABELECIMENTO_PROPRIO' })).id);
    for (let j = 0; j < 12; j++) {
      seq++; const k = (i + j) % CARGOS.length, nasc = 1965 + (seq * 7) % 38, adm = 2015 + (seq % 11);
      const f = await pessoal.criarFuncionario(s, emp.id, {
        matricula: String(1000 + seq), nome: `${NOMES[(seq * 3) % NOMES.length]} ${SOBR[seq % SOBR.length]} ${SOBR[(seq * 5 + 2) % SOBR.length]}`, cpf: cpfGerado(seq), pis_nis: seq % 11 === 0 ? undefined : pisGerado(seq),
        data_nascimento: `${nasc}-${String(1 + seq % 12).padStart(2, '0')}-${String(1 + (seq * 3) % 28).padStart(2, '0')}`, sexo: seq % 3 ? 'M' : 'F', estado_civil: ['SOLTEIRO', 'CASADO', 'UNIAO_ESTAVEL'][seq % 3], escolaridade: ['MEDIO', 'TECNICO', 'SUPERIOR'][seq % 3],
        telefone: `(11) 9${String(10000000 + seq * 12345).slice(0, 4)}-${String(1000 + seq * 7).slice(0, 4)}`, email: `teste${seq}@exemplo.invalid`, cidade: 'Cidade Exemplo', uf, cep: '01001000',
        data_admissao: seq % 9 === 0 ? somaDias(-80) : `${adm}-${String(1 + (seq * 5) % 12).padStart(2, '0')}-10`, cargo_id: cargos[k], ambiente_id: amb[k === 2 || k === 5 ? 1 : 0], funcao: CARGOS[k][0], setor: CARGOS[k][2], cbo: CARGOS[k][1],
        salario: 1800 + (seq % 9) * 350, jornada_semanal: 44, tipo_contrato: seq % 9 === 0 ? 'EXPERIENCIA' : 'CLT_INDETERMINADO', ctps: seq % 7 === 0 ? undefined : `CTPS ${100000 + seq}`, dependentes: seq % 4, pcd: seq % 17 === 0, observacoes: 'Dados fictícios para teste — pode excluir.' });
      nf++;
      // ASO para todos, com validades variadas (vencido / a vencer / em dia) e controle de férias, para exercitar o semáforo
      const desl = [-20, 12, 90, 300][seq % 4]; await registros.criar(s, { ferramenta: 'aso', empresa_id: emp.id, funcionario_id: f.id, titulo: 'ASO periódico (teste)', data_evento: somaDias(desl - 365), data_validade: somaDias(desl), status: 'ABERTO', dados: { tipo: 'PERIODICO', resultado: 'APTO' } }); nr++;
      if (seq % 5 !== 0) { const meses = [3, 8, 14, 20, 26][seq % 5]; await registros.criar(s, { ferramenta: 'ferias_dp', empresa_id: emp.id, funcionario_id: f.id, titulo: 'Férias (teste)', data_evento: somaDias(-Math.round(meses * 30.4)), data_validade: somaDias(-Math.round(meses * 30.4) + 29), status: 'CONCLUIDO', dados: { dias: 30 } }); nr++; }
    }
    if (i === 0) { // vaga e candidatos fictícios para testar a análise por IA no processo seletivo
      await registros.criar(s, { ferramenta: 'vaga', empresa_id: emp.id, titulo: 'Soldador (teste)', data_evento: somaDias(-5), data_validade: somaDias(25), status: 'ABERTO', dados: { cargo: 'Soldador', quantidade: 2, salario_min: 2800, salario_max: 3600, requisitos: 'Ensino médio; 2 anos de experiência com solda MIG/MAG; leitura de desenho técnico', nrs: 'NR-18, NR-34, NR-35', riscos: 'Fumos metálicos, ruído, radiação não ionizante, trabalho em altura', exames: 'Audiometria, espirometria, avaliação clínica' } }); nr++;
      const cs = [['Candidato Exemplo 1', 'TECNICO', 5, 'Soldador MIG/MAG em metalúrgica por 5 anos; leitura de desenho técnico.', 'NR-35 (válida), NR-10', 3200], ['Candidato Exemplo 2', 'MEDIO', 1, 'Auxiliar de produção; começou a aprender solda.', 'Nenhum curso de NR', 2500], ['Candidato Exemplo 3', 'MEDIO', 3, 'Soldador eletrodo revestido em obras.', 'NR-18, NR-35 vencida', 3000]] as const;
      for (const [k, c] of cs.entries()) { await registros.criar(s, { ferramenta: 'candidato', empresa_id: emp.id, titulo: c[0] + ' – Soldador', data_evento: somaDias(-k - 1), status: 'ABERTO', dados: { vaga: 'Soldador (teste)', etapa: 'TRIAGEM', formacao: c[1], exp_anos: c[2], experiencia: c[3], cursos: c[4], pretensao: c[5] } }); nr++; }
    }
  }
  return { empresas: EMPRESAS.length, funcionarios: nf, registros: nr };
}

export async function remover(s: Sessao) {
  if (s.papel !== 'ADMIN') throw new ErroAuth(403, 'Apenas administradores.');
  return dbDoTenant(s.tenantId, s.papel).transaction(async t => {
    const ids = (await t.query(`SELECT id FROM empresas WHERE razao_social LIKE $1`, [PREFIXO + '%'])).rows.map((r: any) => r.id); if (!ids.length) return { removidas: 0 };
    for (const tab of ['registros', 'colaboradores', 'cargos', 'ambientes_trabalho']) await t.query(`DELETE FROM ${tab} WHERE empresa_id = ANY($1::uuid[])`, [ids]);
    const n = (await t.query(`DELETE FROM empresas WHERE id = ANY($1::uuid[])`, [ids])).rowCount; return { removidas: n };
  });
}
