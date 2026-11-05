// Pasta do funcionário: upload, checklist, análise por IA, resumo da empresa e download em ZIP.
import { crc32 } from 'node:zlib';
import { dbDoTenant, isUuid } from './db.ts';
import { decifrar } from './crypto.ts';
import { ErroAuth, type Sessao } from './auth.ts';
import { executarAgente, ErroLLM } from './agente.ts';
import * as pessoal from './pessoal.ts';
import { vigentes } from './normas.ts';
import { exigidos } from './integracao.ts';
import { slotsNecessarios, montarChecklist, mimePorBytes, veredito, PROMPT_EXTRACAO, TIPOS_AVULSOS, situacaoDoc, type Slot } from './docs-func.ts';

export const MAX_BYTES = 6_000_000, MAX_POR_FUNC = 60;
const tx = <R>(s: Sessao, fn: (t: any) => Promise<R>) => dbDoTenant(s.tenantId, s.papel).transaction(fn);
const w = (s: Sessao) => { if (s.papel === 'CLIENTE_LEITURA') throw new ErroAuth(403, 'Perfil somente leitura.'); };
const hojeIso = () => new Date().toISOString().slice(0, 10);
const limpa = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f<>"\\/]/g, '').trim().slice(0, n);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dataOuNull = (v: unknown, campo: string) => { if (v == null || v === '') return null; const s = String(v); if (!ISO.test(s) || isNaN(Date.parse(s))) throw new ErroAuth(422, `${campo} inválida (use AAAA-MM-DD).`); return s; };
const tipoOk = (v: unknown) => { const t = String(v ?? '').toUpperCase(); if (!/^[A-Z0-9_:\-]{2,40}$/.test(t)) throw new ErroAuth(422, 'Tipo de documento inválido.'); return t; };
const COLS = `id, funcionario_id, empresa_id, tipo, lado, titulo, nome_arquivo, mime, tamanho, to_char(data_emissao,'YYYY-MM-DD') AS data_emissao, to_char(data_validade,'YYYY-MM-DD') AS data_validade, analise, analisado_em, status, obs, criado_em`;

