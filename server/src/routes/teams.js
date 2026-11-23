import { Router } from 'express';
import { query } from '../db.js';
import { wrap, badRequest, notFound } from '../errors.js';
import { requirePM } from '../auth.js';
import { isPM } from '../access.js';

const router = Router();

router.get('/', wrap(async (req, res) => {
  const { rows } = await query(`
    SELECT t.id, t.name, t.type, t.lead_id, l.name AS lead_name,
      (SELECT COUNT(*) FROM users u WHERE u.team_id = t.id AND u.is_active)::int AS members
    FROM teams t LEFT JOIN users l ON l.id = t.lead_id
    ${isPM(req.user) ? '' : 'WHERE t.id = $1'} ORDER BY t.id`, isPM(req.user) ? [] : [req.user.team_id]);
  res.json(rows.map((t) => ({ id: t.id, name: t.name, type: t.type, lead: t.lead_id ? { id: t.lead_id, name: t.lead_name } : null, members: t.members })));
}));

router.post('/', requirePM, wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const type = req.body?.type || 'OTHER';
  if (!name) throw badRequest('Team name is required.');
  if (!['FRONTEND', 'BACKEND', 'HR', 'OTHER'].includes(type)) throw badRequest('Unknown team type.');
  const dup = await query('SELECT 1 FROM teams WHERE lower(name) = lower($1)', [name]);
  if (dup.rows[0]) throw badRequest('A team with that name exists.');
  const { rows: [t] } = await query('INSERT INTO teams (name, type) VALUES ($1, $2) RETURNING *', [name, type]);
  res.status(201).json({ id: t.id, name: t.name, type: t.type, lead: null, members: 0 });
}));

router.patch('/:id', requirePM, wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) throw badRequest('Team name is required.');
  const { rowCount } = await query('UPDATE teams SET name = $1 WHERE id = $2', [name, Number(req.params.id)]);
  if (!rowCount) throw notFound('Team not found.');
  res.json({ ok: true });
}));

export default router;
