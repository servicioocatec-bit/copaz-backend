/* Rutas de la API de Copaz. */
import express from 'express';
import crypto from 'crypto';
import webpush from 'web-push';
import { q, familyState } from './db.js';
import { hash, compare, sign, requireAuth } from './auth.js';
import { flowReady, flowPost } from './flow.js';
import { enviarCorreo, correoBienvenida, correoReset, correoVerificacion } from './mail.js';

/* Groserías/insultos que se bloquean en los mensajes (también validado en el cliente). */
function normGros(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't').replace(/@/g, 'a').replace(/\$/g, 's')
    .replace(/(.)\1{2,}/g, '$1');
}
const GROSERIAS = /\b(cs?m|ctm|ql[oa]?|qli?a[oa]|conch[ae]?(tumare|tumadre|desumadre|etumare)?|conchetumare|culi?a?[oa]s?|culea?[oa]s?|maricon(es)?|marica|maraco|hij[oa] de (put[ao]|perr[ao]|mil putas)|hdp|hijuep[au]t[ao]|malpari[dt][oa]|mierda|mrd|put[ao]s?|puton|putea(n|r|s)?|zorra|imbecil(es)?|idiota|estupid[oa]s?|tarad[oa]s?|inutil(es)?|pendej[oa]s?|boludo|pelotud[oa]|cabron(es)?|verga|vrga|care?verga|chinga(d[oa]|r|s|n|mos)?|chingue|coño|cono|carajo|joder|jodete|jodid[oa]|cojones|gilipollas|capullo|mam[oa]n(es)?|mamada|mamah?uevo|mames|polla|soplapollas|garca|forro|gonorrea|malnacid[oa]|cretin[oa]|subnormal|retrasad[oa]|mongolic[oa]|desgraciad[oa]|anda a la (mierda|conch|verga|chingada)|vete a la (mierda|verga|chingada|conch)|andate a la (mierda|conch|verga)|chucha (tu|de|madre)|reculi?a[dt][oa]|fuck|shit|bitch|asshole|bastard)\b/i;
const esOfensivo = (t) => GROSERIAS.test(normGros(t));

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
  const subs = exceptRole
    ? (await q(`SELECT endpoint, sub FROM push_subs WHERE family_id=$1 AND role<>$2`, [familyId, exceptRole])).rows
    : (await q(`SELECT endpoint, sub FROM push_subs WHERE family_id=$1`, [familyId])).rows;
  await Promise.all(subs.map(async s => {
    try { await webpush.sendNotification(s.sub, JSON.stringify(payload)); }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await q(`DELETE FROM push_subs WHERE endpoint=$1`, [s.endpoint]); }
  }));
}

/* Limitador simple por IP (anti fuerza-bruta / abuso), sin dependencias. */
function makeIpLimiter(windowMs, max) {
  const hits = new Map();
  return (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'x';
    const now = Date.now();
    if (hits.size > 8000) hits.clear();
    let e = hits.get(ip);
    if (!e || now > e.reset) { e = { count: 0, reset: now + windowMs }; hits.set(ip, e); }
    e.count++;
    if (e.count > max) return res.status(429).json({ error: 'Demasiadas solicitudes. Espera un momento e intenta de nuevo.' });
    next();
  };
}

/* Custodio ('A'/'B') de una fecha según el esquema — reutilizado en .ics y recordatorios. */
function custodioCalc(sched, isoStr) {
  sched = sched || { type: 'semanal', startParent: 'A', start: null };
  const start = sched.start || isoStr;
  const n = Math.round((new Date(isoStr + 'T00:00') - new Date(start + 'T00:00')) / 86400000);
  if (n < 0) return sched.startParent;
  const first = sched.startParent || 'A', second = first === 'A' ? 'B' : 'A';
  const P = {
    '2-2-3': [first,first,second,second,first,first,first,second,second,first,first,second,second,second],
    '2-2-5-5': [first,first,second,second,first,first,first,first,first,second,second,second,second,second],
    '3-4-4-3': [first,first,first,second,second,second,second,first,first,first,first,second,second,second],
  };
  if (P[sched.type]) return P[sched.type][((n % 14) + 14) % 14];
  if (sched.type === 'semanal') return Math.floor(n / 7) % 2 === 0 ? first : second;
  return n % 2 === 0 ? first : second;
}

