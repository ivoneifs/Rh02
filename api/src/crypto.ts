import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
// AES-256-GCM (autenticado: detecta adulteração). Mestre = 32 bytes em hex (64 caracteres) vindos do ambiente.
export const criptografiaDisponivel = () => /^[0-9a-f]{64}$/i.test(process.env.IA_MASTER_KEY ?? '');
const mestre = () => {
  if (!criptografiaDisponivel()) throw new Error('IA_MASTER_KEY ausente ou inválida (64 caracteres hex).');
  return Buffer.from(process.env.IA_MASTER_KEY!, 'hex');
};
export function cifrar(texto: string): Buffer {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', mestre(), iv);
  const ct = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}
export function decifrar(blob: Buffer): string {
  const d = createDecipheriv('aes-256-gcm', mestre(), blob.subarray(0, 12));
  d.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]).toString('utf8');
}
