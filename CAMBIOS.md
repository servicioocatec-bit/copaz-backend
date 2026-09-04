# 🛠️ Cambios aplicados a Copaz

Resumen de las correcciones y mejoras de esta revisión. El smoke test del backend sigue en verde (77/77).

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
