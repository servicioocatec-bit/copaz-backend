/* Prueba de humo end-to-end con Postgres en memoria (pg-mem).
   Verifica: registro, login, unir familia, CRUD y mensajes. */
import assert from 'node:assert';
import { newDb } from 'pg-mem';
import { setPool, migrate } from '../src/db.js';
import { createApp } from '../src/server.js';

process.env.JWT_SECRET = 'test-secret';
process.env.ADMIN_KEY = 'testadmin';

// --- Preparar pg-mem como si fuera Postgres ---
const mem = newDb();
mem.public.registerFunction({ name: 'now', returns: 'timestamptz', implementation: () => new Date() });
const pg = mem.adapters.createPg();
const pool = new pg.Pool();
setPool(pool);
await migrate();

const app = createApp();
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;

const api = async (method, path, body, token, extra) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(extra || {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

let pass = 0; const ok = (c, m) => { assert.ok(c, m); console.log('  ✓', m); pass++; };

try {
  // 1. Registro padre A
  let r = await api('POST', '/api/auth/register', { email: 'pedro@test.com', password: 'secreto123', name: 'Pedro' });
  ok(r.status === 200 && r.body.token, 'Registro de Pedro (rol A) + token');
  ok(r.body.inviteCode && r.body.inviteCode.length === 6, 'Genera código de invitación: ' + r.body.inviteCode);
  const tokenA = r.body.token; const invite = r.body.inviteCode;

  // 2. Correo duplicado rechazado
  r = await api('POST', '/api/auth/register', { email: 'pedro@test.com', password: 'x', name: 'X' });
  ok(r.status === 409 || r.status === 400, 'Rechaza correo duplicado / contraseña corta');

  // 3. Login
  r = await api('POST', '/api/auth/login', { email: 'pedro@test.com', password: 'secreto123' });
  ok(r.status === 200 && r.body.token, 'Login correcto');
  r = await api('POST', '/api/auth/login', { email: 'pedro@test.com', password: 'malo' });
  ok(r.status === 401, 'Login con contraseña incorrecta rechazado');

  // 4. Registro padre B y unirse a la familia con el código
  r = await api('POST', '/api/auth/register', { email: 'ana@test.com', password: 'secreto123', name: 'Ana' });
  const tokenBsolo = r.body.token;
  r = await api('POST', '/api/family/join', { inviteCode: invite }, tokenBsolo);
  ok(r.status === 200 && r.body.user.role === 'B', 'Ana se une a la familia como rol B');
  const tokenB = r.body.token;

  // 5. Estado compartido
  r = await api('GET', '/api/state', null, tokenA);
  ok(r.status === 200 && r.body.members.length === 2, 'Estado con 2 miembros vinculados');
  ok(r.body.family.parents.A === 'Pedro' && r.body.family.parents.B === 'Ana', 'Nombres de padres correctos');

  // 6. Crear hijo (por A) y verlo desde B
  r = await api('POST', '/api/kids', { name: 'Sofía', allergies: 'Penicilina' }, tokenA);
  const kidId = r.body.id;
  ok(r.status === 200 && kidId, 'A crea hijo Sofía');
  r = await api('GET', '/api/state', null, tokenB);
  ok(r.body.kids.length === 1 && r.body.kids[0].name === 'Sofía', 'B ve el hijo creado por A (sincronizado)');

  // 7. Crear gasto y editarlo
  r = await api('POST', '/api/expenses', { title: 'Colegiatura', amount: 3200, payer: 'A', split: 50, settled: false }, tokenA);
  const expId = r.body.id;
  ok(r.status === 200, 'Crea gasto');
  r = await api('PATCH', '/api/expenses/' + expId, { title: 'Colegiatura', amount: 3200, payer: 'A', split: 50, settled: true }, tokenB);
  ok(r.status === 200 && r.body.settled === true, 'B marca el gasto como saldado');

  // 8. Mensajes (inmutables)
  r = await api('POST', '/api/messages', { text: 'Gracias por llevar a Sofía' }, tokenB);
  ok(r.status === 200 && r.body.from === 'B', 'B envía mensaje');
  r = await api('GET', '/api/state', null, tokenA);
  ok(r.body.messages.length === 1 && r.body.messages[0].text.includes('Sofía'), 'A recibe el mensaje');

  // 9. Ajustes de familia (esquema de custodia)
  r = await api('PATCH', '/api/family', { schedule: { type: 'semanal', start: '2026-08-01', startParent: 'A' } }, tokenA);
  ok(r.status === 200, 'Actualiza esquema de custodia');

  // 10. Seguridad: sin token no hay acceso
  r = await api('GET', '/api/state', null, null);
  ok(r.status === 401, 'Bloquea acceso sin token');

  // 11. Borrar hijo
  r = await api('DELETE', '/api/kids/' + kidId, null, tokenA);
  ok(r.status === 200, 'Borra hijo');
  r = await api('GET', '/api/state', null, tokenB);
  ok(r.body.kids.length === 0, 'Borrado sincronizado a B');

  // 12. Intercambio de días (swaps)
  r = await api('POST', '/api/swaps', { date: '2026-08-15', from: 'A', to: 'B', note: 'Tengo boda', status: 'pending' }, tokenA);
  const swapId = r.body.id;
  ok(r.status === 200 && swapId, 'A propone intercambio de día');
  r = await api('GET', '/api/state', null, tokenB);
  ok(r.body.swaps.length === 1 && r.body.swaps[0].status === 'pending', 'B ve la propuesta pendiente');
  r = await api('PATCH', '/api/swaps/' + swapId, { date: '2026-08-15', from: 'A', to: 'B', note: 'Tengo boda', status: 'accepted' }, tokenB);
  ok(r.status === 200 && r.body.status === 'accepted', 'B acepta el intercambio');
  r = await api('GET', '/api/state', null, tokenA);
  ok(r.body.swaps[0].status === 'accepted', 'Intercambio aceptado sincronizado a A');

  // 13. Bitácora (journal)
  r = await api('POST', '/api/journal', { text: 'Primer día de escuela', author: 'A', date: '2026-08-04', ts: Date.now() }, tokenA);
  ok(r.status === 200 && r.body.id, 'A crea nota en la bitácora');
  r = await api('GET', '/api/state', null, tokenB);
  ok(r.body.journal.length === 1 && r.body.journal[0].text.includes('escuela'), 'B ve la nota (sincronizada)');

  // 14. Acceso: prueba automática, bloqueo y activación admin
  r = await api('GET', '/api/state', null, tokenA);
  ok(r.body.family.access && r.body.family.access.enTrial === true && r.body.family.access.bloqueado === false, 'Nueva familia entra en prueba (no bloqueada)');
  r = await api('GET', '/api/pay/status', null, tokenA);
  ok(r.status === 200 && r.body.access && r.body.access.activo === true, 'pay/status: acceso activo por prueba');
  r = await api('POST', '/api/pay/create', { plan: 'anual' }, tokenA);
  ok(r.status === 503, 'Sin llaves Flow, /pay/create responde 503');
  r = await api('POST', '/api/admin/activate', { email: 'pedro@test.com', plan: 'anual' }, null, { 'x-admin-key': 'testadmin' });
  ok(r.status === 200 && r.body.ok, 'Admin activa Premium por email');
  r = await api('POST', '/api/admin/activate', { email: 'pedro@test.com', plan: 'anual' }, null, { 'x-admin-key': 'malo' });
  ok(r.status === 401, 'Admin rechaza clave incorrecta');
  r = await api('GET', '/api/state', null, tokenA);
  ok(r.body.family.access.premium === true, 'Familia queda Premium tras activación admin');

  // 15. Recuperación de contraseña
  r = await api('POST', '/api/auth/forgot', { email: 'pedro@test.com' });
  ok(r.status === 200 && r.body.ok, 'forgot responde ok (sin filtrar existencia)');
  const tokRow = (await pool.query(`SELECT reset_token FROM users WHERE email='pedro@test.com'`)).rows[0];
  ok(tokRow && tokRow.reset_token, 'forgot genera token de reseteo en la base');
  r = await api('POST', '/api/auth/reset', { token: tokRow.reset_token, password: 'nuevapass123' });
  ok(r.status === 200 && r.body.ok, 'reset cambia la contraseña');
  r = await api('POST', '/api/auth/login', { email: 'pedro@test.com', password: 'nuevapass123' });
  ok(r.status === 200 && r.body.token, 'login con la nueva contraseña funciona');
  r = await api('GET', '/api/admin/families', null, null, { 'x-admin-key': 'testadmin' });
  ok(r.status === 200 && Array.isArray(r.body.families) && r.body.families.length >= 1, 'admin lista familias');

  console.log(`\n✅ ${pass} pruebas pasaron. Backend funciona de extremo a extremo.`);
} catch (e) {
  console.error('\n❌ Falló una prueba:', e.message);
  process.exitCode = 1;
} finally {
  server.close();
}
