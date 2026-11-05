// Matriz de risco configurável (PGR/GRO): 2+ dimensões, 3 métodos de cálculo, faixas/cores editáveis.
// Sem eval: o "cálculo configurável" é declarativo (PRODUTO | SOMA | TABELA), o que evita injeção de código
// vinda de configuração salva por usuários.
export interface Nivel { valor: number; rotulo: string }
export interface Dimensao { id: string; niveis: Nivel[] }
export interface Faixa { ate: number; rotulo: string; cor: string }
export interface MatrizConfig {
  dimensoes: Dimensao[]; metodo: 'PRODUTO' | 'SOMA' | 'TABELA';
  faixas: Faixa[];                                 // ordenadas por "ate" crescente (PRODUTO/SOMA)
  tabela?: Record<string, { rotulo: string; cor: string; pontuacao: number }>;  // TABELA: chave "v1|v2|..." na ordem das dimensões
}
export interface ResultadoMatriz { pontuacao: number; rotulo: string; cor: string }

export function validarConfig(c: MatrizConfig): string[] {
  const e: string[] = [];
  if (c.dimensoes.length < 2) e.push('A matriz precisa de ao menos 2 dimensões.');
  for (const d of c.dimensoes) if (new Set(d.niveis.map(n => n.valor)).size !== d.niveis.length || d.niveis.length < 2) e.push(`Dimensão "${d.id}": níveis duplicados ou insuficientes.`);
  if (c.metodo === 'TABELA') {
    const esperado = c.dimensoes.reduce((a, d) => a * d.niveis.length, 1);
    if (!c.tabela || Object.keys(c.tabela).length !== esperado) e.push(`Tabela deve cobrir todas as ${esperado} combinações.`);
  } else {
    if (!c.faixas.length) e.push('Defina ao menos uma faixa de classificação.');
    for (let i = 1; i < c.faixas.length; i++) if (c.faixas[i].ate <= c.faixas[i - 1].ate) e.push('Faixas devem ter "ate" estritamente crescente.');
  }
  return e;
}

export function calcularRisco(c: MatrizConfig, valores: Record<string, number>): ResultadoMatriz {
  const erros = validarConfig(c); if (erros.length) throw new Error('Matriz inválida: ' + erros.join(' '));
  const vs = c.dimensoes.map(d => {
    const v = valores[d.id];
    if (!d.niveis.some(n => n.valor === v)) throw new Error(`Valor ${v} inválido para a dimensão "${d.id}".`);
    return v;
  });
  if (c.metodo === 'TABELA') {
    const t = c.tabela![vs.join('|')]; return { pontuacao: t.pontuacao, rotulo: t.rotulo, cor: t.cor };
  }
  const p = c.metodo === 'PRODUTO' ? vs.reduce((a, b) => a * b, 1) : vs.reduce((a, b) => a + b, 0);
  const f = c.faixas.find(x => p <= x.ate) ?? c.faixas[c.faixas.length - 1];   // acima da última faixa = classe mais alta
  return { pontuacao: p, rotulo: f.rotulo, cor: f.cor };
}

/** Matriz 5x5 clássica (severidade × probabilidade) para novos clientes. */
export const matrizPadrao5x5: MatrizConfig = {
  dimensoes: [1, 2].map(i => ({ id: i === 1 ? 'severidade' : 'probabilidade', niveis: [1, 2, 3, 4, 5].map(v => ({ valor: v, rotulo: String(v) })) })),
  metodo: 'PRODUTO',
  faixas: [{ ate: 4, rotulo: 'Trivial', cor: '#2e9e5b' }, { ate: 9, rotulo: 'Tolerável', cor: '#9ac93c' }, { ate: 14, rotulo: 'Moderado', cor: '#f2c230' },
    { ate: 19, rotulo: 'Substancial', cor: '#ee8a2b' }, { ate: 25, rotulo: 'Intolerável', cor: '#d63b3b' }],
};
