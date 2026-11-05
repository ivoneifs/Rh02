import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sqls = readFileSync(join(raiz, 'src/relatorios/balancete.sql'), 'utf8').split(';').filter(q => /SELECT/.test(q)).map(q => q.trim());
export const SQL_BALANCETE = sqls[0], SQL_RAZAO = sqls[1];
