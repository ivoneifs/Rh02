// Checklist de treinamentos da integração de novos funcionários, conforme a função (perfis editáveis em Normas › TREINAMENTOS_FUNCAO).
// É uma sugestão baseada na função; a exigência real decorre do inventário de riscos (PGR/GRO) e do PCMSO da empresa.
import { dbDoTenant, isUuid } from './db.ts';
import { ErroAuth, type Sessao } from './auth.ts';
import * as pessoal from './pessoal.ts';
import { vigentes } from './normas.ts';

export const norm = (t: unknown) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const compacto = (t: unknown) => norm(t).replace(/ /g, '');
export type Situacao = 'OK' | 'PENDENTE' | 'AGENDADO' | 'VENCIDO';
export interface Item { cod: string; nome: string; horas: number | null; reciclagem_meses: number | null; situacao: Situacao; registro_id?: string; validade?: string | null; motivo?: string }
interface RegT { id: string; ferramenta: string; status: string; curso: string; validade: string | null }

/** Define os itens exigidos pela função (puro, testável). */
export function exigidos(texto: string, cfg: any, catalogo: Record<string, any>): { perfis: string[]; itens: { cod: string; nome: string; horas: number | null; reciclagem_meses: number | null; chaves: string[] }[] } {
  const t = ' ' + norm(texto) + ' ', perfis: string[] = [], vistos = new Set<string>(), itens: any[] = [];
  const cat = { ...(cfg?.extras ?? {}), ...catalogo };
  const add = (cod: string, nome: string, horas: any, rec: any, chaves: string[]) => { if (vistos.has(cod)) return; vistos.add(cod); itens.push({ cod, nome, horas: horas ?? null, reciclagem_meses: rec ?? null, chaves }); };
  for (const b of cfg?.base ?? []) add(b.cod, b.nome, null, null, (b.chaves ?? []).map(norm));
  for (const p of cfg?.perfis ?? []) if ((p.palavras ?? []).some((w: string) => w && t.includes(norm(w)))) { perfis.push(p.perfil);
    for (const cod of p.treinamentos ?? []) { const c = cat[cod]; if (c) add(cod, c.nome, c.horas, c.reciclagem_meses, [compacto(cod), compacto(String(c.nome).split(' ')[0])]); } }
  return { perfis, itens };
}
const cobre = (reg: RegT, chaves: string[], cod: string) => { const c = compacto(reg.curso), n = norm(reg.curso); return compacto(cod) !== '' && c.includes(compacto(cod)) || chaves.some(k => k && (n.includes(k) || c.includes(k.replace(/ /g, '')))); };

export function situacoes(itens: ReturnType<typeof exigidos>['itens'], regs: RegT[], hoje: string): Item[] {
  return itens.map(i => {
    const r = regs.filter(x => x.status !== 'CANCELADO' && (cobre(x, i.chaves, i.cod) || (i.cod === 'INTEGRACAO' && x.ferramenta === 'integracao') || (i.cod === 'EPI' && x.ferramenta === 'epi_entrega')));
    const feito = r.filter(x => x.status === 'CONCLUIDO'), ok = feito.find(x => !x.validade || x.validade >= hoje), aberto = r.find(x => x.status === 'ABERTO');
    const base = { cod: i.cod, nome: i.nome, horas: i.horas, reciclagem_meses: i.reciclagem_meses };
    if (ok) return { ...base, situacao: 'OK' as Situacao, registro_id: ok.id, validade: ok.validade };
    if (aberto) return { ...base, situacao: 'AGENDADO' as Situacao, registro_id: aberto.id, validade: aberto.validade, motivo: 'Treinamento em aberto no quadro Registros' };
    if (feito.length) return { ...base, situacao: 'VENCIDO' as Situacao, registro_id: feito[0].id, validade: feito[0].validade, motivo: 'Reciclagem vencida' };
    return { ...base, situacao: 'PENDENTE' as Situacao, motivo: 'Sem registro de treinamento' };
  });
}

async function dados(s: Sessao, id: string) {
  if (!isUuid(id)) throw new ErroAuth(400, 'id inválido');
  const f: any = await pessoal.obterFuncionario(s, id);
  const P = await vigentes(s);
  const regs: RegT[] = await dbDoTenant(s.tenantId, s.papel).transaction(async t => (await t.query(`SELECT id, ferramenta, status, COALESCE(dados->>'curso','') AS curso, to_char(data_validade,'YYYY-MM-DD') AS validade FROM registros WHERE funcionario_id=$1 AND ferramenta IN ('treinamento','integracao','epi_entrega')`, [id])).rows);
  const ex = exigidos([f.cargo_nome, f.funcao, f.setor].filter(Boolean).join(' '), P.TREINAMENTOS_FUNCAO, P.TREINAMENTOS_NR ?? {});
  const itens = situacoes(ex.itens, regs, new Date().toISOString().slice(0, 10));
  return { f, perfis: ex.perfis, itens };
}

export async function checklist(s: Sessao, id: string) {
  const { f, perfis, itens } = await dados(s, id);
  const c = (x: Situacao) => itens.filter(i => i.situacao === x).length;
  return { funcionario: { id: f.id, nome: f.nome, matricula: f.matricula, cargo: f.cargo_nome ?? null, funcao: f.funcao ?? null, setor: f.setor ?? null, data_admissao: f.data_admissao },
    perfis, itens, resumo: { total: itens.length, ok: c('OK'), agendados: c('AGENDADO'), pendentes: c('PENDENTE'), vencidos: c('VENCIDO') },
    aviso: 'Sugestão pela função (editável em Administração › Normas e tabelas › TREINAMENTOS_FUNCAO). Confirme com o PGR/PCMSO e a norma aplicável.' };
}

/** Cria, no quadro Registros, uma pendência de treinamento (ABERTO) para cada item pendente/vencido. Idempotente. */
export async function gerarPendencias(s: Sessao, id: string, prazoDias = 15) {
  if (s.papel === 'CLIENTE_LEITURA') throw new ErroAuth(403, 'Perfil somente leitura.');
  const pz = Number(prazoDias); if (!Number.isInteger(pz) || pz < 1 || pz > 180) throw new ErroAuth(422, 'prazo_dias deve ser de 1 a 180.');
  const { f, itens } = await dados(s, id);
  const falta = itens.filter(i => i.situacao === 'PENDENTE' || i.situacao === 'VENCIDO'); if (!falta.length) return { criados: 0 };
  const hoje = new Date(), prazo = new Date(+hoje + pz * 864e5).toISOString().slice(0, 10), h = hoje.toISOString().slice(0, 10);
  return dbDoTenant(s.tenantId, s.papel).transaction(async t => { let n = 0;
    for (const i of falta) {
      const dados_ = { curso: i.nome, carga: i.horas ?? undefined, tipo: i.situacao === 'VENCIDO' ? 'periodico' : 'inicial', reciclagem: i.reciclagem_meses ?? undefined, origem: 'checklist de integração' };
      await t.query(`INSERT INTO registros (tenant_id, criado_por, ferramenta, empresa_id, funcionario_id, titulo, data_evento, data_validade, status, dados) VALUES ($1,$2,'treinamento',$3,$4,$5,$6,$7,'ABERTO',$8::jsonb)`,
        [s.tenantId, s.usuarioId, f.empresa_id, id, `Integração: ${i.nome} – ${f.nome}`.slice(0, 200), h, prazo, JSON.stringify(dados_)]); n++; }
    return { criados: n, prazo }; });
}
