# 📱 Publicar Copaz en Play Store y App Store

Copaz es una PWA. Para llevarla a las tiendas la "envolvemos" en una app nativa. Requisito previo en ambos casos: **la app debe estar publicada en una URL con HTTPS** (tu dominio en Railway/Netlify/Vercel). Ese dominio es el que se empaqueta.

---

## 🤖 Android (Google Play) — con Bubblewrap (TWA)

Una TWA (Trusted Web Activity) muestra tu PWA a pantalla completa, sin barra de navegador. Es el método oficial de Google.

### Requisitos
- Node.js instalado.
- Java JDK 17 y Android SDK (Bubblewrap ayuda a instalarlos).
- Cuenta de **Google Play Console** (pago único de 25 USD).

### Pasos
1. Instala la herramienta:
   ```bash
   npm install -g @bubblewrap/cli
   ```
2. Inicializa desde tu manifest publicado (o usa el `twa-manifest.json` de esta carpeta como base, cambiando `host` e `iconUrl` por tu dominio real):
   ```bash
   bubblewrap init --manifest https://TU-DOMINIO.com/manifest.webmanifest
   ```
3. Genera el paquete firmado:
   ```bash
   bubblewrap build
   ```
   Esto produce `app-release-signed.aab` (para subir a Play) y una clave de firma (`android.keystore`) — **guárdala muy bien, es única**.
4. **Verifica tu dominio (Digital Asset Links).** Bubblewrap te da un archivo `assetlinks.json`. Súbelo a tu web en:
   `https://TU-DOMINIO.com/.well-known/assetlinks.json`
   Esto elimina la barra del navegador y confirma que la app es tuya.
5. En **Play Console**: crea la app, sube el `.aab`, completa ficha (descripción, capturas, política de privacidad) y envía a revisión.

> Notificaciones push: la TWA las soporta vía web push; se configuran en el backend (siguiente etapa).

---

## 🍎 iOS (App Store)

Apple no acepta una PWA "envuelta" tan directamente; hay que empaquetarla con **PWABuilder** o **Capacitor**.

### Opción rápida — PWABuilder
1. Entra a https://www.pwabuilder.com e ingresa tu URL.
2. Descarga el paquete **iOS**. Genera un proyecto Xcode que carga tu PWA en un `WKWebView`.
3. Ábrelo en **Xcode** (necesitas una Mac), configura el bundle id (ej. `app.copaz.ios`) y firma con tu cuenta de **Apple Developer** (99 USD/año).
4. Sube con Xcode/Transporter a **App Store Connect**, completa la ficha y envía a revisión.

### Consejo para pasar la revisión de Apple
Apple rechaza apps que son "solo un sitio web". Para aprobar, asegúrate de que se sientan nativas: funcionar offline (ya lo hace), notificaciones, e idealmente alguna integración nativa (compartir, contactos). Copaz ya cumple varios de estos puntos gracias a la PWA.

---

## Checklist antes de enviar a cualquiera de las dos
- [ ] App publicada en HTTPS y funcionando.
- [ ] `manifest.webmanifest` con nombre, iconos (192, 512, maskable) y theme color. ✅ ya incluido.
- [ ] Service worker activo (offline). ✅ ya incluido.
- [ ] Política de privacidad publicada (obligatoria en ambas tiendas).
- [ ] Capturas de pantalla (teléfono) y descripción en español.
- [ ] Icono 512×512. ✅ ya incluido en `icons/`.
