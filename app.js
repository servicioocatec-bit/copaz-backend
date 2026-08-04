/* =========================================================================
   Copaz — Coparentalidad en paz
   Frontend con dos modos:
     • LOCAL  → API_BASE vacío. Datos en este dispositivo. Ideal para probar.
     • NUBE   → API_BASE con tu URL de Railway. Login + sincronización real
                entre los dos padres, en tiempo real.
   El modo se decide solo según api-client.js (window.COPAZ_CONFIG.API_BASE).
   ========================================================================= */
'use strict';

/* ------------------------------ Utilidades ------------------------------ */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (h) => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstElementChild; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => iso(new Date());
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const DOW   = ['dom','lun','mar','mié','jue','vie','sáb'];

const money = n => new Intl.NumberFormat('es-MX', { style: 'currency', currency: (F() && F().currency) || 'MXN' }).format(n || 0);
function fechaLarga(s) { const [y,m,d] = s.split('-').map(Number); const dt = new Date(y, m-1, d); return `${DOW[dt.getDay()]} ${d} ${MESES[m-1]}`; }
function diffDias(a, b) { return Math.round((new Date(b+'T00:00') - new Date(a+'T00:00')) / 86400000); }
function toast(msg) {
  const t = el(`<div class="toast">${esc(msg)}</div>`);
  $('#toast-root').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = '.3s'; setTimeout(() => t.remove(), 300); }, 2400);
}
async function act(fn) { try { await fn(); } catch (e) { toast(e.message || 'Ocurrió un error'); } }

/* --------------------------- Config / modo ------------------------------ */
const API_BASE = (window.COPAZ_CONFIG && window.COPAZ_CONFIG.API_BASE) || '';
const CLOUD = !!API_BASE;

/* ============================ CAPA DE DATOS ============================= */
/* Store.state tiene siempre esta forma:
   { auth:{role,name}, family:{inviteCode,currency,schedule,parents},
     kids, events, expenses, docs, messages } */
const Store = {
  mode: CLOUD ? 'cloud' : 'local',
  state: null,

  /* --- persistencia local --- */
  _save() { if (this.mode === 'local') localStorage.setItem('copaz.local', JSON.stringify(this.state)); },
  _loadLocal() { try { this.state = JSON.parse(localStorage.getItem('copaz.local')); } catch { this.state = null; } },

  currentUser() { try { return JSON.parse(localStorage.getItem('copaz.user')); } catch { return null; } },
  setUser(u) { localStorage.setItem('copaz.user', JSON.stringify(u)); },

  async init() {
    if (this.mode === 'cloud') {
      Cloud.loadToken();
      if (Cloud.token) { await this.refresh(); this._connect(); }
    } else {
      this._loadLocal();
    }
  },

  async refresh() {
    if (this.mode !== 'cloud') return;
    const raw = await Cloud.state();
    const u = this.currentUser() || {};
    this.state = { auth: { role: u.role || 'A', name: u.name || '' }, ...raw };
    // normalizar schedule con inicio por defecto
    if (!this.state.family.schedule || !this.state.family.schedule.start) {
      const d = new Date();
      this.state.family.schedule = { type: (this.state.family.schedule && this.state.family.schedule.type) || '2-2-3',
        start: iso(new Date(d.getFullYear(), d.getMonth(), 1)), startParent: 'A' };
    }
  },

  _connect() {
    Cloud.connect(async (ev) => {
      if (ev.type === 'sync' || ev.type === 'message') { await this.refresh(); render(); }
    });
  },

  /* --- mutaciones (misma firma en ambos modos) --- */
  async create(entity, obj) {
    if (this.mode === 'cloud') { await Cloud.create(entity, obj); await this.refresh(); }
    else { this.state[entity].push({ id: uid(), ...obj }); this._save(); }
  },
  async update(entity, id, obj) {
    const { id: _i, ...data } = obj;
    if (this.mode === 'cloud') { await Cloud.update(entity, id, data); await this.refresh(); }
    else { const i = this.state[entity].findIndex(x => x.id === id); if (i >= 0) this.state[entity][i] = { id, ...data }; this._save(); }
  },
  async remove(entity, id) {
    if (this.mode === 'cloud') { await Cloud.remove(entity, id); await this.refresh(); }
    else { this.state[entity] = this.state[entity].filter(x => x.id !== id); this._save(); }
  },
  async sendMessage(text) {
    if (this.mode === 'cloud') { await Cloud.sendMessage(text); await this.refresh(); }
    else { this.state.messages.push({ id: uid(), from: this.state.auth.role, text, ts: Date.now() }); this._save(); }
  },
  async patchFamily(patch) {
    if (this.mode === 'cloud') { await Cloud.patchFamily(patch); await this.refresh(); }
    else { Object.assign(this.state.family, patch); if (patch.parents) this.state.family.parents = patch.parents; this._save(); }
  },

  /* --- crear estado local nuevo (modo local) --- */
  createLocal({ a, b, kidsNames, scheduleType, currency, demo }) {
    const kids = kidsNames.map((name, i) => ({
      id: uid(), name, dob: '', school: '', grade: '', allergies: '', meds: '',
      doctor: '', bloodType: '', emergency: '', notes: '', color: ['#0d9488','#f97316','#2563eb','#e11d48'][i % 4],
    }));
    const d = new Date();
    this.state = {
      auth: { role: 'A', name: a },
      family: {
        inviteCode: null, currency,
        schedule: { type: scheduleType, start: iso(new Date(d.getFullYear(), d.getMonth(), 1)), startParent: 'A' },
        parents: { A: a, B: b },
      },
      kids, events: [], expenses: [], docs: [], swaps: [], messages: [],
    };
    if (demo) seedDemo(this.state);
    this._save();
  },

  logout() { Cloud.logout(); localStorage.removeItem('copaz.user'); this.state = null; },
  wipeLocal() { localStorage.removeItem('copaz.local'); this.state = null; },
};

/* Accesores cortos */
const D = () => Store.state;
const F = () => Store.state && Store.state.family;
const meRole = () => Store.state.auth.role;

/* Datos de ejemplo para modo demo */
function seedDemo(s) {
  const t = new Date(), y = t.getFullYear(), m = t.getMonth(), d = t.getDate();
  const dISO = day => iso(new Date(y, m, Math.min(Math.max(day, 1), 28)));
  const k0 = s.kids[0]?.id, kL = s.kids[s.kids.length - 1]?.id;
  s.events = [
    { id: uid(), title: 'Consulta pediatra', date: dISO(d + 2), time: '10:30', kid: k0, who: 'A', note: 'Dra. Ramírez — llevar cartilla' },
    { id: uid(), title: 'Festival escolar', date: dISO(d + 5), time: '17:00', kid: k0, who: 'both', note: 'Auditorio de la escuela' },
    { id: uid(), title: 'Clase de natación', date: dISO(d + 1), time: '16:00', kid: kL, who: 'B', note: '' },
  ];
  s.expenses = [
    { id: uid(), title: 'Colegiatura', amount: 3200, date: dISO(d - 3), payer: 'A', split: 50, cat: 'Educación', kid: k0, settled: false },
    { id: uid(), title: 'Consulta y medicinas', amount: 950, date: dISO(d - 6), payer: 'B', split: 50, cat: 'Salud', kid: k0, settled: false },
    { id: uid(), title: 'Zapatos escolares', amount: 780, date: dISO(d - 8), payer: 'A', split: 50, cat: 'Ropa', kid: kL, settled: true },
  ];
  s.messages = [
    { id: uid(), from: 'B', text: '¿Puedes llevar a Sofía a la consulta del jueves? Tengo junta a esa hora.', ts: Date.now() - 86400000 * 1.2 },
    { id: uid(), from: 'A', text: 'Sí, sin problema. Yo la llevo y te cuento cómo salió.', ts: Date.now() - 86400000 * 1.1 },
    { id: uid(), from: 'B', text: 'Gracias 🙏 Te deposito mi parte de la colegiatura esta semana.', ts: Date.now() - 3600000 * 5 },
  ];
  s.docs = [
    { id: uid(), name: 'Convenio de custodia.pdf', cat: 'Legal', date: dISO(1), note: 'Firmado y sellado' },
    { id: uid(), name: 'Póliza de seguro médico', cat: 'Salud', date: dISO(2), note: 'Vigente hasta dic.' },
  ];
  s.swaps = [
    { id: uid(), date: dISO(d + 6), from: 'A', to: 'B', note: 'Tengo boda ese día, ¿los tienes tú?', status: 'pending', ts: Date.now() - 3600000 * 2 },
  ];
}

