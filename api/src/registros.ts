// Registros das ferramentas (SST, folha...): cada linha é um item guardado no banco, opcionalmente ligado a um funcionário, com datas e validade.
import { dbDoTenant, isUuid } from './db.ts';
import { ErroAuth, type Sessao } from './auth.ts';
import { TODAS as FERRAMENTAS } from './catalogo.ts';

const dataOk = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const tx = <R>(s: Sessao, fn: (t: any) => Promise<R>) => dbDoTenant(s.tenantId, s.papel).transaction(fn);
const w = (s: Sessao) => { if (s.papel === 'CLIENTE_LEITURA') throw new ErroAuth(403, 'Perfil somente leitura.'); };
const chk = (id: string) => { if (!isUuid(id)) throw new ErroAuth(400, 'id inválido'); };
const bad = (m: string) => new ErroAuth(422, m);

function validar(b: any, parcial: boolean) {
  const o: Record<string, any> = {};
  if (!parcial || b.ferramenta !== undefined) { if (!FERRAMENTAS.some(f => f.id === b?.ferramenta)) throw bad('Ferramenta inválida.'); o.ferramenta = b.ferramenta; }
  if (b.empresa_id !== undefined) { if (b.empresa_id && !isUuid(b.empresa_id)) throw bad('Empresa inválida.'); o.empresa_id = b.empresa_id || null; }
  if (b.funcionario_id !== undefined) { if (b.funcionario_id && !isUuid(b.funcionario_id)) throw bad('Funcionário inválido.'); o.funcionario_id = b.funcionario_id || null; }
  if (b.titulo !== undefined) o.titulo = b.titulo ? String(b.titulo).slice(0, 200) : null;
  for (const k of ['data_evento', 'data_validade']) if (b[k] !== undefined) { if (b[k] && !dataOk(b[k])) throw bad(`Data inválida em ${k}.`); o[k] = b[k] || null; }
  if (b.status !== undefined) { if (!['ABERTO', 'CONCLUIDO', 'CANCELADO'].includes(b.status)) throw bad('Status inválido.'); o.status = b.status; }
  if (b.dados !== undefined) { if (b.dados === null || typeof b.dados !== 'object' || JSON.stringify(b.dados).length > 200_000) throw bad('Dados inválidos (objeto até 200 KB).'); o.dados = JSON.stringify(b.dados); }
  if (o.data_evento && o.data_validade && o.data_validade < o.data_evento) throw bad('Validade anterior à data do evento.');
  return o;
}
async function vinculos(t: any, o: Record<string, any>) {
  if (o.funcionario_id) { const r = (await t.query('SELECT empresa_id FROM colaboradores WHERE id=$1', [o.funcionario_id])).rows[0]; if (!r) throw bad('Funcionário não encontrado.'); if (o.empresa_id && o.empresa_id !== r.empresa_id) throw bad('Funcionário de outra empresa.'); o.empresa_id = r.empresa_id; }
  else if (o.empresa_id && !(await t.query('SELECT 1 FROM empresas WHERE id=$1', [o.empresa_id])).rowCount) throw bad('Empresa não encontrada.');
}
const SEL = `SELECT r.*, c.nome AS funcionario_nome, c.matricula AS funcionario_matricula, (r.data_validade IS NOT NULL AND r.data_validade < current_date AND r.status='ABERTO') AS vencido,
  CASE WHEN r.data_validade IS NULL THEN NULL ELSE (r.data_validade - current_date) END AS dias_para_vencer
  FROM registros r LEFT JOIN colaboradores c ON c.id=r.funcionario_id`;
export interface Filtro { ferramenta?: string; empresa?: string; funcionario?: string; status?: string; vencendoEm?: number }
export const listar = (s: Sessao, f: Filtro) => tx(s, async t => (await t.query(`${SEL} WHERE ($1::text IS NULL OR r.ferramenta=$1) AND ($2::uuid IS NULL OR r.empresa_id=$2) AND ($3::uuid IS NULL OR r.funcionario_id=$3)
  AND ($4::text IS NULL OR r.status=$4) AND ($5::int IS NULL OR (r.data_validade IS NOT NULL AND r.status='ABERTO' AND r.data_validade <= current_date + $5::int))
  ORDER BY COALESCE(r.data_validade, r.data_evento, r.criado_em::date) DESC, r.criado_em DESC LIMIT 1000`,
  [f.ferramenta ?? null, f.empresa && isUuid(f.empresa) ? f.empresa : null, f.funcionario && isUuid(f.funcionario) ? f.funcionario : null, f.status ?? null, f.vencendoEm ?? null])).rows);
export async function criar(s: Sessao, b: any) { w(s); const o = validar(b ?? {}, false);
  if (o.dados) { const d = JSON.parse(o.dados); d._por = s.nome; o.dados = JSON.stringify(d); } // quem criou (usuário logado)
  return tx(s, async t => { await vinculos(t, o); const ks = Object.keys(o);
    return (await t.query(`INSERT INTO registros (tenant_id, criado_por${ks.map(k => ',' + k).join('')}) VALUES ($1,$2${ks.map((_, i) => `,$${i + 3}`).join('')}) RETURNING id`, [s.tenantId, s.usuarioId, ...ks.map(k => o[k])])).rows[0]; }); }
export async function editar(s: Sessao, id: string, b: any) { w(s); chk(id); const o = validar(b ?? {}, true); delete o.ferramenta;
  return tx(s, async t => { await vinculos(t, o); if (o.dados) { const d = JSON.parse(o.dados), ant = (await t.query("SELECT dados->>'_por' AS por FROM registros WHERE id=$1", [id])).rows[0]?.por; if (ant) d._por = ant; d._editado_por = s.nome; o.dados = JSON.stringify(d); } const ks = Object.keys(o); if (!ks.length) return { ok: true };
    if (!(await t.query(`UPDATE registros SET ${ks.map((k, i) => `${k}=$${i + 2}${k === 'dados' ? '::jsonb' : ''}`).join(',')}, atualizado_em=now() WHERE id=$1`, [id, ...ks.map(k => o[k])])).rowCount) throw new ErroAuth(404, 'Registro não encontrado.'); return { ok: true }; }); }
export async function excluir(s: Sessao, id: string) { w(s); chk(id);
  return tx(s, async t => { if (!(await t.query('DELETE FROM registros WHERE id=$1', [id])).rowCount) throw new ErroAuth(404, 'Registro não encontrado.'); return { ok: true }; }); }
/** Painel de vencimentos: itens ABERTOS vencidos ou que vencem nos próximos N dias, de todas as ferramentas. */
export const vencimentos = (s: Sessao, dias: number, empresa?: string) => listar(s, { status: 'ABERTO', vencendoEm: Math.max(0, Math.min(365, dias)), empresa });
