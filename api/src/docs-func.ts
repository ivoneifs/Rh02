// Pasta do funcionário: catálogo de documentos necessários, situação por prazo e veredito da análise da IA.
// Funções puras (testáveis); o acesso ao banco fica em docs-rotas.ts.
export type Situacao = 'PENDENTE' | 'ENVIADO' | 'EM_DIA' | 'A_VENCER' | 'VENCIDO';
export interface Slot { tipo: string; nome: string; grupo: string; com_validade: boolean; conferir?: string; horas?: number | null; reciclagem_meses?: number | null }
export const GRUPOS = ['Documentos pessoais e admissão', 'Dependentes', 'Contrato e Departamento Pessoal', 'Saúde ocupacional', 'Segurança e treinamentos'] as const;

const norm = (t: unknown) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const G = GRUPOS;
const PESSOAIS: [string, string, string?][] = [['RG', 'RG (identidade)'], ['CPF', 'CPF'], ['CTPS', 'CTPS (carteira de trabalho)'], ['PIS', 'PIS/NIS'], ['COMP_RES', 'Comprovante de residência'], ['TITULO', 'Título de eleitor'], ['FOTO', 'Foto 3x4'], ['CERT_CIVIL', 'Certidão de nascimento/casamento'], ['ESCOLARIDADE', 'Comprovante de escolaridade'], ['BANCO', 'Dados bancários (comprovante de conta)']];

export interface PerfilFunc { sexo?: string | null; dependentes?: number | null; funcao?: string | null; cargo?: string | null; setor?: string | null; tipo_contrato?: string | null }
/** Lista os documentos esperados para o colaborador. `treinos` vem de integracao.exigidos(). Nada aqui inventa prazo legal. */
export function slotsNecessarios(f: PerfilFunc, treinos: { cod: string; nome: string; horas: number | null; reciclagem_meses: number | null }[]): Slot[] {
  const o: Slot[] = [];
  for (const [t, n] of PESSOAIS) o.push({ tipo: t, nome: n, grupo: G[0], com_validade: false });
  if (f.sexo === 'M') o.push({ tipo: 'RESERVISTA', nome: 'Certificado de reservista', grupo: G[0], com_validade: false, conferir: 'Exigência depende do caso – a conferir' });
  if (/motorista|condutor|operador de (empilhadeira|m[aá]quina)/i.test(`${f.funcao ?? ''} ${f.cargo ?? ''}`)) o.push({ tipo: 'CNH', nome: 'CNH', grupo: G[0], com_validade: true });
  if ((f.dependentes ?? 0) > 0) for (const [t, n] of [['DEP_CERTIDAO', 'Certidão de nascimento dos dependentes'], ['DEP_CPF', 'CPF dos dependentes'], ['DEP_VACINA_ESCOLA', 'Vacinação/matrícula escolar dos dependentes']] as const)
    o.push({ tipo: t, nome: n, grupo: G[1], com_validade: false, conferir: t === 'DEP_VACINA_ESCOLA' ? 'Exigência e periodicidade – a conferir' : undefined });
  for (const [t, n] of [['FICHA_REGISTRO', 'Ficha/livro de registro'], ['CONTRATO', 'Contrato de trabalho'], ['TERMO_VT', 'Termo de vale-transporte (opção/dispensa)'], ['TERMO_LGPD', 'Termo de ciência LGPD']] as const) o.push({ tipo: t, nome: n, grupo: G[2], com_validade: false });
  o.push({ tipo: 'ASO_ADMISSIONAL', nome: 'ASO admissional', grupo: G[3], com_validade: true });
  o.push({ tipo: 'ASO_PERIODICO', nome: 'ASO periódico', grupo: G[3], com_validade: true });
  o.push({ tipo: 'EXAMES', nome: 'Exames complementares', grupo: G[3], com_validade: true, conferir: 'Conforme PCMSO – a conferir' });
  o.push({ tipo: 'OS_SEGURANCA', nome: 'Ordem de serviço de segurança (NR-1)', grupo: G[4], com_validade: false });
  o.push({ tipo: 'FICHA_EPI', nome: 'Ficha de entrega de EPI', grupo: G[4], com_validade: false });
  for (const t of treinos) o.push({ tipo: 'TREIN:' + t.cod, nome: `Certificado: ${t.nome}`, grupo: G[4], com_validade: !!t.reciclagem_meses, horas: t.horas, reciclagem_meses: t.reciclagem_meses });
  return o;
}
export const TIPOS_AVULSOS = [{ tipo: 'OUTRO', nome: 'Outro documento' }, { tipo: 'ATESTADO', nome: 'Atestado' }, { tipo: 'CERT_CURSO', nome: 'Certificado de curso/treinamento' }, { tipo: 'ADVERTENCIA', nome: 'Advertência/suspensão' }, { tipo: 'FERIAS', nome: 'Aviso/recibo de férias' }];

