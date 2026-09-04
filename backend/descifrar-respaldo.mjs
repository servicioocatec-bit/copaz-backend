/* Descifra un respaldo .json.enc de Copaz.
   Uso:
     node backend/descifrar-respaldo.mjs copaz-respaldo-2026-09-04.json.enc "tu-frase-secreta"
   o con variable de entorno:
     BACKUP_PASSPHRASE="tu-frase" node backend/descifrar-respaldo.mjs archivo.json.enc

   Escribe el JSON descifrado en <archivo>.descifrado.json */
import fs from 'fs';
import { descifrar } from './src/cripto.js';

const archivo = process.argv[2];
const frase = process.argv[3] || process.env.BACKUP_PASSPHRASE || '';
if (!archivo || !frase) {
  console.error('Uso: node backend/descifrar-respaldo.mjs <archivo.json.enc> "<frase>"');
  process.exit(1);
}
try {
  const sobre = fs.readFileSync(archivo, 'utf8');
  const plano = descifrar(sobre, frase);
  const salida = archivo.replace(/\.enc$/, '') + '.descifrado.json';
  fs.writeFileSync(salida, plano);
  console.log('✅ Descifrado en: ' + salida);
} catch (e) {
  console.error('❌ No se pudo descifrar (¿frase incorrecta o archivo dañado?):', e.message);
  process.exit(1);
}
