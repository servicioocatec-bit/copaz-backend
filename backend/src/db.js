/* Capa de datos — PostgreSQL.
   Permite inyectar un pool alterno (para pruebas con pg-mem). */
import pg from 'pg';

let pool;

export function setPool(p) { pool = p; }

export function initPool() {
  if (pool) return pool;
  const { Pool } = pg;
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
      ? { rejectUnauthorized: false } : undefined,
  });
  return pool;
}

export function q(text, params) { return pool.query(text, params); }

/* Crea las tablas si no existen. Idempotente. */
export async function migrate() {
  await q(`
  CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    email        TEXT UNIQUE NOT NULL,
    password     TEXT NOT NULL,
    name         TEXT NOT NULL,
    family_id    TEXT,
    role         TEXT,                 -- 'A' o 'B' dentro de la familia
    created_at   TIMESTAMPTZ DEFAULT now()
  );`);

  await q(`
  CREATE TABLE IF NOT EXISTS families (
    id           TEXT PRIMARY KEY,
    invite_code  TEXT UNIQUE NOT NULL,
    currency     TEXT DEFAULT 'MXN',
    schedule     JSONB DEFAULT '{"type":"2-2-3","start":null,"startParent":"A"}',
    parents      JSONB DEFAULT '{}',   -- { A: "nombre", B: "nombre" }
    created_at   TIMESTAMPTZ DEFAULT now()
  );`);

  // Tablas de entidades: todas cuelgan de family_id.
  const entity = (name, cols) => q(`
    CREATE TABLE IF NOT EXISTS ${name} (
      id         TEXT PRIMARY KEY,
      family_id  TEXT NOT NULL,
      ${cols},
      updated_at TIMESTAMPTZ DEFAULT now()
    );`);

  await entity('kids',     `data JSONB NOT NULL`);
  await entity('events',   `data JSONB NOT NULL`);
  await entity('expenses', `data JSONB NOT NULL`);
  await entity('docs',     `data JSONB NOT NULL`);
  await entity('swaps',    `data JSONB NOT NULL`);   // solicitudes de intercambio de días
  await entity('journal',  `data JSONB NOT NULL`);   // bitácora / diario de los hijos
  await entity('settlements', `data JSONB NOT NULL`);// reembolsos / abonos entre padres
  await entity('tasks',    `data JSONB NOT NULL`);   // tareas del colegio / quehaceres del hogar
  await entity('overrides', `data JSONB NOT NULL`);  // excepciones de custodia (feriados/vacaciones)
  await entity('recurring', `data JSONB NOT NULL`);  // gastos recurrentes (plantillas mensuales)
  await entity('agreements',`data JSONB NOT NULL`);  // acuerdos de coparentalidad (confirman ambos)
  await entity('shopping',  `data JSONB NOT NULL`);  // lista compartida de necesidades de los niños
  await q(`ALTER TABLE families ADD COLUMN IF NOT EXISTS reminder_days INTEGER DEFAULT 1;`);
  await q(`ALTER TABLE families ADD COLUMN IF NOT EXISTS cal_token TEXT;`);
  await q(`ALTER TABLE families ADD COLUMN IF NOT EXISTS last_custody_reminder TEXT;`);
  await q(`
  CREATE TABLE IF NOT EXISTS audit (
    id         TEXT PRIMARY KEY,
    family_id  TEXT NOT NULL,
    actor      TEXT,
    action     TEXT NOT NULL,
    detail     TEXT,
    ts         BIGINT NOT NULL
  );`);
  await q(`
  CREATE TABLE IF NOT EXISTS messages (
    id         TEXT PRIMARY KEY,
    family_id  TEXT NOT NULL,
    sender     TEXT NOT NULL,          -- user id
    role       TEXT NOT NULL,          -- 'A' o 'B'
    text       TEXT NOT NULL,
    ts         BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  );`);
  await q(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS image TEXT;`);

  await q(`CREATE INDEX IF NOT EXISTS idx_kids_fam     ON kids(family_id);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_events_fam   ON events(family_id);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_expenses_fam ON expenses(family_id);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_docs_fam     ON docs(family_id);`);
  // Recuperación de contraseña.
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT;`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_expires TIMESTAMPTZ;`);
  // Verificación de correo.
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_token TEXT;`);
  // Cuentas ya existentes (sin token de verificación pendiente) se marcan como verificadas.
  await q(`UPDATE users SET email_verified=true WHERE email_verified IS NOT TRUE AND verify_token IS NULL`);

  // Estado de acceso de la familia: prueba gratis + Premium (se activan/vencen en el servidor).
  await q(`ALTER TABLE families ADD COLUMN IF NOT EXISTS trial_until TIMESTAMPTZ;`);
  await q(`ALTER TABLE families ADD COLUMN IF NOT EXISTS premium_until TIMESTAMPTZ;`);
  await q(`ALTER TABLE families ADD COLUMN IF NOT EXISTS premium_plan TEXT;`);
  // Familias creadas antes de existir la prueba: se les otorga 30 días desde ahora
  // para que no queden bloqueadas al desplegar esta versión.
  await q(`UPDATE families SET trial_until=$1 WHERE trial_until IS NULL`,
    [new Date(Date.now() + 30 * 86400000).toISOString()]);
  await q(`
  CREATE TABLE IF NOT EXISTS payments (
    id          TEXT PRIMARY KEY,
    family_id   TEXT NOT NULL,
    "order"     TEXT UNIQUE NOT NULL,
    plan        TEXT NOT NULL,
    amount      INTEGER NOT NULL,
    status      TEXT DEFAULT 'pending',
    created_at  TIMESTAMPTZ DEFAULT now()
  );`);

  await q(`
  CREATE TABLE IF NOT EXISTS push_subs (
    id         TEXT PRIMARY KEY,
    family_id  TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    role       TEXT NOT NULL,
    endpoint   TEXT UNIQUE NOT NULL,
    sub        JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  );`);

  await q(`CREATE INDEX IF NOT EXISTS idx_swaps_fam    ON swaps(family_id);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_msg_fam      ON messages(family_id);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_push_fam     ON push_subs(family_id);`);
}

