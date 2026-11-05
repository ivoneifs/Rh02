// Motor de sugestão de contrapartida em 2 estágios:
//  1) REGRAS DETERMINÍSTICAS (palavra-chave/regex do contador) — auditáveis, prioridade manda.
//  2) CLASSIFICADOR ML leve (Naive Bayes multinomial sobre tokens do histórico) — treinado com o
//     feedback das confirmações da própria empresa; só sugere (nunca auto-confirma) abaixo do limiar.
// Decisão: regra casou → confiança 1.0 (e pode auto-confirmar); senão ML → sugestão com score.

export interface Regra {
  id: string; prioridade: number; tipoMatch: 'CONTEM' | 'COMECA_COM' | 'IGUAL' | 'REGEX';
  padrao: string; sinal: 'ENTRADA' | 'SAIDA' | 'AMBOS'; valorMin?: number; valorMax?: number;
  contaContrapartidaId: string; autoConfirmar: boolean;
}
export interface Sugestao { contaId: string; confianca: number; origem: 'REGRA' | 'ML'; regraId?: string; autoConfirmar: boolean }

/** Maiúsculas, sem acento, sem números longos (nº doc/data) e sem ruído bancário. */
export function normalizar(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase()
    .replace(/\b\d{4,}\b/g, ' ').replace(/\d{2}\/\d{2}(\/\d{2,4})?/g, ' ')
    .replace(/\b(PIX|TED|DOC|TRANSF|TRANSFERENCIA|RECEBIDO|ENVIADO|PAGTO|PAGAMENTO|COMPRA|DEBITO|CREDITO|CARTAO)\b/g, ' ')
    .replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function aplicarRegras(descricao: string, valor: number, regras: Regra[]): Sugestao | null {
  const d = normalizar(descricao);
  for (const r of [...regras].sort((a, b) => a.prioridade - b.prioridade)) {
    if (r.sinal === 'ENTRADA' && valor <= 0) continue;
    if (r.sinal === 'SAIDA' && valor >= 0) continue;
    const abs = Math.abs(valor);
    if ((r.valorMin != null && abs < r.valorMin) || (r.valorMax != null && abs > r.valorMax)) continue;
    const p = normalizar(r.padrao);
    const ok = r.tipoMatch === 'CONTEM' ? d.includes(p) : r.tipoMatch === 'COMECA_COM' ? d.startsWith(p)
      : r.tipoMatch === 'IGUAL' ? d === p : safeRegex(r.padrao).test(descricao.toUpperCase());
    if (ok) return { contaId: r.contaContrapartidaId, confianca: 1, origem: 'REGRA', regraId: r.id, autoConfirmar: r.autoConfirmar };
  }
  return null;
}

/** Regex do usuário nunca pode travar o worker (ReDoS): limita tamanho e rejeita quantificadores aninhados. */
function safeRegex(p: string): RegExp {
  if (p.length > 200 || /(\([^)]*[+*][^)]*\))[+*{]/.test(p)) return /$^/;
  try { return new RegExp(p, 'i'); } catch { return /$^/; }
}

// ---------- Naive Bayes multinomial com suavização de Laplace ----------
export class ClassificadorHistorico {
  private classes = new Map<string, { n: number; tokens: Map<string, number>; total: number }>();
  private vocab = new Set<string>(); private docs = 0;
  private toks = (d: string, sinal: 'E' | 'S') => [...normalizar(d).split(' ').filter(t => t.length > 2), `__${sinal}`];

  treinar(descricao: string, sinal: 'E' | 'S', contaId: string) {
    const c = this.classes.get(contaId) ?? { n: 0, tokens: new Map(), total: 0 };
    for (const t of this.toks(descricao, sinal)) { c.tokens.set(t, (c.tokens.get(t) ?? 0) + 1); c.total++; this.vocab.add(t); }
    c.n++; this.docs++; this.classes.set(contaId, c);
  }

  prever(descricao: string, sinal: 'E' | 'S'): Sugestao | null {
    if (this.docs === 0) return null;
    const ts = this.toks(descricao, sinal); const V = this.vocab.size;
    const scores: [string, number][] = [];
    for (const [conta, c] of this.classes) {
      let lp = Math.log(c.n / this.docs);
      for (const t of ts) lp += Math.log(((c.tokens.get(t) ?? 0) + 1) / (c.total + V));
      scores.push([conta, lp]);
    }
    const max = Math.max(...scores.map(s => s[1]));
    const exps = scores.map(([k, s]) => [k, Math.exp(s - max)] as const);
    const soma = exps.reduce((a, [, e]) => a + e, 0);
    const [conta, e] = exps.sort((a, b) => b[1] - a[1])[0];
    return { contaId: conta, confianca: e / soma, origem: 'ML', autoConfirmar: false };
  }
}

export function sugerir(desc: string, valor: number, regras: Regra[], ml: ClassificadorHistorico, limiarML = 0.6): Sugestao | null {
  const r = aplicarRegras(desc, valor, regras);
  if (r) return r;
  const m = ml.prever(desc, valor >= 0 ? 'E' : 'S');
  return m && m.confianca >= limiarML ? m : null;       // abaixo do limiar → fila de revisão manual
}
