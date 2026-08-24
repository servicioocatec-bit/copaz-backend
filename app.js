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

/* Comprime y redimensiona una imagen (foto de boleta/documento) a un data URL liviano. */
function comprimirImagen(file, maxDim = 1400, quality = 0.62) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('Selecciona una imagen'));
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width, h = img.height;
      if (w > h && w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim; }
      else if (h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim; }
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); };
    img.src = url;
  });
}
function verImagen(src) {
  openSheet('Foto', `<img src="${src}" style="width:100%;border-radius:12px;display:block">
    <a class="btn block outline" href="${src}" download="copaz-foto.jpg" style="margin-top:12px">Descargar</a>`);
}

/* --------------------------- Config / modo ------------------------------ */
const API_BASE = (window.COPAZ_CONFIG && window.COPAZ_CONFIG.API_BASE) || '';
const CLOUD = !!API_BASE;
const FLOW = { anual: (window.COPAZ_CONFIG && window.COPAZ_CONFIG.FLOW_ANUAL) || '', mensual: (window.COPAZ_CONFIG && window.COPAZ_CONFIG.FLOW_MENSUAL) || '' };
const PRECIOS = { anual: '$89.990', mensual: '$9.990' };

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
    else { (this.state[entity] = this.state[entity] || []).push({ id: uid(), ...obj }); this._save(); }
  },
  async update(entity, id, obj) {
    const { id: _i, ...data } = obj;
    if (this.mode === 'cloud') { await Cloud.update(entity, id, data); await this.refresh(); }
    else { const arr = this.state[entity] = this.state[entity] || []; const i = arr.findIndex(x => x.id === id); if (i >= 0) arr[i] = { id, ...data }; this._save(); }
  },
  async remove(entity, id) {
    if (this.mode === 'cloud') { await Cloud.remove(entity, id); await this.refresh(); }
    else { this.state[entity] = (this.state[entity] || []).filter(x => x.id !== id); this._save(); }
  },
  // Crea muchos registros de una entidad refrescando una sola vez al final.
  async bulkCreate(entity, arr) {
    if (this.mode === 'cloud') { for (const o of arr) await Cloud.create(entity, o); await this.refresh(); }
    else { for (const o of arr) (this.state[entity] = this.state[entity] || []).push({ id: uid(), ...o }); this._save(); }
  },
  async sendMessage(text, image) {
    if (this.mode === 'cloud') { await Cloud.sendMessage(text, image); await this.refresh(); }
    else { this.state.messages.push({ id: uid(), from: this.state.auth.role, text, image: image || '', ts: Date.now() }); this._save(); }
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
      kids, events: [], expenses: [], docs: [], swaps: [], journal: [], tasks: [], messages: [],
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
  let net = 0; // >0 => a favor de A (B le debe a A)
  for (const e of D().expenses) { if (e.settled) continue; const debe = e.amount * (1 - e.split / 100); net += e.payer === 'A' ? debe : -debe; }
  // Reembolsos/abonos: un pago de B a A reduce lo que B le debe a A.
  for (const s of (D().settlements || [])) { net -= (s.to === 'A' ? s.amount : -s.amount); }
  return net;
}
function etiquetaEsquema(t) { return { 'semanal':'Semanal','2-2-3':'2-2-3','2-2-5-5':'2-2-5-5','3-4-4-3':'3-4-4-3','alterna':'Día por medio' }[t] || t; }

