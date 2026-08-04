# Copaz — Backend

API en **Node + Express + PostgreSQL** con sincronización en tiempo real (WebSocket) para que los dos padres vean lo mismo desde teléfonos distintos.

Incluye: registro/login con contraseña cifrada y token de sesión (JWT), emparejamiento de la pareja de padres mediante código de invitación, API para hijos, eventos, gastos, documentos y mensajes, y difusión de cambios en vivo.

---

## 1. Probar en tu computadora (opcional)

```bash
cd backend
npm install
cp .env.example .env      # edita DATABASE_URL y JWT_SECRET
npm start                 # arranca en http://localhost:3000
npm test                  # ejecuta la prueba de humo (no necesita Postgres real)
```

`npm test` usa una base de datos en memoria, así que verifica toda la lógica sin instalar Postgres.

---

## 2. Desplegar en Railway (paso a paso)

1. **Sube el código a GitHub.** Crea un repo nuevo (ej. `copaz-backend`) y sube el contenido de la carpeta `backend/`.

2. **Crea el proyecto en Railway.** En railway.app → *New Project* → *Deploy from GitHub repo* → elige tu repo.

3. **Añade PostgreSQL.** Dentro del proyecto → *New* → *Database* → *Add PostgreSQL*. Railway crea la base y la variable `DATABASE_URL`.

4. **Configura las variables.** En el servicio del backend → pestaña *Variables*, añade:
   - `DATABASE_URL` → valor: `${{ Postgres.DATABASE_URL }}` (referencia a la base que creaste)
   - `JWT_SECRET` → una cadena larga y aleatoria (ej. genera una con un gestor de contraseñas)
   - `CORS_ORIGIN` → `*` mientras pruebas (luego el dominio real de tu app)

5. **Despliega.** Railway detecta Node automáticamente y ejecuta `npm start`. Las tablas se crean solas en el primer arranque.

6. **Consigue tu URL pública.** En *Settings → Networking → Generate Domain*. Te queda algo como
   `https://copaz-backend-production.up.railway.app`. Ábrela: deberías ver `{"app":"Copaz API","status":"ok"}`.

---

## 3. Conectar la app (frontend) al backend

1. Copia `public-api-client.js` a la carpeta de la app (junto a `app.js`).
2. En ese archivo cambia `API_BASE` por tu URL de Railway.
3. Inclúyelo en `index.html` **antes** de `app.js`:
   ```html
   <script src="public-api-client.js"></script>
   <script src="app.js" defer></script>
   ```
4. El siguiente paso de desarrollo es cambiar en `app.js` las llamadas a `DB.save()` por las del objeto `Cloud`
   (registro, login, `Cloud.create(...)`, `Cloud.sendMessage(...)`, etc.) y suscribirse a `Cloud.connect()` para
   recibir los cambios en vivo. *(Esta parte la hacemos juntos en la siguiente iteración.)*

---

## Flujo de emparejamiento de los dos padres

1. El **padre A** se registra → recibe un **código de invitación** de 6 caracteres.
2. Le pasa ese código al **padre B** (por WhatsApp, en persona, como sea).
3. El **padre B** se registra y usa *unir familia* con el código → quedan vinculados y comparten todo.

---

## Endpoints principales

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/register` | Crea usuario + familia + código de invitación |
| POST | `/api/auth/login` | Inicia sesión |
| POST | `/api/family/join` | Une al otro padre con el código |
| GET | `/api/state` | Estado completo de la familia |
| PATCH | `/api/family` | Moneda, esquema de custodia, nombres |
| POST/PATCH/DELETE | `/api/{kids\|events\|expenses\|docs}` | CRUD de cada entidad |
| POST | `/api/messages` | Envía mensaje (inmutable) |
| WS | `/ws?token=...` | Canal de sincronización en tiempo real |

---

## Seguridad incluida

- Contraseñas cifradas con bcrypt (nunca se guardan en texto plano).
- Sesiones con JWT firmado; cada petición valida el token.
- Cada usuario solo puede leer/escribir datos de **su** familia.
- Los mensajes no se pueden editar ni borrar (registro íntegro).

## Siguiente etapa sugerida

- Notificaciones push (web push / Firebase Cloud Messaging).
- Subida real de archivos de documentos (Railway Volumes o almacenamiento S3/R2).
- Recuperación de contraseña por correo.