async function contexto(s: Sessao, funcId: string) {
  if (!isUuid(funcId)) throw new ErroAuth(400, 'id inválido');
  const f: any = await pessoal.obterFuncionario(s, funcId), P = await vigentes(s);
  const ex = exigidos([f.cargo_nome, f.funcao, f.setor].filter(Boolean).join(' '), P.TREINAMENTOS_FUNCAO, P.TREINAMENTOS_NR ?? {});
  const slots = slotsNecessarios({ sexo: f.sexo, dependentes: f.dependentes, funcao: f.funcao, cargo: f.cargo_nome, setor: f.setor, tipo_contrato: f.tipo_contrato }, ex.itens);
  return { f, slots };
}
export async function checklist(s: Sessao, funcId: string) {
  const { f, slots } = await contexto(s, funcId);
  const docs = await tx(s, async t => (await t.query(`SELECT ${COLS} FROM docs_func WHERE funcionario_id=$1 ORDER BY criado_em DESC`, [funcId])).rows);
  const c = montarChecklist(slots, docs, hojeIso());
  return { funcionario: { id: f.id, nome: f.nome, matricula: f.matricula, whatsapp: f.whatsapp ?? null, telefone: f.telefone ?? null, funcao: f.funcao ?? null }, ...c, tipos_avulsos: TIPOS_AVULSOS, max_mb: MAX_BYTES / 1e6,
    aviso: 'Lista de documentos sugerida pelo perfil do colaborador. Prazos vêm do próprio documento (ou da periodicidade cadastrada); confirme exigências com PCMSO/PGR e a legislação – a conferir.' };
}
export async function enviar(s: Sessao, funcId: string, b: any) {
  w(s); const { f } = await contexto(s, funcId);
  if (typeof b?.base64 !== 'string' || !/^[A-Za-z0-9+/=\s]+$/.test(b.base64)) throw new ErroAuth(422, 'Arquivo inválido.');
  const buf = Buffer.from(b.base64, 'base64'); if (!buf.length) throw new ErroAuth(422, 'Arquivo vazio.');
  if (buf.length > MAX_BYTES) throw new ErroAuth(413, `Arquivo acima de ${MAX_BYTES / 1e6} MB.`);
  const mime = mimePorBytes(buf); if (!mime) throw new ErroAuth(415, 'Envie PDF, JPEG, PNG ou WEBP.');
  const lado = b.lado == null || b.lado === '' ? 'UNICO' : String(b.lado).toUpperCase(); if (!['UNICO', 'FRENTE', 'VERSO'].includes(lado)) throw new ErroAuth(422, 'Lado inválido (UNICO, FRENTE ou VERSO).');
  const tipo = tipoOk(b.tipo), em = dataOuNull(b.data_emissao, 'Emissão'), va = dataOuNull(b.data_validade, 'Validade');
  return tx(s, async t => {
    const n = (await t.query('SELECT count(*)::int AS n FROM docs_func WHERE funcionario_id=$1', [funcId])).rows[0].n;
    if (n >= MAX_POR_FUNC) throw new ErroAuth(422, `Limite de ${MAX_POR_FUNC} arquivos por colaborador.`);
    return (await t.query(`INSERT INTO docs_func (tenant_id, empresa_id, funcionario_id, tipo, titulo, nome_arquivo, mime, tamanho, dados, data_emissao, data_validade, criado_por, lado) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING ${COLS}`,
      [s.tenantId, f.empresa_id, funcId, tipo, limpa(b.titulo, 150) || null, limpa(b.nome, 150) || 'documento', mime, buf.length, buf, em, va, s.usuarioId, lado])).rows[0];
  });
}
export async function obter(s: Sessao, id: string) {
  if (!isUuid(id)) throw new ErroAuth(400, 'id inválido');
  const r = await tx(s, async t => (await t.query('SELECT mime, dados, nome_arquivo FROM docs_func WHERE id=$1', [id])).rows[0]);
  if (!r) throw new ErroAuth(404, 'Documento não encontrado.'); return r as { mime: string; dados: Buffer; nome_arquivo: string };
}
export async function editar(s: Sessao, id: string, b: any) {
  w(s); if (!isUuid(id)) throw new ErroAuth(400, 'id inválido'); const set: string[] = [], v: any[] = [id];
  const add = (c: string, x: unknown) => { v.push(x); set.push(`${c}=$${v.length}`); };
  if ('tipo' in (b ?? {})) add('tipo', tipoOk(b.tipo)); if ('titulo' in b) add('titulo', limpa(b.titulo, 150) || null);
  if ('data_emissao' in b) add('data_emissao', dataOuNull(b.data_emissao, 'Emissão')); if ('data_validade' in b) add('data_validade', dataOuNull(b.data_validade, 'Validade'));
  if ('obs' in b) add('obs', limpa(b.obs, 500) || null);
  if ('status' in b) { if (!['ENVIADO', 'CONFERIDO', 'REJEITADO'].includes(b.status)) throw new ErroAuth(422, 'Status inválido.'); add('status', b.status); }
  if (!set.length) throw new ErroAuth(422, 'Nada para alterar.');
  return tx(s, async t => { const r = await t.query(`UPDATE docs_func SET ${set.join(',')} WHERE id=$1 RETURNING ${COLS}`, v); if (!r.rowCount) throw new ErroAuth(404, 'Documento não encontrado.'); return r.rows[0]; });
}
export async function excluir(s: Sessao, id: string) {
  w(s); if (!isUuid(id)) throw new ErroAuth(400, 'id inválido');
  await tx(s, async t => { if (!(await t.query('DELETE FROM docs_func WHERE id=$1', [id])).rowCount) throw new ErroAuth(404, 'Documento não encontrado.'); }); return { ok: true };
}