/* ================================ ROUTER =============================== */
const ROUTES = ['inicio','calendario','gastos','mensajes','hijos','tareas'];
const currentRoute = () => { const h = location.hash.replace('#/', '').split('/')[0]; return ROUTES.includes(h) ? h : 'inicio'; };
const go = (r) => { location.hash = '#/' + r; };
window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', boot);
function aplicarTema() { const t = localStorage.getItem('copaz.theme'); if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark'); else document.documentElement.removeAttribute('data-theme'); }
function alternarTema() { const nuevo = localStorage.getItem('copaz.theme') === 'dark' ? 'light' : 'dark'; localStorage.setItem('copaz.theme', nuevo); aplicarTema(); closeSheet(); render(); toast(nuevo === 'dark' ? '🌙 Modo oscuro' : '☀️ Modo claro'); }
async function boot() { aplicarTema(); await Store.init(); render(); if (localStorage.getItem('copaz.pushOn')) enablePush(false).catch(() => {}); }

/* ================================ RENDER =============================== */
function render() {
  const nav = $('#nav');
  // Enlaces que llegan por correo (?token=)
  if (CLOUD && location.hash.indexOf('/reset') >= 0 && location.hash.indexOf('token=') >= 0) {
    nav.classList.add('hidden'); return renderAuth('reset');
  }
  if (CLOUD && location.hash.indexOf('/verify') >= 0 && location.hash.indexOf('token=') >= 0) {
    nav.classList.add('hidden'); return renderAuth('verify');
  }
  // Puertas de acceso
  if (Store.mode === 'cloud') {
    if (!Cloud.token) { nav.classList.add('hidden'); return renderAuth('welcome'); }
    if (!Store.state) { nav.classList.add('hidden'); return renderLoading(); }
    if (D().kids.length === 0 && !localStorage.getItem('copaz.setupDone')) { nav.classList.add('hidden'); return renderSetup(); }
    if (F().access && F().access.bloqueado) { nav.classList.add('hidden'); return renderPaywall(); }
  } else {
    if (!Store.state || !Store.state.family) { nav.classList.add('hidden'); return renderOnboarding(); }
  }
  nav.classList.remove('hidden');
  renderNav();
  const r = currentRoute();
  const app = $('#app'); app.innerHTML = '';
  ({ inicio: viewInicio, calendario: viewCalendario, gastos: viewGastos, mensajes: viewMensajes, hijos: viewHijos, tareas: viewTareas }[r])(app);
}
function renderLoading() { $('#app').innerHTML = `<div class="ob"><div class="empty"><div class="ic">🕊️</div><p>Cargando tu espacio…</p></div></div>`; }
function renderPaywall() {
  $('#app').innerHTML = `<div class="ob" style="justify-content:center">
    ${LOGO}<h1 style="font-size:24px">Tu acceso terminó</h1>
    <p class="tag">Tu prueba gratis de Copaz llegó a su fin. Suscríbete para seguir coordinando todo lo de tus hijos, sin perder nada.</p>
    <div style="margin-top:22px">
      <button class="btn block" onclick="modalPlanes()">Ver planes y suscribirme</button>
      <button class="btn ghost block" style="margin-top:10px" onclick="cerrarSesion()">Cerrar sesión</button>
    </div>
    <p class="hint" style="margin-top:18px">¿Ya pagaste? Tu Premium se activa apenas confirmamos el pago.</p>
  </div>`;
}
function renderNav() {
  const r = currentRoute();
  const lastSeen = +(localStorage.getItem('copaz.msgSeen') || 0);
  const unread = (D().messages || []).filter(m => m.from !== meRole() && m.ts > lastSeen).length;
  const hoyISO = iso(new Date());
  const tareasPend = (D().tasks || []).filter(t => !t.done && t.due && t.due <= hoyISO).length;
  const items = [['inicio','🏠','Inicio'],['calendario','📅','Custodia'],['gastos','💰','Gastos'],['mensajes','💬','Chat'],['tareas','📝','Tareas'],['hijos','🧒','Hijos']];
  $('#nav').innerHTML = items.map(([id, ic, l]) => {
    const n = id === 'mensajes' ? unread : (id === 'tareas' ? tareasPend : 0);
    const dot = (n > 0)
      ? `<span style="position:absolute;top:3px;left:calc(50% + 6px);min-width:16px;height:16px;padding:0 4px;background:var(--rose);color:#fff;font-size:10px;font-weight:700;border-radius:99px;display:grid;place-items:center">${n}</span>` : '';
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
      </div>
      <p class="hint" style="margin-top:22px"><a href="terminos.html">Términos</a> · <a href="privacidad.html">Privacidad</a></p></div>`;
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
      <p class="hint" style="text-align:center;margin-top:14px">¿Nuevo aquí? <a onclick="renderAuth('register')">Crea una cuenta</a></p>
      <p class="hint" style="text-align:center;margin-top:6px"><a onclick="renderAuth('forgot')">¿Olvidaste tu contraseña?</a></p>`);
    $('#au-go').onclick = () => act(async () => {
      const email = $('#au-email').value.trim(), pass = $('#au-pass').value;
      if (!email || !pass) return toast('Escribe correo y contraseña');
      const r = await Cloud.login(email, pass);
      Cloud.setToken(r.token); Store.setUser(r.user);
      await Store.refresh(); Store._connect(); go('inicio'); render();
    });
  } else if (screen === 'forgot') {
    app.innerHTML = authShell('Recuperar contraseña', `
      <p class="hint" style="margin-bottom:14px">Escribe tu correo y te enviaremos un enlace para crear una nueva contraseña.</p>
      <div class="field"><label>Correo</label><input id="au-email" type="email" placeholder="tu@correo.com"></div>
      <button class="btn block" id="au-go">Enviar enlace</button>
      <p class="hint" style="text-align:center;margin-top:14px"><a onclick="renderAuth('login')">Volver</a></p>`);
    $('#au-go').onclick = () => act(async () => {
      const email = $('#au-email').value.trim(); if (!email) return toast('Escribe tu correo');
      await Cloud.forgot(email);
      toast('Si el correo existe, te enviamos un enlace 📧'); renderAuth('login');
    });
  } else if (screen === 'reset') {
    const token = (location.hash.match(/token=([^&]+)/) || [])[1] || '';
    app.innerHTML = authShell('Nueva contraseña', `
      <div class="field"><label>Nueva contraseña</label><input id="au-pass" type="password" placeholder="Mínimo 6 caracteres"></div>
      <button class="btn block" id="au-go">Guardar contraseña</button>
      <p class="hint" style="text-align:center;margin-top:14px"><a onclick="location.hash='';renderAuth('login')">Volver</a></p>`);
    $('#au-go').onclick = () => act(async () => {
      const pass = $('#au-pass').value; if (pass.length < 6) return toast('Mínimo 6 caracteres');
      await Cloud.reset(token, pass);
      toast('¡Contraseña actualizada! Ya puedes entrar.'); location.hash = ''; renderAuth('login');
    });
  } else if (screen === 'verify') {
    const token = (location.hash.match(/token=([^&]+)/) || [])[1] || '';
    app.innerHTML = authShell('Verificando tu correo', `<div class="empty"><div class="ic">⏳</div><p id="vf-msg">Un momento…</p></div>
      <p class="hint" style="text-align:center;margin-top:14px"><a onclick="location.hash='';go('inicio');render()">Ir a la app</a></p>`);
    act(async () => {
      try { await Cloud.verify(token); $('#vf-msg').innerHTML = '✅ ¡Correo verificado! Ya puedes suscribirte.'; }
      catch (e) { $('#vf-msg').textContent = '⚠️ ' + (e.message || 'El enlace no es válido o ya se usó.'); }
      // refrescar estado si hay sesión
      if (Cloud.token) { try { await Store.refresh(); } catch {} }
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
    enablePush(true).catch(() => {});
  });
}

/* =============================== INICIO =============================== */
function viewInicio(app) {
  const hoy = today(), custodioHoy = custodioDe(hoy), cambio = proximoCambio(), bal = balance(), me = meRole();
  const pendientes = D().expenses.filter(e => !e.settled).length;
  const proxEventos = [...D().events].filter(e => e.date >= hoy).sort((a,b) => (a.date+a.time).localeCompare(b.date+b.time)).slice(0, 3);
  const ultimo = D().messages.filter(m => m.from !== me).slice(-1);
  const miNombre = (D().auth.name || nombre(me)).split(' ')[0];
  const dp = diasPrueba();
  const banner = premiumActivo()
    ? `<div class="card tight" onclick="modalPlanes()" style="cursor:pointer;background:var(--teal-50);border-color:var(--teal-200)"><div style="font-size:13px;color:var(--teal-800)">⭐ <b>Premium activo</b> hasta ${premiumHasta()}</div></div>`
    : dp === null
    ? `<div class="card" onclick="modalPlanes()" style="cursor:pointer;background:linear-gradient(135deg,#f97316,#ea580c);color:#fff;border:none"><div style="font-weight:800">✨ Prueba Copaz Premium — 30 días gratis</div><div style="font-size:12.5px;opacity:.92;margin-top:2px">Toca para ver los planes.</div></div>`
    : dp > 0
      ? `<div class="card tight" onclick="modalPlanes()" style="cursor:pointer;background:var(--teal-50);border-color:var(--teal-200)"><div style="font-size:13px;color:var(--teal-800)">🎁 Te quedan ${dp} día${dp !== 1 ? 's' : ''} de prueba Premium · <b>ver planes</b></div></div>`
      : `<div class="card tight" onclick="modalPlanes()" style="cursor:pointer;background:#fff7ed;border-color:#fed7aa"><div style="font-size:13px;color:#9a3412">Tu prueba terminó · <b>suscríbete a Premium</b></div></div>`;
  const verifBanner = (CLOUD && D().me && D().me.verified === false)
    ? `<div class="card tight" style="background:#fff7ed;border-color:#fed7aa"><div style="font-size:13px;color:#9a3412">📧 Verifica tu correo para poder suscribirte. <a onclick="reenviarVerificacion()" style="font-weight:700">Reenviar correo</a></div></div>`
    : '';

  app.innerHTML = topbar('Hola, ' + miNombre, fechaLarga(hoy)) + `<div class="screen">
    ${verifBanner}
    ${banner}
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
    <button class="btn block outline" style="margin-bottom:12px" onclick="modalAgenda()">📅 Agenda de la semana</button>
    ${bloqueClasesHoy()}
    ${bloqueProxEval()}
    <div class="section-title">Próximos eventos <span class="count">${proxEventos.length}</span></div>
    <div class="card">${proxEventos.length ? proxEventos.map(evRow).join('') : `<div class="empty"><div class="ic">🗓️</div><p>Sin eventos próximos</p></div>`}</div>
    ${ultimo.length ? `<div class="section-title">Último mensaje</div>
    <div class="card" onclick="go('mensajes')" style="cursor:pointer"><div class="list-row">
      <div class="avatar" style="background:${color(ultimo[0].from)}">${inicial(nombre(ultimo[0].from))}</div>
      <div class="body"><div class="t">${esc(nombre(ultimo[0].from))}</div>
        <div class="s">${esc(ultimo[0].text.slice(0,60))}${ultimo[0].text.length>60?'…':''}</div></div></div></div>` : ''}
  </div>`;
}
/* Une bloques contiguos con la misma materia (08:15+09:00 → 08:15–09:45). */
function mergeBloques(list) {
  const ord = list.slice().sort((a, b) => String(a.start).localeCompare(b.start));
  const out = [];
  for (const b of ord) {
    const prev = out[out.length - 1];
    if (prev && prev.subject === b.subject && prev.end && prev.end === b.start) prev.end = b.end;
    else out.push({ ...b });
  }
  return out;
}
const diaHoyCorto = () => ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie'][new Date().getDay()] || '';
function bloqueClasesHoy() {
  const d = diaHoyCorto();
  const kids = (D().kids || []).filter(k => (k.timetable || []).some(b => b.day === d));
  if (!d || !kids.length) return '';
  const filas = kids.map(k => {
    const bl = mergeBloques((k.timetable || []).filter(b => b.day === d));
    if (!bl.length) return '';
    const chips = bl.map(b => `<span style="display:inline-block;background:${subColor(b.subject)};color:#0f172a;border-radius:8px;padding:3px 8px;font-size:12px;font-weight:600;margin:2px 3px 0 0">${esc(b.start)} ${esc(b.subject)}</span>`).join('');
    return `<div class="list-row"><div class="avatar" style="background:${k.color || '#0d9488'}">${inicial(k.name)}</div>
      <div class="body"><div class="t">${esc(k.name)}</div><div style="margin-top:2px">${chips}</div></div></div>`;
  }).join('');
  return `<div class="section-title">📚 Clases de hoy</div><div class="card">${filas}</div>`;
}
function bloqueProxEval() {
  const hoy = today();
  const evs = [...(D().tasks || [])].filter(t => !t.done && t.due && t.due >= hoy && t.type !== 'hogar').sort((a, b) => a.due.localeCompare(b.due)).slice(0, 3);
  if (!evs.length) return '';
  return `<div class="section-title" onclick="go('tareas')" style="cursor:pointer">📝 Próximas evaluaciones <span class="count">${evs.length}</span></div>
    <div class="card" onclick="go('tareas')" style="cursor:pointer">${evs.map(t => {
      const dias = diffDias(hoy, t.due);
      const cuando = dias === 0 ? 'Hoy' : dias === 1 ? 'Mañana' : (dias <= 7 ? 'En ' + dias + ' días' : fechaLarga(t.due));
      const kid = D().kids.find(k => k.id === t.kid);
      return `<div class="list-row"><div class="avatar" style="background:${subColor(t.subject || t.title)};color:#0f172a">${esc(String(t.subject || t.title)[0].toUpperCase())}</div>
        <div class="body"><div class="t">${esc(t.subject || 'Evaluación')}</div><div class="s">${esc(t.title)}${kid ? ' · ' + esc(kid.name) : ''}</div></div>
        <div class="meta"><span class="badge ${dias <= 1 ? 'rose' : 'teal'}">${cuando}</span></div></div>`;
    }).join('')}</div>`;
}
/* Agenda semanal: combina horario de clases, evaluaciones y custodia/eventos. */
function modalAgenda() {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // 0 = lunes
  const lunes = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
  const nombresDia = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const cortoDia = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const hoyISO = today();
  let html = '';
  for (let i = 0; i < 7; i++) {
    const dObj = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + i);
    const dISO = iso(dObj);
    const esHoy = dISO === hoyISO;
    const cust = custodioDe(dISO);
    // Clases (solo Lun–Vie)
    const clases = i < 5 ? D().kids.map(k => {
      const bl = mergeBloques((k.timetable || []).filter(b => b.day === cortoDia[i]));
      if (!bl.length) return '';
      return `<div style="font-size:12.5px;margin-top:3px"><b>${esc(k.name)}:</b> ${bl.map(b => `${esc(b.start)} ${esc(b.subject)}`).join(' · ')}</div>`;
    }).join('') : '';
    // Evaluaciones y tareas del día
    const evs = (D().tasks || []).filter(t => t.due === dISO && !t.done);
    const evHtml = evs.map(t => `<div style="font-size:12.5px;margin-top:3px;color:var(--rose)">📝 ${esc(t.subject || '')}${t.subject ? ': ' : ''}${esc(t.title)}</div>`).join('');
    // Eventos del calendario
    const evtos = D().events.filter(e => e.date === dISO);
    const evtHtml = evtos.map(e => `<div style="font-size:12.5px;margin-top:3px">📅 ${e.time ? esc(e.time) + ' · ' : ''}${esc(e.title)}</div>`).join('');
    const vacio = !clases && !evHtml && !evtHtml;
    html += `<div class="card" style="${esHoy ? 'border-color:var(--teal-400);box-shadow:0 0 0 2px var(--teal-100,#ccfbf1)' : ''}">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="font-weight:800">${nombresDia[i]} ${dObj.getDate()}${esHoy ? ' <span class="badge teal">hoy</span>' : ''}</div>
        <span class="badge ${cust === 'A' ? 'teal' : 'amber'}">👤 ${esc(nombre(cust))}</span></div>
      ${clases || ''}${evHtml}${evtHtml}${vacio ? `<div style="font-size:12.5px;color:var(--slate);margin-top:3px">Sin actividades</div>` : ''}</div>`;
  }
  openSheet('Agenda de la semana 📅', html);
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
  const query = (window.gastoQuery || '').toLowerCase();
  const filtered = query ? items.filter(e => (e.title + ' ' + e.cat).toLowerCase().includes(query)) : items;
  const sets = [...(D().settlements || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  app.innerHTML = topbar('Gastos', 'Compartidos y reembolsos',
    items.length ? `<button class="icon-btn" onclick="exportarGastosPDF()" title="Exportar a PDF">🧾</button><button class="icon-btn" onclick="exportarGastosCSV()" title="Exportar a CSV" style="margin-left:6px">⬇️</button>` : '') + `<div class="screen">
    <div class="balance ${cls}"><div class="l">Balance actual</div><div class="v">${money(Math.abs(bal))}</div>
      <div style="opacity:.92;font-size:13.5px;margin-top:2px">${txt}</div></div>
    <div class="row2" style="margin-bottom:14px">
      ${bal !== 0 ? `<button class="btn ghost" onclick="saldarTodo()">Marcar saldado</button>` : '<div></div>'}
      <button class="btn ghost" onclick="modalAbono()">＋ Registrar abono</button></div>
    ${resumen}
    ${items.length ? `<input class="field" style="margin-bottom:10px" placeholder="🔎 Buscar gasto…" value="${esc(window.gastoQuery || '')}" oninput="window.gastoQuery=this.value; clearTimeout(window._gq); window._gq=setTimeout(()=>viewGastos(document.getElementById('app')),250)">` : ''}
    <div class="section-title">Movimientos <span class="count">${filtered.length}</span></div>
    <div class="card">${filtered.length ? filtered.map(gastoRow).join('') : `<div class="empty"><div class="ic">🧾</div><p>${items.length ? 'Sin resultados' : 'Aún no hay gastos'}</p></div>`}</div>
    ${sets.length ? `<div class="section-title">Reembolsos / abonos <span class="count">${sets.length}</span></div>
      <div class="card">${sets.map(abonoRow).join('')}</div>` : ''}
    </div>
    <button class="fab" onclick="modalGasto()">＋</button>`;
}
function gastoRow(e) {
  const kid = D().kids.find(k => k.id === e.kid), debeOtro = e.amount * (1 - e.split / 100);
  return `<div class="list-row"><div class="avatar" style="background:${color(e.payer)}">${inicial(nombre(e.payer))}</div>
    <div class="body" style="cursor:pointer" onclick="modalGasto('${e.id}')"><div class="t">${esc(e.title)} ${e.settled ? '<span class="badge green">saldado</span>' : ''} ${e.receipt ? '<span class="badge gray">📷</span>' : ''}</div>
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
    <div class="field"><label>Foto de la boleta (opcional)</label><input id="gx-img" type="file" accept="image/*">
      <div id="gx-prev" style="margin-top:8px">${e && e.receipt ? `<img src="${e.receipt}" onclick="verReciboGasto('${e.id}')" style="width:100%;max-height:200px;object-fit:contain;border-radius:12px;border:1px solid var(--line);cursor:pointer">` : ''}</div></div>
    <button class="btn block" id="gx-save">${e ? 'Guardar cambios' : 'Guardar gasto'}</button>
    ${e ? `<button class="btn block outline" id="gx-del" style="margin-top:10px">Eliminar gasto</button>` : ''}`);
  segBind('#gx-p');
  const rng = $('#gx-s'), lbl = $('#gx-splitlbl');
  rng.oninput = () => { lbl.textContent = `${rng.value}% / ${100 - rng.value}%`; };
  let receiptData = e && e.receipt ? e.receipt : '';
  $('#gx-img').onchange = (ev) => act(async () => {
    const f = ev.target.files[0]; if (!f) return;
    receiptData = await comprimirImagen(f);
    $('#gx-prev').innerHTML = `<img src="${receiptData}" style="width:100%;max-height:200px;object-fit:contain;border-radius:12px;border:1px solid var(--line)">`;
  });
  $('#gx-save').onclick = () => act(async () => {
    const title = $('#gx-t').value.trim(), amount = parseFloat($('#gx-a').value);
    if (!title) return toast('Escribe el concepto');
    if (!amount || amount <= 0) return toast('Escribe un monto válido');
    const data = { title, amount, date: $('#gx-d').value, payer: segVal('#gx-p'), split: parseInt(rng.value, 10), cat: $('#gx-c').value, kid: $('#gx-k').value, settled: e ? e.settled : false, receipt: receiptData || '' };
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
/* Reembolsos / abonos entre padres */
function abonoRow(s) {
  const from = s.from || (s.to === 'A' ? 'B' : 'A');
  return `<div class="list-row"><div class="avatar" style="background:${color(from)}">💵</div>
    <div class="body"><div class="t">${esc(nombre(from))} → ${esc(nombre(s.to))}</div>
      <div class="s">${fechaLarga(s.date || today())}${s.note ? ' · ' + esc(s.note) : ''}</div></div>
    <div class="meta"><div style="font-weight:800;color:var(--green);font-size:15px">${money(s.amount)}</div>
      <button class="btn sm ghost" style="margin-top:4px" onclick="delAbono('${s.id}')">✕</button></div></div>`;
}
const delAbono = (id) => act(async () => { await Store.remove('settlements', id); render(); toast('Eliminado'); });
function modalAbono() {
  const bal = balance();
  const quienPaga = bal < -0.5 ? 'A' : 'B';
  openSheet('Registrar abono / pago', `
    <p class="hint" style="margin-bottom:12px">Un pago de un padre al otro (reembolso). Ajusta el balance, no es un gasto nuevo.</p>
    <div class="field"><label>¿Quién pagó?</label><div class="seg" id="ab-from">
      <button data-v="A" class="${quienPaga==='A'?'on':''}">${esc(nombre('A'))}</button><button data-v="B" class="${quienPaga==='B'?'on':''}">${esc(nombre('B'))}</button></div></div>
    <div class="row2"><div class="field"><label>Monto</label><input id="ab-a" type="number" inputmode="decimal" placeholder="0"></div>
      <div class="field"><label>Fecha</label><input id="ab-d" type="date" value="${today()}"></div></div>
    <div class="field"><label>Nota (opcional)</label><input id="ab-n" placeholder="Transferencia, efectivo…"></div>
    <button class="btn block" id="ab-save">Guardar abono</button>`);
  segBind('#ab-from');
  $('#ab-save').onclick = () => act(async () => {
    const amount = parseFloat($('#ab-a').value); if (!amount || amount <= 0) return toast('Escribe un monto válido');
    const from = segVal('#ab-from'), to = from === 'A' ? 'B' : 'A';
    await Store.create('settlements', { amount, from, to, date: $('#ab-d').value, note: $('#ab-n').value.trim() });
    closeSheet(); render(); toast('Abono registrado');
  });
}
/* Exportar a PDF (usa el diálogo de imprimir del navegador → guardar como PDF) */
function imprimirReporte(titulo, cuerpo) {
  const w = window.open('', '_blank');
  if (!w) { toast('Permite ventanas emergentes para exportar el PDF'); return; }
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)} — Copaz</title>
    <style>body{font-family:Arial,system-ui;padding:24px;color:#0f172a}h1{color:#0f766e;font-size:22px}table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:14px}th,td{border-bottom:1px solid #e2e8f0;padding:7px 6px;text-align:left;vertical-align:top}th{color:#64748b;font-size:10.5px;text-transform:uppercase}.mut{color:#64748b;font-size:12px}</style></head>
    <body><h1>🕊️ Copaz — ${esc(titulo)}</h1><div class="mut">${esc(nombre('A'))} y ${esc(nombre('B'))} · Generado ${new Date().toLocaleString('es-CL')}</div>
    ${cuerpo}<scr` + `ipt>setTimeout(function(){window.print()},500)</scr` + `ipt></body></html>`);
  w.document.close();
}
function exportarGastosPDF() {
  const bal = balance();
  const rows = [...D().expenses].sort((a, b) => a.date.localeCompare(b.date)).map(e => {
    const kid = D().kids.find(k => k.id === e.kid);
    return `<tr><td>${fechaLarga(e.date)}</td><td>${esc(e.title)}</td><td>${esc(e.cat)}${kid ? ' · ' + esc(kid.name) : ''}</td><td>${esc(nombre(e.payer))}</td><td style="text-align:right">${money(e.amount)}</td><td>${e.settled ? 'Sí' : 'No'}</td></tr>`;
  }).join('');
  const setRows = (D().settlements || []).map(s => `<tr><td>${fechaLarga(s.date || today())}</td><td>Abono/reembolso</td><td>${esc(s.note || '')}</td><td>${esc(nombre(s.from || (s.to === 'A' ? 'B' : 'A')))} → ${esc(nombre(s.to))}</td><td style="text-align:right">${money(s.amount)}</td><td>—</td></tr>`).join('');
  const txt = bal > 0.5 ? `${nombre('B')} le debe a ${nombre('A')} ${money(Math.abs(bal))}` : bal < -0.5 ? `${nombre('A')} le debe a ${nombre('B')} ${money(Math.abs(bal))}` : 'Están al corriente';
  imprimirReporte('Gastos y reembolsos', `<p style="font-weight:700;margin-top:12px">Balance: ${esc(txt)}</p>
    <table><tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th>Pagó</th><th style="text-align:right">Monto</th><th>Saldado</th></tr>${rows}${setRows}</table>`);
}
function exportarMensajesPDF() {
  const rows = D().messages.map(m => `<tr><td style="white-space:nowrap">${new Date(m.ts).toLocaleString('es-CL')}</td><td>${esc(nombre(m.from))}</td><td>${esc(m.text || '')}${m.image ? ' [foto adjunta]' : ''}</td></tr>`).join('');
  imprimirReporte('Historial de mensajes', `<table><tr><th>Fecha y hora</th><th>De</th><th>Mensaje</th></tr>${rows}</table>`);
}
function exportarTareasPDF() {
  const tareas = [...(D().tasks || [])].sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')));
  if (!tareas.length) return toast('No hay tareas para exportar');
  const rows = tareas.map(t => {
    const kid = D().kids.find(k => k.id === t.kid);
    return `<tr><td style="white-space:nowrap">${t.due ? fechaLarga(t.due) : '—'}</td><td>${t.type === 'hogar' ? '🏠 Hogar' : '📚 Colegio'}</td><td>${esc(t.subject || '')}</td><td>${esc(t.title)}${kid ? ' · ' + esc(kid.name) : ''}</td><td>${t.done ? '✓' : ''}</td></tr>`;
  }).join('');
  imprimirReporte('Tareas y evaluaciones', `<table><tr><th>Fecha</th><th>Tipo</th><th>Materia</th><th>Detalle</th><th>Hecha</th></tr>${rows}</table>`);
}
function exportarColegioPDF(kidId) {
  const k = D().kids.find(x => x.id === kidId); if (!k) return;
  const tt = (k.timetable || []);
  let horario = '';
  if (tt.length) {
    const horas = [...new Set(tt.map(p => p.start))].sort();
    horario = `<h2 style="color:#0f766e;font-size:16px;margin-top:18px">Horario de materias</h2>
      <table><tr><th></th>${DIAS.map(d => `<th>${d}</th>`).join('')}</tr>
      ${horas.map(hr => `<tr><td style="white-space:nowrap">${esc(hr)}</td>${DIAS.map(d => { const p = tt.find(x => x.start === hr && x.day === d); return `<td>${p ? esc(p.subject) : ''}</td>`; }).join('')}</tr>`).join('')}</table>`;
  }
  const evs = [...(D().tasks || [])].filter(t => t.kid === kidId && t.type !== 'hogar' && t.due).sort((a, b) => a.due.localeCompare(b.due));
  const evTable = evs.length ? `<h2 style="color:#0f766e;font-size:16px;margin-top:22px">Calendario de evaluaciones</h2>
    <table><tr><th>Fecha</th><th>Materia</th><th>Contenido</th></tr>
    ${evs.map(t => `<tr><td style="white-space:nowrap">${fechaLarga(t.due)}</td><td>${esc(t.subject || '')}</td><td>${esc(t.title)}</td></tr>`).join('')}</table>` : '';
  const profes = (k.teachers && k.teachers.length) ? `<h2 style="color:#0f766e;font-size:16px;margin-top:22px">Profesores</h2>
    <table><tr><th>Ramo</th><th>Profesor(a)</th><th>Correo</th></tr>
    ${k.teachers.map(p => `<tr><td>${esc(p.s)}</td><td>${esc(p.n)}</td><td>${esc(p.e)}</td></tr>`).join('')}</table>` : '';
  if (!horario && !evTable) return toast('Este hijo no tiene horario ni evaluaciones');
  imprimirReporte(`Colegio · ${k.name}`, `<p class="mut">${esc(k.school || '')}${k.grade ? ' · ' + esc(k.grade) : ''}</p>${horario}${evTable}${profes}`);
}
const saldar = (id) => act(async () => { const e = D().expenses.find(x => x.id === id); if (e) { await Store.update('expenses', id, { ...e, settled: true }); render(); toast('Marcado como saldado'); } });
const saldarTodo = () => act(async () => { for (const e of D().expenses.filter(x => !x.settled)) await Store.update('expenses', e.id, { ...e, settled: true }); render(); toast('Todo saldado ✓'); });

/* ============================== MENSAJES ============================= */
function viewMensajes(app) {
  const me = meRole();
  const q = (window.msgQuery || '').toLowerCase();
  const msgs = q ? D().messages.filter(m => (m.text || '').toLowerCase().includes(q)) : D().messages;
  app.innerHTML = topbar('Mensajes', 'Con ' + nombre(me === 'A' ? 'B' : 'A'),
    `<button class="icon-btn" onclick="exportarMensajesPDF()" title="Exportar a PDF">🧾</button><button class="icon-btn" onclick="exportarMensajes()" title="Guardar copia (.txt)" style="margin-left:6px">⬇️</button>`) + `<div class="screen">
    <input class="field" style="margin-bottom:10px" placeholder="🔎 Buscar en mensajes…" value="${esc(window.msgQuery || '')}" oninput="window.msgQuery=this.value; clearTimeout(window._mq); window._mq=setTimeout(()=>viewMensajes(document.getElementById('app')),250)">
    <div class="msg-wrap" id="msg-wrap"></div>
    <div class="composer"><div class="tone" id="tone"></div><div class="box">
      <label class="send" style="background:var(--teal-50);color:var(--teal-700);cursor:pointer">📷<input id="msg-img" type="file" accept="image/*" style="display:none"></label>
      <textarea id="msg-in" rows="1" placeholder="Escribe un mensaje respetuoso…"></textarea>
      <button class="send" id="msg-send">➤</button></div></div></div>`;
  const wrap = $('#msg-wrap');
  wrap.innerHTML = msgs.map(m => {
    const mine = m.from === me;
    return `<div class="msg ${mine ? 'me' : 'them'}">
      ${mine ? '' : `<div style="font-size:11px;font-weight:700;color:${color(m.from)};margin-bottom:2px">${esc(nombre(m.from))}</div>`}
      ${m.image ? `<img src="${m.image}" onclick="verImagenMensaje('${m.id}')" style="max-width:200px;border-radius:10px;display:block;margin-bottom:${m.text ? '6px' : '0'};cursor:pointer">` : ''}
      ${m.text ? `<div>${esc(m.text)}</div>` : ''}
      <div class="time">${new Date(m.ts).toLocaleString('es-MX',{ day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit' })}</div></div>`;
  }).join('');
  const imgIn = $('#msg-img');
  if (imgIn) imgIn.onchange = (ev) => act(async () => {
    const f = ev.target.files[0]; if (!f) return;
    const data = await comprimirImagen(f);
    await Store.sendMessage('', data); render();
  });
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
/* Normaliza el texto para detectar groserías aunque usen acentos, MAYÚSCULAS,
   letras repetidas (putooo) o números/símbolos (v3rg@). */
function normGros(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't').replace(/@/g, 'a').replace(/\$/g, 's')
    .replace(/(.)\1{2,}/g, '$1');
}
/* Lista de groserías/insultos que se BLOQUEAN al enviar (Latinoamérica + México + Chile + España). */
const GROSERIAS = /\b(cs?m|ctm|ql[oa]?|qli?a[oa]|conch[ae]?(tumare|tumadre|desumadre|etumare)?|conchetumare|culi?a?[oa]s?|culea?[oa]s?|maricon(es)?|marica|maraco|hij[oa] de (put[ao]|perr[ao]|mil putas)|hdp|hijuep[au]t[ao]|malpari[dt][oa]|mierda|mrd|put[ao]s?|puton|putea(n|r|s)?|zorra|imbecil(es)?|idiota|estupid[oa]s?|tarad[oa]s?|inutil(es)?|pendej[oa]s?|boludo|pelotud[oa]|cabron(es)?|verga|vrga|care?verga|chinga(d[oa]|r|s|n|mos)?|chingue|coño|cono|carajo|joder|jodete|jodid[oa]|cojones|gilipollas|capullo|mam[oa]n(es)?|mamada|mamah?uevo|mames|polla|soplapollas|garca|forro|gonorrea|malnacid[oa]|cretin[oa]|subnormal|retrasad[oa]|mongolic[oa]|desgraciad[oa]|anda a la (mierda|conch|verga|chingada)|vete a la (mierda|verga|chingada|conch)|andate a la (mierda|conch|verga)|chucha (tu|de|madre)|reculi?a[dt][oa]|fuck|shit|bitch|asshole|bastard)\b/i;
function tieneGroseria(text) { return GROSERIAS.test(normGros(text)); }

function enviarMensaje() {
  const input = $('#msg-in'), text = input.value.trim(); if (!text) return;
  if (tieneGroseria(text)) {
    const tone = $('#tone');
    if (tone) { tone.className = 'tone warn'; tone.innerHTML = '🚫 Ese mensaje contiene lenguaje ofensivo. Reformúlalo para mantener la paz. <button class="btn sm" style="margin-left:6px;padding:4px 10px" onclick="suavizarMensaje()">✨ Suavizar</button>'; }
    toast('No se puede enviar: contiene lenguaje ofensivo');
    return;
  }
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
    <button class="btn block coral" onclick="modalBitacora()" style="margin-top:10px">📔 Bitácora de los hijos</button>
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
      <div class="ph" style="background:${k.photo ? `center/cover no-repeat url('${k.photo}')` : (k.color || '#0d9488')}">${k.photo ? '' : inicial(k.name)}</div>
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
    <div class="kid-card" style="margin-bottom:6px"><div class="ph" style="background:${k.photo ? `center/cover no-repeat url('${k.photo}')` : (k.color||'#0d9488')};width:64px;height:64px;font-size:28px">${k.photo ? '' : inicial(k.name)}</div>
      <div><div style="font-weight:800;font-size:20px">${esc(k.name)}</div>
        <div style="color:var(--slate)">${k.dob ? calcEdad(k.dob)+' años · '+k.dob : 'Sin fecha de nacimiento'}</div></div></div>
    <dl class="kid-detail">${row('Escuela',k.school)}${row('Grado',k.grade)}${k.schedule ? `<dt>Notas de horario</dt><dd style="white-space:pre-line">${esc(k.schedule)}</dd>` : ''}${row('Alergias',k.allergies)}${row('Medicamentos',k.meds)}${row('Tipo de sangre',k.bloodType)}${row('Médico',k.doctor)}${row('Contacto de emergencia',k.emergency)}${row('Notas',k.notes)}</dl>
    <div style="margin-top:14px"><div style="font-weight:700;font-size:13px;color:var(--slate);margin-bottom:6px">📚 Horario de materias</div>${horarioGrid(k.timetable)}
      <button class="btn block outline" style="margin-top:8px" onclick="modalHorario('${k.id}')">Editar horario de materias</button>
      <button class="btn block ghost" style="margin-top:8px" onclick="cargarDatosColegio('${k.id}')">📥 Cargar datos del colegio (6° básico)</button>
      ${((k.timetable && k.timetable.length) || (D().tasks || []).some(t => t.kid === k.id)) ? `<button class="btn block ghost" style="margin-top:8px" onclick="exportarColegioPDF('${k.id}')">🧾 Exportar horario y evaluaciones (PDF)</button>` : ''}</div>
    ${k.docPhoto ? `<div style="margin-top:16px"><div style="font-weight:700;font-size:13px;color:var(--slate);margin-bottom:6px">🖼️ Horario / calendario (foto)</div>
      <img src="${k.docPhoto}" onclick="verImagenHijoDoc('${k.id}')" style="max-width:100%;border-radius:12px;border:1px solid var(--line);cursor:pointer"></div>` : ''}
    ${(k.teachers && k.teachers.length) ? `<div style="margin-top:16px"><div style="font-weight:700;font-size:13px;color:var(--slate);margin-bottom:6px">👩‍🏫 Profesores</div>
      <div class="card" style="padding:6px 12px">${k.teachers.map(p => `<div style="padding:8px 0;border-bottom:1px solid var(--line)">
        <div style="font-weight:600;font-size:14px">${esc(p.s)}</div>
        <div style="font-size:13px;color:var(--slate)">${esc(p.n)}</div>
        <a href="mailto:${esc(p.e)}" style="font-size:13px;color:var(--teal-700);word-break:break-all">${esc(p.e)}</a></div>`).join('')}</div></div>` : ''}
    <div class="row2" style="margin-top:18px"><button class="btn ghost" onclick="modalHijo('${k.id}')">Editar datos</button><button class="btn outline" onclick="delHijo('${k.id}')">Eliminar</button></div>`);
}
/* ---- Horario de materias (grilla semanal por hijo) ---- */
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie'];
function subColor(s = '') { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 60% 87%)`; }
function horarioGrid(tt) {
  tt = (tt || []).filter(p => p && p.start);
  if (!tt.length) return `<div class="empty" style="padding:16px 0"><div class="ic">📚</div><p>Sin horario de materias todavía</p></div>`;
  const horas = [...new Set(tt.map(p => p.start))].sort();
  const hoy = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie'][new Date().getDay()] || '';
  const th = 'padding:6px 4px;font-size:11px;color:var(--slate);text-align:center;font-weight:700';
  const thHoy = th + ';color:var(--teal-700);background:var(--teal-50,#f0fdfa);border-radius:8px 8px 0 0';
  const td = 'padding:3px;text-align:center;vertical-align:top';
  let h = `<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;min-width:340px"><thead><tr><th style="${th}"></th>${DIAS.map(d => `<th style="${d === hoy ? thHoy : th}">${d}${d === hoy ? ' •' : ''}</th>`).join('')}</tr></thead><tbody>`;
  for (const hr of horas) {
    h += `<tr><td style="${td};font-size:11px;color:var(--slate);white-space:nowrap">${esc(hr)}</td>`;
    for (const d of DIAS) {
      const p = tt.find(x => x.start === hr && x.day === d);
      const cellBg = d === hoy ? 'background:var(--teal-50,#f0fdfa)' : '';
      h += `<td style="${td};${cellBg}">${p ? `<div style="background:${subColor(p.subject)};color:#0f172a;border-radius:8px;padding:5px 4px;font-size:11px;font-weight:600;line-height:1.15">${esc(p.subject)}${p.room ? `<div style="font-weight:400;opacity:.7">${esc(p.room)}</div>` : ''}</div>` : ''}</td>`;
    }
    h += `</tr>`;
  }
  return h + `</tbody></table></div>`;
}
function modalHorario(id) {
  const k = D().kids.find(x => x.id === id); if (!k) return;
  openSheet(`Horario · ${k.name}`, `
    ${horarioGrid(k.timetable)}
    <div id="tt-list" style="margin-top:12px"></div>
    <button class="btn block outline" onclick="ttAdd('${id}')" style="margin-top:10px">➕ Agregar bloque</button>`);
  renderTtList(id);
}
function renderTtList(id) {
  const el = $('#tt-list'); if (!el) return;
  const k = D().kids.find(x => x.id === id);
  const orden = d => DIAS.indexOf(d);
  const tt = (k.timetable || []).map((p, i) => ({ ...p, _i: i })).sort((a, b) => (orden(a.day) - orden(b.day)) || String(a.start).localeCompare(b.start));
  el.innerHTML = tt.map(p => `<div class="list-row"><div class="avatar" style="background:${subColor(p.subject)};color:#0f172a">${esc(String(p.subject || '?')[0].toUpperCase())}</div>
    <div class="body"><div class="t">${esc(p.subject)}</div><div class="s">${esc(p.day)} · ${esc(p.start)}${p.end ? '–' + esc(p.end) : ''}${p.room ? ' · ' + esc(p.room) : ''}</div></div>
    <button class="btn ghost" style="padding:6px 10px" onclick="ttDel('${id}',${p._i})">✕</button></div>`).join('');
}
function ttAdd(id) {
  openSheet('Agregar bloque', `
    <div class="field"><label>Materia</label><input id="tt-s" placeholder="Matemáticas"></div>
    <div class="row2"><div class="field"><label>Día</label><select id="tt-d">${DIAS.map(d => `<option>${d}</option>`).join('')}</select></div>
      <div class="field"><label>Sala (opcional)</label><input id="tt-r" placeholder="Aula 3"></div></div>
    <div class="row2"><div class="field"><label>Hora inicio</label><input id="tt-h" type="time" value="08:00"></div>
      <div class="field"><label>Hora fin</label><input id="tt-e" type="time"></div></div>
    <button class="btn block" id="tt-go">Agregar</button>`);
  $('#tt-go').onclick = () => act(async () => {
    const s = $('#tt-s').value.trim(); if (!s) return toast('Escribe la materia');
    const k = D().kids.find(x => x.id === id);
    const tt = (k.timetable || []).concat([{ subject: s, day: $('#tt-d').value, start: $('#tt-h').value, end: $('#tt-e').value, room: $('#tt-r').value.trim() }]);
    await Store.update('kids', id, { ...k, timetable: tt }); modalHorario(id); toast('Bloque agregado ✓');
  });
}
function ttDel(id, i) {
  act(async () => { const k = D().kids.find(x => x.id === id); const tt = (k.timetable || []).slice(); tt.splice(i, 1); await Store.update('kids', id, { ...k, timetable: tt }); modalHorario(id); });
}
/* ---- Preset: Colegio Conquistadores · 6° básico 2026 ----
   Horario semanal de materias + calendario de evaluaciones + profesores.
   Se carga con un toque en el perfil del hijo/a. */
const COLE_HORARIO = (() => {
  const B = (day, blocks) => blocks.map(([start, end, subject]) => ({ day, start, end, subject, room: '' }));
  return [].concat(
    B('Lun', [['08:15','09:00','Historia y Cs. Sociales'],['09:00','09:45','Historia y Cs. Sociales'],['10:00','10:45','Artes visuales'],['10:45','11:30','Artes visuales'],['11:45','12:30','Religión'],['12:30','13:15','Religión'],['14:00','14:45','Lenguaje'],['14:45','15:30','Lenguaje']]),
    B('Mar', [['08:15','09:00','Historia y Cs. Sociales'],['09:00','09:45','Historia y Cs. Sociales'],['10:00','10:45','Cs. Naturales'],['10:45','11:30','Cs. Naturales'],['11:45','12:30','Matemáticas'],['12:30','13:15','Matemáticas'],['14:00','14:45','Taller: Poder de los números'],['14:45','15:30','Taller: Poder de los números'],['16:00','17:30','Taekwondo']]),
    B('Mié', [['08:15','09:00','Inglés'],['09:00','09:45','Orientación'],['10:00','10:45','Ed. Física'],['10:45','11:30','Ed. Física'],['11:45','12:30','Tecnología'],['12:30','13:15','Tecnología'],['14:00','14:45','Música'],['14:45','15:30','Música'],['16:00','17:30','Teatro']]),
    B('Jue', [['08:15','09:00','Matemáticas'],['09:00','09:45','Matemáticas'],['10:00','10:45','Lenguaje'],['10:45','11:30','Lenguaje'],['11:45','12:30','Cs. Naturales'],['12:30','13:15','Cs. Naturales'],['14:00','14:45','Taller: Conquistadores de libros'],['14:45','15:30','Taller: Conquistadores de libros'],['16:00','17:30','Danza/fútbol']]),
    B('Vie', [['08:15','09:00','Lenguaje'],['09:00','09:45','Lenguaje'],['10:00','10:45','Matemáticas'],['10:45','11:30','Matemáticas'],['11:45','12:30','Inglés'],['12:30','13:15','Inglés']])
  );
})();
const COLE_PROFES = [
  { s: 'Lenguaje / Religión', n: 'Elsa Díaz', e: 'e.diazconquistadores@gmail.com' },
  { s: 'Inglés', n: 'Francisca Tello', e: 'f.telloconquistadores@gmail.com' },
  { s: 'Matemáticas / Orientación', n: 'Francisca Moroso', e: 'f.morosoconquistadores@gmail.com' },
  { s: 'Historia y Cs. Sociales', n: 'Juan Pablo Castillo', e: 'jp.castilloconquistadores@gmail.com' },
  { s: 'Cs. Naturales', n: 'Magda Aranda', e: 'm.arandaconquistadores@gmail.com' },
  { s: 'Tecnología / Artes visuales', n: 'Mariana Paradela', e: 'm.paradelaconquistadores@gmail.com' },
  { s: 'Música', n: 'Rodrigo Araya', e: 'r.arayaconquistadores@gmail.com' },
  { s: 'Ed. Física', n: 'Jorge Rodríguez', e: 'j.rodriguezconquistadores@gmail.com' },
];
const COLE_EVALS = [
  ['2026-08-03','Formativa','Lenguaje','Lectura domiciliaria 30%: “Un secreto en mi colegio”'],
  ['2026-08-04','Sumativa','Artes visuales','Bajorrelieve'],
  ['2026-08-05','Sumativa','Tecnología','Disertación sobre la evolución de un objeto tecnológico'],
  ['2026-08-06','Formativa','Lenguaje','Lectura domiciliaria 70%: “Un secreto en mi colegio”'],
  ['2026-08-07','Sumativa','Matemáticas','Suma y resta, números decimales (multiplicación y división)'],
  ['2026-08-10','Sumativa','Lenguaje','Elementos textuales, infografías, textos de opinión'],
  ['2026-08-10','Sumativa','Historia','Regiones de Chile'],
  ['2026-08-13','Sumativa','Cs. Naturales','Lección 5: Energía'],
  ['2026-08-19','Sumativa','Tecnología','Diseño de idea e innovación tecnológica'],
  ['2026-08-24','Sumativa','Artes visuales','Escultura con materiales reciclados'],
  ['2026-08-24','Sumativa','Religión','Empatía y tolerancia'],
  ['2026-08-24','Formativa','Lenguaje','Lectura domiciliaria 30%: “La guerra del bosque”'],
  ['2026-08-26','Sumativa','Ed. Física','Ejecución correcta de una danza nacional'],
  ['2026-08-27','Formativa','Lenguaje','Lectura domiciliaria 70%: “La guerra del bosque”'],
  ['2026-08-28','Sumativa','Música','Unidad n°3 y repertorio'],
  ['2026-09-03','Sumativa','Matemáticas','Juego matemático'],
  ['2026-09-04','Sumativa','Inglés','Present perfect – have/has'],
  ['2026-09-25','Sumativa','Ed. Física','Presentación gala de raíz folclórica'],
  ['2026-09-28','Sumativa','Lenguaje','Artículos informativos, claves textuales, comparar noticias'],
  ['2026-10-09','Sumativa','Inglés','Properties / Passive voice'],
  ['2026-10-09','Sumativa','Música','Repertorio popular folclórico latinoamericano'],
  ['2026-10-11','Sumativa','Artes visuales','Mosaiquismo. Arte urbano'],
  ['2026-10-14','Sumativa','Tecnología','El objeto tecnológico'],
  ['2026-10-18','Sumativa','Ed. Física','Deportes individuales y colectivos aplicando reglas del juego'],
  ['2026-10-20','Sumativa','Matemáticas','Razón y porcentaje'],
  ['2026-10-22','Sumativa','Cs. Naturales','Lección 7'],
  ['2026-10-26','Sumativa','Religión','Democracia y perseverancia'],
  ['2026-10-26','Formativa','Lenguaje','Lectura domiciliaria 30%: “El gigante bonachón”'],
  ['2026-10-27','Sumativa','Historia','Conformación del territorio chileno del siglo XIX'],
  ['2026-10-28','Sin calificar','SIMCE','Matemáticas y cuestionario estudiantes'],
  ['2026-10-29','Sin calificar','SIMCE','Lectura'],
  ['2026-10-30','Formativa','Lenguaje','Lectura domiciliaria 70%: “El gigante bonachón”'],
  ['2026-11-02','Sumativa','Lenguaje','Conectores, tipos de narradores y personajes'],
  ['2026-11-06','Sumativa','Inglés','Unit 7: Animals and survival'],
  ['2026-11-23','Sumativa','Religión','Honestidad'],
  ['2026-11-25','Sumativa','Música','Unidad n°4 y repertorio'],
  ['2026-11-26','Sumativa','Cs. Naturales','Erosión del suelo'],
  ['2026-11-30','Sumativa','Lenguaje','Sinónimos, hipónimos e hiperónimos'],
  ['2026-12-03','Formativa','Lenguaje','Lectura domiciliaria 30%: “El principito”'],
  ['2026-12-04','Formativa','Lenguaje','Lectura domiciliaria 70%: “El principito”'],
];
function cargarDatosColegio(kidId) {
  const k = D().kids.find(x => x.id === kidId); if (!k) return;
  const yaCargado = (D().tasks || []).some(t => t.origen === 'cole2026');
  const seguir = () => act(async () => {
    closeSheet();
    toast('Cargando horario y evaluaciones…');
    // Limpia el bloque de profesores que versiones anteriores dejaban en las notas.
    const notas = String(k.schedule || '').split('Profesores 6° básico:')[0].trim();
    await Store.update('kids', kidId, { ...k, timetable: COLE_HORARIO, schedule: notas, teachers: COLE_PROFES });
    const tareas = COLE_EVALS.map(([due, tipo, subject, contenido]) => ({
      title: contenido, subject, kid: kidId, due, type: 'colegio',
      note: `${tipo} · 6° básico`, done: false, origen: 'cole2026',
    }));
    await Store.bulkCreate('tasks', tareas);
    render(); toast(`✓ Horario y ${tareas.length} evaluaciones cargadas`);
  });
  openSheet('Cargar datos del colegio', `
    <p class="hint" style="margin-bottom:12px">Se cargará el <b>horario de materias</b> de 6° básico y <b>${COLE_EVALS.length} evaluaciones</b> (agosto–diciembre 2026) como tareas de ${esc(k.name)}, con recordatorio 1 día antes. También se guardan los correos de los profesores.</p>
    ${yaCargado ? `<p class="hint" style="color:var(--rose);margin-bottom:12px">⚠️ Ya cargaste estos datos antes. Si continúas se duplicarán las evaluaciones.</p>` : ''}
    <button class="btn block" id="cole-go">${yaCargado ? 'Cargar de nuevo' : 'Cargar ahora'}</button>`);
  $('#cole-go').onclick = seguir;
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
    <div class="field"><label>Notas de horario (opcional)</label><textarea id="k-sched" style="min-height:80px" placeholder="Ej.\nEntrada 8:00 · Salida 14:00\nMartes: natación 16:00">${esc(k.schedule||'')}</textarea>
      ${id ? `<button type="button" class="btn block outline" style="margin-top:8px" onclick="modalHorario('${id}')">📚 Horario de materias (grilla)</button>` : `<div class="hint" style="margin-top:6px">Guarda primero para agregar el horario de materias en grilla.</div>`}</div>
    <div class="field"><label>Foto (opcional)</label><input id="k-img" type="file" accept="image/*">
      <div id="k-prev" style="margin-top:8px">${k.photo ? `<img src="${k.photo}" style="width:72px;height:72px;object-fit:cover;border-radius:18px">` : ''}</div></div>
    <div class="field"><label>Foto del horario o calendario (opcional)</label><input id="k-docimg" type="file" accept="image/*">
      <div class="hint">Sube una foto del horario o del calendario de evaluaciones impreso.</div>
      <div id="k-docprev" style="margin-top:8px">${k.docPhoto ? `<img src="${k.docPhoto}" style="max-width:100%;border-radius:12px;border:1px solid var(--line)">` : ''}</div></div>
    <div class="field"><label>Notas</label><textarea id="k-notes">${esc(k.notes||'')}</textarea></div>
    <button class="btn block" id="k-save">Guardar</button>`);
  let photoData = k.photo || '';
  let docData = k.docPhoto || '';
  $('#k-img').onchange = (ev) => act(async () => {
    const f = ev.target.files[0]; if (!f) return;
    photoData = await comprimirImagen(f, 400, 0.7);
    $('#k-prev').innerHTML = `<img src="${photoData}" style="width:72px;height:72px;object-fit:cover;border-radius:18px">`;
  });
  $('#k-docimg').onchange = (ev) => act(async () => {
    const f = ev.target.files[0]; if (!f) return;
    docData = await comprimirImagen(f, 1400, 0.75);
    $('#k-docprev').innerHTML = `<img src="${docData}" style="max-width:100%;border-radius:12px;border:1px solid var(--line)">`;
  });
  $('#k-save').onclick = () => act(async () => {
    const name = $('#k-name').value.trim(); if (!name) return toast('Escribe el nombre');
    const obj = { name, dob: $('#k-dob').value, bloodType: $('#k-blood').value.trim(), school: $('#k-school').value.trim(), grade: $('#k-grade').value.trim(),
      allergies: $('#k-all').value.trim(), meds: $('#k-meds').value.trim(), doctor: $('#k-doc').value.trim(), emergency: $('#k-em').value.trim(),
      schedule: $('#k-sched').value.trim(), notes: $('#k-notes').value.trim(), photo: photoData || '', docPhoto: docData || '' };
    if (id) { await Store.update('kids', id, { ...k, ...obj }); }
    else { await Store.create('kids', { ...obj, color: ['#0d9488','#f97316','#2563eb','#e11d48'][D().kids.length % 4] }); }
    closeSheet(); render(); toast('Guardado');
  });
}
const delHijo = (id) => act(async () => { if (D().kids.length <= 1) return toast('Debe quedar al menos un hijo/a'); await Store.remove('kids', id); closeSheet(); render(); toast('Eliminado'); });
function docRow(d) {
  const thumb = d.image
    ? `<div onclick="verImagenDoc('${d.id}')" style="width:44px;height:44px;border-radius:10px;background:center/cover no-repeat url('${d.image}');cursor:pointer;flex-shrink:0"></div>`
    : `<div class="avatar" style="background:#64748b">📄</div>`;
  return `<div class="list-row">${thumb}
    <div class="body" ${d.image ? `style="cursor:pointer" onclick="verImagenDoc('${d.id}')"` : ''}><div class="t">${esc(d.name)} ${d.image ? '<span class="badge gray">📷 foto</span>' : ''}</div><div class="s">${esc(d.cat)} · ${fechaLarga(d.date)}${d.note ? ' · '+esc(d.note) : ''}</div></div>
    <button class="btn sm ghost" onclick="delDoc('${d.id}')">✕</button></div>`;
}
const verImagenDoc = (id) => { const d = D().docs.find(x => x.id === id); if (d && d.image) verImagen(d.image); };
const verReciboGasto = (id) => { const e = D().expenses.find(x => x.id === id); if (e && e.receipt) verImagen(e.receipt); };
const verImagenMensaje = (id) => { const m = D().messages.find(x => x.id === id); if (m && m.image) verImagen(m.image); };
const verImagenHijoDoc = (id) => { const k = D().kids.find(x => x.id === id); if (k && k.docPhoto) verImagen(k.docPhoto); };
function modalDoc() {
  openSheet('Registrar documento o boleta', `
    <div class="field"><label>Nombre</label><input id="d-name" placeholder="Ej. Convenio de custodia, boleta colegiatura…"></div>
    <div class="field"><label>Categoría</label><select id="d-cat"><option>Legal</option><option>Salud</option><option>Escuela</option><option>Boleta</option><option>Identidad</option><option>Seguro</option><option>Otro</option></select></div>
    <div class="field"><label>Nota</label><input id="d-note" placeholder="Vigencia, detalle…"></div>
    <div class="field"><label>Foto (opcional)</label><input id="d-img" type="file" accept="image/*">
      <div id="d-prev" style="margin-top:8px"></div><div class="hint">Toma o elige una foto de la boleta o documento. Se comprime sola.</div></div>
    <button class="btn block" id="d-save">Guardar</button>`);
  let imgData = '';
  $('#d-img').onchange = (e) => act(async () => {
    const f = e.target.files[0]; if (!f) return;
    imgData = await comprimirImagen(f);
    $('#d-prev').innerHTML = `<img src="${imgData}" style="width:100%;max-height:220px;object-fit:contain;border-radius:12px;border:1px solid var(--line)">`;
  });
  $('#d-save').onclick = () => act(async () => {
    const name = $('#d-name').value.trim(); if (!name) return toast('Escribe el nombre');
    await Store.create('docs', { name, cat: $('#d-cat').value, date: today(), note: $('#d-note').value.trim(), image: imgData || '' });
    closeSheet(); render(); toast('Guardado');
  });
}
const delDoc = (id) => act(async () => { await Store.remove('docs', id); render(); toast('Eliminado'); });

/* =============================== BITÁCORA =========================== */
function modalBitacora() {
  const items = [...(D().journal || [])].sort((a, b) => (b.ts || 0) - (a.ts || 0) || b.date.localeCompare(a.date));
  openSheet('Bitácora 📔', `
    <p class="hint" style="margin-bottom:12px">Momentos y notas de tus hijos, compartidos entre los dos padres.</p>
    <button class="btn block" onclick="modalNota()">＋ Nueva nota</button>
    <div style="margin-top:14px">${items.length ? items.map(notaRow).join('') : `<div class="empty"><div class="ic">📔</div><p>Aún no hay notas</p></div>`}</div>`);
}
function notaRow(n) {
  const kid = D().kids.find(k => k.id === n.kid);
  return `<div class="list-row"><div class="avatar" style="background:${kid ? kid.color : '#94a3b8'}">${kid ? inicial(kid.name) : '📔'}</div>
    <div class="body"><div class="t" style="white-space:pre-line">${esc((n.text || '').slice(0, 140))}${(n.text || '').length > 140 ? '…' : ''}</div>
      <div class="s">${fechaLarga(n.date)}${kid ? ' · ' + esc(kid.name) : ''} · ${esc(nombre(n.author))}</div></div>
    <button class="btn sm ghost" onclick="delNota('${n.id}')">✕</button></div>`;
}
function modalNota() {
  const kidsOpts = `<option value="">— General —</option>` + D().kids.map(k => `<option value="${k.id}">${esc(k.name)}</option>`).join('');
  openSheet('Nueva nota', `
    <div class="field"><label>¿De qué hijo/a?</label><select id="jn-k">${kidsOpts}</select></div>
    <div class="field"><label>Nota</label><textarea id="jn-t" style="min-height:120px" placeholder="Ej. Hoy Mateo dio sus primeros pasos 🎉  /  Sofía tuvo fiebre, le di paracetamol a las 20:00"></textarea></div>
    <div class="field"><label>Fecha</label><input id="jn-d" type="date" value="${today()}"></div>
    <button class="btn block" id="jn-save">Guardar nota</button>`);
  $('#jn-save').onclick = () => act(async () => {
    const text = $('#jn-t').value.trim(); if (!text) return toast('Escribe la nota');
    await Store.create('journal', { text, kid: $('#jn-k').value, date: $('#jn-d').value, author: meRole(), ts: Date.now() });
    closeSheet(); modalBitacora(); toast('Nota guardada');
  });
}
const delNota = (id) => act(async () => { await Store.remove('journal', id); closeSheet(); modalBitacora(); toast('Nota eliminada'); });

/* =============================== AJUSTES ============================= */
function modalAjustes() {
  const f = F(), inviteRow = CLOUD ? `
    ${f.inviteCode ? `<div class="card tight" style="margin-bottom:14px"><div style="font-size:12px;color:var(--slate);text-transform:uppercase;letter-spacing:.05em">Código de invitación</div>
      <div style="font-size:24px;font-weight:800;letter-spacing:.12em;color:var(--teal-700)">${esc(f.inviteCode)}</div>
      <div class="hint">Compártelo con el otro padre para que se una.</div></div>` : ''}
    <button class="btn block ghost" onclick="enablePush(true)" style="margin-bottom:6px">🔔 Activar notificaciones</button>
    <div class="hint" style="margin-bottom:10px">📱 En iPhone las notificaciones funcionan solo si agregas Copaz a la pantalla de inicio (Compartir → “Agregar a inicio”), con iOS 16.4 o superior.</div>
    <button class="btn block outline" onclick="cerrarSesion()" style="margin-bottom:10px">Cerrar sesión</button>` : '';
  openSheet('Ajustes', `
    <div class="field"><label>Tu nombre</label><input id="st-a" value="${esc(f.parents.A || '')}"></div>
    <div class="field"><label>Otro padre / madre</label><input id="st-b" value="${esc(f.parents.B || '')}"></div>
    ${!CLOUD ? `<div class="field"><label>¿Quién eres tú?</label><div class="seg" id="st-me">
      <button data-v="A" class="${meRole()==='A'?'on':''}">${esc(f.parents.A||'A')}</button>
      <button data-v="B" class="${meRole()==='B'?'on':''}">${esc(f.parents.B||'B')}</button></div></div>` : ''}
    <div class="field"><label>Moneda</label><select id="st-cur">${['MXN','USD','EUR','COP','ARS','CLP'].map(c => `<option value="${c}" ${f.currency===c?'selected':''}>${c}</option>`).join('')}</select></div>
    <button class="btn block" id="st-save">Guardar ajustes</button>
    <button class="btn block coral" onclick="modalPlanes()" style="margin-top:10px">✨ Planes y suscripción</button>
    <button class="btn block outline" onclick="alternarTema()" style="margin-top:10px">${localStorage.getItem('copaz.theme') === 'dark' ? '☀️ Modo claro' : '🌙 Modo oscuro'}</button>
    ${CLOUD ? `<button class="btn block outline" onclick="modalCambiarClave()" style="margin-top:10px">🔑 Cambiar contraseña</button>
    <button class="btn block outline" onclick="modalActividad()" style="margin-top:10px">🕘 Actividad reciente</button>
    <button class="btn block outline" onclick="modalCalendario()" style="margin-top:10px">📆 Suscribir calendario</button>` : ''}
    <button class="btn block outline" onclick="modalAyuda()" style="margin-top:10px">❓ Ayuda y soporte</button>
    ${inviteRow}
    ${CLOUD ? `<button class="btn block danger" onclick="modalEliminarCuenta()" style="margin-top:10px">🗑️ Eliminar mi cuenta</button>` : ''}
    ${!CLOUD ? `<button class="btn block danger" id="st-reset" style="margin-top:10px">Borrar todo y reiniciar</button>` : ''}
    <p class="hint" style="text-align:center;margin-top:14px">Copaz v25 · ${CLOUD ? 'Modo nube (sincronizado)' : 'Modo local (este dispositivo)'}</p>`);
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
/* =============================== TAREAS =============================== */
function viewTareas(app) {
  const hoyISO = iso(new Date());
  const all = [...(D().tasks || [])];
  const filtro = window.tareaFiltro || 'pend';
  let list = all;
  if (filtro === 'pend') list = all.filter(t => !t.done);
  else if (filtro === 'colegio') list = all.filter(t => t.type !== 'hogar');
  else if (filtro === 'hogar') list = all.filter(t => t.type === 'hogar');
  list.sort((a, b) => (a.done !== b.done ? (a.done ? 1 : -1) : String(a.due || '9999').localeCompare(String(b.due || '9999'))));
  const chip = (id, l) => `<button class="btn sm ${filtro === id ? '' : 'ghost'}" style="padding:6px 12px" onclick="window.tareaFiltro='${id}';viewTareas(document.getElementById('app'))">${l}</button>`;
  const pend = all.filter(t => !t.done).length;
  const atras = all.filter(t => !t.done && t.due && t.due < hoyISO).length;

  // Límite de "esta semana" (próximos 7 días).
  const fin7 = new Date(); fin7.setDate(fin7.getDate() + 7); const fin7ISO = iso(fin7);
  const MES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const grupoDe = (t) => {
    if (t.done) return { k: 'z-hechas', label: '✓ Hechas' };
    if (!t.due) return { k: 'y-sinfecha', label: 'Sin fecha' };
    if (t.due < hoyISO) return { k: 'a-atrasadas', label: '⚠️ Atrasadas' };
    if (t.due <= fin7ISO) return { k: 'b-semana', label: '📌 Esta semana' };
    const [y, m] = t.due.split('-'); return { k: 'c-' + y + m, label: MES[+m - 1] + ' ' + y };
  };
  const grupos = {};
  for (const t of list) { const g = grupoDe(t); (grupos[g.k] = grupos[g.k] || { label: g.label, items: [] }).items.push(t); }
  const orden = Object.keys(grupos).sort();
  const cuerpo = list.length
    ? orden.map(k => `<div class="section-title">${grupos[k].label} <span class="count">${grupos[k].items.length}</span></div>
        <div class="card">${grupos[k].items.map(taskRow).join('')}</div>`).join('')
    : `<div class="card"><div class="empty"><div class="ic">📝</div><p>${all.length ? 'Nada por aquí' : 'Aún no hay tareas'}</p></div></div>`;

  app.innerHTML = topbar('Tareas', pend ? `${pend} pendiente${pend > 1 ? 's' : ''}${atras ? ` · ${atras} atrasada${atras > 1 ? 's' : ''}` : ''}` : 'Todo al día') + `<div class="screen">
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${chip('pend', 'Pendientes')}${chip('colegio', '📚 Colegio')}${chip('hogar', '🏠 Hogar')}${chip('todas', 'Todas')}${(D().tasks || []).length ? `<button class="btn sm ghost" style="padding:6px 12px" onclick="exportarTareasPDF()">🧾 PDF</button>` : ''}</div>
    ${cuerpo}
    </div><button class="fab" onclick="modalTarea()">＋</button>`;
}
function taskRow(t) {
  const kid = D().kids.find(k => k.id === t.kid);
  const hoyISO = iso(new Date());
  const late = t.due && t.due < hoyISO && !t.done;
  const vence = t.due ? (late ? 'Atrasada' : (t.due === hoyISO ? 'Vence hoy' : 'Entrega ' + fechaLarga(t.due))) : 'Sin fecha';
  const ic = t.type === 'hogar' ? '🏠' : '📚';
  return `<div class="list-row">
    <button onclick="toggleTarea('${t.id}')" style="width:26px;height:26px;border-radius:8px;border:2px solid ${t.done ? 'var(--teal-500)' : 'var(--line)'};background:${t.done ? 'var(--teal-500)' : 'transparent'};color:#fff;flex:none;cursor:pointer;font-size:14px">${t.done ? '✓' : ''}</button>
    <div class="body" style="cursor:pointer;margin-left:10px" onclick="modalTarea('${t.id}')"><div class="t" style="${t.done ? 'text-decoration:line-through;opacity:.55' : ''}">${ic} ${esc(t.title)}</div>
      <div class="s">${t.subject ? esc(t.subject) + ' · ' : ''}${kid ? esc(kid.name) + ' · ' : ''}<span style="${late ? 'color:var(--rose);font-weight:700' : ''}">${vence}</span></div></div></div>`;
}
function toggleTarea(id) { act(async () => { const t = (D().tasks || []).find(x => x.id === id); if (!t) return; await Store.update('tasks', id, { ...t, done: !t.done }); render(); }); }
function modalTarea(id) {
  const t = id ? (D().tasks || []).find(x => x.id === id) : null;
  const kidsOpts = `<option value="">— General —</option>` + D().kids.map(k => `<option value="${k.id}"${t && t.kid === k.id ? ' selected' : ''}>${esc(k.name)}</option>`).join('');
  const tipo = t ? (t.type || 'colegio') : 'colegio';
  openSheet(id ? 'Editar tarea' : 'Nueva tarea', `
    <div class="field"><label>Título</label><input id="tk-t" placeholder="Ej. Entregar maqueta, tender la cama…" value="${t ? esc(t.title) : ''}"></div>
    <div class="field"><label>Tipo</label><div class="seg" id="tk-tipo">${['colegio', 'hogar'].map(x => `<button type="button" data-v="${x}" class="${tipo === x ? 'on' : ''}">${x === 'colegio' ? '📚 Colegio' : '🏠 Hogar'}</button>`).join('')}</div></div>
    <div class="row2"><div class="field"><label>Materia (opcional)</label><input id="tk-s" value="${t ? esc(t.subject || '') : ''}" placeholder="Matemáticas"></div>
      <div class="field"><label>Hijo/a</label><select id="tk-k">${kidsOpts}</select></div></div>
    <div class="field"><label>Fecha de entrega</label><input id="tk-d" type="date" value="${t ? t.due || '' : ''}"></div>
    <div class="field"><label>Notas (opcional)</label><textarea id="tk-n">${t ? esc(t.note || '') : ''}</textarea></div>
    <button class="btn block" id="tk-go">${id ? 'Guardar' : 'Agregar'}</button>
    ${id ? `<button class="btn block outline" style="margin-top:8px" onclick="delTarea('${id}')">Eliminar</button>` : ''}`);
  $$('#tk-tipo button').forEach(b => b.onclick = () => $$('#tk-tipo button').forEach(x => x.classList.toggle('on', x === b)));
  $('#tk-go').onclick = () => act(async () => {
    const title = $('#tk-t').value.trim(); if (!title) return toast('Escribe el título');
    const obj = { title, type: segVal('#tk-tipo'), subject: $('#tk-s').value.trim(), kid: $('#tk-k').value, due: $('#tk-d').value, note: $('#tk-n').value.trim(), done: t ? !!t.done : false };
    if (id) await Store.update('tasks', id, { ...t, ...obj, reminded: (t && t.due === obj.due) ? t.reminded : false });
    else await Store.create('tasks', obj);
    closeSheet(); render(); toast('Guardado');
  });
}
function delTarea(id) { act(async () => { await Store.remove('tasks', id); closeSheet(); render(); toast('Eliminada'); }); }

const SOPORTE_EMAIL = 'servicio.oca.tec@gmail.com';
function modalAyuda() {
  const faqs = [
    ['¿Cómo invito al otro padre/madre?', 'En Ajustes verás un “Código de invitación”. Compártelo; la otra persona crea su cuenta y en “Unirme a una familia” escribe ese código. Así ven y editan todo sincronizado.'],
    ['¿Los dos vemos lo mismo al instante?', 'Sí. Gastos, mensajes, calendario, tareas y horario se sincronizan en tiempo real entre ambos.'],
    ['¿Cómo cargo el horario y las evaluaciones del colegio?', 'Entra al perfil del hijo/a y toca “📥 Cargar datos del colegio”. También puedes editar el horario a mano o subir una foto del calendario.'],
    ['¿Las notificaciones no me llegan en iPhone?', 'En iPhone debes agregar Copaz a la pantalla de inicio (Compartir → “Agregar a inicio”) y tener iOS 16.4 o superior.'],
    ['¿Cómo funciona el pago?', 'Tienes 30 días gratis. Luego, desde “Planes y suscripción” pagas con Flow (mensual o anual). El Premium se activa solo al confirmarse el pago y te llega un recibo por correo.'],
    ['¿Puedo cancelar o eliminar mis datos?', 'El cobro no es automático: si no renuevas, simplemente se vence. Puedes borrar toda tu cuenta y datos en Ajustes → “Eliminar mi cuenta”.'],
    ['¿Es privado?', 'Solo tú y el otro padre/madre vinculado ven la información de su familia. Nadie más tiene acceso.'],
  ];
  openSheet('Ayuda y soporte ❓', `
    ${faqs.map(([q, a]) => `<details style="border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:8px">
      <summary style="font-weight:700;cursor:pointer">${esc(q)}</summary>
      <div style="font-size:13.5px;color:var(--slate);margin-top:6px">${esc(a)}</div></details>`).join('')}
    <div class="card tight" style="margin-top:8px"><div style="font-size:13px">¿Necesitas más ayuda? Escríbenos:</div>
      <a class="btn block" href="mailto:${SOPORTE_EMAIL}?subject=Soporte%20Copaz" style="margin-top:8px">✉️ Contactar soporte</a>
      <div class="hint" style="margin-top:6px">${SOPORTE_EMAIL}</div></div>
    <p class="hint" style="text-align:center;margin-top:12px"><a href="terminos.html" target="_blank">Términos</a> · <a href="privacidad.html" target="_blank">Privacidad</a></p>`);
}
function modalEliminarCuenta() {
  openSheet('Eliminar mi cuenta 🗑️', `
    <p class="hint" style="margin-bottom:12px;color:var(--rose)">⚠️ Esto borra <b>para siempre</b> tu familia y todos sus datos (hijos, gastos, mensajes, tareas, documentos) para ambos padres. No se puede deshacer.</p>
    <div class="field"><label>Escribe tu contraseña para confirmar</label><input id="del-pass" type="password"></div>
    <div class="field"><label>Escribe ELIMINAR para continuar</label><input id="del-word" placeholder="ELIMINAR"></div>
    <button class="btn block danger" id="del-go">Eliminar mi cuenta definitivamente</button>`);
  $('#del-go').onclick = () => act(async () => {
    if (($('#del-word').value || '').trim().toUpperCase() !== 'ELIMINAR') return toast('Escribe ELIMINAR para confirmar');
    const pass = $('#del-pass').value; if (!pass) return toast('Escribe tu contraseña');
    await Cloud.deleteAccount(pass);
    Store.logout(); closeSheet(); location.hash = ''; render();
    toast('Tu cuenta fue eliminada');
  });
}
function cerrarSesion() { Store.logout(); closeSheet(); location.hash = ''; render(); }
function modalCambiarClave() {
  openSheet('Cambiar contraseña', `
    <div class="field"><label>Contraseña actual</label><input id="cp-a" type="password"></div>
    <div class="field"><label>Nueva contraseña</label><input id="cp-n" type="password" placeholder="Mínimo 6 caracteres"></div>
    <button class="btn block" id="cp-go">Guardar</button>`);
  $('#cp-go').onclick = () => act(async () => {
    const a = $('#cp-a').value, n = $('#cp-n').value; if (n.length < 6) return toast('Mínimo 6 caracteres');
    await Cloud.changePassword(a, n); closeSheet(); toast('Contraseña actualizada ✓');
  });
}
function modalActividad() {
  openSheet('Actividad reciente', `<div id="act-list"><div class="empty"><div class="ic">🕘</div><p>Cargando…</p></div></div>`);
  act(async () => {
    const { audit } = await Cloud.audit();
    const acc = { crear: 'agregó', editar: 'editó', borrar: 'eliminó' };
    const ent = { kids: 'hijo/a', events: 'evento', expenses: 'gasto', docs: 'documento', swaps: 'intercambio', journal: 'nota', settlements: 'abono' };
    const trad = (d = '') => d.replace(/^(\w+)(:?)/, (m, w, c) => (ent[w] || w) + c);
    $('#act-list').innerHTML = (audit && audit.length) ? audit.map(a => `<div class="list-row">
      <div class="avatar" style="background:${color(a.actor)}">${inicial(nombre(a.actor))}</div>
      <div class="body"><div class="t">${esc(nombre(a.actor))} ${acc[a.action] || a.action} ${esc(trad(a.detail || ''))}</div>
      <div class="s">${new Date(Number(a.ts)).toLocaleString('es-CL')}</div></div></div>`).join('')
      : `<div class="empty"><div class="ic">🕘</div><p>Sin actividad todavía</p></div>`;
  });
}
function modalCalendario() {
  const tok = F() && F().calToken, fid = F() && F().id;
  const url = (tok && fid) ? `${API_BASE}/api/cal/${fid}/${tok}.ics` : '';
  openSheet('Suscribir calendario 📆', `
    <p class="hint" style="margin-bottom:12px">Agrega este enlace en Google Calendar o Apple Calendar (Agregar calendario → Desde URL) para ver la custodia y los eventos, siempre actualizados.</p>
    <div class="field"><input value="${esc(url)}" readonly onclick="this.select()"></div>
    <button class="btn block" onclick="copiarTexto('${url}')">Copiar enlace</button>
    <a class="btn block ghost" href="${url}" style="margin-top:10px" download="copaz.ics">Descargar .ics</a>`);
}
const copiarTexto = (t) => { if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => toast('Enlace copiado 📋')); else toast('Copia el enlace manualmente'); };

/* =============================== PLANES ============================= */
function diasPrueba() {
  if (CLOUD) {
    const t = F() && F().access && F().access.trialUntil;
    if (!t) return null;
    return Math.ceil((new Date(t).getTime() - Date.now()) / 86400000);
  }
  const ts = localStorage.getItem('copaz.trialStart');
  if (!ts) return null;
  return 30 - diffDias(ts.slice(0, 10), today());
}
function modalPlanes() {
  const dias = diasPrueba();
  let estado = '';
  if (dias !== null) {
    estado = dias > 0
      ? `<div class="card tight" style="background:var(--teal-50);border-color:var(--teal-200);margin-bottom:14px"><div style="font-size:13px;color:var(--teal-800)">🎁 Prueba activa: te quedan <b>${dias} día${dias !== 1 ? 's' : ''}</b> de Premium gratis.</div></div>`
      : `<div class="card tight" style="background:#fff7ed;border-color:#fed7aa;margin-bottom:14px"><div style="font-size:13px;color:#9a3412">Tu prueba terminó. Suscríbete para seguir disfrutando Premium.</div></div>`;
  }
  openSheet('Copaz Premium ✨', `
    ${estado}
    <p class="hint" style="margin-bottom:14px">Precio por cada padre. Aún más barato que OurFamilyWizard y las apps líderes.</p>
    <div class="card" style="border:2px solid var(--teal-500)">
      <div style="font-weight:800;font-size:16px">Plan anual <span class="badge green" style="margin-left:6px">2 meses gratis</span></div>
      <div style="font-size:28px;font-weight:800;letter-spacing:-.02em;margin-top:2px">${PRECIOS.anual} <span style="font-size:13px;font-weight:600;color:var(--slate)">CLP / año</span></div>
      <div class="hint">Por cada padre · el mejor valor</div>
      <button class="btn block" style="margin-top:10px" onclick="irAFlow('anual')">Suscribirme al plan anual</button>
    </div>
    <div class="card">
      <div style="font-weight:800;font-size:16px">Plan mensual</div>
      <div style="font-size:28px;font-weight:800;letter-spacing:-.02em;margin-top:2px">${PRECIOS.mensual} <span style="font-size:13px;font-weight:600;color:var(--slate)">CLP / mes</span></div>
      <div class="hint">Por cada padre · cancela cuando quieras</div>
      <button class="btn block ghost" style="margin-top:10px" onclick="irAFlow('mensual')">Suscribirme al plan mensual</button>
    </div>
    ${(!CLOUD && dias === null) ? `<button class="btn block outline" onclick="iniciarPrueba()" style="margin-top:4px">Comenzar 30 días gratis</button>` : ''}
    <p class="hint" style="text-align:center;margin-top:14px">Pagos seguros con Flow · disponible en toda Latinoamérica.</p>
  `);
}
const iniciarPrueba = () => { localStorage.setItem('copaz.trialStart', new Date().toISOString()); closeSheet(); render(); toast('¡30 días de Premium activados! 🎉'); };
const reenviarVerificacion = () => act(async () => { await Cloud.resendVerify(); toast('Correo de verificación reenviado 📧'); });
function premiumActivo() {
  if (CLOUD) return !!(F() && F().access && F().access.premium);
  const p = F() && F().premium; return !!(p && p.until && new Date(p.until) > new Date());
}
function premiumHasta() {
  const u = CLOUD ? (F() && F().access && F().access.premiumUntil) : (F() && F().premium && F().premium.until);
  return u ? fechaLarga(String(u).slice(0, 10)) : '';
}
async function irAFlow(plan) {
  // Pago único generado automáticamente por Flow (API). Al pagar, Premium se activa solo.
  // No hay cobro recurrente: cuando vence, se paga de nuevo a mano.
  if (CLOUD) {
    try {
      const r = await Cloud.payCreate(plan);
      if (r && r.url) { window.location.href = r.url; return; }
    } catch (e) {
      if (/erifica/.test(e.message || '')) { toast('Verifica tu correo antes de suscribirte 📧'); closeSheet(); return; }
      if (FLOW[plan]) { window.open(FLOW[plan], '_blank', 'noopener'); return; } // respaldo: botón de pago
      toast(e.message || 'No se pudo iniciar el pago'); return;
    }
  }
  const url = FLOW[plan];
  if (!url) { toast('Pago no configurado'); return; }
  window.open(url, '_blank', 'noopener');
}

/* =========================== MODAL / SHEET ========================== */
function openSheet(title, body) {
  $('#modal-root').innerHTML = `<div class="overlay" id="overlay"><div class="sheet" onclick="event.stopPropagation()">
    <div class="grip"></div><h3>${esc(title)}</h3>${body}</div></div>`;
  $('#overlay').onclick = closeSheet;
}
const closeSheet = () => { $('#modal-root').innerHTML = ''; };
function segBind(sel) { $$(sel + ' button').forEach(b => b.onclick = () => { $$(sel + ' button').forEach(x => x.classList.remove('on')); b.classList.add('on'); }); }
function segVal(sel) { const on = $(sel + ' button.on'); return on ? on.dataset.v : null; }

/* =========================== NOTIFICACIONES ======================== */
function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64); const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
async function enablePush(interactive) {
  if (!CLOUD) { if (interactive) toast('Disponible con la app en la nube'); return; }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    if (interactive) toast('Este dispositivo no soporta notificaciones'); return;
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { if (interactive) toast('Activa el permiso de notificaciones'); return; }
    const reg = await navigator.serviceWorker.ready;
    const { key } = await Cloud.vapid();
    if (!key) { if (interactive) toast('El servidor aún no tiene push configurado'); return; }
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
    await Cloud.subscribePush(sub.toJSON());
    localStorage.setItem('copaz.pushOn', '1');
    if (interactive) toast('Notificaciones activadas 🔔');
  } catch (e) { if (interactive) toast('No se pudo activar: ' + (e.message || '')); }
}

/* Exponer para onclick inline */
Object.assign(window, {
  enablePush,
  go, renderAuth, calMove, modalDia, modalEvento, delEvento, modalEsquema, modalGasto, saldar, saldarTodo,
  modalHijo, modalHijoVer, delHijo, modalDoc, delDoc, modalAjustes, closeSheet, exportarMensajes, cerrarSesion,
  modalProponerSwap, acceptSwap, rejectSwap, suavizarMensaje, exportarGastosCSV,
  modalPlanes, iniciarPrueba, irAFlow, modalBitacora, modalNota, delNota, reenviarVerificacion, alternarTema,
  verImagen, verImagenDoc, verReciboGasto, verImagenMensaje,
  modalAbono, delAbono, exportarGastosPDF, exportarMensajesPDF,
  modalCambiarClave, modalActividad, modalCalendario, copiarTexto, viewGastos, viewMensajes,
  viewTareas, modalTarea, toggleTarea, delTarea, modalHorario, ttAdd, ttDel, cargarDatosColegio,
  exportarTareasPDF, exportarColegioPDF, verImagenHijoDoc, modalAgenda, modalAyuda, modalEliminarCuenta,
});