/* ---------------------- Motor de rotación de custodia ------------------- */
/* Un intercambio aceptado tiene prioridad sobre el esquema para ese día. */
function overrideDe(isoStr) {
  const list = (D().swaps || []).filter(x => x.status === 'accepted' && x.date === isoStr);
  return list.length ? list[list.length - 1].to : null;
}
function custodioDe(isoStr) {
  const ov = overrideDe(isoStr); if (ov) return ov;
  const s = F().schedule;
  const start = s.start || iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const n = diffDias(start, isoStr);
  if (n < 0) return s.startParent;
  const first = s.startParent, second = first === 'A' ? 'B' : 'A';
  const P = {
    '2-2-3':   [first,first, second,second, first,first,first, second,second, first,first, second,second,second],
    '2-2-5-5': [first,first, second,second, first,first,first,first,first, second,second,second,second,second],
    '3-4-4-3': [first,first,first, second,second,second,second, first,first,first,first, second,second,second],
  };
  if (P[s.type]) return P[s.type][n % 14];
  if (s.type === 'semanal') return Math.floor(n / 7) % 2 === 0 ? first : second;
  return n % 2 === 0 ? first : second; // alterna
}
function nombre(who) { return who === 'both' ? 'Ambos' : (F().parents[who] || (who === 'A' ? 'Padre/madre A' : 'Padre/madre B')); }
function color(who) { return who === 'A' ? '#0d9488' : '#f97316'; }
function inicial(name = '?') { return (String(name).trim()[0] || '?').toUpperCase(); }
function proximoCambio() {
  const hoy = today(), actual = custodioDe(hoy);
  for (let i = 1; i <= 21; i++) { const f = iso(new Date(Date.now() + i * 86400000)); if (custodioDe(f) !== actual) return { fecha: f, dias: i, quien: custodioDe(f) }; }
  return null;
}
function balance() {
  let net = 0;
  for (const e of D().expenses) { if (e.settled) continue; const debe = e.amount * (1 - e.split / 100); net += e.payer === 'A' ? debe : -debe; }
  return net;
}
function etiquetaEsquema(t) { return { 'semanal':'Semanal','2-2-3':'2-2-3','2-2-5-5':'2-2-5-5','3-4-4-3':'3-4-4-3','alterna':'Día por medio' }[t] || t; }

/* ================================ ROUTER =============================== */
const ROUTES = ['inicio','calendario','gastos','mensajes','hijos'];
const currentRoute = () => { const h = location.hash.replace('#/', '').split('/')[0]; return ROUTES.includes(h) ? h : 'inicio'; };
const go = (r) => { location.hash = '#/' + r; };
window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', boot);
async function boot() { await Store.init(); render(); }

/* ================================ RENDER =============================== */
function render() {
  const nav = $('#nav');
  // Puertas de acceso
  if (Store.mode === 'cloud') {
    if (!Cloud.token) { nav.classList.add('hidden'); return renderAuth('welcome'); }
    if (!Store.state) { nav.classList.add('hidden'); return renderLoading(); }
    if (D().kids.length === 0 && !localStorage.getItem('copaz.setupDone')) { nav.classList.add('hidden'); return renderSetup(); }
  } else {
    if (!Store.state || !Store.state.family) { nav.classList.add('hidden'); return renderOnboarding(); }
  }
  nav.classList.remove('hidden');
  renderNav();
  const r = currentRoute();
  const app = $('#app'); app.innerHTML = '';
  ({ inicio: viewInicio, calendario: viewCalendario, gastos: viewGastos, mensajes: viewMensajes, hijos: viewHijos }[r])(app);
}
function renderLoading() { $('#app').innerHTML = `<div class="ob"><div class="empty"><div class="ic">🕊️</div><p>Cargando tu espacio…</p></div></div>`; }
function renderNav() {
  const r = currentRoute();
  const lastSeen = +(localStorage.getItem('copaz.msgSeen') || 0);
  const unread = (D().messages || []).filter(m => m.from !== meRole() && m.ts > lastSeen).length;
  const items = [['inicio','🏠','Inicio'],['calendario','📅','Calendario'],['gastos','💰','Gastos'],['mensajes','💬','Mensajes'],['hijos','🧒','Hijos']];
  $('#nav').innerHTML = items.map(([id, ic, l]) => {
    const dot = (id === 'mensajes' && unread > 0)
      ? `<span style="position:absolute;top:3px;left:calc(50% + 6px);min-width:16px;height:16px;padding:0 4px;background:var(--rose);color:#fff;font-size:10px;font-weight:700;border-radius:99px;display:grid;place-items:center">${unread}</span>` : '';
    return `<a href="#/${id}" class="${r===id?'active':''}" style="position:relative"><span class="ic">${ic}</span>${l}${dot}</a>`;
  }).join('');
}
function topbar(title, sub, actions = '') {
  return `<header class="topbar"><div class="topbar-inner">
    <div><h1>${esc(title)}</h1>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>
    <div class="spacer"></div>${actions}</div></header>`;
}

/* ============================ LOGO (SVG) =============================== */
const LOGO = `<svg class="logo" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect width="100" height="100" rx="26" fill="#0d9488"/>
  <path d="M30 58c8 10 32 10 40 0" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round"/>
  <circle cx="37" cy="42" r="7" fill="#fff"/><circle cx="63" cy="42" r="7" fill="#f97316"/></svg>`;

/* ===================== ONBOARDING (modo LOCAL) ========================= */
function renderOnboarding() {
  $('#app').innerHTML = `<div class="ob">
    ${LOGO}<h1>Copaz</h1>
    <p class="tag">Coparentalidad en paz. Todo lo de tus hijos, organizado y sin conflicto.</p>
    <div style="margin:24px 0">
      <div class="feat"><span class="ic">📅</span><div><div class="t">Calendario de custodia</div><div class="s">Plantillas automáticas: semanal, 2-2-3, 2-2-5-5 y más.</div></div></div>
      <div class="feat"><span class="ic">💰</span><div><div class="t">Gastos compartidos</div><div class="s">Divide costos y ve al instante quién le debe a quién.</div></div></div>
      <div class="feat"><span class="ic">💬</span><div><div class="t">Mensajes ordenados</div><div class="s">Todo lo acordado en un solo lugar, con fecha y hora.</div></div></div>
      <div class="feat"><span class="ic">🧒</span><div><div class="t">Perfiles de tus hijos</div><div class="s">Info médica, alergias, escuela y contactos de emergencia.</div></div></div>
    </div>
    <button class="btn block" id="ob-start">Comenzar</button>
    <button class="btn ghost block" id="ob-demo" style="margin-top:10px">Ver con datos de ejemplo</button>
  </div>`;
  $('#ob-start').onclick = () => modalConfigInicial(false);
  $('#ob-demo').onclick  = () => modalConfigInicial(true);
}
function modalConfigInicial(demo) {
  openSheet('Configura tu familia', `
    <div class="field"><label>Tu nombre</label><input id="cfg-a" placeholder="Ej. Pedro" value="${demo ? 'Pedro' : ''}"></div>
    <div class="field"><label>Nombre del otro padre / madre</label><input id="cfg-b" placeholder="Ej. Ana" value="${demo ? 'Ana' : ''}"></div>
    <div class="field"><label>Nombres de tus hijos <span class="hint">(separados por coma)</span></label>
      <input id="cfg-k" placeholder="Ej. Sofía, Mateo" value="${demo ? 'Sofía, Mateo' : ''}"></div>
    <div class="field"><label>Esquema de custodia</label>
      <select id="cfg-s">
        <option value="semanal">Semana sí / semana no</option>
        <option value="2-2-3" selected>2-2-3 (alterna fines de semana)</option>
        <option value="2-2-5-5">2-2-5-5</option>
        <option value="3-4-4-3">3-4-4-3</option>
        <option value="alterna">Día por medio</option>
      </select></div>
    <div class="field"><label>Moneda</label>
      <select id="cfg-cur">${['MXN','USD','EUR','COP','ARS','CLP'].map(c => `<option value="${c}">${c}</option>`).join('')}</select></div>
    <button class="btn block" id="cfg-go">Crear mi espacio</button>
  `);
  $('#cfg-go').onclick = () => {
    const a = $('#cfg-a').value.trim() || 'Yo';
    const b = $('#cfg-b').value.trim() || 'Otro padre/madre';
    const kidsNames = ($('#cfg-k').value.trim() || 'Hijo/a').split(',').map(s => s.trim()).filter(Boolean);
    Store.createLocal({ a, b, kidsNames, scheduleType: $('#cfg-s').value, currency: $('#cfg-cur').value, demo });
    closeSheet(); go('inicio'); render(); toast('¡Listo! Bienvenido a Copaz 🕊️');
  };
}