/** A IA só extrai os dados do arquivo; prazo, nome e coerência são conferidos pelo servidor (docs-func.veredito). */
export async function analisar(s: Sessao, id: string, ia: typeof executarAgente = executarAgente) {
  w(s); if (!isUuid(id)) throw new ErroAuth(400, 'id inválido');
  const d = await tx(s, async t => (await t.query(`SELECT ${COLS}, dados FROM docs_func WHERE id=$1`, [id])).rows[0]); if (!d) throw new ErroAuth(404, 'Documento não encontrado.');
  const { f, slots } = await contexto(s, d.funcionario_id); const slot: Slot | undefined = slots.find(x => x.tipo === d.tipo);
  const cfg = await tx(s, async t => (await t.query('SELECT api_key_enc, modelo FROM tenant_ia_config')).rows[0]);
  let apiKey: string | undefined; try { if (cfg?.api_key_enc) apiKey = decifrar(cfg.api_key_enc); } catch { /* ilegível */ }
  apiKey ??= process.env.OPENAI_API_KEY; if (!apiKey) throw new ErroAuth(400, 'A chave da OpenAI ainda não foi configurada (Administração › Configuração da IA).');
  const b64 = Buffer.from(d.dados).toString('base64');
  const parte = d.mime === 'application/pdf' ? { type: 'file', file: { filename: 'documento.pdf', file_data: `data:application/pdf;base64,${b64}` } } : { type: 'image_url', image_url: { url: `data:${d.mime};base64,${b64}` } };
  let resp: string;
  try { resp = (await ia({ apiKey, baseUrl: process.env.OPENAI_BASE_URL, modelo: cfg?.modelo ?? 'gpt-4o-mini', mensagens: [{ role: 'user', content: [{ type: 'text', text: PROMPT_EXTRACAO + ` Item esperado: ${slot?.nome ?? d.titulo ?? d.tipo}.` }, parte] }], ferramentas: [], maxRodadas: 1 })).resposta; }
  catch (e) { if (e instanceof ErroLLM) throw new ErroAuth(502, 'Erro do provedor de IA: ' + e.message); throw e; }
  let j: any; try { j = JSON.parse(resp.replace(/^```(?:json)?|```$/gm, '').trim()); } catch { throw new ErroAuth(502, 'A IA não devolveu uma leitura válida. Tente novamente ou use um arquivo mais nítido.'); }
  const str = (x: any, n = 120) => typeof x === 'string' ? x.slice(0, n) : undefined;
  const ex = { legivel: j?.legivel !== false, tipo_detectado: str(j?.tipo_detectado), titular: str(j?.titular), data_emissao: str(j?.data_emissao, 10), data_validade: str(j?.data_validade, 10), entidade: str(j?.entidade), curso: str(j?.curso), carga_horaria: Number.isFinite(Number(j?.carga_horaria)) ? Number(j.carga_horaria) : undefined, resultado: str(j?.resultado, 30) };
  const v = veredito(ex, { tipo: d.tipo, nome_funcionario: f.nome, hoje: hojeIso(), lado: d.lado, data_validade_informada: d.data_validade, reciclagem_meses: slot?.reciclagem_meses ?? null });
  const analise = { ...v, analisado_por: 'IA', aviso: 'Leitura automática: confira com o documento original.' };
  await tx(s, async t => { await t.query('UPDATE docs_func SET analise=$2::jsonb, analisado_em=now(), data_emissao=COALESCE(data_emissao,$3), data_validade=COALESCE(data_validade,$4) WHERE id=$1', [id, JSON.stringify(analise), v.data_emissao, v.data_validade]); });
  return analise;
}

