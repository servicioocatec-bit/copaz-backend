/* Integración con Flow (flow.cl) — mismo patrón que uso en mis otras apps.
   Firma HMAC-SHA256 de los parámetros ordenados, con la secret key.
   Si no hay llaves configuradas, flowReady() es false y la app sigue
   funcionando en modo gratis/prueba sin cobrar. */
import crypto from 'crypto';

const FLOW_API_KEY = process.env.FLOW_API_KEY || '';
const FLOW_SECRET_KEY = process.env.FLOW_SECRET_KEY || '';
const FLOW_BASE_URL = (process.env.FLOW_BASE_URL || 'https://www.flow.cl/api').replace(/\/+$/, '');

export const flowReady = () => !!(FLOW_API_KEY && FLOW_SECRET_KEY);

function sign(params) {
  const sorted = Object.keys(params).sort().map(k => k + params[k]).join('');
  return crypto.createHmac('sha256', FLOW_SECRET_KEY).update(sorted).digest('hex');
}

export async function flowPost(endpoint, params) {
  if (!flowReady()) throw new Error('Flow no configurado');
  const body = { apiKey: FLOW_API_KEY, ...params };
  body.s = sign(body);
  const r = await fetch(`${FLOW_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const txt = await r.text();
  let json; try { json = JSON.parse(txt); } catch { throw new Error('Flow respuesta no-JSON: ' + txt.slice(0, 160)); }
  if (!r.ok) throw new Error('Flow ' + r.status + ' ' + txt.slice(0, 200));
  return json;
}

export async function flowGet(endpoint, params) {
  if (!flowReady()) throw new Error('Flow no configurado');
  const body = { apiKey: FLOW_API_KEY, ...params };
  body.s = sign(body);
  const qs = new URLSearchParams(body).toString();
  const r = await fetch(`${FLOW_BASE_URL}${endpoint}?${qs}`);
  const txt = await r.text();
  let json; try { json = JSON.parse(txt); } catch { throw new Error('Flow respuesta no-JSON: ' + txt.slice(0, 160)); }
  if (!r.ok) throw new Error('Flow GET ' + r.status + ' ' + txt.slice(0, 200));
  return json;
}