/* ======================= ACCESO (modo NUBE) =========================== */
function renderAuth(screen) {
  const app = $('#app');
  if (screen === 'welcome') {
    app.innerHTML = `<div class="ob">${LOGO}<h1>Copaz</h1>
      <p class="tag">Coparentalidad en paz. Coordina todo lo de tus hijos con el otro padre, en un solo lugar.</p>
      <div style="margin-top:26px">
        <button class="btn block" onclick="renderAuth('register')">Crear cuenta</button>
        <button class="btn outline block" style="margin-top:10px" onclick="renderAuth('login')">Ya tengo cuenta</button>
        <button class="btn ghost block" style="margin-top:10px" onclick="renderAuth('join')">Tengo un código de invitación</button>
      </div></div>`;
  } else if (screen === 'register') {
    app.innerHTML = authShell('Crear cuenta', `
      <div class="field"><label>Tu nombre</label><input id="au-name" placeholder="Ej. Pedro"></div>
      <div class="field"><label>Correo</label><input id="au-email" type="email" placeholder="tu@correo.com"></div>
      <div class="field"><label>Contraseña</label><input id="au-pass" type="password" placeholder="Mínimo 6 caracteres"></div>
      <button class="btn block" id="au-go">Crear cuenta</button>
      <p class="hint" style="text-align:center;margin-top:14px">¿Ya tienes cuenta? <a onclick="renderAuth('login')">Inicia sesión</a></p>`);
    $('#au-go').onclick = () => act(async () => {
      const name = $('#au-name').value.trim(), email = $('#au-email').value.trim(), pass = $('#au-pass').value;
      if (!name || !email || pass.length < 6) return toast('Completa todos los campos (contraseña de 6+)');
      const r = await Cloud.register(email, pass, name);
      Cloud.setToken(r.token); Store.setUser({ ...r.user, inviteCode: r.inviteCode });
      await Store.refresh(); Store._connect();
      renderInvite(r.inviteCode);
    });
  } else if (screen === 'login') {
    app.innerHTML = authShell('Iniciar sesión', `
      <div class="field"><label>Correo</label><input id="au-email" type="email" placeholder="tu@correo.com"></div>
      <div class="field"><label>Contraseña</label><input id="au-pass" type="password"></div>
      <button class="btn block" id="au-go">Entrar</button>
      <p class="hint" style="text-align:center;margin-top:14px">¿Nuevo aquí? <a onclick="renderAuth('register')">Crea una cuenta</a></p>`);
    $('#au-go').onclick = () => act(async () => {
      const email = $('#au-email').value.trim(), pass = $('#au-pass').value;
      if (!email || !pass) return toast('Escribe correo y contraseña');
      const r = await Cloud.login(email, pass);
      Cloud.setToken(r.token); Store.setUser(r.user);
      await Store.refresh(); Store._connect(); go('inicio'); render();
    });
  } else if (screen === 'join') {
    app.innerHTML = authShell('Unirme con un código', `
      <p class="hint" style="margin-bottom:14px">Primero necesitas una cuenta. Si aún no tienes, créala y luego vincula con el código que te dio el otro padre.</p>
      <div class="field"><label>Tu nombre</label><input id="au-name" placeholder="Ej. Ana"></div>
      <div class="field"><label>Correo</label><input id="au-email" type="email" placeholder="tu@correo.com"></div>
      <div class="field"><label>Contraseña</label><input id="au-pass" type="password" placeholder="Mínimo 6 caracteres"></div>
      <div class="field"><label>Código de invitación</label><input id="au-code" placeholder="Ej. 4XZ8QK" style="text-transform:uppercase"></div>
      <button class="btn block" id="au-go">Crear cuenta y vincular</button>
      <p class="hint" style="text-align:center;margin-top:14px"><a onclick="renderAuth('welcome')">Volver</a></p>`);
    $('#au-go').onclick = () => act(async () => {
      const name = $('#au-name').value.trim(), email = $('#au-email').value.trim(), pass = $('#au-pass').value, code = $('#au-code').value.trim();
      if (!name || !email || pass.length < 6 || !code) return toast('Completa todos los campos');
      const reg = await Cloud.register(email, pass, name);
      Cloud.setToken(reg.token);
      const j = await Cloud.join(code);
      Cloud.setToken(j.token); Store.setUser(j.user);
      await Store.refresh(); Store._connect(); go('inicio'); render(); toast('¡Vinculado! Ya comparten todo 🎉');
    });
  }
}
function authShell(title, body) {
  return `<div class="ob"><div style="width:56px;margin:0 auto 10px">${LOGO.replace('class="logo"','')}</div>
    <h1 style="font-size:24px">${esc(title)}</h1><div style="text-align:left;margin-top:22px">${body}</div></div>`;
}
function renderInvite(code) {
  $('#app').innerHTML = `<div class="ob">
    <div class="empty"><div class="ic">🎉</div></div>
    <h1 style="font-size:24px">¡Cuenta creada!</h1>
    <p class="tag">Comparte este código con el otro padre para que se una a tu espacio y vean lo mismo.</p>
    <div class="card" style="margin:20px 0"><div style="font-size:12px;color:var(--slate);text-transform:uppercase;letter-spacing:.06em">Tu código de invitación</div>
      <div style="font-size:34px;font-weight:800;letter-spacing:.15em;color:var(--teal-700);margin-top:6px">${esc(code)}</div></div>
    <button class="btn block" onclick="go('inicio');render()">Entrar a Copaz</button>
  </div>`;
}

/* Configuración guiada la primera vez (modo nube, familia vacía) */
function renderSetup() {
  const yo = (D().auth.name || 'Yo').split(' ')[0];
  $('#app').innerHTML = `<div class="ob" style="justify-content:flex-start;padding-top:30px">
    ${LOGO}<h1 style="font-size:24px">Hola, ${esc(yo)} 👋</h1>
    <p class="tag">Configuremos tu familia en 20 segundos. Podrás cambiar todo después.</p>
    <div style="text-align:left;margin-top:22px">
      <div class="field"><label>Nombre del otro padre / madre</label><input id="su-b" placeholder="Ej. Ana"></div>
      <div class="field"><label>Nombres de tus hijos <span class="hint">(separados por coma)</span></label>
        <input id="su-k" placeholder="Ej. Sofía, Mateo"></div>
      <div class="field"><label>Esquema de custodia</label>
        <select id="su-s">
          <option value="semanal">Semana sí / semana no</option>
          <option value="2-2-3" selected>2-2-3 (alterna fines de semana)</option>
          <option value="2-2-5-5">2-2-5-5</option>
          <option value="3-4-4-3">3-4-4-3</option>
          <option value="alterna">Día por medio</option>
        </select></div>
      <div class="field"><label>¿Quién tiene a los niños primero este mes?</label>
        <div class="seg" id="su-first"><button data-v="A" class="on">Yo</button><button data-v="B">El otro padre/madre</button></div></div>
      <div class="field"><label>Moneda</label>
        <select id="su-cur">${['MXN','USD','EUR','COP','ARS','CLP'].map(c => `<option value="${c}">${c}</option>`).join('')}</select></div>
      <button class="btn block" id="su-go">Guardar y continuar</button>
      <button class="btn ghost block" id="su-skip" style="margin-top:10px">Saltar por ahora</button>
    </div></div>`;
  segBind('#su-first');
  $('#su-skip').onclick = () => { localStorage.setItem('copaz.setupDone', '1'); go('inicio'); render(); };
  $('#su-go').onclick = () => act(async () => {
    const b = $('#su-b').value.trim();
    const kids = ($('#su-k').value.trim() || '').split(',').map(s => s.trim()).filter(Boolean);
    const d = new Date();
    await Store.patchFamily({
      parents: { A: D().auth.name || nombre('A'), B: b || 'Otro padre/madre' },
      currency: $('#su-cur').value,
      schedule: { type: $('#su-s').value, start: iso(new Date(d.getFullYear(), d.getMonth(), 1)), startParent: segVal('#su-first') },
    });
    for (let i = 0; i < kids.length; i++) {
      await Store.create('kids', { name: kids[i], dob:'', school:'', grade:'', allergies:'', meds:'', doctor:'', bloodType:'', emergency:'', notes:'', color: ['#0d9488','#f97316','#2563eb','#e11d48'][i % 4] });
    }
    localStorage.setItem('copaz.setupDone', '1');
    go('inicio'); render(); toast('¡Familia configurada! 🎉');
  });
}

