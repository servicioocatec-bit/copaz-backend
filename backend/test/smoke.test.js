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

  // 16. Sin servicio de correo (RESEND) configurado: la cuenta queda verificada
  // automáticamente para poder usar y pagar sin correo.
  r = await api('GET', '/api/state', null, tokenA);
  ok(r.body.me && r.body.me.verified === true, 'Sin correo configurado, el usuario queda verificado');
  const vRow = (await pool.query(`SELECT verify_token, email_verified FROM users WHERE email='pedro@test.com'`)).rows[0];
  ok(vRow && vRow.email_verified === true && !vRow.verify_token, 'No se genera token de verificación cuando no hay correo');

  // 17. Bloqueo de groserías en mensajes
  r = await api('POST', '/api/messages', { text: 'eres un idiota' }, tokenB);
  ok(r.status === 400 && r.body.ofensivo, 'Bloquea mensaje con lenguaje ofensivo');
  for (const frase of ['chinga tu madre', 'vete a la verga igual', 'CHINGA TU MADRE', 'and4te a la verga', 'putooo', 'conchetumare']) {
    r = await api('POST', '/api/messages', { text: frase }, tokenB);
    ok(r.status === 400 && r.body.ofensivo, `Bloquea: "${frase}"`);
  }
  r = await api('POST', '/api/messages', { text: 'gracias, nos vemos el jueves' }, tokenB);
  ok(r.status === 200, 'Permite mensaje respetuoso');
  r = await api('POST', '/api/messages', { text: 'llevo a los niños al colegio a las 8' }, tokenB);
  ok(r.status === 200, 'No hay falsos positivos en un mensaje normal');

  // 18. Reembolsos, auditoría, cambiar contraseña, calendario .ics
  r = await api('POST', '/api/settlements', { amount: 5000, from: 'B', to: 'A', date: '2026-08-10', note: 'abono' }, tokenB);
  ok(r.status === 200 && r.body.id, 'Registra reembolso/abono');
  r = await api('GET', '/api/state', null, tokenA);
  ok(Array.isArray(r.body.settlements) && r.body.settlements.length === 1, 'Reembolso aparece en el estado');
  r = await api('GET', '/api/audit', null, tokenA);
  ok(r.status === 200 && Array.isArray(r.body.audit) && r.body.audit.length >= 1, 'Historial de auditoría');
  r = await api('POST', '/api/auth/change-password', { actual: 'malo', nueva: 'otraclave123' }, tokenA);
  ok(r.status === 401, 'Cambiar clave rechaza la actual incorrecta');
  r = await api('POST', '/api/auth/change-password', { actual: 'nuevapass123', nueva: 'otraclave123' }, tokenA);
  ok(r.status === 200 && r.body.ok, 'Cambia la contraseña con la actual correcta');
  const st = await api('GET', '/api/state', null, tokenA);
  const fid = st.body.family.id, ctok = st.body.family.calToken;
  ok(!!ctok, 'La familia tiene token de calendario');
  const icsRes = await fetch(base + `/api/cal/${fid}/${ctok}.ics`);
  const icsTxt = await icsRes.text();
  ok(icsRes.status === 200 && icsTxt.includes('BEGIN:VCALENDAR'), 'Feed .ics del calendario funciona');

  // 19. Tareas (colegio/hogar) sincronizadas entre padres
  r = await api('POST', '/api/tasks', { title: 'Maqueta del sistema solar', type: 'colegio', subject: 'Ciencias', due: '2026-09-01', done: false }, tokenA);
  const taskId = r.body.id;
  ok(r.status === 200 && taskId, 'A crea una tarea de colegio');
  r = await api('GET', '/api/state', null, tokenB);
  ok(Array.isArray(r.body.tasks) && r.body.tasks.length === 1 && r.body.tasks[0].title.includes('Maqueta'), 'B ve la tarea (sincronizada)');
  r = await api('PATCH', '/api/tasks/' + taskId, { title: 'Maqueta del sistema solar', type: 'colegio', done: true }, tokenB);
  ok(r.status === 200 && r.body.done === true, 'B marca la tarea como hecha');
  r = await api('POST', '/api/tasks', { title: 'Tender la cama', type: 'hogar', done: false }, tokenB);
  ok(r.status === 200 && r.body.id, 'B crea un quehacer del hogar');
  r = await api('GET', '/api/state', null, tokenA);
  ok(r.body.tasks.length === 2, 'A ve ambas tareas');

  // 19b. Nuevas entidades: excepciones, recurrentes, acuerdos, lista
  r = await api('POST', '/api/overrides', { start: '2026-09-18', end: '2026-09-19', who: 'A', note: 'Fiestas Patrias' }, tokenA);
  ok(r.status === 200 && r.body.id, 'Crea excepción de custodia (feriado)');
  r = await api('POST', '/api/recurring', { title: 'Colegiatura', amount: 120000, dia: 5, payer: 'A', split: 50, cat: 'Educación' }, tokenA);
  ok(r.status === 200 && r.body.id, 'Crea gasto recurrente');
  r = await api('POST', '/api/agreements', { title: 'Vacaciones', text: 'Se dividen en partes iguales', by: 'A', aceptaA: true, aceptaB: false }, tokenA);
  ok(r.status === 200 && r.body.id, 'Crea acuerdo de coparentalidad');
  r = await api('POST', '/api/shopping', { text: 'Zapatillas', done: false }, tokenB);
  ok(r.status === 200 && r.body.id, 'Agrega ítem a la lista de necesidades');
  r = await api('GET', '/api/state', null, tokenB);
  ok(r.body.overrides.length === 1 && r.body.recurring.length === 1 && r.body.agreements.length === 1 && r.body.shopping.length === 1, 'Las nuevas entidades se sincronizan');

  // 19b-2. Módulos nuevos: pensión de alimentos, entregas y decisiones conjuntas
  r = await api('POST', '/api/support', { month: '2026-08', amount: 250000, paid: true, paidDate: '2026-08-05', method: 'Transferencia', note: 'Agosto' }, tokenA);
  ok(r.status === 200 && r.body.id, 'Registra pago de pensión de alimentos');
  const supportId = r.body.id;
  r = await api('POST', '/api/handoffs', { date: '2026-08-15', time: '19:00', from: 'A', to: 'B', note: 'Entrega en el colegio' }, tokenA);
  ok(r.status === 200 && r.body.id, 'Registra una entrega de los niños');
  r = await api('POST', '/api/decisions', { title: 'Viaje de fin de año', detail: 'Autorizar salida a la playa', proposedBy: 'A', status: 'pending', ts: Date.now() }, tokenA);
  ok(r.status === 200 && r.body.id, 'Propone una decisión conjunta');
  const decisionId = r.body.id;
  r = await api('PATCH', '/api/decisions/' + decisionId, { title: 'Viaje de fin de año', detail: 'Autorizar salida a la playa', proposedBy: 'A', status: 'approved', decidedBy: 'B', decidedAt: Date.now() }, tokenB);
  ok(r.status === 200, 'El otro padre aprueba la decisión');
  r = await api('PATCH', '/api/support/' + supportId, { month: '2026-08', amount: 250000, paid: true, note: 'Agosto (editado)' }, tokenB);
  ok(r.status === 200, 'Edita el pago de pensión');
  r = await api('GET', '/api/state', null, tokenB);
  ok(r.body.support.length === 1 && r.body.handoffs.length === 1 && r.body.decisions.length === 1 && r.body.decisions[0].status === 'approved', 'Pensión, entregas y decisiones se sincronizan');

  // 19b-3. Descargar mis datos (portabilidad)
  r = await api('GET', '/api/export', null, tokenA);
  ok(r.status === 200 && r.body.family && Array.isArray(r.body.support), 'Exporta todos mis datos');

  // 19c. Recordatorios configurables
  r = await api('PATCH', '/api/family', { reminderDays: 3 }, tokenA);
  ok(r.status === 200, 'Actualiza días de aviso de recordatorio');
  r = await api('GET', '/api/state', null, tokenB);
  ok(r.body.family.reminderDays === 3, 'reminderDays queda en 3 y sincroniza');

  // 20. Panel admin: lista de pagos
  r = await api('GET', '/api/admin/payments', null, null, { 'x-admin-key': 'testadmin' });
  ok(r.status === 200 && Array.isArray(r.body.payments), 'Admin lista pagos');

  // 20-a. Panel admin: métricas de negocio
  r = await api('GET', '/api/admin/stats', null, null, { 'x-admin-key': 'malo' });
  ok(r.status === 401, 'Métricas rechazan clave incorrecta');
  r = await api('GET', '/api/admin/stats', null, null, { 'x-admin-key': 'testadmin' });
  ok(r.status === 200 && typeof r.body.stats.familias === 'number' && typeof r.body.stats.conversion === 'number', 'Métricas devuelven números');

  // 20a. OCR: sin ANTHROPIC_API_KEY responde 503 (no rompe la app)
  r = await api('POST', '/api/ocr/evaluaciones', { image: 'data:image/jpeg;base64,xxxx' }, tokenB);
  ok(r.status === 503 && r.body.sinIA, 'OCR evaluaciones responde 503 sin llave de IA');
  r = await api('POST', '/api/ocr/horario', { image: 'data:image/jpeg;base64,xxxx' }, tokenB);
  ok(r.status === 503 && r.body.sinIA, 'OCR horario responde 503 sin llave de IA');

  // 20a-bis. Borrado de familia desde admin: crea una desechable y la elimina por email
  r = await api('POST', '/api/auth/register', { email: 'temp@test.com', password: 'secreto123', name: 'Temp' });
  ok(r.status === 200, 'Crea familia desechable');
  r = await api('POST', '/api/admin/delete-family', { email: 'temp@test.com' }, null, { 'x-admin-key': 'malo' });
  ok(r.status === 401, 'Admin borrar rechaza clave incorrecta');
  r = await api('POST', '/api/admin/delete-family', { email: 'temp@test.com' }, null, { 'x-admin-key': 'testadmin' });
  ok(r.status === 200 && r.body.ok, 'Admin borra la familia por email');
  r = await api('POST', '/api/auth/login', { email: 'temp@test.com', password: 'secreto123' });
  ok(r.status === 401, 'La cuenta borrada ya no puede iniciar sesión');

  // 20b. Respaldo completo de la base
  r = await api('GET', '/api/admin/backup', null, null, { 'x-admin-key': 'malo' });
  ok(r.status === 401, 'Respaldo rechaza clave incorrecta');
  r = await api('GET', '/api/admin/backup', null, null, { 'x-admin-key': 'testadmin' });
  ok(r.status === 200 && r.body.tablas && Array.isArray(r.body.tablas.users), 'Descarga respaldo con todas las tablas');

  // 21. Eliminar cuenta (autoservicio) — va al final porque borra la familia
  r = await api('DELETE', '/api/account', { password: 'incorrecta' }, tokenA);
  ok(r.status === 401, 'Eliminar cuenta rechaza contraseña incorrecta');
  r = await api('DELETE', '/api/account', { password: 'otraclave123' }, tokenA);
  ok(r.status === 200 && r.body.ok, 'Elimina la cuenta con la contraseña correcta');
  r = await api('GET', '/api/state', null, tokenA);
  ok(r.status !== 200, 'Tras eliminar, ya no hay acceso a la familia');

  console.log(`\n✅ ${pass} pruebas pasaron. Backend funciona de extremo a extremo.`);
} catch (e) {
  console.error('\n❌ Falló una prueba:', e.message);
  process.exitCode = 1;
} finally {
  server.close();
}
