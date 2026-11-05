// Atualização automática do cadastro do funcionário a partir de registros CONCLUÍDOS de certas ferramentas
// (mudança de cargo/salário, transferência definitiva, contrato, retorno com nova função, desligamento).
// Os campos alterados voltam na resposta para o usuário ver o que mudou; nada é alterado sem um registro concluído.
const CONTRATO: Record<string, string> = { EXPERIENCIA: 'EXPERIENCIA', DETERMINADO: 'CLT_DETERMINADO', INDETERMINADO: 'CLT_INDETERMINADO', INTERMITENTE: 'INTERMITENTE', APRENDIZ: 'APRENDIZ', ESTAGIO: 'ESTAGIO' };
const txt = (v: unknown, n = 100) => { const s = String(v ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, n); return s || undefined; };
const num = (v: unknown) => { const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && n > 0 && n < 1e9 ? n : undefined; };
const dataOk = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s ? s : undefined;

/** Puro: quais colunas de `colaboradores` mudam (e rótulos para mostrar ao usuário). */
export function camposDoCadastro(ferramenta: string, d: any, dataEvento?: string | null): { cols: Record<string, any>; rotulos: string[]; cargoNome?: string } {
  const cols: Record<string, any> = {}, rotulos: string[] = []; let cargoNome: string | undefined;
  const set = (col: string, v: unknown, rot: string) => { if (v !== undefined) { cols[col] = v; rotulos.push(rot); } };
  d = d ?? {};
  if (ferramenta === 'mudanca_cargo') { set('salario', num(d.sal_novo), 'salário'); const c = txt(d.cargo_novo); if (c) { set('funcao', c, 'função'); cargoNome = c; } }
  else if (ferramenta === 'transferencia_ds') { if (d.definitiva) set('setor', txt(d.destino), 'setor'); }
  else if (ferramenta === 'contrato_trab') { const t = CONTRATO[String(d.tipo)]; set('tipo_contrato', t, 'tipo de contrato'); if (d.tipo === 'APRENDIZ') set('aprendiz', true, 'aprendiz'); }
  else if (ferramenta === 'retorno') set('funcao', txt(d.nova_funcao), 'função');
  else if (ferramenta === 'deslig_chk') set('data_demissao', dataOk(dataEvento), 'data de demissão');
  return { cols, rotulos, cargoNome };
}

/** Aplica no banco (dentro da transação do registro). Devolve os rótulos alterados. */
export async function aplicarAoCadastro(t: any, reg: { ferramenta: string; status: string; funcionario_id: string | null; dados: any; data_evento: string | null }): Promise<string[]> {
  if (reg.status !== 'CONCLUIDO' || !reg.funcionario_id) return [];
  const { cols, rotulos, cargoNome } = camposDoCadastro(reg.ferramenta, reg.dados, reg.data_evento);
  if (cargoNome) { const c = (await t.query(`SELECT id FROM cargos WHERE empresa_id=(SELECT empresa_id FROM colaboradores WHERE id=$1) AND lower(nome)=lower($2) LIMIT 1`, [reg.funcionario_id, cargoNome])).rows[0]; if (c) { cols.cargo_id = c.id; rotulos.push('cargo'); } }
  const ks = Object.keys(cols); if (!ks.length) return [];
  await t.query(`UPDATE colaboradores SET ${ks.map((k, i) => `${k}=$${i + 2}`).join(',')}, atualizado_em=now() WHERE id=$1`, [reg.funcionario_id, ...ks.map(k => cols[k])]);
  return rotulos;
}
