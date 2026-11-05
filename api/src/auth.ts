// Login/senha, sessões e administração de usuários.
// Senhas: scrypt (N=16384,r=8,p=1) com salt aleatório. Sessão: token aleatório de 256 bits no cookie HttpOnly; no banco só o SHA-256.
import { scrypt, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import type http from 'node:http';
import { pool, dbDoTenant, isUuid } from './db.ts';

export const PAPEIS = ['ADMIN', 'CONTADOR', 'AUXILIAR', 'CLIENTE_LEITURA'] as const;
export type Papel = typeof PAPEIS[number];
export interface Sessao { usuarioId: string; tenantId: string; papel: Papel; nome: string; email: string }

export class ErroAuth extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status; } }

const N = 16384, R = 8, P = 1, KEYLEN = 64;
const COOKIE = 'erp_sessao';
const DIAS_SESSAO = 7;
const MAX_FALHAS = 5, BLOQUEIO_MIN = 15;

const derivar = (senha: string, salt: Buffer, n = N, r = R, p = P) =>
  new Promise<Buffer>((ok, ko) => scrypt(senha, salt, KEYLEN, { N: n, r, p, maxmem: 128 * n * r * 2 }, (e, k) => (e ? ko(e) : ok(k))));

export async function hashSenha(senha: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${(await derivar(senha, salt)).toString('base64')}`;
}
const HASH_FALSO = hashSenha(randomBytes(12).toString('hex'));   // gasta o mesmo tempo quando o e-mail não existe
export async function conferirSenha(senha: string, hash: string): Promise<boolean> {
  const [alg, n, r, p, s, h] = hash.split('$');
  if (alg !== 'scrypt' || !h) return false;
  const esperado = Buffer.from(h, 'base64');
  const obtido = await derivar(senha, Buffer.from(s, 'base64'), +n, +r, +p);
  return esperado.length === obtido.length && timingSafeEqual(esperado, obtido);
}

export const emailValido = (e: unknown): e is string => typeof e === 'string' && e.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
export function validarSenha(senha: unknown, email = ''): asserts senha is string {
  if (typeof senha !== 'string' || senha.length < 10) throw new ErroAuth(422, 'A senha deve ter pelo menos 10 caracteres.');
  if (senha.length > 200) throw new ErroAuth(422, 'Senha longa demais.');
  if (!/[A-Za-z]/.test(senha) || !/\d/.test(senha)) throw new ErroAuth(422, 'A senha deve ter letras e números.');
  if (email && senha.toLowerCase() === email.toLowerCase()) throw new ErroAuth(422, 'A senha não pode ser igual ao e-mail.');
}
const nomeValido = (n: unknown): n is string => typeof n === 'string' && n.trim().length >= 2 && n.length <= 120;
const sha = (t: string) => createHash('sha256').update(t).digest();

// ---------- sessão / cookie ----------
const seguro = (req: http.IncomingMessage) => req.headers['x-forwarded-proto'] === 'https' || process.env.COOKIE_SECURE === 'true';
export const cookieSessao = (req: http.IncomingMessage, token: string, apagar = false) =>
  `${COOKIE}=${apagar ? '' : token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${apagar ? 0 : DIAS_SESSAO * 86400}${seguro(req) ? '; Secure' : ''}`;
const tokenDoCookie = (req: http.IncomingMessage) => {
  for (const par of (req.headers.cookie ?? '').split(';')) { const [k, ...v] = par.trim().split('='); if (k === COOKIE) return v.join('='); }
  return null;
};

async function novaSessao(c: { query: Function }, usuarioId: string, tenantId: string, papel: Papel) {
  const token = randomBytes(32).toString('base64url');
  await c.query(`INSERT INTO auth_sessoes (token_hash, usuario_id, tenant_id, papel, expira_em) VALUES ($1,$2,$3,$4, now() + ($5 || ' days')::interval)`,
    [sha(token), usuarioId, tenantId, papel, String(DIAS_SESSAO)]);
  return token;
}

export async function sessaoDe(req: http.IncomingMessage): Promise<Sessao | null> {
  const t = tokenDoCookie(req); if (!t || !/^[A-Za-z0-9_-]{40,60}$/.test(t)) return null;
  const { rows } = await pool.query(`SELECT s.usuario_id, s.tenant_id, s.papel, c.email, c.ativo FROM auth_sessoes s JOIN auth_contas c ON c.usuario_id = s.usuario_id
    WHERE s.token_hash = $1 AND s.expira_em > now()`, [sha(t)]);
  const r = rows[0]; if (!r || !r.ativo) return null;
  const nome = (await dbDoTenant(r.tenant_id).transaction(async tx => (await tx.query('SELECT nome FROM usuarios WHERE id=$1', [r.usuario_id])).rows[0]?.nome)) as string | undefined;
  if (!nome) return null;
  return { usuarioId: r.usuario_id, tenantId: r.tenant_id, papel: r.papel, nome, email: r.email };
}

// ---------- cadastro (cria o escritório/tenant + 1º usuário ADMIN) ----------
export async function cadastrar(b: any) {
  if (!nomeValido(b?.nome)) throw new ErroAuth(422, 'Informe seu nome.');
  if (!emailValido(b?.email)) throw new ErroAuth(422, 'E-mail inválido.');
  validarSenha(b?.senha, b.email);
  const escritorio = typeof b.escritorio === 'string' && b.escritorio.trim().length >= 2 ? b.escritorio.trim().slice(0, 120) : b.nome.trim();
  const email = b.email.trim().toLowerCase(), hash = await hashSenha(b.senha);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    if ((await c.query('SELECT 1 FROM auth_contas WHERE lower(email)=$1', [email])).rowCount) throw new ErroAuth(409, 'Este e-mail já está cadastrado.');
    const tenantId = (await c.query('INSERT INTO tenants (nome) VALUES ($1) RETURNING id', [escritorio])).rows[0].id as string;
    await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [tenantId]);
    const uid = (await c.query(`INSERT INTO usuarios (tenant_id,email,nome,papel) VALUES ($1,$2,$3,'ADMIN') RETURNING id`, [tenantId, email, b.nome.trim()])).rows[0].id as string;
    await c.query('INSERT INTO auth_contas (usuario_id,tenant_id,email,senha_hash) VALUES ($1,$2,$3,$4)', [uid, tenantId, email, hash]);
    const token = await novaSessao(c, uid, tenantId, 'ADMIN');
    await c.query('COMMIT'); return { token };
  } catch (e: any) {
    await c.query('ROLLBACK').catch(() => {});
    if (e?.code === '23505') throw new ErroAuth(409, 'Este e-mail já está cadastrado.');
    throw e;
  } finally { c.release(); }
}

// ---------- login ----------
const porIp = new Map<string, { n: number; ate: number }>();
function limiteIp(ip: string) {
  const agora = Date.now(); let e = porIp.get(ip);
  if (!e || e.ate < agora) { e = { n: 0, ate: agora + BLOQUEIO_MIN * 60_000 }; porIp.set(ip, e); }
  if (++e.n > 30) throw new ErroAuth(429, 'Muitas tentativas. Tente novamente em alguns minutos.');
  if (porIp.size > 10_000) for (const [k, v] of porIp) if (v.ate < agora) porIp.delete(k);
}
export async function entrar(b: any, ip: string) {
  limiteIp(ip);
  const email = typeof b?.email === 'string' ? b.email.trim().toLowerCase() : '', senha = typeof b?.senha === 'string' ? b.senha : '';
  if (!email || !senha || senha.length > 200) throw new ErroAuth(401, 'E-mail ou senha incorretos.');
  const conta = (await pool.query(`SELECT usuario_id, tenant_id, senha_hash, ativo, falhas, bloqueado_ate FROM auth_contas WHERE lower(email)=$1`, [email])).rows[0];
  if (!conta) { await conferirSenha(senha, await HASH_FALSO); throw new ErroAuth(401, 'E-mail ou senha incorretos.'); }
  if (conta.bloqueado_ate && new Date(conta.bloqueado_ate) > new Date()) throw new ErroAuth(429, `Conta bloqueada por tentativas erradas. Tente novamente em ${BLOQUEIO_MIN} minutos.`);
  const ok = await conferirSenha(senha, conta.senha_hash);
  if (!ok || !conta.ativo) {
    if (!ok) await pool.query(`UPDATE auth_contas SET falhas = falhas + 1, bloqueado_ate = CASE WHEN falhas + 1 >= $2 THEN now() + ($3 || ' minutes')::interval END WHERE usuario_id=$1`,
      [conta.usuario_id, MAX_FALHAS, String(BLOQUEIO_MIN)]);
    throw new ErroAuth(conta.ativo ? 401 : 403, conta.ativo ? 'E-mail ou senha incorretos.' : 'Usuário desativado. Fale com o administrador.');
  }
  const papel = (await dbDoTenant(conta.tenant_id).transaction(async tx => (await tx.query('SELECT papel FROM usuarios WHERE id=$1', [conta.usuario_id])).rows[0]?.papel)) as Papel | undefined;
  if (!papel) throw new ErroAuth(401, 'E-mail ou senha incorretos.');
  await pool.query('UPDATE auth_contas SET falhas=0, bloqueado_ate=NULL, ultimo_login=now() WHERE usuario_id=$1', [conta.usuario_id]);
  await pool.query('DELETE FROM auth_sessoes WHERE expira_em < now()');
  return { token: await novaSessao(pool, conta.usuario_id, conta.tenant_id, papel) };
}
export async function sair(req: http.IncomingMessage) {
  const t = tokenDoCookie(req); if (t) await pool.query('DELETE FROM auth_sessoes WHERE token_hash=$1', [sha(t)]);
}
export async function trocarSenha(s: Sessao, b: any, req: http.IncomingMessage) {
  const atual = (await pool.query('SELECT senha_hash FROM auth_contas WHERE usuario_id=$1', [s.usuarioId])).rows[0];
  if (!atual || typeof b?.senhaAtual !== 'string' || !(await conferirSenha(b.senhaAtual, atual.senha_hash))) throw new ErroAuth(403, 'Senha atual incorreta.');
  validarSenha(b?.novaSenha, s.email);
  await pool.query('UPDATE auth_contas SET senha_hash=$2 WHERE usuario_id=$1', [s.usuarioId, await hashSenha(b.novaSenha)]);
  const t = tokenDoCookie(req);
  await pool.query('DELETE FROM auth_sessoes WHERE usuario_id=$1 AND token_hash <> $2', [s.usuarioId, t ? sha(t) : Buffer.alloc(0)]);
}

// ---------- ADMIN: CRUD de usuários do tenant ----------
// Consultas sobre tabelas com RLS (usuarios) precisam do contexto do tenant.
const q = (s: Sessao, sql: string, p: unknown[]) => dbDoTenant(s.tenantId, s.papel).transaction(async tx => (await tx.query(sql, p)) as any);
const exigirAdmin = (s: Sessao) => { if (s.papel !== 'ADMIN') throw new ErroAuth(403, 'Apenas administradores.'); };
const papelValido = (p: unknown): p is Papel => typeof p === 'string' && (PAPEIS as readonly string[]).includes(p);

export async function listarUsuarios(s: Sessao) {
  exigirAdmin(s);
  return ((await q(s, `SELECT u.id, u.nome, u.email, u.papel, c.ativo, c.ultimo_login FROM usuarios u JOIN auth_contas c ON c.usuario_id=u.id
    WHERE u.tenant_id=$1 ORDER BY lower(u.nome)`, [s.tenantId])) as any).rows;
}
export async function criarUsuario(s: Sessao, b: any) {
  exigirAdmin(s);
  if (!nomeValido(b?.nome)) throw new ErroAuth(422, 'Informe o nome.');
  if (!emailValido(b?.email)) throw new ErroAuth(422, 'E-mail inválido.');
  if (!papelValido(b?.papel)) throw new ErroAuth(422, 'Papel inválido.');
  validarSenha(b?.senha, b.email);
  const email = b.email.trim().toLowerCase(), hash = await hashSenha(b.senha);
  const c = await pool.connect();
  try {
    await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [s.tenantId]);
    const id = (await c.query(`INSERT INTO usuarios (tenant_id,email,nome,papel) VALUES ($1,$2,$3,$4) RETURNING id`, [s.tenantId, email, b.nome.trim(), b.papel])).rows[0].id;
    await c.query('INSERT INTO auth_contas (usuario_id,tenant_id,email,senha_hash) VALUES ($1,$2,$3,$4)', [id, s.tenantId, email, hash]);
    await c.query('COMMIT'); return { id };
  } catch (e: any) { await c.query('ROLLBACK').catch(() => {}); if (e?.code === '23505') throw new ErroAuth(409, 'Este e-mail já está cadastrado.'); throw e; }
  finally { c.release(); }
}
// Não permite deixar o escritório sem nenhum ADMIN ativo.
async function garantirOutroAdmin(s: Sessao, alvoId: string) {
  const { rows } = await q(s, `SELECT count(*)::int AS n FROM usuarios u JOIN auth_contas c ON c.usuario_id=u.id
    WHERE u.tenant_id=$1 AND u.papel='ADMIN' AND c.ativo AND u.id <> $2`, [s.tenantId, alvoId]);
  if (!rows[0].n) throw new ErroAuth(409, 'O escritório precisa manter pelo menos um administrador ativo.');
}
async function doTenant(s: Sessao, id: string) {
  if (!isUuid(id)) throw new ErroAuth(400, 'id inválido');
  const r = (await q(s, 'SELECT papel FROM usuarios WHERE id=$1 AND tenant_id=$2', [id, s.tenantId])).rows[0];
  if (!r) throw new ErroAuth(404, 'Usuário não encontrado.');
  return r as { papel: Papel };
}
export async function editarUsuario(s: Sessao, id: string, b: any) {
  exigirAdmin(s); const atual = await doTenant(s, id);
  const sets: string[] = [], v: unknown[] = [id, s.tenantId];
  if (b?.nome !== undefined) { if (!nomeValido(b.nome)) throw new ErroAuth(422, 'Nome inválido.'); v.push(b.nome.trim()); sets.push(`nome=$${v.length}`); }
  if (b?.papel !== undefined) {
    if (!papelValido(b.papel)) throw new ErroAuth(422, 'Papel inválido.');
    if (atual.papel === 'ADMIN' && b.papel !== 'ADMIN') await garantirOutroAdmin(s, id);
    v.push(b.papel); sets.push(`papel=$${v.length}`);
  }
  if (sets.length) await q(s, `UPDATE usuarios SET ${sets.join(',')} WHERE id=$1 AND tenant_id=$2`, v);
  if (b?.papel !== undefined) await pool.query('UPDATE auth_sessoes SET papel=$2 WHERE usuario_id=$1', [id, b.papel]);
  if (b?.ativo !== undefined) {
    if (typeof b.ativo !== 'boolean') throw new ErroAuth(422, 'ativo deve ser true/false.');
    if (!b.ativo) { if (id === s.usuarioId) throw new ErroAuth(409, 'Você não pode desativar a si mesmo.'); if (atual.papel === 'ADMIN') await garantirOutroAdmin(s, id); }
    await pool.query('UPDATE auth_contas SET ativo=$2, falhas=0, bloqueado_ate=NULL WHERE usuario_id=$1', [id, b.ativo]);
    if (!b.ativo) await pool.query('DELETE FROM auth_sessoes WHERE usuario_id=$1', [id]);
  }
  if (b?.novaSenha !== undefined) {
    const em = (await pool.query('SELECT email FROM auth_contas WHERE usuario_id=$1', [id])).rows[0]?.email ?? '';
    validarSenha(b.novaSenha, em);
    await pool.query('UPDATE auth_contas SET senha_hash=$2, falhas=0, bloqueado_ate=NULL WHERE usuario_id=$1', [id, await hashSenha(b.novaSenha)]);
    await pool.query('DELETE FROM auth_sessoes WHERE usuario_id=$1', [id]);
  }
  return { ok: true };
}
export async function excluirUsuario(s: Sessao, id: string) {
  exigirAdmin(s); const atual = await doTenant(s, id);
  if (id === s.usuarioId) throw new ErroAuth(409, 'Você não pode excluir a si mesmo.');
  if (atual.papel === 'ADMIN') await garantirOutroAdmin(s, id);
  try {
    const c = await pool.connect();
    try { await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [s.tenantId]);
      await c.query('DELETE FROM usuarios WHERE id=$1 AND tenant_id=$2', [id, s.tenantId]); await c.query('COMMIT'); }
    catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  } catch (e: any) {
    if (e?.code === '23503') throw new ErroAuth(409, 'Este usuário tem histórico (lançamentos). Desative-o em vez de excluir.');
    throw e;
  }
  return { ok: true };
}

// ---------- ADMIN: CRUD de empresas ----------
const REGIMES = ['SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL', 'LUCRO_ARBITRADO', 'IMUNE_ISENTA'];
function cnpjValido(c: string) {
  if (!/^\d{14}$/.test(c) || /^(\d)\1+$/.test(c)) return false;
  const dv = (n: number) => { let soma = 0, pes = n - 7; for (let i = 0; i < n; i++) { soma += +c[i] * pes--; if (pes < 2) pes = 9; } const r = soma % 11; return r < 2 ? 0 : 11 - r; };
  return dv(12) === +c[12] && dv(13) === +c[13];
}
const campoEmpresa = (b: any, parcial: boolean) => {
  const o: Record<string, unknown> = {};
  if (!parcial || b.cnpj !== undefined) { const c = String(b.cnpj ?? '').replace(/\D/g, ''); if (!cnpjValido(c)) throw new ErroAuth(422, 'CNPJ inválido.'); o.cnpj = c; }
  if (!parcial || b.razaoSocial !== undefined) { if (!nomeValido(b.razaoSocial)) throw new ErroAuth(422, 'Razão social inválida.'); o.razao_social = b.razaoSocial.trim(); }
  if (!parcial || b.uf !== undefined) { if (!/^[A-Za-z]{2}$/.test(String(b.uf ?? ''))) throw new ErroAuth(422, 'UF inválida.'); o.uf = String(b.uf).toUpperCase(); }
  if (!parcial || b.regime !== undefined) { if (!REGIMES.includes(b.regime)) throw new ErroAuth(422, 'Regime tributário inválido.'); o.regime_tributario = b.regime; }
  if (b.ativa !== undefined) { if (typeof b.ativa !== 'boolean') throw new ErroAuth(422, 'ativa deve ser true/false.'); o.ativa = b.ativa; }
  return o;
};
export async function listarEmpresasAdmin(s: Sessao) {
  exigirAdmin(s);
  return dbDoTenant(s.tenantId, s.papel).transaction(async tx => (await tx.query('SELECT id, cnpj, razao_social, uf, regime_tributario, ativa FROM empresas ORDER BY razao_social')).rows);
}
export async function criarEmpresa(s: Sessao, b: any) {
  exigirAdmin(s); const o = campoEmpresa(b ?? {}, false);
  try {
    return await dbDoTenant(s.tenantId, s.papel).transaction(async tx => {
      let esc = (await tx.query('SELECT id FROM escritorios ORDER BY id LIMIT 1')).rows[0]?.id;
      if (!esc) {   // 1º cadastro: cria o escritório do tenant (CNPJ fictício único, editável depois)
        const nome = (await pool.query('SELECT nome FROM tenants WHERE id=$1', [s.tenantId])).rows[0].nome;
        esc = (await tx.query(`INSERT INTO escritorios (tenant_id, razao_social, cnpj) VALUES ($1,$2,$3) RETURNING id`, [s.tenantId, nome, '0' + s.tenantId.replace(/\D/g, '').padEnd(13, '0').slice(0, 13)])).rows[0].id;
      }
      return (await tx.query(`INSERT INTO empresas (tenant_id, escritorio_id, cnpj, razao_social, uf, regime_tributario) VALUES ($1,$2,$3,$4,$5,$6::regime_tributario) RETURNING id`,
        [s.tenantId, esc, o.cnpj, o.razao_social, o.uf, o.regime_tributario])).rows[0];
    });
  } catch (e: any) { if (e?.code === '23505') throw new ErroAuth(409, 'CNPJ já cadastrado neste escritório.'); throw e; }
}
export async function editarEmpresa(s: Sessao, id: string, b: any) {
  exigirAdmin(s); if (!isUuid(id)) throw new ErroAuth(400, 'id inválido');
  const o = campoEmpresa(b ?? {}, true); const ks = Object.keys(o); if (!ks.length) return { ok: true };
  const sets = ks.map((k, i) => `${k}=$${i + 2}${k === 'regime_tributario' ? '::regime_tributario' : ''}`).join(',');
  try {
    const n = await dbDoTenant(s.tenantId, s.papel).transaction(async tx => (await tx.query(`UPDATE empresas SET ${sets} WHERE id=$1`, [id, ...ks.map(k => o[k])])).rowCount);
    if (!n) throw new ErroAuth(404, 'Empresa não encontrada.');
  } catch (e: any) { if (e?.code === '23505') throw new ErroAuth(409, 'CNPJ já cadastrado neste escritório.'); throw e; }
  return { ok: true };
}
export async function excluirEmpresa(s: Sessao, id: string) {
  exigirAdmin(s); if (!isUuid(id)) throw new ErroAuth(400, 'id inválido');
  try {
    const n = await dbDoTenant(s.tenantId, s.papel).transaction(async tx => (await tx.query('DELETE FROM empresas WHERE id=$1', [id])).rowCount);
    if (!n) throw new ErroAuth(404, 'Empresa não encontrada.');
  } catch (e: any) { if (e?.code === '23503') throw new ErroAuth(409, 'A empresa tem movimentação contábil. Desative-a em vez de excluir.'); throw e; }
  return { ok: true };
}
