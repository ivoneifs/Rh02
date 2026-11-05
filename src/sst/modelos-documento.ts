// Renderizador de modelos ({{variavel}}) para PGR/PCMSO/ASO/ficha de EPI/OS etc.
// Seguro por construção: só substitui variáveis (sem expressões/eval), escapa HTML por padrão e FALHA se faltar variável —
// um laudo com "{{cargo}}" literal ou campo vazio seria um documento com validade comprometida.
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const variaveisDoModelo = (html: string) => [...new Set([...html.matchAll(/\{\{\s*([a-z0-9_.]+)\s*\}\}/gi)].map(m => m[1]))];

export function renderizar(modelo: string, dados: Record<string, string | number | undefined>, raw: Set<string> = new Set()): string {
  const faltando = variaveisDoModelo(modelo).filter(v => dados[v] === undefined || dados[v] === '');
  if (faltando.length) throw new Error(`Variáveis sem valor: ${faltando.join(', ')}`);
  return modelo.replace(/\{\{\s*([a-z0-9_.]+)\s*\}\}/gi, (_, k) => raw.has(k) ? String(dados[k]) : esc(String(dados[k])));
}
