# 🕊️ Copaz — Guía del proyecto

**Copaz** es una app (PWA) para padres separados que reúne en un solo lugar todo lo de sus hijos: calendario de custodia, gastos compartidos, mensajes y perfiles. Este paquete trae **la app completa + el backend**, listo para probar hoy y para desplegar cuando quieras.

---

## 📁 Qué hay en este paquete

```
copaz/
├── index.html            La app (PWA)
├── app.css               Estilos
├── app.js                Toda la app
├── api-client.js         Conexión con el backend  ← aquí pones tu URL de Railway
├── manifest.webmanifest  Para instalarla como app
├── sw.js                 Funciona offline
├── icons/                Iconos
├── GUIA.md               Este archivo
└── backend/              El servidor (Node + PostgreSQL) para Railway
    ├── src/              Código del servidor
    ├── test/             Pruebas automáticas
    └── README.md         Guía de despliegue en Railway
```

---

## ▶️ Opción 1: Probarla YA (modo local, sin backend)

1. Abre `index.html` en Chrome, Edge o Safari (doble clic).
2. Pulsa **"Ver con datos de ejemplo"** para verla llena.
3. En el móvil o desde Chrome puedes **instalarla**: menú → *Añadir a pantalla de inicio*. Funciona como app nativa, incluso sin internet.

> En modo local, los datos se guardan en ese dispositivo. Perfecto para probar el producto. Para que **los dos padres compartan datos**, sigue la Opción 2.

---

## ☁️ Opción 2: Activar la nube (los dos padres sincronizados)

1. **Despliega el backend en Railway.** Sigue `backend/README.md` (subir a GitHub, añadir PostgreSQL, variables, generar dominio). Como ya usas Railway, son pocos minutos.
2. **Conecta la app.** Abre `api-client.js` y cambia:
   ```js
   API_BASE: '',
   ```
   por tu URL de Railway, por ejemplo:
   ```js
   API_BASE: 'https://copaz-backend-production.up.railway.app',
   ```
3. **Sube la app** a cualquier hosting estático (Railway, Netlify, Vercel, GitHub Pages…). Con eso, la app pasa a **modo nube**: pantalla de login, registro y sincronización en tiempo real.

### Cómo se emparejan los dos padres
1. El **padre A** crea su cuenta → recibe un **código de invitación** de 6 caracteres.
2. Se lo pasa al **padre B**.
3. El **padre B** entra en *"Tengo un código de invitación"*, crea su cuenta con ese código → quedan vinculados y comparten todo al instante.

---

## ✅ Estado actual (probado)

- App completa: inicio, calendario de custodia (5 plantillas), gastos con balance, mensajes con verificador de tono, perfiles de hijos y documentos.
- Backend con login, emparejamiento, sincronización en tiempo real (WebSocket) y seguridad por familia. **18 pruebas automáticas pasando.**
- Funciona en dos modos sin tocar el código de la app: **local** (vacío `API_BASE`) o **nube** (con tu URL).

## 🔜 Siguientes etapas sugeridas
- Notificaciones push.
- Subida real de archivos de documentos.
- Recuperación de contraseña por correo.
- Empaquetado para Play Store / App Store.
