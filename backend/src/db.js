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

  await q(`CREATE INDEX IF NOT EXISTS idx_kids_fam     ON kids(family_id);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_events_fam   ON events(family_id);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_expenses_fam ON expenses(family_id);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_docs_fam     ON docs(family_id);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_swaps_fam    ON swaps(family_id);`);
  await q(`CREATE INDEX IF NOT EXISTS idx_msg_fam      ON messages(family_id);`);
}

/* Devuelve el estado completo de una familia (lo que consume el frontend). */
export async function familyState(familyId) {
  const fam = (await q(`SELECT * FROM families WHERE id=$1`, [familyId])).rows[0];
  if (!fam) return null;
  const members = (await q(`SELECT id, name, email, role FROM users WHERE family_id=$1`, [familyId])).rows;
  const load = async (t) => (await q(`SELECT id, data FROM ${t} WHERE family_id=$1`, [familyId]))
    .rows.map(r => ({ id: r.id, ...r.data }));
  const messages = (await q(
    `SELECT id, role AS "from", text, ts FROM messages WHERE family_id=$1 ORDER BY ts ASC`, [familyId]
  )).rows;
  return {
    family: {
      id: fam.id, inviteCode: fam.invite_code, currency: fam.currency,
      schedule: fam.schedule, parents: fam.parents,
    },
    members,
    kids:     await load('kids'),
    events:   await load('events'),
    expenses: await load('expenses'),
    docs:     await load('docs'),
    swaps:    await load('swaps'),
    messages,
  };
}
