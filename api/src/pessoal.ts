// Cadastro de funcionários (colaboradores), cargos e ambientes de trabalho. Tudo por tenant (RLS). Leitura: qualquer papel; escrita: ADMIN/CONTADOR/AUXILIAR.
import { dbDoTenant, isUuid } from './db.ts';
import { ErroAuth, type Sessao } from './auth.ts';
import { cpfOk } from './ferramentas.ts';

type T = 'txt' | 'cpf' | 'pis' | 'date' | 'num' | 'int' | 'bool' | 'uf' | 'cep' | 'email' | 'uuid' | 'enum';
interface F { k: string; t: T; req?: boolean; max?: number; op?: string[]; min?: number; maxv?: number }
const CONTRATOS = ['CLT_INDETERMINADO', 'CLT_DETERMINADO', 'EXPERIENCIA', 'APRENDIZ', 'ESTAGIO', 'TEMPORARIO', 'INTERMITENTE', 'AUTONOMO', 'DIRIGENTE_SOCIO', 'OUTRO'];
export const CAMPOS_FUNC: F[] = [
  { k: 'matricula', t: 'txt', req: true, max: 30 }, { k: 'nome', t: 'txt', req: true, max: 150 }, { k: 'nome_social', t: 'txt', max: 150 }, { k: 'cpf', t: 'cpf', req: true },
  { k: 'data_nascimento', t: 'date' }, { k: 'sexo', t: 'enum', op: ['M', 'F', 'O'] }, { k: 'rg', t: 'txt', max: 30 }, { k: 'pis_nis', t: 'pis' }, { k: 'ctps', t: 'txt', max: 40 },
  { k: 'estado_civil', t: 'enum', op: ['SOLTEIRO', 'CASADO', 'UNIAO_ESTAVEL', 'SEPARADO', 'DIVORCIADO', 'VIUVO'] },
  { k: 'escolaridade', t: 'enum', op: ['FUNDAMENTAL_INCOMPLETO', 'FUNDAMENTAL', 'MEDIO_INCOMPLETO', 'MEDIO', 'TECNICO', 'SUPERIOR_INCOMPLETO', 'SUPERIOR', 'POS_GRADUACAO'] },
  { k: 'telefone', t: 'txt', max: 30 }, { k: 'email', t: 'email' }, { k: 'cep', t: 'cep' }, { k: 'logradouro', t: 'txt', max: 150 }, { k: 'numero', t: 'txt', max: 20 }, { k: 'complemento', t: 'txt', max: 80 },
  { k: 'bairro', t: 'txt', max: 80 }, { k: 'cidade', t: 'txt', max: 80 }, { k: 'uf', t: 'uf' },
  { k: 'data_admissao', t: 'date', req: true }, { k: 'data_demissao', t: 'date' }, { k: 'cargo_id', t: 'uuid' }, { k: 'ambiente_id', t: 'uuid' }, { k: 'funcao', t: 'txt', max: 100 }, { k: 'setor', t: 'txt', max: 100 },
  { k: 'cbo', t: 'txt', max: 6 }, { k: 'salario', t: 'num', min: 0, maxv: 1e9 }, { k: 'jornada_semanal', t: 'num', min: 0, maxv: 80 }, { k: 'tipo_contrato', t: 'enum', op: CONTRATOS },
  { k: 'categoria_esocial', t: 'txt', max: 3 }, { k: 'dependentes', t: 'int', min: 0, maxv: 30 }, { k: 'pcd', t: 'bool' }, { k: 'aprendiz', t: 'bool' },
  { k: 'contato_emergencia', t: 'txt', max: 200 }, { k: 'observacoes', t: 'txt', max: 2000 }, { k: 'ativo', t: 'bool' },
];
export const CAMPOS_CARGO: F[] = [{ k: 'codigo', t: 'txt', req: true, max: 30 }, { k: 'nome', t: 'txt', req: true, max: 120 }, { k: 'cbo', t: 'txt', max: 6 }, { k: 'descricao', t: 'txt', max: 2000 }, { k: 'ativo', t: 'bool' }];
export const CAMPOS_AMB: F[] = [{ k: 'nome', t: 'txt', req: true, max: 150 }, { k: 'tipo', t: 'enum', op: ['ESTABELECIMENTO_PROPRIO', 'TERCEIROS', 'OBRA', 'RURAL', 'OUTRO'] }, { k: 'descricao', t: 'txt', max: 2000 }, { k: 'ativo', t: 'bool' }];

const pisOk = (s: string) => { if (!/^\d{11}$/.test(s) || /^(\d)\1+$/.test(s)) return false; const w = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const sm = w.reduce((a, x, i) => a + x * +s[i], 0); const r = 11 - (sm % 11); return (r >= 10 ? 0 : r) === +s[10]; };
const dataOk = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const bad = (m: string) => new ErroAuth(422, m);