/* Exporta TODAS las tablas (respaldo completo de la base). */
export async function exportAll() {
  const tablas = ['families', 'users', 'kids', 'events', 'expenses', 'docs', 'swaps', 'journal', 'settlements', 'tasks', 'messages', 'audit', 'payments', 'push_subs'];
  const data = { generado: new Date().toISOString(), version: 1, tablas: {} };
  for (const t of tablas) {
    try { data.tablas[t] = (await q(`SELECT * FROM ${t}`)).rows; }
    catch { data.tablas[t] = []; }
  }
  return data;
}

/* Devuelve el estado completo de una familia (lo que consume el frontend). */
export async function familyState(familyId) {
  const fam = (await q(`SELECT * FROM families WHERE id=$1`, [familyId])).rows[0];
  if (!fam) return null;
  const members = (await q(`SELECT id, name, email, role FROM users WHERE family_id=$1`, [familyId])).rows;
  const load = async (t) => (await q(`SELECT id, data FROM ${t} WHERE family_id=$1`, [familyId]))
    .rows.map(r => ({ id: r.id, ...r.data }));
  const messages = (await q(
    `SELECT id, role AS "from", text, image, ts FROM messages WHERE family_id=$1 ORDER BY ts ASC`, [familyId]
  )).rows;
  const ahora = Date.now();
  const premOk = !!(fam.premium_until && new Date(fam.premium_until).getTime() > ahora);
  const trialOk = !!(fam.trial_until && new Date(fam.trial_until).getTime() > ahora);
  return {
    family: {
      id: fam.id, inviteCode: fam.invite_code, currency: fam.currency,
      schedule: fam.schedule, parents: fam.parents,
      reminderDays: fam.reminder_days == null ? 1 : fam.reminder_days,
      premium: { until: fam.premium_until || null, plan: fam.premium_plan || null },
      calToken: fam.cal_token || null,
      access: {
        premium: premOk, enTrial: trialOk, activo: premOk || trialOk, bloqueado: !(premOk || trialOk),
        trialUntil: fam.trial_until || null, premiumUntil: fam.premium_until || null, plan: fam.premium_plan || null,
      },
    },
    members,
    kids:     await load('kids'),
    events:   await load('events'),
    expenses: await load('expenses'),
    docs:     await load('docs'),
    swaps:    await load('swaps'),
    journal:  await load('journal'),
    settlements: await load('settlements'),
    tasks:    await load('tasks'),
    overrides: await load('overrides'),
    recurring: await load('recurring'),
    agreements: await load('agreements'),
    shopping: await load('shopping'),
    messages,
  };
}
