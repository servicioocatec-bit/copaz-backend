/* Autenticación: hash de contraseñas y tokens JWT. */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const SECRET = () => process.env.JWT_SECRET || 'dev-secret-cambiar';

export const hash    = (pw) => bcrypt.hash(pw, 10);
export const compare = (pw, h) => bcrypt.compare(pw, h);

export function sign(user) {
  return jwt.sign(
    { uid: user.id, email: user.email, family_id: user.family_id, role: user.role },
    SECRET(), { expiresIn: '90d' }
  );
}
export function verify(token) {
  try { return jwt.verify(token, SECRET()); } catch { return null; }
}

/* Middleware Express: exige token válido en Authorization: Bearer <token>. */
export function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const payload = token && verify(token);
  if (!payload) return res.status(401).json({ error: 'No autorizado' });
  req.user = payload;
  next();
}
