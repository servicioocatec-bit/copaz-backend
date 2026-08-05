/* =========================================================================
   Copaz — cliente de API para el frontend.
   Copia este archivo a la carpeta de la app (junto a app.js) e inclúyelo
   antes de app.js:  <script src="public-api-client.js"></script>
   Luego cambia CONFIG.API_BASE por la URL de tu backend en Railway.
   ========================================================================= */
'use strict';

const CONFIG = {
  // URL pública de tu backend en Railway (sin barra final).
  // Ej: https://copaz-backend-production.up.railway.app
  //
  // DÉJALO VACÍO ('') para usar la app en modo local (un solo dispositivo,
  // sin necesidad de backend). Con una URL, la app pasa a modo nube:
  // login y sincronización entre los dos padres.
  //
  // ✅ Backend YA desplegado en Railway y conectado:
  API_BASE: 'https://copaz-backend-production.up.railway.app',

  // Links de pago de Flow (pega aquí las URLs de tus planes en flow.cl).
  // Ej: 'https://www.flow.cl/app/web/pagarBtnPago.php?...'
  FLOW_ANUAL: 'https://www.flow.cl/btn.php?token=hbf98242a14882cc2887d6a9f4ec38ef44552c0c',
  FLOW_MENSUAL: 'https://www.flow.cl/btn.php?token=l0d70e5a5192e3412dd193b8356f3b655588f69a',
};

const Cloud = {
  token: null,
  ws: null,

  get base() { return CONFIG.API_BASE; },

  loadToken() { this.token = localStorage.getItem('copaz.token') || null; return this.token; },
  setToken(t) { this.token = t; localStorage.setItem('copaz.token', t); },
  logout() { this.token = null; localStorage.removeItem('copaz.token'); if (this.ws) this.ws.close(); },

  async req(method, path, body) {
    const res = await fetch(this.base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error de red');
    return data;
  },

  // --- Auth ---
  register(email, password, name) { return this.req('POST', '/api/auth/register', { email, password, name }); },
  login(email, password)          { return this.req('POST', '/api/auth/login', { email, password }); },
  join(inviteCode)                { return this.req('POST', '/api/family/join', { inviteCode }); },

  // --- Estado ---
  state()             { return this.req('GET', '/api/state'); },
  patchFamily(patch)  { return this.req('PATCH', '/api/family', patch); },

  // --- Entidades (kids | events | expenses | docs) ---
  create(entity, obj)      { return this.req('POST', `/api/${entity}`, obj); },
  update(entity, id, obj)  { return this.req('PATCH', `/api/${entity}/${id}`, obj); },
  remove(entity, id)       { return this.req('DELETE', `/api/${entity}/${id}`); },

  // --- Mensajes ---
  sendMessage(text) { return this.req('POST', '/api/messages', { text }); },

  // --- Notificaciones push ---
  vapid()            { return this.req('GET', '/api/push/vapid'); },
  subscribePush(sub) { return this.req('POST', '/api/push/subscribe', { sub }); },

  // --- Pagos / Premium (Flow) ---
  payStatus()     { return this.req('GET', '/api/pay/status'); },
  payCreate(plan) { return this.req('POST', '/api/pay/create', { plan }); },

  // --- Tiempo real ---
  connect(onEvent) {
    if (!this.token) return;
    const wsUrl = this.base.replace(/^http/, 'ws') + '/ws?token=' + encodeURIComponent(this.token);
    this.ws = new WebSocket(wsUrl);
    this.ws.onmessage = (e) => { try { onEvent(JSON.parse(e.data)); } catch {} };
    this.ws.onclose = () => { setTimeout(() => this.connect(onEvent), 3000); }; // reconexión automática
  },
};

window.Cloud = Cloud;
window.COPAZ_CONFIG = CONFIG;