export function validar(campos: F[], b: any, parcial: boolean): Record<string, any> {
  const o: Record<string, any> = {};
  for (const f of campos) {
    let v = b?.[f.k]; const tem = v !== undefined;
    if (!tem) { if (f.req && !parcial) throw bad(`Campo obrigatório: ${f.k}.`); continue; }
    if (v === null || v === '') { if (f.req) throw bad(`Campo obrigatório: ${f.k}.`); o[f.k] = f.t === 'bool' ? false : f.t === 'int' && f.k === 'dependentes' ? 0 : null; continue; }
    switch (f.t) {
      case 'txt': v = String(v).trim(); if (v.length > (f.max ?? 200)) throw bad(`${f.k}: máximo ${f.max} caracteres.`); break;
      case 'cpf': v = String(v).replace(/\D/g, ''); if (!cpfOk(v)) throw bad('CPF inválido.'); break;
      case 'pis': v = String(v).replace(/\D/g, ''); if (!pisOk(v)) throw bad('PIS/NIS inválido.'); break;
      case 'date': v = String(v).slice(0, 10); if (!dataOk(v)) throw bad(`Data inválida em ${f.k}.`); break;
      case 'num': case 'int': v = Number(String(v).replace(',', '.')); if (!Number.isFinite(v) || (f.t === 'int' && !Number.isInteger(v)) || v < (f.min ?? -1e15) || v > (f.maxv ?? 1e15)) throw bad(`Valor inválido em ${f.k}.`); break;
      case 'bool': v = v === true || v === 'true' || v === '1' || v === 1; break;
      case 'uf': v = String(v).toUpperCase(); if (!/^[A-Z]{2}$/.test(v)) throw bad('UF inválida.'); break;
      case 'cep': v = String(v).replace(/\D/g, ''); if (!/^\d{8}$/.test(v)) throw bad('CEP inválido (8 dígitos).'); break;
      case 'email': v = String(v).trim().toLowerCase(); if (v.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) throw bad('E-mail inválido.'); break;
      case 'uuid': if (!isUuid(v)) throw bad(`Identificador inválido em ${f.k}.`); break;
      case 'enum': if (!f.op!.includes(v)) throw bad(`Valor inválido em ${f.k}.`); break;
    }
    o[f.k] = v;
  }
  if (o.data_nascimento && o.data_nascimento > new Date().toISOString().slice(0, 10)) throw bad('Nascimento no futuro.');
  if (o.data_nascimento && o.data_admissao && o.data_nascimento > o.data_admissao) throw bad('Nascimento posterior à admissão.');
  if (o.data_demissao && o.data_admissao && o.data_demissao < o.data_admissao) throw bad('Demissão anterior à admissão.');
  return o;
}
const podeEscrever = (s: Sessao) => { if (s.papel === 'CLIENTE_LEITURA') throw new ErroAuth(403, 'Perfil somente leitura.'); };
const tx = <R>(s: Sessao, fn: (t: any) => Promise<R>) => dbDoTenant(s.tenantId, s.papel).transaction(fn);
const chk = (id: string) => { if (!isUuid(id)) throw new ErroAuth(400, 'id inválido'); };
const dup = (e: any, m: string) => { if (e?.code === '23505') throw new ErroAuth(409, m); if (e?.code === '23503') throw new ErroAuth(409, 'Registro em uso: inative em vez de excluir.'); throw e; };

async function inserir(t: any, tabela: string, s: Sessao, empresa: string, o: Record<string, any>) {
  const ks = Object.keys(o);
  return (await t.query(`INSERT INTO ${tabela} (tenant_id, empresa_id${ks.map(k => ',' + k).join('')}) VALUES ($1,$2${ks.map((_, i) => `,$${i + 3}`).join('')}) RETURNING id`, [s.tenantId, empresa, ...ks.map(k => o[k])])).rows[0];
}
async function atualizar(t: any, tabela: string, id: string, o: Record<string, any>, extra = '') {
  const ks = Object.keys(o); if (!ks.length) return;
  const r = await t.query(`UPDATE ${tabela} SET ${ks.map((k, i) => `${k}=$${i + 2}`).join(',')}${extra} WHERE id=$1`, [id, ...ks.map(k => o[k])]);
  if (!r.rowCount) throw new ErroAuth(404, 'Registro não encontrado.');
}
async function empresaOk(t: any, id: string) { chk(id); if (!(await t.query('SELECT 1 FROM empresas WHERE id=$1', [id])).rowCount) throw new ErroAuth(404, 'Empresa não encontrada.'); }
async function refOk(t: any, o: Record<string, any>, empresa: string) {
  if (o.cargo_id && !(await t.query('SELECT 1 FROM cargos WHERE id=$1 AND empresa_id=$2', [o.cargo_id, empresa])).rowCount) throw bad('Cargo não pertence à empresa.');
  if (o.ambiente_id && !(await t.query('SELECT 1 FROM ambientes_trabalho WHERE id=$1 AND empresa_id=$2', [o.ambiente_id, empresa])).rowCount) throw bad('Ambiente não pertence à empresa.');
}

