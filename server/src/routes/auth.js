import { Router } from 'express';
import { query } from '../db.js';
import { wrap, badRequest, HttpError } from '../errors.js';
import { checkPassword, hashPassword, signToken, requireAuth, publicUser, USER_SQL } from '../auth.js';

const router = Router();

router.post('/login', wrap(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!email || !password) throw badRequest('Enter your email and password.');
  const { rows: [row] } = await query('SELECT id, password_hash, is_active FROM users WHERE lower(email) = $1', [email]);
  if (!row || !(await checkPassword(password, row.password_hash))) throw new HttpError(401, 'Email or password is wrong.');
  if (!row.is_active) throw new HttpError(401, 'This account has been deactivated. Please contact the PM.');
  const { rows: [user] } = await query(USER_SQL, [row.id]);
  res.json({ token: signToken(user), user: publicUser(user) });
}));

router.get('/me', requireAuth, (req, res) => res.json(publicUser(req.user)));

router.post('/change-password', requireAuth, wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 8) throw badRequest('The new password needs at least 8 characters.');
  const { rows: [row] } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await checkPassword(String(currentPassword || ''), row.password_hash))) throw badRequest('Your current password is wrong.');
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(String(newPassword)), req.user.id]);
  res.json({ ok: true });
}));

export default router;
