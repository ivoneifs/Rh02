// Serviço de lançamentos — uma ÚNICA transação ACID: tenant → validação → cabeçalho → partidas → outbox.
// Três camadas de defesa para ΣD = ΣC:  (1) validarLancamento (feedback amigável),
// (2) constraint trigger deferido no PostgreSQL (barreira final), (3) transação atômica.
import { validarLancamento, type LancamentoInput, type ContaInfo } from './validar.ts';

/** Contrato mínimo do cliente de banco (compatível com node-postgres PoolClient). */
export interface Tx { query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> }
export interface Db { transaction<R>(fn: (tx: Tx) => Promise<R>): Promise<R> }

export class ErroDeNegocio extends Error {
  codigo: string; detalhes: string[];
  constructor(codigo: string, detalhes: string[]) { super(detalhes.join(' | ')); this.codigo = codigo; this.detalhes = detalhes; }
}

export async function criarLancamento(
  db: Db, tenantId: string, usuarioId: string, input: LancamentoInput & { origemEventoId?: string; origem?: string },
) {
  return db.transaction(async (tx) => {
    // RLS: toda a transação enxerga só o tenant corrente (SET LOCAL morre no COMMIT/ROLLBACK).
    await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

    // Idempotência: evento de integração já contabilizado devolve o lançamento existente.
    if (input.origemEventoId) {
      const ex = await tx.query(`SELECT id FROM lancamentos_contabeis WHERE empresa_id=$1 AND origem_evento_id=$2`,
        [input.empresaId, input.origemEventoId]);
      if (ex.rows[0]) return { id: ex.rows[0].id as string, duplicado: true };
    }

    const ids = [...new Set(input.partidas.map(p => p.contaId))];
    const { rows } = await tx.query<{ id: string; tipo: 'S'|'A'; ativa: boolean; aceita_cc: boolean }>(
      `SELECT id, tipo, ativa, aceita_cc FROM plano_contas WHERE empresa_id=$1 AND id = ANY($2::uuid[])`, [input.empresaId, ids]);
    const contas = new Map<string, ContaInfo>(rows.map(r => [r.id, { id: r.id, tipo: r.tipo, ativa: r.ativa, aceitaCC: r.aceita_cc }]));

    const v = validarLancamento(input, contas);
    if (!v.ok) throw new ErroDeNegocio('LANCAMENTO_INVALIDO', v.erros);

    const l = await tx.query(
      `INSERT INTO lancamentos_contabeis (tenant_id, empresa_id, data, documento, origem, origem_evento_id, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, numero`,
      [tenantId, input.empresaId, input.data, input.documento ?? null, input.origem ?? 'MANUAL', input.origemEventoId ?? null, usuarioId]);
    const { id, numero } = l.rows[0];

    // Insert multi-linha único (uma ida ao banco, independe de N partidas).
    const vals: unknown[] = []; const tuples = input.partidas.map((p, i) => {
      vals.push(tenantId, input.empresaId, id, input.data, p.contaId, p.dc, p.valor, p.centroCustoId ?? null, p.historico ?? null);
      const o = i * 9; return `($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6},$${o+7},$${o+8},$${o+9})`;
    });
    await tx.query(`INSERT INTO partidas (tenant_id,empresa_id,lancamento_id,data,conta_id,dc,valor,centro_custo_id,historico) VALUES ${tuples.join(',')}`, vals);

    // Outbox transacional: o worker de saldos/balancete só vê o evento se o lançamento commitou.
    await tx.query(`SELECT pg_notify('lancamento_gravado', $1)`, [JSON.stringify({ id, empresaId: input.empresaId, data: input.data })]);
    return { id: id as string, numero: Number(numero), formato: v.formato, duplicado: false };
  }); // COMMIT → constraint trigger deferido valida ΣD=ΣC no banco; falha aqui desfaz tudo.
}
