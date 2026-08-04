/* Rutas de la API de Copaz. */
import express from 'express';
import { q, familyState } from './db.js';
import { hash, compare, sign, requireAuth } from './auth.js';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
const code = () => Math.random().toString(36).slice(2, 8).toUpperCase(); // invitación 6 chars

export function buildRouter(broadcast) {
  const r = express.Router();

  /* ------------------------------ AUTH ------------------------------ */

  // Registro: crea usuario + su familia (rol A) + código de invitación.
  r.post('/auth/register', async (req, res) => {
    const { email, password, name } = req.body || {};
    if (!email || !password || !name) return res.status(400).json({ error: 'Faltan datos' });
    if (String(password).length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    const exists = (await q(`SELECT 1 FROM users WHERE email=$1`, [email.toLowerCase()])).rowCount;
    if (exists) return res.status(409).json({ error: 'Ese correo ya está registrado' });

    const familyId = uid();
    let invite = code();
    // asegurar unicidad del código
    while ((await q(`SELECT 1 FROM families WHERE invite_code=$1`, [invite])).rowCount) invite = code();

    await q(`INSERT INTO families (id, invite_code, parents) VALUES ($1,$2,$3)`,
      [familyId, invite, JSON.stringify({ A: name, B: '' })]);

    const userId = uid();
    await q(`INSERT INTO users (id, email, password, name, family_id, role) VALUES ($1,$2,$3,$4,$5,'A')`,
      [userId, email.toLowerCase(), await hash(password), name, familyId]);

    const user = { id: userId, email: email.toLowerCase(), family_id: familyId, role: 'A' };
    res.json({ token: sign(user), user: { id: userId, name, email: user.email, role: 'A' }, inviteCode: invite });
  });

  // Login
  r.post('/auth/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Faltan datos' });
    const u = (await q(`SELECT * FROM users WHERE email=$1`, [String(email).toLowerCase()])).rows[0];
    if (!u || !(await compare(password, u.password))) return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
    res.json({ token: sign(u), user: { id: u.id, name: u.name, email: u.email, role: u.role } });
  });

  // Unirse a la familia del otro padre con el código de invitación (rol B).
  r.post('/family/join', requireAuth, async (req, res) => {
    const { inviteCode } = req.body || {};
    const fam = (await q(`SELECT * FROM families WHERE invite_code=$1`, [String(inviteCode || '').toUpperCase()])).rows[0];
    if (!fam) return res.status(404).json({ error: 'Código de invitación no válido' });

    const taken = (await q(`SELECT role FROM users WHERE family_id=$1`, [fam.id])).rows.map(x => x.role);
    if (taken.includes('A') && taken.includes('B')) return res.status(409).json({ error: 'Esta familia ya tiene dos padres vinculados' });
    const role = taken.includes('A') ? 'B' : 'A';

    const me = (await q(`SELECT * FROM users WHERE id=$1`, [req.user.uid])).rows[0];
    await q(`UPDATE users SET family_id=$1, role=$2 WHERE id=$3`, [fam.id, role, me.id]);
    const parents = { ...(fam.parents || {}), [role]: me.name };
    await q(`UPDATE families SET parents=$1 WHERE id=$2`, [JSON.stringify(parents), fam.id]);

    const user = { id: me.id, email: me.email, family_id: fam.id, role };
    broadcast(fam.id, { type: 'sync' });
    res.json({ token: sign(user), user: { id: me.id, name: me.name, email: me.email, role } });
  });

  /* --------------------------- ESTADO ------------------------------- */
  r.get('/state', requireAuth, async (req, res) => {
    const state = await familyState(req.user.family_id);
    if (!state) return res.status(404).json({ error: 'Familia no encontrada' });
    res.json(state);
  });

  // Ajustes de familia (moneda, esquema de custodia, nombres).
  r.patch('/family', requireAuth, async (req, res) => {
    const { currency, schedule, parents } = req.body || {};
    const cur = (await q(`SELECT * FROM families WHERE id=$1`, [req.user.family_id])).rows[0];
    await q(`UPDATE families SET currency=$1, schedule=$2, parents=$3 WHERE id=$4`, [
      currency ?? cur.currency,
      JSON.stringify(schedule ?? cur.schedule),
      JSON.stringify(parents ?? cur.parents),
      req.user.family_id,
    ]);
    broadcast(req.user.family_id, { type: 'sync' });
    res.json({ ok: true });
  });

  /* ----------------------------- MENSAJES --------------------------- */
  /* Definido ANTES del CRUD genérico para que no lo capture /:entity.
     Los mensajes son inmutables: solo se crean y se listan. */
  r.post('/messages', requireAuth, async (req, res) => {
    const text = String(req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Mensaje vacío' });
    const id = uid(); const ts = Date.now();
    await q(`INSERT INTO messages (id, family_id, sender, role, text, ts) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, req.user.family_id, req.user.uid, req.user.role, text, ts]);
    broadcast(req.user.family_id, { type: 'message', message: { id, from: req.user.role, text, ts } });
    res.json({ id, from: req.user.role, text, ts });
  });

  /* --------------------- CRUD genérico por entidad ------------------ */
  const ENTITIES = ['kids', 'events', 'expenses', 'docs', 'swaps'];
  const guard = (t, res) => { if (!ENTITIES.includes(t)) { res.status(404).json({ error: 'Entidad no válida' }); return false; } return true; };

  // Crear
  r.post('/:entity', requireAuth, async (req, res) => {
    const t = req.params.entity;
    if (!guard(t, res)) return;
    const id = req.body.id || uid();
    const { id: _omit, ...data } = req.body;
    await q(`INSERT INTO ${t} (id, family_id, data) VALUES ($1,$2,$3)`, [id, req.user.family_id, JSON.stringify(data)]);
    broadcast(req.user.family_id, { type: 'sync' });
    res.json({ id, ...data });
  });

  // Actualizar
  r.patch('/:entity/:id', requireAuth, async (req, res) => {
    const t = req.params.entity;
    if (!guard(t, res)) return;
    const { id: _omit, ...data } = req.body;
    const upd = await q(`UPDATE ${t} SET data=$1, updated_at=now() WHERE id=$2 AND family_id=$3`,
      [JSON.stringify(data), req.params.id, req.user.family_id]);
    if (!upd.rowCount) return res.status(404).json({ error: 'No encontrado' });
    broadcast(req.user.family_id, { type: 'sync' });
    res.json({ id: req.params.id, ...data });
  });

  // Borrar
  r.delete('/:entity/:id', requireAuth, async (req, res) => {
    const t = req.params.entity;
    if (!guard(t, res)) return;
    await q(`DELETE FROM ${t} WHERE id=$1 AND family_id=$2`, [req.params.id, req.user.family_id]);
    broadcast(req.user.family_id, { type: 'sync' });
    res.json({ ok: true });
  });

  return r;
}
