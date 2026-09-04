# 🛠️ Cambios aplicados a Copaz

Resumen de las correcciones y mejoras. Pruebas en verde: **backend 86/86** y **frontend 15/15** (jsdom).

## 📈 Tercera tanda (lo que pude cerrar solo)

- **📊 Métricas de negocio en el admin.** Nuevo `GET /api/admin/stats` + tarjeta en `admin.html`: familias, premium, en prueba, bloqueadas, % de conversión, % de familias con los dos padres, registros de 7/30 días, ingresos de 30 días y totales, pagos confirmados/pendientes.
- **🔒 Respaldo cifrado.** Si defines `BACKUP_PASSPHRASE`, el respaldo diario viaja por correo cifrado con AES-256-GCM (protege los datos de menores). Se descifra con `node backend/descifrar-respaldo.mjs archivo.json.enc "frase"`.
- **🔎 SEO + redes sociales.** Landing e `index` con Open Graph / Twitter Card + JSON-LD (para que al compartir el link salga tarjeta con imagen), `robots.txt` y `sitemap.xml`. **Ojo:** cambia la URL base de esos archivos por tu dominio final cuando lo tengas.

> Pendiente que necesita tu cuenta: **object storage** para las imágenes (mueve las fotos fuera de Postgres). No lo dejé a medias porque sin tu bucket no puedo probar la subida real; lo hacemos juntos cuando tengas las credenciales (R2/S3). El **dominio** y las **capturas de tienda** también dependen de ti.

---

## 🚀 Funciones nuevas (segunda tanda)

- **💳 Pensión de alimentos.** Control mensual de pagos (monto, fecha, medio, estado al día/pendiente). Entra en el informe para tribunal. (Ajustes → Pensión de alimentos)
- **🤝 Registro de entregas.** Deja constancia de cuándo y quién entregó a los niños; respaldo objetivo ante conflictos. (Ajustes → Registro de entregas)
- **🧩 Decisiones conjuntas.** Uno propone (viaje, gasto médico, cambio de colegio) y el otro aprueba/rechaza, con fecha y autor. (Ajustes → Decisiones conjuntas)
- **💬 Invitar por WhatsApp.** Botón que arma el mensaje con el link de la app y el código de invitación (baja la fricción de que entre el segundo padre).
- **⬇️ Descargar mis datos.** Portabilidad: exporta todo el estado de la familia en JSON (endpoint `GET /api/export`).
- **🔒 Allowlist de IP para el admin.** Opcional con `ADMIN_IP_ALLOWLIST`.
- **📄 Informe ampliado.** Ahora el informe para tribunal incluye también pensión, entregas y decisiones, además de custodia/mensajes/gastos/bitácora/actividad.
- Se corrigieron dos bugs latentes: el respaldo (`exportAll`) y el borrado de familia dejaban fuera varias tablas (overrides, recurring, agreements, shopping); ahora incluyen todas.

---

## Primera tanda

## Correcciones

1. **Moneda coherente.** El default pasó de `MXN` a **CLP** (app y base de datos) y el formateo de dinero ahora usa el locale correcto según la moneda de la familia (antes usaba `es-MX` fijo). El selector de moneda muestra CLP primero.

2. **Variables de entorno documentadas.** `ANTHROPIC_API_KEY` (OCR con foto), `OCR_MODEL`, `BACKUP_EMAIL` (respaldo diario) y `PREMIUM_NOTICE_DAYS` ahora están en `.env.example` y en `GUIA.md`. Antes se usaban en el código pero no estaban documentadas → esas funciones quedaban apagadas sin saberlo.

3. **Modelos de OCR reales.** Se quitaron los modelos inexistentes (`claude-sonnet-5`, `claude-opus-5`, etc.) y se dejaron modelos de visión reales, con `OCR_MODEL` como override.

4. **Seguridad del panel admin.** `/admin/backup` ya **no** acepta la clave por query string (`?key=`), solo por cabecera `x-admin-key`. Así la clave no queda en logs ni en el historial del navegador. El panel ya la enviaba por cabecera, así que no se rompe nada.

## Nuevas funciones

5. **Correos de retención de Premium.** Aviso automático **"tu Premium está por vencer"** (X días antes, configurable con `PREMIUM_NOTICE_DAYS`) y **"tu Premium venció"**. Cada aviso se manda una sola vez por período. Requiere `RESEND_API_KEY`.

6. **Informe para abogado/tribunal (PDF).** En **Ajustes → "📄 Informe para abogado/tribunal"**: eliges un período y genera un PDF consolidado con resumen de custodia (noches por cada padre, % del período, excepciones), historial de mensajes, gastos y reembolsos, bitácora y — en modo nube — el registro de actividad. Es el diferenciador que venden las apps líderes del rubro.

7. **Modelo de cobro unificado.** El Premium es **por familia** (un pago cubre a los dos padres), que es como ya funcionaba el código. Se ajustó el copy de la landing y de la app (antes decía "por cada padre", lo que contradecía el código). *Si prefieres cobrar por cada padre, hay que refactorizar el acceso a nivel usuario — avísame y lo hago.*

8. **CI (GitHub Actions).** `.github/workflows/ci.yml` corre `npm test` en cada push y pull request.

## Lo que quedó pendiente (necesita tu cuenta/decisión)

- **Imágenes en object storage (R2/S3).** Hoy las fotos (boletas, docs, mensajes) se guardan en base64 dentro de Postgres; a escala infla la base y encarece Railway. Mover a almacenamiento de objetos necesita que crees el bucket y me pases las credenciales.
- **Dominio propio** (`copaz.app`): es configuración de DNS tuya. Vender desde `*.up.railway.app` resta confianza.
- **Analytics de activación/retención:** requiere elegir y conectar un servicio (PostHog, Plausible, etc.).
- **Capturas para las tiendas:** hay que tomarlas de la app corriendo.
- **CAPTCHA en el registro:** el rate-limit por IP ya está; un CAPTCHA necesita llaves de un proveedor (hCaptcha/Turnstile).

> Nota: el "verificador de tono", el FAQ in-app y el tour de bienvenida **ya existían** en la app (mi primera lectura fue incompleta): el analizador de tono es multi-señal (insultos, tono acusatorio, hostilidad, generalizaciones), no solo una lista de garabatos.
