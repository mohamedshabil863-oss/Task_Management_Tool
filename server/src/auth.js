import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { query } from './db.js';
import { HttpError, forbidden } from './errors.js';
import { roleLabel } from './access.js';

const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('Set JWT_SECRET before running in production.');
}

export const hashPassword = (pw) => bcrypt.hash(pw, 10);
export const checkPassword = (pw, hash) => bcrypt.compare(pw, hash);
export const signToken = (user) => jwt.sign({ sub: user.id }, SECRET, { expiresIn: '12h' });

const USER_SQL = `
  SELECT u.id, u.name, u.email, u.role, u.team_id, u.is_active, t.name AS team_name, t.type AS team_type
  FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.id = $1`;

export function publicUser(u) {
  return {
    id: u.id, name: u.name, email: u.email, role: u.role, isActive: u.is_active,
    team: u.team_id ? { id: u.team_id, name: u.team_name, type: u.team_type } : null,
    roleLabel: roleLabel(u, u.team_type),
  };
}

/** Every request re-reads the user, so a deactivated account stops working at once. */
export async function requireAuth(req, _res, next) {
  try {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new HttpError(401, 'Please log in.');
    let payload;
    try { payload = jwt.verify(token, SECRET); } catch { throw new HttpError(401, 'Your session has ended. Please log in again.'); }
    const { rows } = await query(USER_SQL, [payload.sub]);
    const user = rows[0];
    if (!user || !user.is_active) throw new HttpError(401, 'This account is not active.');
    req.user = user;
    next();
  } catch (err) { next(err); }
}

export const requirePM = (req, _res, next) => (req.user.role === 'PM' ? next() : next(forbidden('Only the Project Manager can do this.')));

export { USER_SQL };
