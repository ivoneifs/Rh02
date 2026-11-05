// Upload de fotos (JPEG/PNG/WEBP) para funcionários, registros e empresas. O navegador reduz a imagem antes de enviar;
// aqui validamos o tipo pelos bytes (não pelo nome), o tamanho e o vínculo com o tenant.
import { dbDoTenant, isUuid } from './db.ts';
import { ErroAuth, type Sessao } from './auth.ts';

export const MAX_BYTES = 2_000_000, MAX_POR_ALVO = 30;
const ALVOS: Record<string, string> = { funcionario: 'colaboradores', registro: 'registros', empresa: 'empresas' };
const tx = <R>(s: Sessao, fn: (t: any) => Promise<R>) => dbDoTenant(s.tenantId, s.papel).transaction(fn);
const w = (s: Sessao) => { if (s.papel === 'CLIENTE_LEITURA') throw new ErroAuth(403, 'Perfil somente leitura.'); };

/** Descobre o tipo real da imagem pelos primeiros bytes. */
export function tipoPorBytes(b: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}
const limpa = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f<>"\\]/g, '').trim().slice(0, n);

export async function enviar(s: Sessao, b: any) {
  w(s);
  const tabela = ALVOS[b?.alvo_tipo]; if (!tabela) throw new ErroAuth(422, 'alvo_tipo inválido.');
  if (!isUuid(b?.alvo_id)) throw new ErroAuth(422, 'alvo_id inválido.');
  if (typeof b?.base64 !== 'string' || !/^[A-Za-z0-9+/=\s]+$/.test(b.base64)) throw new ErroAuth(422, 'Imagem inválida.');
  const buf = Buffer.from(b.base64, 'base64');
  if (buf.length > MAX_BYTES) throw new ErroAuth(413, `Imagem acima de ${MAX_BYTES / 1e6} MB. Use uma foto menor.`);
  const mime = tipoPorBytes(buf); if (!mime) throw new ErroAuth(415, 'Envie uma imagem JPEG, PNG ou WEBP.');
  return tx(s, async t => {
    if (!(await t.query(`SELECT 1 FROM ${tabela} WHERE id=$1`, [b.alvo_id])).rowCount) throw new ErroAuth(404, 'Item não encontrado.');
    const n = (await t.query('SELECT count(*)::int AS n FROM anexos WHERE alvo_tipo=$1 AND alvo_id=$2', [b.alvo_tipo, b.alvo_id])).rows[0].n;
    if (n >= MAX_POR_ALVO) throw new ErroAuth(422, `Limite de ${MAX_POR_ALVO} fotos por item.`);
    const r = await t.query(`INSERT INTO anexos (tenant_id, alvo_tipo, alvo_id, nome, mime, tamanho, legenda, dados, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, nome, mime, tamanho, legenda, criado_em`,
      [s.tenantId, b.alvo_tipo, b.alvo_id, limpa(b.nome, 120) || 'foto', mime, buf.length, limpa(b.legenda, 200) || null, buf, s.usuarioId]);
    return r.rows[0];
  });
}
export const listar = (s: Sessao, alvoTipo: string, alvoId: string) => {
  if (!ALVOS[alvoTipo] || !isUuid(alvoId)) throw new ErroAuth(422, 'Parâmetros inválidos.');
  return tx(s, async t => (await t.query('SELECT id, nome, mime, tamanho, legenda, criado_em FROM anexos WHERE alvo_tipo=$1 AND alvo_id=$2 ORDER BY criado_em', [alvoTipo, alvoId])).rows);
};
export async function obter(s: Sessao, id: string) {
  if (!isUuid(id)) throw new ErroAuth(400, 'id inválido');
  const r = await tx(s, async t => (await t.query('SELECT mime, dados FROM anexos WHERE id=$1', [id])).rows[0]);
  if (!r) throw new ErroAuth(404, 'Foto não encontrada.'); return r as { mime: string; dados: Buffer };
}
export async function excluir(s: Sessao, id: string) {
  w(s); if (!isUuid(id)) throw new ErroAuth(400, 'id inválido');
  await tx(s, async t => { if (!(await t.query('DELETE FROM anexos WHERE id=$1', [id])).rowCount) throw new ErroAuth(404, 'Foto não encontrada.'); }); return { ok: true };
}
export async function legenda(s: Sessao, id: string, texto: unknown) {
  w(s); if (!isUuid(id)) throw new ErroAuth(400, 'id inválido');
  await tx(s, async t => { await t.query('UPDATE anexos SET legenda=$2 WHERE id=$1', [id, limpa(texto, 200) || null]); }); return { ok: true };
}