/* =============================== INICIO =============================== */
function viewInicio(app) {
  const hoy = today(), custodioHoy = custodioDe(hoy), cambio = proximoCambio(), bal = balance(), me = meRole();
  const pendientes = D().expenses.filter(e => !e.settled).length;
  const proxEventos = [...D().events].filter(e => e.date >= hoy).sort((a,b) => (a.date+a.time).localeCompare(b.date+b.time)).slice(0, 3);
  const ultimo = D().messages.filter(m => m.from !== me).slice(-1);
  const miNombre = (D().auth.name || nombre(me)).split(' ')[0];

  app.innerHTML = topbar('Hola, ' + miNombre, fechaLarga(hoy)) + `<div class="screen">
    <div class="hero">
      <div class="label">Hoy están con</div>
      <div class="who">${esc(nombre(custodioHoy))}</div>
      ${cambio ? `<div class="when">Cambio en ${cambio.dias} día${cambio.dias>1?'s':''} · ${fechaLarga(cambio.fecha)} pasan con ${esc(nombre(cambio.quien))}</div>` : ''}
      <div class="chips">${D().kids.map(k => `<span class="chip">🧒 ${esc(k.name)}</span>`).join('')}</div>
    </div>
    <div class="stat-grid">
      <div class="stat" onclick="go('gastos')" style="cursor:pointer"><div class="ic">💰</div>
        <div class="n" style="color:${bal>0.5?'#16a34a':bal<-0.5?'#e11d48':'#475569'}">${money(Math.abs(bal))}</div>
        <div class="t">${bal>0.5? 'a favor de '+esc(nombre('A')) : bal<-0.5? esc(nombre('A'))+' debe' : 'al corriente'}</div></div>
      <div class="stat" onclick="go('gastos')" style="cursor:pointer"><div class="ic">🧾</div><div class="n">${pendientes}</div><div class="t">gastos por saldar</div></div>
      <div class="stat" onclick="go('calendario')" style="cursor:pointer"><div class="ic">📅</div><div class="n">${proxEventos.length}</div><div class="t">próximos eventos</div></div>
      <div class="stat" onclick="go('mensajes')" style="cursor:pointer"><div class="ic">💬</div><div class="n">${D().messages.length}</div><div class="t">mensajes</div></div>
    </div>
    <div class="section-title">Próximos eventos <span class="count">${proxEventos.length}</span></div>
    <div class="card">${proxEventos.length ? proxEventos.map(evRow).join('') : `<div class="empty"><div class="ic">🗓️</div><p>Sin eventos próximos</p></div>`}</div>
    ${ultimo.length ? `<div class="section-title">Último mensaje</div>
    <div class="card" onclick="go('mensajes')" style="cursor:pointer"><div class="list-row">
      <div class="avatar" style="background:${color(ultimo[0].from)}">${inicial(nombre(ultimo[0].from))}</div>
      <div class="body"><div class="t">${esc(nombre(ultimo[0].from))}</div>
        <div class="s">${esc(ultimo[0].text.slice(0,60))}${ultimo[0].text.length>60?'…':''}</div></div></div></div>` : ''}
  </div>`;
}
function evRow(e) {
  const dias = diffDias(today(), e.date);
  const cuando = dias === 0 ? 'Hoy' : dias === 1 ? 'Mañana' : fechaLarga(e.date);
  const kid = D().kids.find(k => k.id === e.kid);
  const whoB = e.who === 'both' ? `<span class="badge gray">Ambos</span>` : `<span class="badge ${e.who==='A'?'teal':'amber'}">${esc(nombre(e.who))}</span>`;
  return `<div class="list-row"><div class="avatar" style="background:${kid?kid.color:'#94a3b8'}">${kid?inicial(kid.name):'📌'}</div>
    <div class="body"><div class="t">${esc(e.title)}</div><div class="s">${cuando}${e.time?' · '+e.time:''}${kid?' · '+esc(kid.name):''}</div></div>
    <div class="meta">${whoB}</div></div>`;
}

/* ============================= CALENDARIO ============================= */
let calRef = new Date();
function viewCalendario(app) {
  app.innerHTML = topbar('Calendario', 'Custodia · ' + etiquetaEsquema(F().schedule.type),
    `<button class="icon-btn" onclick="modalEsquema()">⚙️</button>`) + `<div class="screen">
    <div class="cal-head"><button class="cal-nav" onclick="calMove(-1)">‹</button>
      <h2>${MESES[calRef.getMonth()]} ${calRef.getFullYear()}</h2>
      <button class="cal-nav" onclick="calMove(1)">›</button></div>
    <div class="card"><div class="cal-grid">${DOW.map(d => `<div class="cal-dow">${d}</div>`).join('')}</div>
      <div class="cal-grid" id="cal-body"></div>
      <div class="legend">
        <span class="k"><span class="sw" style="background:var(--teal-50);border:1px solid var(--teal-200)"></span> ${esc(nombre('A'))}</span>
        <span class="k"><span class="sw" style="background:var(--coral-soft);border:1px solid #fed7aa"></span> ${esc(nombre('B'))}</span>
        <span class="k"><span class="sw" style="background:var(--rose)"></span> evento</span></div></div>
    ${swapsSection()}
    <div class="section-title">Eventos de ${MESES[calRef.getMonth()]}</div>
    <div class="card" id="cal-events"></div></div>
    <button class="fab" onclick="modalEvento()">＋</button>`;
  drawCal();
}

