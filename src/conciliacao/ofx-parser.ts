// Parser OFX tolerante: aceita OFX 1.x (SGML, tags sem fechamento) e 2.x (XML).
// Para PDF: o worker faz extração de texto (pdf-parse / OCR para escaneados) e converte para a mesma
// estrutura ItemExtrato; este parser cobre o caminho determinístico.
export interface ItemExtrato { fitid: string; data: string; valor: string; descricao: string; tipo?: string }
export interface ExtratoOFX { banco?: string; conta?: string; moeda?: string; itens: ItemExtrato[] }

const tag = (blk: string, t: string) => {
  const m = new RegExp(`<${t}>([^<\\r\\n]*)`, 'i').exec(blk);
  return m ? m[1].trim() : undefined;
};

// OFX: 20250131120000[-3:BRT] → 2025-01-31
const dataOFX = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

/** "1.234,56" / "-1234.56" → "-1234.56" (string decimal, sem float). */
export function normalizaValor(raw: string): string {
  let s = raw.trim().replace(/\s/g, '');
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(',', '.');
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) throw new Error(`Valor OFX inválido: ${raw}`);
  return s;
}

export function parseOFX(conteudo: string): ExtratoOFX {
  const txt = conteudo.replace(/\r/g, '');
  if (!/<OFX>/i.test(txt)) throw new Error('Arquivo não é OFX (tag <OFX> ausente).');
  const itens: ItemExtrato[] = [];
  const re = /<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi;
  for (let m; (m = re.exec(txt)); ) {
    const b = m[1];
    const fitid = tag(b, 'FITID'), dt = tag(b, 'DTPOSTED'), amt = tag(b, 'TRNAMT');
    if (!fitid || !dt || !amt) continue;                       // transação incompleta → vai p/ log de rejeitados
    itens.push({
      fitid, data: dataOFX(dt), valor: normalizaValor(amt),
      descricao: [tag(b, 'MEMO'), tag(b, 'NAME')].filter(Boolean).join(' ').replace(/&amp;/g, '&'),
      tipo: tag(b, 'TRNTYPE'),
    });
  }
  return { banco: tag(txt, 'BANKID'), conta: tag(txt, 'ACCTID'), moeda: tag(txt, 'CURDEF'), itens };
}
