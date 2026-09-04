/* Correo transaccional con Resend (https://resend.com), sin dependencias:
   se llama con fetch. Si no hay RESEND_API_KEY, los correos se omiten y la app
   sigue funcionando igual. Mismo enfoque que uso en mis otras apps. */
const RESEND_API_KEY = (process.env.RESEND_API_KEY || '').trim();
const EMAIL_FROM = (process.env.EMAIL_FROM || 'Copaz <onboarding@resend.dev>').trim();

export const mailReady = () => !!RESEND_API_KEY;

export async function enviarCorreo(to, subject, html, attachments) {
  if (!RESEND_API_KEY) return false;
  try {
    const body = { from: EMAIL_FROM, to, subject, html };
    if (attachments && attachments.length) body.attachments = attachments; // [{ filename, content(base64) }]
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.ok;
  } catch { return false; }
}

const wrap = (titulo, cuerpo) => `<div style="font-family:Segoe UI,system-ui,Arial,sans-serif;max-width:520px;margin:auto;color:#0f172a">
  <div style="background:#0d9488;color:#fff;padding:20px;border-radius:16px 16px 0 0"><h1 style="margin:0;font-size:20px">🕊️ Copaz</h1></div>
  <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 16px 16px;padding:22px">
    <h2 style="color:#0f766e;margin-top:0">${titulo}</h2>${cuerpo}
    <p style="color:#94a3b8;font-size:12px;margin-top:24px">Copaz — Coparentalidad en paz.</p></div></div>`;

export const correoBienvenida = (nombre) => wrap(`¡Bienvenido/a, ${nombre}!`,
  `<p>Tu cuenta de Copaz está lista. Ya puedes coordinar todo lo de tus hijos con el otro padre en un solo lugar: calendario de custodia, gastos, mensajes y más.</p>
   <p>Tienes <b>30 días de prueba gratis</b> de Premium. ¡Que lo disfrutes!</p>`);

export const correoReset = (link) => wrap('Restablece tu contraseña',
  `<p>Recibimos una solicitud para cambiar tu contraseña. Haz clic en el botón (válido por 1 hora):</p>
   <p style="text-align:center;margin:22px 0"><a href="${link}" style="background:#0d9488;color:#fff;text-decoration:none;padding:12px 22px;border-radius:12px;font-weight:700">Cambiar mi contraseña</a></p>
   <p style="color:#64748b;font-size:13px">Si no fuiste tú, ignora este correo; tu contraseña seguirá igual.</p>`);

export const correoVerificacion = (nombre, link) => wrap(`Confirma tu correo, ${nombre}`,
  `<p>¡Gracias por unirte a Copaz! Solo falta confirmar tu correo para activar tu cuenta y poder suscribirte.</p>
   <p style="text-align:center;margin:22px 0"><a href="${link}" style="background:#0d9488;color:#fff;text-decoration:none;padding:12px 22px;border-radius:12px;font-weight:700">Verificar mi correo</a></p>
   <p>Tienes <b>30 días de prueba gratis</b> de Premium. ¡Que lo disfrutes!</p>`);

export const correoRecibo = ({ plan, monto, hasta, orden }) => wrap('Recibo de tu pago — Copaz Premium',
  `<p>¡Gracias por tu pago! Tu suscripción <b>Premium ${plan}</b> quedó activa.</p>
   <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
     <tr><td style="padding:8px 0;color:#64748b">Plan</td><td style="padding:8px 0;text-align:right;font-weight:700">Premium ${plan}</td></tr>
     <tr><td style="padding:8px 0;color:#64748b">Monto</td><td style="padding:8px 0;text-align:right;font-weight:700">$${Number(monto).toLocaleString('es-CL')} CLP</td></tr>
     <tr><td style="padding:8px 0;color:#64748b">Válido hasta</td><td style="padding:8px 0;text-align:right;font-weight:700">${hasta}</td></tr>
     <tr><td style="padding:8px 0;color:#64748b">N° de orden</td><td style="padding:8px 0;text-align:right">${orden}</td></tr>
   </table>
   <p style="color:#64748b;font-size:13px">El pago fue procesado por Flow. Si necesitas una boleta/factura, responde a este correo.</p>`);

export const correoPorVencer = ({ nombre, dias, hasta, link }) => wrap('Tu Premium está por vencer',
  `<p>Hola${nombre ? ' ' + nombre : ''}, tu suscripción <b>Premium de Copaz</b> vence ${dias <= 0 ? 'hoy' : (dias === 1 ? 'mañana' : 'en ' + dias + ' días')} (${hasta}).</p>
   <p>Renueva con un clic para no perder el acceso al calendario, los gastos y los mensajes compartidos.</p>
   <p style="text-align:center;margin:22px 0"><a href="${link}" style="background:#0d9488;color:#fff;text-decoration:none;padding:12px 22px;border-radius:12px;font-weight:700">Renovar mi Premium</a></p>
   <p style="color:#64748b;font-size:13px">Recuerda: el pago es por una sola vez, sin cobro automático.</p>`);

export const correoVencido = ({ nombre, link }) => wrap('Tu Premium venció',
  `<p>Hola${nombre ? ' ' + nombre : ''}, tu <b>Premium de Copaz</b> venció. Tus datos siguen guardados y seguros, pero la app quedó en modo de solo lectura hasta que renueves.</p>
   <p style="text-align:center;margin:22px 0"><a href="${link}" style="background:#0d9488;color:#fff;text-decoration:none;padding:12px 22px;border-radius:12px;font-weight:700">Reactivar mi Premium</a></p>
   <p style="color:#64748b;font-size:13px">Un solo pago y vuelves a tener todo activo al instante.</p>`);
