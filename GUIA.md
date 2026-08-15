# 🕊️ Copaz — Guía completa

App para padres separados (PWA) con backend, pagos con Flow, prueba/bloqueo y panel de administrador.
Este zip trae **todo**: la app, el backend, la landing, los legales y el panel admin.

---

## 📁 Contenido

```
copaz/
├── index.html            La app (PWA)
├── app.js / app.css      Toda la app y estilos
├── api-client.js         Conexión con el backend  ← aquí va tu URL de Railway
├── manifest.webmanifest  Instalable
├── sw.js                 Offline + notificaciones push
├── icons/                Iconos
├── landing.html          Página de venta (pública)
├── terminos.html         Términos y Condiciones
├── privacidad.html       Política de Privacidad
├── admin.html            Panel de administración (activar cuentas)
└── backend/              Servidor Node + PostgreSQL (Railway)
    ├── src/              server, routes, db, auth, flow, mail
    ├── test/             pruebas automáticas (35 en verde)
    └── README.md         Guía de despliegue del backend
```

---

## ✅ Qué incluye (todo probado)

- Registro/login, emparejamiento de los dos padres, **sincronización en tiempo real**.
- Calendario de custodia (5 plantillas) + **intercambios de días**.
- Gastos compartidos con balance, resumen mensual, **CSV** y edición.
- Mensajes con **verificador de tono**, **bitácora**, perfiles de hijos con **horario escolar**.
- **Notificaciones push** (VAPID).
- **Recuperar contraseña** + **correos** (Resend).
- **Pagos con Flow** (pago único mensual/anual; al pagar, Premium se activa solo; sin cobro recurrente).
- **Prueba de 30 días** controlada por el servidor + **bloqueo (paywall)** al vencer.
- **Panel de administrador** (`admin.html`) para activar cuentas a mano.
- Landing de venta + Términos + Privacidad.

---

## 🚀 Desplegar (resumen)

### 1. Frontend + Backend
Sube **toda la carpeta `copaz`** a tu repo de GitHub conectado a Railway.
Railway redespliega solo el backend (`copaz-backend`) y el frontend (sitio estático).

### 2. Variables en Railway → servicio `copaz-backend` → Variables
Ya deberías tener: `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN`, `VAPID_*`, `PUBLIC_URL`, `FRONTEND_URL`, `FLOW_BASE_URL`.
Agrega/confirma (las secretas las pegas tú):

```
FLOW_API_KEY=<las MISMAS de producción que usa Acopia>
FLOW_SECRET_KEY=<las MISMAS de producción que usa Acopia>
ADMIN_KEY=<cadena larga y secreta, para el panel admin>
RESEND_API_KEY=<tu llave de Resend, para correos>   (opcional)
EMAIL_FROM=Copaz <onboarding@resend.dev>
TRIAL_DAYS=30
```

### 3. Conectar la app al backend
En `api-client.js`, `API_BASE` ya apunta a tu backend de Railway. Los links de Flow (`FLOW_ANUAL`, `FLOW_MENSUAL`) son el respaldo por si el API falla.

---

## 🔗 Tus URLs

- App: `https://accomplished-prosperity-production-5a5c.up.railway.app`
- Landing (venta): `.../landing.html`
- **Panel admin**: `.../admin.html`  (entras con tu `ADMIN_KEY`)
- Backend: `https://copaz-backend-production.up.railway.app`

---

## 💳 Cómo funcionan los pagos

- La persona toca **Suscribirme** → Flow genera el pago → al pagar, **Premium se activa solo** (webhook). Un pago por período, **sin renovación automática**.
- Nota: Flow valida que el correo sea **real**. Por eso conviene **verificación de correo** al registrarse (recomendado antes de vender).
- Si algún día quieres activar a mano, usas **`admin.html`**: buscas por correo y activas mensual/anual con un clic.

---

## 🔜 Recomendado antes de vender

- Dominio propio (ej. `copaz.app`).
- Verificación de correo al registrarse.
- Respaldos automáticos de la base (Railway).