const dias = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);
/** Situação de um documento pelo prazo: sem arquivo = PENDENTE; sem validade = ENVIADO; senão VENCIDO / A_VENCER (≤ aviso dias) / EM_DIA. */
export function situacaoDoc(doc: { data_validade?: string | null } | null | undefined, hoje: string, aviso = 30): Situacao {
  if (!doc) return 'PENDENTE'; const v = doc.data_validade; if (!v) return 'ENVIADO';
  return v < hoje ? 'VENCIDO' : dias(v, hoje) <= aviso ? 'A_VENCER' : 'EM_DIA';
}
/** Combina slots e arquivos: usa o arquivo mais recente de cada tipo; os demais ficam como histórico. */
export function montarChecklist(slots: Slot[], docs: any[], hoje: string) {
  const por = new Map<string, any[]>(); for (const d of docs) (por.get(d.tipo) ?? por.set(d.tipo, []).get(d.tipo)!).push(d);
  const itens = slots.map(s => { const l = (por.get(s.tipo) ?? []).slice().sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em))); const atual = l.find(d => d.status !== 'REJEITADO') ?? null;
    return { ...s, doc: atual, historico: l.filter(d => d !== atual).map(d => d.id), situacao: situacaoDoc(atual, hoje) as Situacao, dias: atual?.data_validade ? dias(atual.data_validade, hoje) : null }; });
  const tipos = new Set(slots.map(s => s.tipo));
  const extras = docs.filter(d => !tipos.has(d.tipo)).map(d => ({ tipo: d.tipo, nome: d.titulo || d.tipo, grupo: 'Outros documentos', com_validade: !!d.data_validade, doc: d, historico: [], situacao: situacaoDoc(d, hoje), dias: d.data_validade ? dias(d.data_validade, hoje) : null }));
  const todos = [...itens, ...extras], c = (x: Situacao) => todos.filter(i => i.situacao === x).length;
  return { itens: todos, resumo: { total: itens.length, pendentes: c('PENDENTE'), enviados: c('ENVIADO'), em_dia: c('EM_DIA'), a_vencer: c('A_VENCER'), vencidos: c('VENCIDO'), completos: itens.length - itens.filter(i => i.situacao === 'PENDENTE').length } };
}