const SEL_FUNC = `SELECT c.*, (c.cpf) AS cpf, ca.nome AS cargo_nome, am.nome AS ambiente_nome,
  CASE WHEN c.data_nascimento IS NULL THEN NULL ELSE date_part('year', age(COALESCE(c.data_demissao, current_date), c.data_nascimento))::int END AS idade,
  date_part('year', age(COALESCE(c.data_demissao, current_date), c.data_admissao))::int AS anos_casa
  FROM colaboradores c LEFT JOIN cargos ca ON ca.id=c.cargo_id LEFT JOIN ambientes_trabalho am ON am.id=c.ambiente_id`;
export const listarFuncionarios = (s: Sessao, empresa: string, busca?: string, so_ativos = false) => tx(s, async t => { await empresaOk(t, empresa);
  return (await t.query(`${SEL_FUNC} WHERE c.empresa_id=$1 AND ($2::text IS NULL OR c.nome ILIKE $2 OR c.matricula ILIKE $2 OR c.cpf LIKE $3 OR COALESCE(c.funcao,'') ILIKE $2 OR COALESCE(c.setor,'') ILIKE $2)
    AND (NOT $4 OR (c.ativo AND c.data_demissao IS NULL)) ORDER BY lower(c.nome) LIMIT 2000`, [empresa, busca ? `%${busca}%` : null, busca ? `${busca.replace(/\D/g, '')}%` : null, so_ativos])).rows; });
export const obterFuncionario = (s: Sessao, id: string) => tx(s, async t => { chk(id); const r = (await t.query(`${SEL_FUNC} WHERE c.id=$1`, [id])).rows[0]; if (!r) throw new ErroAuth(404, 'Funcionário não encontrado.'); return r; });
export async function criarFuncionario(s: Sessao, empresa: string, b: any) {
  podeEscrever(s); const o = validar(CAMPOS_FUNC, b, false);
  try { return await tx(s, async t => { await empresaOk(t, empresa); await refOk(t, o, empresa); return inserir(t, 'colaboradores', s, empresa, o); }); } catch (e: any) { return dup(e, 'Matrícula ou CPF já cadastrado nesta empresa.'); }
}
export async function editarFuncionario(s: Sessao, id: string, b: any) {
  podeEscrever(s); chk(id); const o = validar(CAMPOS_FUNC, b, true);
  try { await tx(s, async t => { const e = (await t.query('SELECT empresa_id FROM colaboradores WHERE id=$1', [id])).rows[0]; if (!e) throw new ErroAuth(404, 'Funcionário não encontrado.'); await refOk(t, o, e.empresa_id); await atualizar(t, 'colaboradores', id, o, ', atualizado_em=now()'); }); return { ok: true }; }
  catch (e: any) { return dup(e, 'Matrícula ou CPF já cadastrado nesta empresa.'); }
}
export async function excluirFuncionario(s: Sessao, id: string) {
  podeEscrever(s); if (s.papel !== 'ADMIN') throw new ErroAuth(403, 'Apenas administradores excluem funcionários (use "inativar").'); chk(id);
  try { await tx(s, async t => { if (!(await t.query('DELETE FROM colaboradores WHERE id=$1', [id])).rowCount) throw new ErroAuth(404, 'Funcionário não encontrado.'); }); return { ok: true }; } catch (e: any) { return dup(e, ''); }
}
// cargos e ambientes
const CRUD = (tabela: string, campos: F[], ordem: string, msgDup: string) => ({
  listar: (s: Sessao, empresa: string) => tx(s, async t => { await empresaOk(t, empresa); return (await t.query(`SELECT * FROM ${tabela} WHERE empresa_id=$1 ORDER BY ${ordem}`, [empresa])).rows; }),
  criar: async (s: Sessao, empresa: string, b: any) => { podeEscrever(s); const o = validar(campos, b, false); try { return await tx(s, async t => { await empresaOk(t, empresa); return inserir(t, tabela, s, empresa, o); }); } catch (e: any) { return dup(e, msgDup); } },
  editar: async (s: Sessao, id: string, b: any) => { podeEscrever(s); chk(id); const o = validar(campos, b, true); try { await tx(s, t => atualizar(t, tabela, id, o)); return { ok: true }; } catch (e: any) { return dup(e, msgDup); } },
  excluir: async (s: Sessao, id: string) => { podeEscrever(s); chk(id); try { await tx(s, async t => { if (!(await t.query(`DELETE FROM ${tabela} WHERE id=$1`, [id])).rowCount) throw new ErroAuth(404, 'Registro não encontrado.'); }); return { ok: true }; } catch (e: any) { return dup(e, ''); } },
});
export const cargos = CRUD('cargos', CAMPOS_CARGO, 'lower(nome)', 'Já existe um cargo com esse código nesta empresa.');
export const ambientes = CRUD('ambientes_trabalho', CAMPOS_AMB, 'lower(nome)', 'Ambiente duplicado.');
