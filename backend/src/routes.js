/* Rutas de la API de Copaz. */
import express from 'express';
import webpush from 'web-push';
import { q, familyState } from './db.js';
import { hash, compare, sign, requireAuth } from './auth.js';
import { flowReady, flowPost } from './flow.js';

/* Planes Premium (por cada padre). Días de vigencia que otorga cada pago. */
const PLANES = {
  mensual: { amount: 9990,  dias: 30,  label: 'mensual' },
  anual:   { amount: 89990, dias: 365, label: 'anual' },
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
const code = () => Math.random().toString(36).slice(2, 8).toUpperCase(); // invitación 6 chars

/* --- Notificaciones push (web-push + VAPID) --- */
const VAPID_PUBLIC = process.env.VAPID_PUBLIC || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE || '';
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:soporte@copaz.app', VAPID_PUBLIC, VAPID_PRIVATE);
}
async function nombreDe(familyId, role) {
  const fam = (await q(`SELECT parents FROM families WHERE id=$1`, [familyId])).rows[0];
  return (fam && fam.parents && fam.parents[role]) || 'El otro padre/madre';
}
async function sendPush(familyId, exceptRole, payload) {
  if (!VAPID_PUBLIC) return;
  const subs = (await q(`SELECT endpoint, sub FROM push_subs WHERE family_id=$1 AND role<>$2`, [familyId, exceptRole])).rows;
  await Promise.all(subs.map(async s => {
    try { await webpush.sendNotification(s.sub, JSON.stringify(payload)); }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await q(`DELETE FROM push_subs WHERE endpoint=$1`, [s.endpoint]); }
  }));
}

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

  /* --------------------------- PUSH -------------------------------- */
  r.get('/push/vapid', (_req, res) => res.json({ key: VAPID_PUBLIC }));
  r.post('/push/subscribe', requireAuth, async (req, res) => {
    const sub = req.body.sub;
    if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Suscripción no válida' });
    await q(`INSERT INTO push_subs (id, family_id, user_id, role, endpoint, sub) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (endpoint) DO UPDATE SET family_id=$2, user_id=$3, role=$4, sub=$6`,
      [uid(), req.user.family_id, req.user.uid, req.user.role, sub.endpoint, JSON.stringify(sub)]);
    res.json({ ok: true });
  });

  /* ------------------------------ PAGOS (Flow) --------------------------- */
  const baseUrl = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  const frontUrl = () => (process.env.FRONTEND_URL || '').replace(/\/+$/, '');

  // Estado Premium de la familia
  r.get('/pay/status', requireAuth, async (req, res) => {
    const f = (await q(`SELECT premium_until, premium_plan FROM families WHERE id=$1`, [req.user.family_id])).rows[0] || {};
    const activo = !!(f.premium_until && new Date(f.premium_until) > new Date());
    res.json({ flowReady: flowReady(), premium: { activo, until: f.premium_until || null, plan: f.premium_plan || null } });
  });

  // Crea el pago en Flow y devuelve la URL a la que redirigir al usuario.
  r.post('/pay/create', requireAuth, async (req, res) => {
    const plan = req.body.plan === 'anual' ? 'anual' : 'mensual';
    const p = PLANES[plan];
    if (!flowReady()) return res.status(503).json({ error: 'El cobro con Flow aún no está configurado en el servidor.' });
    const u = (await q(`SELECT email FROM users WHERE id=$1`, [req.user.uid])).rows[0];
    const order = `COPAZ-${req.user.family_id}-${plan}-${Date.now()}`;
    try {
      const result = await flowPost('/payment/create', {
        commerceOrder: order,
        subject: `Copaz Premium ${p.label} (por cada padre)`,
        currency: 'CLP',
        amount: p.amount,
        email: u.email,
        urlConfirmation: `${baseUrl(req)}/api/pay/webhook`,
        urlReturn: `${baseUrl(req)}/api/pay/return`,
        optional: JSON.stringify({ family: req.user.family_id, plan }),
      });
      await q(`INSERT INTO payments (id, family_id, "order", plan, amount, status) VALUES ($1,$2,$3,$4,$5,'pending')
        ON CONFLICT ("order") DO NOTHING`, [uid(), req.user.family_id, order, plan, p.amount]);
      const url = (result.url && result.token) ? `${result.url}?token=${result.token}` : (result.url || null);
      if (!url) return res.status(502).json({ error: 'Flow no devolvió una URL de pago' });
      res.json({ url });
    } catch (e) { res.status(500).json({ error: 'Error creando el pago: ' + e.message }); }
  });

  // Consulta el estado real en Flow y activa Premium si está pagado.
  async function activarDesdeToken(token) {
    if (!token || !flowReady()) return null;
    const status = await flowPost('/payment/getStatus', { token });
    const pagado = [2, '2'].includes(status.status);
    let familyId = null, plan = 'mensual';
    try { const o = JSON.parse(status.optional || '{}'); familyId = o.family; plan = o.plan || 'mensual'; } catch {}
    if (!familyId && status.commerceOrder) { const parts = String(status.commerceOrder).split('-'); familyId = parts[1]; plan = parts[2] || 'mensual'; }
    if (!pagado || !familyId) { return { pagado, familyId }; }
    const dias = (PLANES[plan] || PLANES.mensual).dias;
    const cur = (await q(`SELECT premium_until FROM families WHERE id=$1`, [familyId])).rows[0];
    const desde = (cur && cur.premium_until && new Date(cur.premium_until) > new Date()) ? new Date(cur.premium_until) : new Date();
    const until = new Date(desde.getTime() + dias * 86400000);
    await q(`UPDATE families SET premium_until=$1, premium_plan=$2 WHERE id=$3`, [until.toISOString(), plan, familyId]);
    if (status.commerceOrder) await q(`UPDATE payments SET status='paid' WHERE "order"=$1`, [status.commerceOrder]).catch(() => {});
    broadcast(familyId, { type: 'sync' });
    return { pagado: true, familyId, plan, until };
  }

  // Webhook: Flow lo llama al confirmarse el pago (servidor a servidor).
  r.post('/pay/webhook', async (req, res) => {
    res.status(200).send('OK');
    try { await activarDesdeToken(req.body.token || req.query.token); } catch {}
  });

  // Retorno: Flow devuelve al usuario aquí; activamos y lo mandamos de vuelta a la app.
  const handleReturn = async (req, res) => {
    try { await activarDesdeToken(req.body.token || req.query.token); } catch {}
    const dest = frontUrl() ? `${frontUrl()}/#/inicio` : '/';
    res.send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Copaz</title><body style="font-family:system-ui;background:#f7f9fb;color:#0f172a;text-align:center;padding:60px 20px"><h1 style="color:#0d9488">✓ Pago recibido</h1><p>Ya puedes volver a Copaz. Tu Premium se activa en unos segundos.</p><p><a href="${dest}" style="display:inline-block;margin-top:16px;background:#0d9488;color:#fff;text-decoration:none;padding:12px 22px;border-radius:12px;font-weight:700">Volver a Copaz</a></p><script>setTimeout(function(){location.href=${JSON.stringify(dest)}},2500)</script></body>`);
  };
  r.get('/pay/return', handleReturn);
  r.post('/pay/return', handleReturn);

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
    nombreDe(req.user.family_id, req.user.role).then(n => sendPush(req.user.family_id, req.user.role, {
      title: n, body: text.slice(0, 120), url: './#/mensajes', tag: 'mensajes',
    })).catch(() => {});
    res.json({ id, from: req.user.role, text, ts });
  });

  /* --------------------- CRUD genérico por entidad ------------------ */
  const ENTITIES = ['kids', 'events', 'expenses', 'docs', 'swaps', 'journal'];
  const guard = (t, res) => { if (!ENTITIES.includes(t)) { res.status(404).json({ error: 'Entidad no válida' }); return false; } return true; };

  // Crear
  r.post('/:entity', requireAuth, async (req, res) => {
    const t = req.params.entity;
    if (!guard(t, res)) return;
    const id = req.body.id || uid();
    const { id: _omit, ...data } = req.body;
    await q(`INSERT INTO ${t} (id, family_id, data) VALUES ($1,$2,$3)`, [id, req.user.family_id, JSON.stringify(data)]);
    broadcast(req.user.family_id, { type: 'sync' });
    if (t === 'swaps') {
      nombreDe(req.user.family_id, req.user.role).then(n => sendPush(req.user.family_id, req.user.role, {
        title: 'Solicitud de intercambio', body: `${n} propone un cambio de día`, url: './#/calendario', tag: 'swap',
      })).catch(() => {});
    } else if (t === 'expenses') {
      nombreDe(req.user.family_id, req.user.role).then(n => sendPush(req.user.family_id, req.user.role, {
        title: 'Nuevo gasto', body: `${n} registró: ${(data.title || '').slice(0, 60)}`, url: './#/gastos', tag: 'gasto',
      })).catch(() => {});
    }
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