/* Recordatorios automáticos: eventos próximos y cambios de custodia (push a ambos padres). */
export function startReminders() {
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const run = async () => {
    if (!VAPID_PUBLIC) return;
    try {
      const now = new Date();
      const hoy = iso(now);
      const manana = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
      const fams = (await q(`SELECT id, parents, schedule, last_custody_reminder FROM families`)).rows;
      for (const f of fams) {
        const evs = (await q(`SELECT id, data FROM events WHERE family_id=$1`, [f.id])).rows;
        for (const row of evs) {
          const e = row.data; if (!e || e.reminded || !e.date) continue;
          if (e.date === hoy || e.date === manana) {
            sendPush(f.id, null, { title: 'Recordatorio', body: `${e.title || 'Evento'}${e.time ? ' · ' + e.time : ''} (${e.date === hoy ? 'hoy' : 'mañana'})`, url: './#/calendario', tag: 'recordatorio' }).catch(() => {});
            await q(`UPDATE events SET data=$1 WHERE id=$2`, [JSON.stringify({ ...e, reminded: true }), row.id]);
          }
        }
        const tks = (await q(`SELECT id, data FROM tasks WHERE family_id=$1`, [f.id])).rows;
        for (const row of tks) {
          const tk = row.data; if (!tk || tk.reminded || tk.done || !tk.due) continue;
          if (tk.due === hoy || tk.due === manana) {
            sendPush(f.id, null, { title: 'Tarea por entregar', body: `${tk.title || 'Tarea'}${tk.subject ? ' · ' + tk.subject : ''} (${tk.due === hoy ? 'hoy' : 'mañana'})`, url: './#/tareas', tag: 'tarea' }).catch(() => {});
            await q(`UPDATE tasks SET data=$1 WHERE id=$2`, [JSON.stringify({ ...tk, reminded: true }), row.id]);
          }
        }
        if (custodioCalc(f.schedule, hoy) !== custodioCalc(f.schedule, manana) && f.last_custody_reminder !== hoy) {
          const who = custodioCalc(f.schedule, manana);
          sendPush(f.id, null, { title: 'Cambio de custodia', body: `Mañana los niños pasan con ${(f.parents || {})[who] || who}`, url: './#/inicio', tag: 'custodia' }).catch(() => {});
          await q(`UPDATE families SET last_custody_reminder=$1 WHERE id=$2`, [hoy, f.id]);
        }
      }
    } catch (e) { /* silencioso */ }
  };
  setTimeout(run, 15000);        // primera pasada al arrancar
  setInterval(run, 30 * 60000);  // cada 30 minutos
}

async function logAudit(familyId, actor, action, detail) {
  try {
    await q(`INSERT INTO audit (id, family_id, actor, action, detail, ts) VALUES ($1,$2,$3,$4,$5,$6)`,
      [Date.now().toString(36) + Math.random().toString(36).slice(2, 7), familyId, actor || '', action, String(detail || '').slice(0, 200), Date.now()]);
  } catch {}
}

