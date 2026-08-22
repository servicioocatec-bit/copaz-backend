/* Servidor Copaz — Express + WebSocket. */
import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { initPool, migrate } from './db.js';
import { verify } from './auth.js';
import { buildRouter } from './routes.js';

/* ---- WebSocket: agrupamos conexiones por familia para difundir cambios ---- */
const rooms = new Map(); // familyId -> Set<ws>
function broadcast(familyId, payload) {
  const set = rooms.get(familyId);
  if (!set) return;
  const msg = JSON.stringify(payload);
  for (const ws of set) { if (ws.readyState === 1) ws.send(msg); }
}

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // Railway/proxy: leer la IP real del cliente para el rate limiting.
  app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
  app.use(express.json({ limit: '6mb' })); // permite adjuntar fotos (boletas/documentos) comprimidas

  app.get('/', (_req, res) => res.json({ app: 'Copaz API', status: 'ok' }));
  app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));
  app.use('/api', buildRouter(broadcast));

  // Manejo de errores centralizado
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  });
  return app;
}

function attachWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws, req) => {
    // Autenticación por token en la query: /ws?token=...
    const url = new URL(req.url, 'http://localhost');
    const payload = verify(url.searchParams.get('token'));
    if (!payload) { ws.close(4001, 'no auth'); return; }
    const fam = payload.family_id;
    if (!rooms.has(fam)) rooms.set(fam, new Set());
    rooms.get(fam).add(ws);
    ws.send(JSON.stringify({ type: 'connected' }));

    ws.on('close', () => {
      const set = rooms.get(fam);
      if (set) { set.delete(ws); if (!set.size) rooms.delete(fam); }
    });
    ws.on('error', () => {});
  });
}

async function start() {
  initPool();
  await migrate();
  const app = createApp();
  const server = http.createServer(app);
  attachWebSocket(server);
  const port = process.env.PORT || 3000;
  server.listen(port, () => console.log(`Copaz API escuchando en :${port}`));
}

// Solo arranca si se ejecuta directamente (no al importar en pruebas).
if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch(e => { console.error('Fallo al iniciar:', e); process.exit(1); });
}