/* --------- Intercambios de días --------- */
function swapsSection() {
  const me = meRole();
  const swaps = (D().swaps || []).filter(s => s.status === 'pending')
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!swaps.length) return '';
  return `<div class="section-title">Intercambios pendientes <span class="count">${swaps.length}</span></div>
    <div class="card">${swaps.map(s => swapRow(s, me)).join('')}</div>`;
}
function swapRow(s, me) {
  const incoming = s.to === me; // me piden que YO tenga a los niños ese día? to = quien tendría a los niños
  const mine = s.from === me;   // yo lo propuse
  const dias = diffDias(today(), s.date);
  const cuando = dias === 0 ? 'Hoy' : dias === 1 ? 'Mañana' : fechaLarga(s.date);
  return `<div class="list-row">
    <div class="avatar" style="background:${color(s.from)}">🔄</div>
    <div class="body"><div class="t">${cuando} → con ${esc(nombre(s.to))}</div>
      <div class="s">Propuesto por ${esc(nombre(s.from))}${s.note ? ' · “' + esc(s.note) + '”' : ''}</div></div>
    <div class="meta">${
      mine ? `<span class="badge amber">Esperando</span>`
      : `<button class="btn sm" onclick="acceptSwap('${s.id}')">Aceptar</button>
         <button class="btn sm ghost" style="margin-top:4px" onclick="rejectSwap('${s.id}')">Rechazar</button>`
    }</div></div>`;
}
function modalProponerSwap(fecha) {
  const me = meRole(), other = me === 'A' ? 'B' : 'A';
  const actual = custodioDe(fecha);
  openSheet('Proponer intercambio', `
    <p class="hint" style="margin-bottom:14px">${fechaLarga(fecha)} · ahora le toca a <b>${esc(nombre(actual))}</b>.</p>
    <div class="field"><label>¿Quién tendría a los niños ese día?</label>
      <div class="seg" id="sw-to">
        <button data-v="A" class="${actual==='A'?'':'on'}">${esc(nombre('A'))}</button>
        <button data-v="B" class="${actual==='B'?'':'on'}">${esc(nombre('B'))}</button></div></div>
    <div class="field"><label>Mensaje (opcional)</label><textarea id="sw-note" placeholder="Ej. Tengo un compromiso ese día…"></textarea></div>
    <button class="btn block" id="sw-go">Enviar propuesta</button>
    <p class="hint" style="text-align:center;margin-top:12px">${esc(nombre(other))} recibirá la solicitud para aceptarla o rechazarla.</p>`);
  segBind('#sw-to');
  $('#sw-go').onclick = () => act(async () => {
    const to = segVal('#sw-to'); const from = to === 'A' ? 'B' : 'A';
    await Store.create('swaps', { date: fecha, from, to, note: $('#sw-note').value.trim(), status: 'pending', ts: Date.now() });
    closeSheet(); render(); toast('Propuesta enviada');
  });
}
const acceptSwap = (id) => act(async () => { const s = (D().swaps || []).find(x => x.id === id); if (s) { await Store.update('swaps', id, { ...s, status: 'accepted' }); render(); toast('Intercambio aceptado ✓'); } });
const rejectSwap = (id) => act(async () => { const s = (D().swaps || []).find(x => x.id === id); if (s) { await Store.update('swaps', id, { ...s, status: 'rejected' }); render(); toast('Intercambio rechazado'); } });
const calMove = (d) => { calRef.setMonth(calRef.getMonth() + d); viewCalendario($('#app')); };
function drawCal() {
  const body = $('#cal-body'); if (!body) return;
  const y = calRef.getFullYear(), m = calRef.getMonth();
  const startPad = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startPad; i++) { const dt = new Date(y, m, 1 - (startPad - i)); cells.push({ d: dt.getDate(), s: iso(dt), out: true }); }
  for (let d = 1; d <= days; d++) cells.push({ d, s: iso(new Date(y, m, d)), out: false });
  while (cells.length % 7) { const dt = new Date(y, m, days + (cells.length % 7)); cells.push({ d: dt.getDate(), s: iso(dt), out: true }); }
  const evBy = {}; D().events.forEach(e => (evBy[e.date] = evBy[e.date] || []).push(e));
  body.innerHTML = cells.map(c => {
    const who = custodioDe(c.s);
    const cls = ['cal-cell', who === 'A' ? 'pa' : 'pb', c.out ? 'out' : '', c.s === today() ? 'today' : ''].join(' ');
    return `<div class="${cls}" onclick="modalDia('${c.s}')">${c.d}${evBy[c.s] ? '<span class="dot"></span>' : ''}</div>`;
  }).join('');
  const pref = `${y}-${pad(m + 1)}`;
  const evs = D().events.filter(e => e.date.startsWith(pref)).sort((a,b) => (a.date+a.time).localeCompare(b.date+b.time));
  $('#cal-events').innerHTML = evs.length ? evs.map(evRow).join('') : `<div class="empty"><div class="ic">🗓️</div><p>Sin eventos este mes</p></div>`;
}
function modalDia(s) {
  const who = custodioDe(s), evs = D().events.filter(e => e.date === s);
  openSheet(fechaLarga(s), `
    <div class="card tight" style="margin-bottom:14px"><div class="list-row" style="padding:6px 0">
      <div class="avatar" style="background:${color(who)}">${inicial(nombre(who))}</div>
      <div class="body"><div class="t">Con ${esc(nombre(who))}</div><div class="s">Esquema ${etiquetaEsquema(F().schedule.type)}</div></div></div></div>
    ${evs.length ? evs.map(e => `<div class="list-row"><div class="avatar" style="background:#94a3b8">📌</div>
      <div class="body" style="cursor:pointer" onclick="modalEvento('${e.date}','${e.id}')"><div class="t">${esc(e.title)}</div><div class="s">${e.time || 'Todo el día'} · ${esc(nombre(e.who))}</div></div>
      <button class="btn sm ghost" onclick="modalEvento('${e.date}','${e.id}')">Editar</button></div>`).join('') : `<p class="hint" style="margin-bottom:14px">Sin eventos este día.</p>`}
    <button class="btn block" onclick="modalEvento('${s}')">＋ Añadir evento</button>
    <button class="btn block ghost" style="margin-top:10px" onclick="modalProponerSwap('${s}')">🔄 Proponer intercambio</button>`);
}
function modalEvento(fecha, id) {
  const ev = id ? D().events.find(x => x.id === id) : null;
  const kidsOpts = D().kids.map(k => `<option value="${k.id}"${ev && ev.kid === k.id ? ' selected' : ''}>${esc(k.name)}</option>`).join('');
  const who = ev ? ev.who : 'A';
  openSheet(ev ? 'Editar evento' : 'Nuevo evento', `
    <div class="field"><label>Título</label><input id="ev-t" placeholder="Ej. Consulta pediatra" value="${ev ? esc(ev.title) : ''}"></div>
    <div class="row2"><div class="field"><label>Fecha</label><input id="ev-d" type="date" value="${ev ? ev.date : (fecha || today())}"></div>
      <div class="field"><label>Hora</label><input id="ev-h" type="time" value="${ev ? ev.time : ''}"></div></div>
    <div class="field"><label>¿De qué hijo/a?</label><select id="ev-k">${kidsOpts}</select></div>
    <div class="field"><label>¿Quién lleva/asiste?</label><div class="seg" id="ev-who">
      <button data-v="A" class="${who==='A'?'on':''}">${esc(nombre('A'))}</button><button data-v="B" class="${who==='B'?'on':''}">${esc(nombre('B'))}</button><button data-v="both" class="${who==='both'?'on':''}">Ambos</button></div></div>
    <div class="field"><label>Nota</label><textarea id="ev-n" placeholder="Detalles, dirección, qué llevar…">${ev ? esc(ev.note || '') : ''}</textarea></div>
    <button class="btn block" id="ev-save">${ev ? 'Guardar cambios' : 'Guardar evento'}</button>
    ${ev ? `<button class="btn block outline" id="ev-del" style="margin-top:10px">Eliminar evento</button>` : ''}`);
  segBind('#ev-who');
  $('#ev-save').onclick = () => act(async () => {
    const title = $('#ev-t').value.trim(); if (!title) return toast('Escribe un título');
    const data = { title, date: $('#ev-d').value, time: $('#ev-h').value, kid: $('#ev-k').value, who: segVal('#ev-who'), note: $('#ev-n').value.trim() };
    if (ev) await Store.update('events', id, data); else await Store.create('events', data);
    closeSheet(); render(); toast(ev ? 'Evento actualizado' : 'Evento guardado');
  });
  const del = $('#ev-del');
  if (del) del.onclick = () => act(async () => { await Store.remove('events', id); closeSheet(); render(); toast('Evento eliminado'); });
}
const delEvento = (id) => act(async () => { await Store.remove('events', id); closeSheet(); render(); toast('Evento eliminado'); });
function modalEsquema() {
  const s = F().schedule;
  openSheet('Esquema de custodia', `
    <div class="field"><label>Tipo de rotación</label><select id="es-t">
      <option value="semanal">Semana sí / semana no</option><option value="2-2-3">2-2-3</option>
      <option value="2-2-5-5">2-2-5-5</option><option value="3-4-4-3">3-4-4-3</option><option value="alterna">Día por medio</option></select></div>
    <div class="field"><label>Fecha de inicio del ciclo</label><input id="es-d" type="date" value="${s.start}"></div>
    <div class="field"><label>¿Quién empieza el ciclo?</label><div class="seg" id="es-p">
      <button data-v="A" class="${s.startParent==='A'?'on':''}">${esc(nombre('A'))}</button>
      <button data-v="B" class="${s.startParent==='B'?'on':''}">${esc(nombre('B'))}</button></div></div>
    <p class="hint">Las plantillas siguen los estándares de acuerdos de custodia compartida.</p>
    <button class="btn block" id="es-save" style="margin-top:8px">Guardar esquema</button>`);
  $('#es-t').value = s.type; segBind('#es-p');
  $('#es-save').onclick = () => act(async () => {
    await Store.patchFamily({ schedule: { type: $('#es-t').value, start: $('#es-d').value, startParent: segVal('#es-p') } });
    closeSheet(); viewCalendario($('#app')); toast('Esquema actualizado');
  });
}