export function buildRouter(broadcast) {
  const r = express.Router();

  // Anti-abuso: límites por IP en las rutas sensibles.
  r.use('/auth', makeIpLimiter(60 * 1000, 40));   // 40 intentos/min de login-registro-reset por IP
  r.use('/pay', makeIpLimiter(60 * 1000, 30));
  r.use('/admin', makeIpLimiter(60 * 1000, 60));

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

    const trialDias = Math.max(0, Number(process.env.TRIAL_DAYS || 30));
    const trialUntil = new Date(Date.now() + trialDias * 86400000).toISOString();
    const calTok = crypto.randomBytes(12).toString('hex');
    await q(`INSERT INTO families (id, invite_code, parents, trial_until, cal_token) VALUES ($1,$2,$3,$4,$5)`,
      [familyId, invite, JSON.stringify({ A: name, B: '' }), trialUntil, calTok]);

    const userId = uid();
    const vtoken = crypto.randomBytes(24).toString('hex');
    await q(`INSERT INTO users (id, email, password, name, family_id, role, email_verified, verify_token) VALUES ($1,$2,$3,$4,$5,'A',false,$6)`,
      [userId, email.toLowerCase(), await hash(password), name, familyId, vtoken]);

    const user = { id: userId, email: email.toLowerCase(), family_id: familyId, role: 'A' };
    const front = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
    enviarCorreo(user.email, 'Verifica tu correo — Copaz', correoVerificacion(name, `${front}/#/verify?token=${vtoken}`)).catch(() => {});
    res.json({ token: sign(user), user: { id: userId, name, email: user.email, role: 'A', verified: false }, inviteCode: invite });
  });

  // Verificar correo con el token del enlace.
  r.post('/auth/verify', async (req, res) => {
    const token = (req.body && req.body.token) || '';
    if (!token) return res.status(400).json({ error: 'Falta el token' });
    const u = (await q(`SELECT id FROM users WHERE verify_token=$1`, [token])).rows[0];
    if (!u) return res.status(400).json({ error: 'Enlace inválido o ya usado' });
    await q(`UPDATE users SET email_verified=true, verify_token=NULL WHERE id=$1`, [u.id]);
    res.json({ ok: true });
  });
  // Reenviar el correo de verificación.
  r.post('/auth/resend-verify', requireAuth, async (req, res) => {
    const u = (await q(`SELECT email, name, email_verified FROM users WHERE id=$1`, [req.user.uid])).rows[0];
    if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (u.email_verified) return res.json({ ok: true, yaVerificado: true });
    const vtoken = crypto.randomBytes(24).toString('hex');
    await q(`UPDATE users SET verify_token=$1 WHERE id=$2`, [vtoken, req.user.uid]);
    const front = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
    enviarCorreo(u.email, 'Verifica tu correo — Copaz', correoVerificacion(u.name || '', `${front}/#/verify?token=${vtoken}`)).catch(() => {});
    res.json({ ok: true });
  });

  // Recuperación de contraseña
  r.post('/auth/forgot', async (req, res) => {
    const email = String((req.body && req.body.email) || '').toLowerCase().trim();
    res.json({ ok: true }); // respondemos igual exista o no (no filtrar cuentas)
    if (!email) return;
    const u = (await q(`SELECT id, name FROM users WHERE email=$1`, [email])).rows[0];
    if (!u) return;
    const token = crypto.randomBytes(24).toString('hex');
    const exp = new Date(Date.now() + 3600000).toISOString();
    await q(`UPDATE users SET reset_token=$1, reset_expires=$2 WHERE id=$3`, [token, exp, u.id]);
    const front = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
    enviarCorreo(email, 'Restablece tu contraseña de Copaz', correoReset(`${front}/#/reset?token=${token}`)).catch(() => {});
  });
  r.post('/auth/reset', async (req, res) => {
    const { token, password } = req.body || {};
    if (!token || !password || String(password).length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    const u = (await q(`SELECT id FROM users WHERE reset_token=$1 AND reset_expires > now()`, [token])).rows[0];
    if (!u) return res.status(400).json({ error: 'El enlace es inválido o expiró' });
    await q(`UPDATE users SET password=$1, reset_token=NULL, reset_expires=NULL WHERE id=$2`, [await hash(password), u.id]);
    res.json({ ok: true });
  });

  // Login
  r.post('/auth/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Faltan datos' });
    const u = (await q(`SELECT * FROM users WHERE email=$1`, [String(email).toLowerCase()])).rows[0];
    if (!u || !(await compare(password, u.password))) return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
    res.json({ token: sign(u), user: { id: u.id, name: u.name, email: u.email, role: u.role, verified: u.email_verified === true } });
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
    const me = (await q(`SELECT email_verified FROM users WHERE id=$1`, [req.user.uid])).rows[0];
    state.me = { verified: !!(me && me.email_verified) };
    if (!state.family.calToken) {
      const tok = crypto.randomBytes(12).toString('hex');
      await q(`UPDATE families SET cal_token=$1 WHERE id=$2`, [tok, req.user.family_id]);
      state.family.calToken = tok;
    }
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

  // Estado de acceso (prueba + Premium) de la familia
  r.get('/pay/status', requireAuth, async (req, res) => {
    const f = (await q(`SELECT trial_until, premium_until, premium_plan FROM families WHERE id=$1`, [req.user.family_id])).rows[0] || {};
    const now = Date.now();
    const premium = !!(f.premium_until && new Date(f.premium_until).getTime() > now);
    const enTrial = !!(f.trial_until && new Date(f.trial_until).getTime() > now);
    res.json({
      flowReady: flowReady(),
      access: { premium, enTrial, activo: premium || enTrial, bloqueado: !(premium || enTrial), trialUntil: f.trial_until || null, premiumUntil: f.premium_until || null, plan: f.premium_plan || null },
    });
  });

  // Activación manual por el dueño del SaaS (cuando cobras por botón de Flow).
  // Protegido con ADMIN_KEY (cabecera x-admin-key o body.adminKey).
  r.post('/admin/activate', async (req, res) => {
    const key = req.headers['x-admin-key'] || (req.body && req.body.adminKey);
    if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'No autorizado' });
    const plan = (req.body.plan === 'anual') ? 'anual' : 'mensual';
    const p = PLANES[plan];
    let famId = req.body.familyId;
    if (!famId && req.body.email) {
      const u = (await q(`SELECT family_id FROM users WHERE email=$1`, [String(req.body.email).toLowerCase()])).rows[0];
      famId = u && u.family_id;
    }
    if (!famId) return res.status(404).json({ error: 'Familia no encontrada (envía familyId o email)' });
    const cur = (await q(`SELECT premium_until FROM families WHERE id=$1`, [famId])).rows[0];
    const desde = (cur && cur.premium_until && new Date(cur.premium_until) > new Date()) ? new Date(cur.premium_until) : new Date();
    const until = new Date(desde.getTime() + p.dias * 86400000);
    await q(`UPDATE families SET premium_until=$1, premium_plan=$2 WHERE id=$3`, [until.toISOString(), plan, famId]);
    broadcast(famId, { type: 'sync' });
    res.json({ ok: true, familyId: famId, plan, premiumUntil: until.toISOString() });
  });

  // Lista de familias para el panel de administrador.
  r.get('/admin/families', async (req, res) => {
    const key = req.headers['x-admin-key'];
    if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'No autorizado' });
    const fams = (await q(`SELECT id, parents, trial_until, premium_until, premium_plan, created_at FROM families ORDER BY created_at DESC LIMIT 500`)).rows;
    const now = Date.now();
    const out = [];
    for (const f of fams) {
      const us = (await q(`SELECT email FROM users WHERE family_id=$1`, [f.id])).rows;
      const estado = (f.premium_until && new Date(f.premium_until).getTime() > now) ? 'premium'
        : (f.trial_until && new Date(f.trial_until).getTime() > now) ? 'prueba' : 'bloqueado';
      out.push({ id: f.id, emails: us.map(u => u.email).join(', '), miembros: us.length,
        trialUntil: f.trial_until, premiumUntil: f.premium_until, plan: f.premium_plan, estado });
    }
    res.json({ families: out });
  });

  // Crea el pago en Flow y devuelve la URL a la que redirigir al usuario.
  r.post('/pay/create', requireAuth, async (req, res) => {
    const plan = req.body.plan === 'anual' ? 'anual' : 'mensual';
    const p = PLANES[plan];
    if (!flowReady()) return res.status(503).json({ error: 'El cobro con Flow aún no está configurado en el servidor.' });
    const u = (await q(`SELECT email, email_verified FROM users WHERE id=$1`, [req.user.uid])).rows[0];
    if (!u || !u.email_verified) return res.status(403).json({ error: 'Verifica tu correo antes de suscribirte.', necesitaVerificar: true });
    const order = `COPAZ-${req.user.family_id}-${plan}-${Date.now()}`;
    try {
      const result = await flowPost('/payment/create', {
        commerceOrder: order,
        subject: `Copaz Premium ${p.label}`,
        currency: 'CLP',
        amount: p.amount,
        email: u.email,
        urlConfirmation: `${baseUrl(req)}/api/pay/webhook`,
        urlReturn: `${baseUrl(req)}/api/pay/return`,
        optional: req.user.family_id,
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
    let familyId = status.optional || null, plan = 'mensual';
    if (status.commerceOrder) { const parts = String(status.commerceOrder).split('-'); if (!familyId) familyId = parts[1]; plan = parts[2] || 'mensual'; }
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
    const image = req.body.image && /^data:image\//.test(req.body.image) ? req.body.image : null;
    if (!text && !image) return res.status(400).json({ error: 'Mensaje vacío' });
    if (text && esOfensivo(text)) return res.status(400).json({ error: 'El mensaje contiene lenguaje ofensivo. Reformúlalo, por favor.', ofensivo: true });
    const id = uid(); const ts = Date.now();
    await q(`INSERT INTO messages (id, family_id, sender, role, text, image, ts) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, req.user.family_id, req.user.uid, req.user.role, text, image, ts]);
    broadcast(req.user.family_id, { type: 'message', message: { id, from: req.user.role, text, image, ts } });
    nombreDe(req.user.family_id, req.user.role).then(n => sendPush(req.user.family_id, req.user.role, {
      title: n, body: image && !text ? '📷 Envió una foto' : text.slice(0, 120), url: './#/mensajes', tag: 'mensajes',
    })).catch(() => {});
    res.json({ id, from: req.user.role, text, image, ts });
  });

  /* --------------------- CRUD genérico por entidad ------------------ */
  const ENTITIES = ['kids', 'events', 'expenses', 'docs', 'swaps', 'journal', 'settlements', 'tasks'];
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
    } else if (t === 'settlements') {
      nombreDe(req.user.family_id, req.user.role).then(n => sendPush(req.user.family_id, req.user.role, {
        title: 'Reembolso registrado', body: `${n} registró un abono`, url: './#/gastos', tag: 'abono',
      })).catch(() => {});
    } else if (t === 'tasks') {
      nombreDe(req.user.family_id, req.user.role).then(n => sendPush(req.user.family_id, req.user.role, {
        title: 'Nueva tarea', body: `${n} agregó: ${(data.title || '').slice(0, 60)}`, url: './#/tareas', tag: 'tarea',
      })).catch(() => {});
    }
    logAudit(req.user.family_id, req.user.role, 'crear', `${t}: ${data.title || data.name || data.text || ''}`);
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
    logAudit(req.user.family_id, req.user.role, 'editar', `${t}: ${data.title || data.name || ''}`);
    res.json({ id: req.params.id, ...data });
  });

  // Borrar
  r.delete('/:entity/:id', requireAuth, async (req, res) => {
    const t = req.params.entity;
    if (!guard(t, res)) return;
    await q(`DELETE FROM ${t} WHERE id=$1 AND family_id=$2`, [req.params.id, req.user.family_id]);
    broadcast(req.user.family_id, { type: 'sync' });
    logAudit(req.user.family_id, req.user.role, 'borrar', t);
    res.json({ ok: true });
  });

  // Historial de actividad (auditoría) de la familia.
  r.get('/audit', requireAuth, async (req, res) => {
    const rows = (await q(`SELECT actor, action, detail, ts FROM audit WHERE family_id=$1 ORDER BY ts DESC LIMIT 100`, [req.user.family_id])).rows;
    res.json({ audit: rows });
  });

  // Cambiar contraseña desde Ajustes (con la contraseña actual).
  r.post('/auth/change-password', requireAuth, async (req, res) => {
    const { actual, nueva } = req.body || {};
    if (!nueva || String(nueva).length < 6) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
    const u = (await q(`SELECT password FROM users WHERE id=$1`, [req.user.uid])).rows[0];
    if (!u || !(await compare(actual || '', u.password))) return res.status(401).json({ error: 'La contraseña actual no es correcta' });
    await q(`UPDATE users SET password=$1 WHERE id=$2`, [await hash(nueva), req.user.uid]);
    res.json({ ok: true });
  });

  // Feed de calendario (.ics) para suscribir en Google/Apple Calendar. Público con token.
  r.get('/cal/:familyId/:token.ics', async (req, res) => {
    const fam = (await q(`SELECT * FROM families WHERE id=$1`, [req.params.familyId])).rows[0];
    if (!fam || !fam.cal_token || fam.cal_token !== req.params.token) return res.status(404).send('No encontrado');
    const evs = (await q(`SELECT data FROM events WHERE family_id=$1`, [req.params.familyId])).rows.map(r => r.data);
    const pad = n => String(n).padStart(2, '0');
    const fmt = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
    const parents = fam.parents || {};
    const sched = fam.schedule || { type: 'semanal', start: null, startParent: 'A' };
    const custodioDe = (isoStr) => {
      const start = sched.start || isoStr;
      const n = Math.round((new Date(isoStr + 'T00:00') - new Date(start + 'T00:00')) / 86400000);
      if (n < 0) return sched.startParent;
      const first = sched.startParent, second = first === 'A' ? 'B' : 'A';
      const P = {
        '2-2-3': [first,first,second,second,first,first,first,second,second,first,first,second,second,second],
        '2-2-5-5': [first,first,second,second,first,first,first,first,first,second,second,second,second,second],
        '3-4-4-3': [first,first,first,second,second,second,second,first,first,first,first,second,second,second],
      };
      if (P[sched.type]) return P[sched.type][((n % 14) + 14) % 14];
      if (sched.type === 'semanal') return Math.floor(n / 7) % 2 === 0 ? first : second;
      return n % 2 === 0 ? first : second;
    };
    let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Copaz//Calendario//ES\r\nX-WR-CALNAME:Copaz — Custodia\r\n';
    const hoy = new Date();
    for (let i = 0; i < 90; i++) {
      const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + i);
      const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const who = custodioDe(iso);
      const dEnd = new Date(d.getTime() + 86400000);
      ics += `BEGIN:VEVENT\r\nUID:cust-${iso}@copaz\r\nDTSTART;VALUE=DATE:${fmt(d)}\r\nDTEND;VALUE=DATE:${fmt(dEnd)}\r\nSUMMARY:Con ${parents[who] || who}\r\nEND:VEVENT\r\n`;
    }
    for (const e of evs) {
      if (!e.date) continue;
      const [y, m, dd] = e.date.split('-').map(Number);
      const start = new Date(Date.UTC(y, m - 1, dd));
      const end = new Date(start.getTime() + 86400000);
      ics += `BEGIN:VEVENT\r\nUID:ev-${e.date}-${Math.random().toString(36).slice(2, 7)}@copaz\r\nDTSTART;VALUE=DATE:${fmt(start)}\r\nDTEND;VALUE=DATE:${fmt(end)}\r\nSUMMARY:${String(e.title || 'Evento').replace(/[\r\n,;]/g, ' ')}${e.time ? ' (' + e.time + ')' : ''}\r\nEND:VEVENT\r\n`;
    }
    ics += 'END:VCALENDAR\r\n';
    res.set('Content-Type', 'text/calendar; charset=utf-8').send(ics);
  });

  return r;
}
