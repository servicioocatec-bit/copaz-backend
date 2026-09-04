/* Cifrado de respaldos con AES-256-GCM y clave derivada de una frase secreta
   (scrypt). Sin dependencias externas. El sobre resultante es un JSON con la
   sal, el IV, el tag y los datos, todo en base64: se puede descifrar en
   cualquier parte con la misma frase (ver backend/descifrar-respaldo.mjs). */
import crypto from 'crypto';

export function cifrar(textoPlano, frase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(String(frase), salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(textoPlano, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1, alg: 'aes-256-gcm', kdf: 'scrypt',
    salt: salt.toString('base64'), iv: iv.toString('base64'),
    tag: tag.toString('base64'), data: enc.toString('base64'),
  });
}

export function descifrar(sobreJson, frase) {
  const s = typeof sobreJson === 'string' ? JSON.parse(sobreJson) : sobreJson;
  const salt = Buffer.from(s.salt, 'base64');
  const iv = Buffer.from(s.iv, 'base64');
  const tag = Buffer.from(s.tag, 'base64');
  const key = crypto.scryptSync(String(frase), salt, 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(Buffer.from(s.data, 'base64')), decipher.final()]);
  return dec.toString('utf8');
}