/* =============================== GASTOS =============================== */
function viewGastos(app) {
  const bal = balance();
  const cls = bal > 0.5 ? 'pos' : bal < -0.5 ? 'neg' : 'zero';
  const txt = bal > 0.5 ? `${esc(nombre('B'))} le debe a ${esc(nombre('A'))}` : bal < -0.5 ? `${esc(nombre('A'))} le debe a ${esc(nombre('B'))}` : 'Están al corriente';
  const items = [...D().expenses].sort((a,b) => b.date.localeCompare(a.date));
  const mp = today().slice(0, 7);
  const mes = D().expenses.filter(e => e.date.startsWith(mp));
  const totalMes = mes.reduce((s, e) => s + e.amount, 0);
  const porCat = {}; mes.forEach(e => porCat[e.cat] = (porCat[e.cat] || 0) + e.amount);
  const cats = Object.entries(porCat).sort((a, b) => b[1] - a[1]);
  const pagA = mes.filter(e => e.payer === 'A').reduce((s, e) => s + e.amount, 0);
  const pagB = mes.filter(e => e.payer === 'B').reduce((s, e) => s + e.amount, 0);
  const resumen = totalMes > 0 ? `<div class="card">
      <div style="font-size:12px;color:var(--slate);text-transform:uppercase;letter-spacing:.05em">Gasto de ${MESES[new Date().getMonth()]}</div>
      <div style="font-size:24px;font-weight:800;letter-spacing:-.02em">${money(totalMes)}</div>
      <div style="font-size:12.5px;color:var(--slate);margin-top:3px">${esc(nombre('A'))} pagó ${money(pagA)} · ${esc(nombre('B'))} pagó ${money(pagB)}</div>
      <div style="margin-top:12px;display:flex;flex-direction:column;gap:9px">
      ${cats.map(([c, v]) => { const pct = Math.round(v / totalMes * 100); return `<div>
        <div style="display:flex;justify-content:space-between;font-size:12.5px"><span style="font-weight:600">${esc(c)}</span><span style="color:var(--slate)">${money(v)} · ${pct}%</span></div>
        <div style="height:6px;background:var(--line);border-radius:99px;margin-top:3px;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--teal-500)"></div></div></div>`; }).join('')}
      </div></div>` : '';
  app.innerHTML = topbar('Gastos', 'Compartidos y reembolsos',
    items.length ? `<button class="icon-btn" onclick="exportarGastosCSV()" title="Exportar a CSV">⬇️</button>` : '') + `<div class="screen">
    <div class="balance ${cls}"><div class="l">Balance actual</div><div class="v">${money(Math.abs(bal))}</div>
      <div style="opacity:.92;font-size:13.5px;margin-top:2px">${txt}</div></div>
    ${bal !== 0 ? `<button class="btn block ghost" onclick="saldarTodo()" style="margin-bottom:14px">Marcar todo como saldado</button>` : ''}
    ${resumen}
    <div class="section-title">Movimientos <span class="count">${items.length}</span></div>
    <div class="card">${items.length ? items.map(gastoRow).join('') : `<div class="empty"><div class="ic">🧾</div><p>Aún no hay gastos</p></div>`}</div></div>
    <button class="fab" onclick="modalGasto()">＋</button>`;
}
function gastoRow(e) {
  const kid = D().kids.find(k => k.id === e.kid), debeOtro = e.amount * (1 - e.split / 100);
  return `<div class="list-row"><div class="avatar" style="background:${color(e.payer)}">${inicial(nombre(e.payer))}</div>
    <div class="body" style="cursor:pointer" onclick="modalGasto('${e.id}')"><div class="t">${esc(e.title)} ${e.settled ? '<span class="badge green">saldado</span>' : ''}</div>
      <div class="s">${fechaLarga(e.date)} · ${esc(e.cat)}${kid ? ' · '+esc(kid.name) : ''} · pagó ${esc(nombre(e.payer))}</div></div>
    <div class="meta"><div style="font-weight:800;color:var(--ink);font-size:15px">${money(e.amount)}</div>
      <div style="font-size:11.5px">${e.settled ? '' : `${esc(nombre(e.payer==='A'?'B':'A'))} debe ${money(debeOtro)}`}</div>
      ${e.settled ? '' : `<button class="btn sm ghost" style="margin-top:4px" onclick="saldar('${e.id}')">Saldar</button>`}</div></div>`;
}
function modalGasto(id) {
  const e = id ? D().expenses.find(x => x.id === id) : null;
  const cats = ['Educación','Salud','Ropa','Alimentación','Actividades','Transporte','Otro'];
  const kidsOpts = `<option value="">— General —</option>` + D().kids.map(k => `<option value="${k.id}"${e && e.kid === k.id ? ' selected' : ''}>${esc(k.name)}</option>`).join('');
  const split = e ? e.split : 50;
  openSheet(e ? 'Editar gasto' : 'Nuevo gasto', `
    <div class="field"><label>Concepto</label><input id="gx-t" placeholder="Ej. Colegiatura, consulta…" value="${e ? esc(e.title) : ''}"></div>
    <div class="row2"><div class="field"><label>Monto</label><input id="gx-a" type="number" inputmode="decimal" placeholder="0.00" value="${e ? e.amount : ''}"></div>
      <div class="field"><label>Fecha</label><input id="gx-d" type="date" value="${e ? e.date : today()}"></div></div>
    <div class="field"><label>¿Quién pagó?</label><div class="seg" id="gx-p">
      <button data-v="A" class="${!e || e.payer === 'A' ? 'on' : ''}">${esc(nombre('A'))}</button><button data-v="B" class="${e && e.payer === 'B' ? 'on' : ''}">${esc(nombre('B'))}</button></div></div>
    <div class="row2"><div class="field"><label>Categoría</label>
      <select id="gx-c">${cats.map(c => `<option${e && e.cat === c ? ' selected' : ''}>${c}</option>`).join('')}</select></div>
      <div class="field"><label>Hijo/a</label><select id="gx-k">${kidsOpts}</select></div></div>
    <div class="field"><label>División <span class="hint" id="gx-splitlbl">${split}% / ${100 - split}%</span></label>
      <input id="gx-s" type="range" min="0" max="100" step="5" value="${split}">
      <div class="hint">Porcentaje que le corresponde a quien pagó. El resto lo debe el otro.</div></div>
    <button class="btn block" id="gx-save">${e ? 'Guardar cambios' : 'Guardar gasto'}</button>
    ${e ? `<button class="btn block outline" id="gx-del" style="margin-top:10px">Eliminar gasto</button>` : ''}`);
  segBind('#gx-p');
  const rng = $('#gx-s'), lbl = $('#gx-splitlbl');
  rng.oninput = () => { lbl.textContent = `${rng.value}% / ${100 - rng.value}%`; };
  $('#gx-save').onclick = () => act(async () => {
    const title = $('#gx-t').value.trim(), amount = parseFloat($('#gx-a').value);
    if (!title) return toast('Escribe el concepto');
    if (!amount || amount <= 0) return toast('Escribe un monto válido');
    const data = { title, amount, date: $('#gx-d').value, payer: segVal('#gx-p'), split: parseInt(rng.value, 10), cat: $('#gx-c').value, kid: $('#gx-k').value, settled: e ? e.settled : false };
    if (e) await Store.update('expenses', id, data); else await Store.create('expenses', data);
    closeSheet(); render(); toast(e ? 'Gasto actualizado' : 'Gasto registrado');
  });
  const del = $('#gx-del');
  if (del) del.onclick = () => act(async () => { await Store.remove('expenses', id); closeSheet(); render(); toast('Gasto eliminado'); });
}
function exportarGastosCSV() {
  const rows = [['Fecha','Concepto','Categoría','Hijo/a','Pagó','Monto','% pagador','Saldado']];
  [...D().expenses].sort((a,b) => a.date.localeCompare(b.date)).forEach(e => {
    const kid = D().kids.find(k => k.id === e.kid);
    rows.push([e.date, e.title, e.cat, kid ? kid.name : '', nombre(e.payer), e.amount, e.split + '%', e.settled ? 'Sí' : 'No']);
  });
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `copaz-gastos-${today()}.csv`; a.click();
  URL.revokeObjectURL(a.href); toast('CSV exportado');
}
const saldar = (id) => act(async () => { const e = D().expenses.find(x => x.id === id); if (e) { await Store.update('expenses', id, { ...e, settled: true }); render(); toast('Marcado como saldado'); } });
const saldarTodo = () => act(async () => { for (const e of D().expenses.filter(x => !x.settled)) await Store.update('expenses', e.id, { ...e, settled: true }); render(); toast('Todo saldado ✓'); });