/** Descobre o tipo real do arquivo pelos bytes. */
export function mimePorBytes(b: Buffer): 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (b.length > 12 && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

const dataIso = (v: unknown) => { const s = String(v ?? '').trim(); let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return `${m[1]}-${m[2]}-${m[3]}`; m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const valida = (d: string | null) => d && !isNaN(Date.parse(d)) && d >= '1950-01-01' && d <= '2100-12-31' ? d : null;
/** Aproximação de nome: todos os tokens (≥3 letras) do menor nome aparecem no outro. */
export function mesmoNome(a: string, b: string): boolean {
  const ta = norm(a).split(' ').filter(x => x.length >= 3), tb = norm(b).split(' ').filter(x => x.length >= 3); if (!ta.length || !tb.length) return false;
  const [p, g] = ta.length <= tb.length ? [ta, tb] : [tb, ta]; const hit = p.filter(x => g.includes(x)).length; return hit >= Math.min(2, p.length) && hit / p.length >= 0.6;
}
/** Tipos que a IA pode devolver em `tipo_detectado` e a que slot pertencem (checagem de coerência). */
const PALAVRAS: [RegExp, string[]][] = [[/\baso\b|atestado de saude ocupacional/, ['ASO_ADMISSIONAL', 'ASO_PERIODICO']], [/exame|laudo|audiometr|espirometr|hemograma/, ['EXAMES']], [/\brg\b|identidade/, ['RG']], [/\bcpf\b/, ['CPF']], [/ctps|carteira de trabalho/, ['CTPS']], [/\bnr ?\d+|treinamento|certificado|capacitacao|curso/, ['TREIN', 'CERT_CURSO']], [/cnh|habilitacao/, ['CNH']]];
export function coerente(tipoSlot: string, detectado: string): boolean | null {
  const d = norm(detectado); if (!d) return null; const hit = PALAVRAS.filter(([r]) => r.test(d)); if (!hit.length) return null;
  return hit.some(([, ts]) => ts.some(t => tipoSlot === t || tipoSlot.startsWith(t))) || tipoSlot === 'OUTRO';
}
export interface Extracao { legivel?: boolean; tipo_detectado?: string; titular?: string; data_emissao?: string; data_validade?: string; entidade?: string; curso?: string; carga_horaria?: number | string; resultado?: string; observacoes?: string }
/** Veredito calculado pelo servidor (a IA só extrai; prazo e comparação são feitos aqui). */
export function veredito(ex: Extracao, ctx: { tipo: string; nome_funcionario: string; hoje: string; data_validade_informada?: string | null; aviso?: number; reciclagem_meses?: number | null }) {
  const alertas: { nivel: 'ERRO' | 'AVISO' | 'OK'; texto: string }[] = [];
  const emissao = valida(dataIso(ex.data_emissao)); let validade = valida(dataIso(ex.data_validade)) ?? valida(ctx.data_validade_informada ?? null);
  let validadeCalculada = false;
  if (!validade && emissao && ctx.reciclagem_meses) { const d = new Date(emissao + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + ctx.reciclagem_meses); validade = d.toISOString().slice(0, 10); validadeCalculada = true; }
  if (ex.legivel === false) alertas.push({ nivel: 'ERRO', texto: 'Documento ilegível ou incompleto – envie uma cópia melhor.' });
  if (ex.titular && !mesmoNome(ex.titular, ctx.nome_funcionario)) alertas.push({ nivel: 'ERRO', texto: `O nome no documento (“${String(ex.titular).slice(0, 80)}”) não parece ser do colaborador (${ctx.nome_funcionario}).` });
  else if (!ex.titular && ex.legivel !== false) alertas.push({ nivel: 'AVISO', texto: 'A IA não identificou o nome do titular – confira manualmente.' });
  const co = coerente(ctx.tipo, ex.tipo_detectado ?? ''); if (co === false) alertas.push({ nivel: 'AVISO', texto: `O arquivo parece ser “${String(ex.tipo_detectado).slice(0, 60)}”, diferente do item escolhido.` });
  if (/inapt/i.test(String(ex.resultado ?? ''))) alertas.push({ nivel: 'ERRO', texto: 'O documento indica resultado INAPTO – procure o SST/medicina do trabalho.' });
  const sit = situacaoDoc({ data_validade: validade }, ctx.hoje, ctx.aviso ?? 30);
  if (validade) { const dd = dias(validade, ctx.hoje);
    if (sit === 'VENCIDO') alertas.push({ nivel: 'ERRO', texto: `VENCIDO há ${-dd} dia(s) (validade ${validade.split('-').reverse().join('/')}).` });
    else if (sit === 'A_VENCER') alertas.push({ nivel: 'AVISO', texto: `Vence em ${dd} dia(s) (${validade.split('-').reverse().join('/')}) – agende a renovação.` });
    else alertas.push({ nivel: 'OK', texto: `Dentro do prazo até ${validade.split('-').reverse().join('/')} (${dd} dias).` });
    if (validadeCalculada) alertas.push({ nivel: 'AVISO', texto: `Validade calculada pela emissão + ${ctx.reciclagem_meses} meses (periodicidade do cadastro – a conferir).` });
  } else alertas.push({ nivel: 'AVISO', texto: 'Não encontrei data de validade – informe manualmente se o documento tiver prazo.' });
  const nivel = alertas.some(a => a.nivel === 'ERRO') ? 'ERRO' : alertas.some(a => a.nivel === 'AVISO') ? 'AVISO' : 'OK';
  return { nivel, situacao: sit, data_emissao: emissao, data_validade: validade, alertas, extraido: { tipo_detectado: ex.tipo_detectado ?? null, titular: ex.titular ?? null, entidade: ex.entidade ?? null, curso: ex.curso ?? null, carga_horaria: ex.carga_horaria ?? null, resultado: ex.resultado ?? null } };
}
export const PROMPT_EXTRACAO = 'Você é um assistente de conferência documental de RH/SST. Leia o documento anexado e responda SOMENTE um JSON com as chaves: legivel (boolean), tipo_detectado (ex.: ASO, certificado NR-35, RG), titular (nome completo da pessoa), data_emissao (AAAA-MM-DD), data_validade (AAAA-MM-DD, só se estiver escrita no documento), entidade (clínica/instituição emissora), curso (nome do curso/NR), carga_horaria (número de horas), resultado (apto/inapto, só se houver), observacoes (curta). Use null no que não constar; NÃO invente. NÃO transcreva diagnósticos, CID, resultados clínicos nem números de documentos pessoais.';
