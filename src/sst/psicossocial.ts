// Apuração de questionário psicossocial com ANONIMATO: grupos com menos de k respondentes são suprimidos
// (não se calcula nem exibe média), impedindo identificação indireta em equipes pequenas.
export interface Item { id: string; dimensao: string; invertido?: boolean }
export interface Instrumento {
  escalaMin: number; escalaMax: number; itens: Item[];
  /** limites inferiores de 0–100 de cada classe, para dimensões em que QUANTO MAIOR, PIOR. */
  faixasRisco: { moderado: number; alto: number; critico: number };
  dimensoesPositivas?: string[];     // quanto MAIOR, MELHOR (ex.: apoio social): classificação espelhada
}
export interface RespostaAnonima { grupoId: string; valores: Record<string, number> }
export type Classe = 'BAIXO' | 'MODERADO' | 'ALTO' | 'CRITICO';
export interface ResultadoDimensao { grupoId: string; dimensao: string; n: number; media: number | null; classe: Classe | null; suprimido: boolean }

const norm = (v: number, i: Instrumento, inv?: boolean) => {
  const p = ((v - i.escalaMin) / (i.escalaMax - i.escalaMin)) * 100; return inv ? 100 - p : p;
};
export function apurar(ins: Instrumento, respostas: RespostaAnonima[], kMinimo: number): ResultadoDimensao[] {
  const grupos = new Set(respostas.map(r => r.grupoId)); const dims = [...new Set(ins.itens.map(i => i.dimensao))]; const out: ResultadoDimensao[] = [];
  for (const g of grupos) {
    const rs = respostas.filter(r => r.grupoId === g);
    for (const d of dims) {
      if (rs.length < kMinimo) { out.push({ grupoId: g, dimensao: d, n: rs.length, media: null, classe: null, suprimido: true }); continue; }
      const itens = ins.itens.filter(i => i.dimensao === d);
      const porResp = rs.map(r => {
        const vs = itens.filter(i => r.valores[i.id] != null).map(i => norm(r.valores[i.id], ins, i.invertido));
        return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
      }).filter((x): x is number => x != null);
      if (porResp.length < kMinimo) { out.push({ grupoId: g, dimensao: d, n: porResp.length, media: null, classe: null, suprimido: true }); continue; }
      const media = Math.round((porResp.reduce((a, b) => a + b, 0) / porResp.length) * 100) / 100;
      const pior = ins.dimensoesPositivas?.includes(d) ? 100 - media : media;       // espelha dimensões "positivas"
      const f = ins.faixasRisco;
      out.push({ grupoId: g, dimensao: d, n: porResp.length, media, suprimido: false,
        classe: pior >= f.critico ? 'CRITICO' : pior >= f.alto ? 'ALTO' : pior >= f.moderado ? 'MODERADO' : 'BAIXO' });
    }
  }
  return out;
}