/* ============================== MENSAJES ============================= */
function viewMensajes(app) {
  const me = meRole();
  app.innerHTML = topbar('Mensajes', 'Con ' + nombre(me === 'A' ? 'B' : 'A'),
    `<button class="icon-btn" onclick="exportarMensajes()" title="Guardar copia">⬇️</button>`) + `<div class="screen">
    <div class="card tight" style="background:var(--teal-50);border-color:var(--teal-200);margin-bottom:14px">
      <div style="font-size:12.5px;color:var(--teal-800)">🕊️ Un solo lugar para acordar lo de los niños, con calma y sin malentendidos. Todo queda ordenado por fecha, así nadie tiene que recordar quién dijo qué.</div></div>
    <div class="msg-wrap" id="msg-wrap"></div>
    <div class="composer"><div class="tone" id="tone"></div><div class="box">
      <textarea id="msg-in" rows="1" placeholder="Escribe un mensaje respetuoso…"></textarea>
      <button class="send" id="msg-send">➤</button></div></div></div>`;
  const wrap = $('#msg-wrap');
  wrap.innerHTML = D().messages.map(m => {
    const mine = m.from === me;
    return `<div class="msg ${mine ? 'me' : 'them'}">
      ${mine ? '' : `<div style="font-size:11px;font-weight:700;color:${color(m.from)};margin-bottom:2px">${esc(nombre(m.from))}</div>`}
      <div>${esc(m.text)}</div>
      <div class="time">${new Date(m.ts).toLocaleString('es-MX',{ day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit' })}</div></div>`;
  }).join('');
  setTimeout(() => wrap.scrollIntoView({ block: 'end' }), 0);
  // marcar como leídos
  localStorage.setItem('copaz.msgSeen', String(Date.now()));
  renderNav();
  const input = $('#msg-in'), tone = $('#tone');
  input.oninput = () => {
    input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    pintarTono(input.value);
  };
  $('#msg-send').onclick = enviarMensaje;
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarMensaje(); } };
}
function pintarTono(text) {
  const tone = $('#tone'); if (!tone) return;
  const c = analizarTono(text);
  tone.className = 'tone ' + (c.level || '');
  if (!c.level) { tone.innerHTML = ''; return; }
  tone.innerHTML = `<span>${esc(c.msg)}</span>` +
    (c.soften ? ` <button class="btn sm" style="margin-left:6px;padding:4px 10px" onclick="suavizarMensaje()">✨ Suavizar</button>` : '');
}
/* Analizador de tono multidimensional (reglas locales; ampliable a IA en el backend). */
const TONO = {
  insultos: ['idiota','estúpid','imbécil','inútil','no sirves','flojo','floja','irresponsable','ridícul','patét','tarad','payas'],
  acusa:    ['por tu culpa','es tu culpa','tu problema','tú siempre','tu siempre','tú nunca','tu nunca','tienes la culpa'],
  absolutos:['nunca','siempre','jamás','jamas','todo el tiempo','cada vez','nada te importa'],
  hostil:   ['odio','harto','harta','no me importa','me da igual','déjame en paz','no quiero saber'],
};
function analizarTono(text) {
  const t = text.toLowerCase().trim(); if (!t) return { level: '' };
  let score = 0; const motivos = [];
  if (TONO.insultos.some(w => t.includes(w)))  { score += 3; motivos.push('lenguaje ofensivo'); }
  if (TONO.acusa.some(w => t.includes(w)))     { score += 2; motivos.push('tono acusatorio'); }
  if (TONO.hostil.some(w => t.includes(w)))    { score += 2; motivos.push('hostilidad'); }
  if (TONO.absolutos.some(w => t.includes(w))) { score += 1; motivos.push('generalizaciones'); }
  if (text.length > 8 && text === text.toUpperCase()) { score += 2; motivos.push('mayúsculas (gritar)'); }
  if ((text.match(/!/g) || []).length >= 3)    { score += 1; motivos.push('exceso de signos'); }
  if (score >= 2) return { level: 'warn', soften: true, msg: `⚠️ Suena tenso (${motivos.slice(0,2).join(', ')}). ¿Lo suavizamos?` };
  if (score === 1) return { level: 'warn', soften: true, msg: '💬 Se puede decir de forma más neutral.' };
  if (/gracias|por favor|te lo agradezco|claro que|con gusto|de acuerdo/.test(t)) return { level: 'ok', msg: '✓ Tono respetuoso' };
  return { level: '' };
}
/* Reescribe el mensaje en un tono más neutral (asistente local, editable). */
function suavizarTexto(text) {
  let s = text;
  if (s.length > 8 && s === s.toUpperCase()) s = s.charAt(0) + s.slice(1).toLowerCase();
  const rep = [
    [/\bnunca\b/gi,'pocas veces'], [/\bsiempre\b/gi,'muchas veces'], [/\bjam[áa]s\b/gi,'rara vez'],
    [/\bpor tu culpa\b/gi,''], [/\bes tu culpa\b/gi,''], [/\btu problema\b/gi,'algo que resolver juntos'],
    [/\bt[úu] siempre\b/gi,'a veces'], [/\bt[úu] nunca\b/gi,'a veces no'],
    [/\beres (un|una)\b/gi,''],
    [/\b(idiota|estúpid[oa]|imb[ée]cil|in[úu]til|flojo|floja|irresponsable|rid[íi]cul[oa]|patét[ico]*|tarad[oa])\b/gi,''],
    [/\bodio\b/gi,'me cuesta'], [/\bharto\b/gi,'cansado'], [/\bharta\b/gi,'cansada'],
    [/!{2,}/g,'.'], [/\s{2,}/g,' '],
  ];
  for (const [re, to] of rep) s = s.replace(re, to);
  s = s.replace(/\s+([.,])/g, '$1').replace(/,\s*,/g, ',').replace(/^[\s,]+/, '').trim();
  if (s && !/[.!?]$/.test(s)) s += '.';
  const softFrame = /^(oye|hola|por favor|gracias)/i.test(s) ? '' : 'Me gustaría que pudiéramos resolver esto con calma. ';
  return (softFrame + (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')).trim();
}
function suavizarMensaje() {
  const input = $('#msg-in'); if (!input || !input.value.trim()) return;
  input.value = suavizarTexto(input.value);
  input.dispatchEvent(new Event('input'));
  input.focus();
  toast('Sugerencia lista — revísala antes de enviar');
}
function enviarMensaje() {
  const input = $('#msg-in'), text = input.value.trim(); if (!text) return;
  input.value = '';
  act(async () => { await Store.sendMessage(text); render(); });
}
function exportarMensajes() {
  const lines = D().messages.map(m => `[${new Date(m.ts).toLocaleString('es-MX')}] ${nombre(m.from)}: ${m.text}`);
  const header = `HISTORIAL DE MENSAJES — COPAZ\nEntre: ${nombre('A')} y ${nombre('B')}\nGuardado: ${new Date().toLocaleString('es-MX')}\nTotal: ${D().messages.length} mensajes\n${'='.repeat(50)}\n\n`;
  const blob = new Blob([header + lines.join('\n')], { type: 'text/plain' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `copaz-mensajes-${today()}.txt`; a.click();
  URL.revokeObjectURL(a.href); toast('Copia guardada');
}

/* =============================== HIJOS =============================== */
function viewHijos(app) {
  app.innerHTML = topbar('Mis hijos', D().kids.length + ' perfil' + (D().kids.length !== 1 ? 'es' : '')) + `<div class="screen">
    ${D().kids.map(kidCard).join('')}
    <button class="btn block ghost" onclick="modalHijo()" style="margin-top:6px">＋ Añadir hijo/a</button>
    <div class="section-title">Documentos <span class="count">${D().docs.length}</span></div>
    <div class="card">${D().docs.length ? D().docs.map(docRow).join('') : `<div class="empty"><div class="ic">📄</div><p>Sin documentos</p></div>`}</div>
    <button class="btn block ghost" onclick="modalDoc()">＋ Registrar documento</button>
    <div style="margin-top:30px" class="card tight"><div class="list-row" style="padding:8px 0" onclick="modalAjustes()">
      <div class="avatar" style="background:#475569">⚙️</div><div class="body"><div class="t">Ajustes</div><div class="s">Nombres, moneda, vinculación</div></div><div class="meta">›</div></div></div>
  </div>`;
}
function kidCard(k) {
  const edad = k.dob ? calcEdad(k.dob) : null;
  return `<div class="card"><div class="kid-card" onclick="modalHijoVer('${k.id}')" style="cursor:pointer">
      <div class="ph" style="background:${k.color || '#0d9488'}">${inicial(k.name)}</div>
      <div style="flex:1"><div style="font-weight:800;font-size:17px">${esc(k.name)}</div>
        <div style="font-size:13px;color:var(--slate)">${edad !== null ? edad+' años' : 'Sin fecha de nacimiento'}${k.grade ? ' · '+esc(k.grade) : ''}</div></div>
      <div class="meta">›</div></div>
    ${(k.allergies || k.meds) ? `<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
      ${k.allergies ? `<span class="badge rose">⚠️ ${esc(k.allergies)}</span>` : ''}${k.meds ? `<span class="badge blue">💊 ${esc(k.meds)}</span>` : ''}</div>` : ''}</div>`;
}
function calcEdad(dob) { const d = new Date(dob), n = new Date(); let a = n.getFullYear()-d.getFullYear(); if (n.getMonth()<d.getMonth()||(n.getMonth()===d.getMonth()&&n.getDate()<d.getDate())) a--; return a; }
function modalHijoVer(id) {
  const k = D().kids.find(x => x.id === id); if (!k) return;
  const row = (l, v) => v ? `<dt>${l}</dt><dd>${esc(v)}</dd>` : '';
  openSheet(k.name, `
    <div class="kid-card" style="margin-bottom:6px"><div class="ph" style="background:${k.color||'#0d9488'};width:64px;height:64px;font-size:28px">${inicial(k.name)}</div>
      <div><div style="font-weight:800;font-size:20px">${esc(k.name)}</div>
        <div style="color:var(--slate)">${k.dob ? calcEdad(k.dob)+' años · '+k.dob : 'Sin fecha de nacimiento'}</div></div></div>
    <dl class="kid-detail">${row('Escuela',k.school)}${row('Grado',k.grade)}${row('Alergias',k.allergies)}${row('Medicamentos',k.meds)}${row('Tipo de sangre',k.bloodType)}${row('Médico',k.doctor)}${row('Contacto de emergencia',k.emergency)}${row('Notas',k.notes)}</dl>
    <div class="row2" style="margin-top:18px"><button class="btn ghost" onclick="modalHijo('${k.id}')">Editar</button><button class="btn outline" onclick="delHijo('${k.id}')">Eliminar</button></div>`);
}
function modalHijo(id) {
  const k = id ? D().kids.find(x => x.id === id) : {};
  openSheet(id ? 'Editar hijo/a' : 'Nuevo hijo/a', `
    <div class="field"><label>Nombre</label><input id="k-name" value="${esc(k.name||'')}"></div>
    <div class="row2"><div class="field"><label>Fecha de nacimiento</label><input id="k-dob" type="date" value="${k.dob||''}"></div>
      <div class="field"><label>Tipo de sangre</label><input id="k-blood" value="${esc(k.bloodType||'')}" placeholder="O+"></div></div>
    <div class="row2"><div class="field"><label>Escuela</label><input id="k-school" value="${esc(k.school||'')}"></div>
      <div class="field"><label>Grado</label><input id="k-grade" value="${esc(k.grade||'')}" placeholder="3° primaria"></div></div>
    <div class="field"><label>Alergias</label><input id="k-all" value="${esc(k.allergies||'')}" placeholder="Ninguna / penicilina…"></div>
    <div class="field"><label>Medicamentos</label><input id="k-meds" value="${esc(k.meds||'')}"></div>
    <div class="field"><label>Médico / pediatra</label><input id="k-doc" value="${esc(k.doctor||'')}"></div>
    <div class="field"><label>Contacto de emergencia</label><input id="k-em" value="${esc(k.emergency||'')}" placeholder="Nombre y teléfono"></div>
    <div class="field"><label>Notas</label><textarea id="k-notes">${esc(k.notes||'')}</textarea></div>
    <button class="btn block" id="k-save">Guardar</button>`);
  $('#k-save').onclick = () => act(async () => {
    const name = $('#k-name').value.trim(); if (!name) return toast('Escribe el nombre');
    const obj = { name, dob: $('#k-dob').value, bloodType: $('#k-blood').value.trim(), school: $('#k-school').value.trim(), grade: $('#k-grade').value.trim(),
      allergies: $('#k-all').value.trim(), meds: $('#k-meds').value.trim(), doctor: $('#k-doc').value.trim(), emergency: $('#k-em').value.trim(), notes: $('#k-notes').value.trim() };
    if (id) { await Store.update('kids', id, { ...k, ...obj }); }
    else { await Store.create('kids', { ...obj, color: ['#0d9488','#f97316','#2563eb','#e11d48'][D().kids.length % 4] }); }
    closeSheet(); render(); toast('Guardado');
  });
}
const delHijo = (id) => act(async () => { if (D().kids.length <= 1) return toast('Debe quedar al menos un hijo/a'); await Store.remove('kids', id); closeSheet(); render(); toast('Eliminado'); });
function docRow(d) {
  return `<div class="list-row"><div class="avatar" style="background:#64748b">📄</div>
    <div class="body"><div class="t">${esc(d.name)}</div><div class="s">${esc(d.cat)} · ${fechaLarga(d.date)}${d.note ? ' · '+esc(d.note) : ''}</div></div>
    <button class="btn sm ghost" onclick="delDoc('${d.id}')">✕</button></div>`;
}
function modalDoc() {
  openSheet('Registrar documento', `
    <div class="field"><label>Nombre del documento</label><input id="d-name" placeholder="Ej. Convenio de custodia"></div>
    <div class="field"><label>Categoría</label><select id="d-cat"><option>Legal</option><option>Salud</option><option>Escuela</option><option>Identidad</option><option>Seguro</option><option>Otro</option></select></div>
    <div class="field"><label>Nota</label><input id="d-note" placeholder="Vigencia, ubicación física…"></div>
    <p class="hint">Aquí registras la ficha del documento. La subida de archivos llega con la siguiente actualización.</p>
    <button class="btn block" id="d-save">Guardar</button>`);
  $('#d-save').onclick = () => act(async () => {
    const name = $('#d-name').value.trim(); if (!name) return toast('Escribe el nombre');
    await Store.create('docs', { name, cat: $('#d-cat').value, date: today(), note: $('#d-note').value.trim() });
    closeSheet(); render(); toast('Documento registrado');
  });
}
const delDoc = (id) => act(async () => { await Store.remove('docs', id); render(); toast('Eliminado'); });

/* =============================== AJUSTES ============================= */
function modalAjustes() {
  const f = F(), inviteRow = CLOUD ? `
    ${f.inviteCode ? `<div class="card tight" style="margin-bottom:14px"><div style="font-size:12px;color:var(--slate);text-transform:uppercase;letter-spacing:.05em">Código de invitación</div>
      <div style="font-size:24px;font-weight:800;letter-spacing:.12em;color:var(--teal-700)">${esc(f.inviteCode)}</div>
      <div class="hint">Compártelo con el otro padre para que se una.</div></div>` : ''}
    <button class="btn block outline" onclick="cerrarSesion()" style="margin-bottom:10px">Cerrar sesión</button>` : '';
  openSheet('Ajustes', `
    <div class="field"><label>Tu nombre</label><input id="st-a" value="${esc(f.parents.A || '')}"></div>
    <div class="field"><label>Otro padre / madre</label><input id="st-b" value="${esc(f.parents.B || '')}"></div>
    ${!CLOUD ? `<div class="field"><label>¿Quién eres tú?</label><div class="seg" id="st-me">
      <button data-v="A" class="${meRole()==='A'?'on':''}">${esc(f.parents.A||'A')}</button>
      <button data-v="B" class="${meRole()==='B'?'on':''}">${esc(f.parents.B||'B')}</button></div></div>` : ''}
    <div class="field"><label>Moneda</label><select id="st-cur">${['MXN','USD','EUR','COP','ARS','CLP'].map(c => `<option value="${c}" ${f.currency===c?'selected':''}>${c}</option>`).join('')}</select></div>
    <button class="btn block" id="st-save">Guardar ajustes</button>
    ${inviteRow}
    ${!CLOUD ? `<button class="btn block danger" id="st-reset" style="margin-top:10px">Borrar todo y reiniciar</button>` : ''}
    <p class="hint" style="text-align:center;margin-top:14px">Copaz v1 · ${CLOUD ? 'Modo nube (sincronizado)' : 'Modo local (este dispositivo)'}</p>`);
  if (!CLOUD) segBind('#st-me');
  $('#st-save').onclick = () => act(async () => {
    const parents = { A: $('#st-a').value.trim() || 'Yo', B: $('#st-b').value.trim() || 'Otro' };
    await Store.patchFamily({ currency: $('#st-cur').value, parents });
    if (!CLOUD && $('#st-me')) { D().auth.role = segVal('#st-me'); D().auth.name = parents[D().auth.role]; Store._save(); }
    closeSheet(); render(); toast('Ajustes guardados');
  });
  const rst = $('#st-reset');
  if (rst) rst.onclick = () => { if (confirm('¿Borrar todos los datos? No se puede deshacer.')) { Store.wipeLocal(); closeSheet(); go('inicio'); render(); } };
}
function cerrarSesion() { Store.logout(); closeSheet(); location.hash = ''; render(); }

/* =========================== MODAL / SHEET ========================== */
function openSheet(title, body) {
  $('#modal-root').innerHTML = `<div class="overlay" id="overlay"><div class="sheet" onclick="event.stopPropagation()">
    <div class="grip"></div><h3>${esc(title)}</h3>${body}</div></div>`;
  $('#overlay').onclick = closeSheet;
}
const closeSheet = () => { $('#modal-root').innerHTML = ''; };
function segBind(sel) { $$(sel + ' button').forEach(b => b.onclick = () => { $$(sel + ' button').forEach(x => x.classList.remove('on')); b.classList.add('on'); }); }
function segVal(sel) { const on = $(sel + ' button.on'); return on ? on.dataset.v : null; }

/* Exponer para onclick inline */
Object.assign(window, {
  go, renderAuth, calMove, modalDia, modalEvento, delEvento, modalEsquema, modalGasto, saldar, saldarTodo,
  modalHijo, modalHijoVer, delHijo, modalDoc, delDoc, modalAjustes, closeSheet, exportarMensajes, cerrarSesion,
  modalProponerSwap, acceptSwap, rejectSwap, suavizarMensaje, exportarGastosCSV,
});