/** Visão geral da empresa: por colaborador ativo, quantos documentos exigidos já estão na pasta e quantos vencidos/a vencer. */
export async function resumoEmpresa(s: Sessao, empresa: string) {
  const fs: any[] = (await pessoal.listarFuncionarios(s, empresa, undefined, true)).slice(0, 500), P = await vigentes(s), hoje = hojeIso();
  const docs: any[] = await tx(s, async t => (await t.query(`SELECT funcionario_id, tipo, lado, status, to_char(data_validade,'YYYY-MM-DD') AS data_validade, criado_em FROM docs_func WHERE empresa_id=$1 AND status<>'REJEITADO'`, [empresa])).rows);
  const por = new Map<string, any[]>(); for (const d of docs) (por.get(d.funcionario_id) ?? por.set(d.funcionario_id, []).get(d.funcionario_id)!).push(d);
  return fs.map(f => { const ex = exigidos([f.cargo_nome, f.funcao, f.setor].filter(Boolean).join(' '), P.TREINAMENTOS_FUNCAO, P.TREINAMENTOS_NR ?? {});
    const c = montarChecklist(slotsNecessarios({ sexo: f.sexo, dependentes: f.dependentes, funcao: f.funcao, cargo: f.cargo_nome }, ex.itens), por.get(f.id) ?? [], hoje).resumo;
    return { id: f.id, nome: f.nome, matricula: f.matricula, funcao: f.funcao ?? null, whatsapp: f.whatsapp ?? f.telefone ?? null, ...c }; });
}

/** Pasta do colaborador em ZIP (sem compressão), organizada em subpastas por tipo. */
export async function zipPasta(s: Sessao, funcId: string) {
  const { f, slots } = await contexto(s, funcId);
  const docs: any[] = await tx(s, async t => (await t.query('SELECT tipo, lado, nome_arquivo, mime, dados, to_char(criado_em,\'YYYYMMDD\') AS dia FROM docs_func WHERE funcionario_id=$1 ORDER BY criado_em', [funcId])).rows);
  if (!docs.length) throw new ErroAuth(404, 'A pasta ainda não tem arquivos.');
  const raiz = String(f.nome ?? 'colaborador').replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 60) + (f.matricula ? ` (${String(f.matricula).replace(/[^\w-]/g, '')})` : ''); const hoje = new Date(), dt = (hoje.getUTCHours() << 11) | (hoje.getUTCMinutes() << 5) | (hoje.getUTCSeconds() >> 1), dd = ((hoje.getUTCFullYear() - 1980) << 9) | ((hoje.getUTCMonth() + 1) << 5) | hoje.getUTCDate(); const parts: Buffer[] = [], cen: Buffer[] = []; let off = 0; const usados = new Set<string>();
  for (const d of docs) {
    const sl = slots.find(x => x.tipo === d.tipo), seg = (v: string) => v.replace(/[^\p{L}\p{N} ._()-]/gu, '_').replace(/\s+/g, ' ').trim().slice(0, 80);
    let nome = `${raiz}/${seg(sl?.grupo ?? 'Outros documentos')}/${seg(sl?.nome ?? d.tipo)}${d.lado === 'FRENTE' ? ' (frente)' : d.lado === 'VERSO' ? ' (verso)' : ''} - ${d.dia} - ${seg(String(d.nome_arquivo))}`; while (usados.has(nome)) nome = nome.replace(/(\.[^.]*)?$/, '_2$1'); usados.add(nome);
    const n = Buffer.from(nome, 'utf8'), data: Buffer = Buffer.from(d.dados), c = crc32(data) >>> 0;
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(dt, 10); h.writeUInt16LE(dd, 12); h.writeUInt32LE(c, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    const e = Buffer.alloc(46); e.writeUInt32LE(0x02014b50, 0); e.writeUInt16LE(20, 4); e.writeUInt16LE(20, 6); e.writeUInt16LE(0x0800, 8); e.writeUInt16LE(dt, 12); e.writeUInt16LE(dd, 14); e.writeUInt32LE(c, 16); e.writeUInt32LE(data.length, 20); e.writeUInt32LE(data.length, 24); e.writeUInt16LE(n.length, 28); e.writeUInt32LE(off, 42);
    parts.push(h, n, data); cen.push(e, n); off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(cen), fim = Buffer.alloc(22); fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(docs.length, 8); fim.writeUInt16LE(docs.length, 10); fim.writeUInt32LE(cd.length, 12); fim.writeUInt32LE(off, 16);
  return { nome: `pasta-${String(f.matricula ?? f.id).replace(/[^\w-]/g, '')}.zip`, dados: Buffer.concat([...parts, cd, fim]) };
}
export { situacaoDoc };
