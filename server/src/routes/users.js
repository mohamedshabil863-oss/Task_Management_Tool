import { Router } from 'express';
import { query, tx } from '../db.js';
import { wrap, badRequest, notFound, forbidden } from '../errors.js';
import { requirePM, hashPassword, publicUser } from '../auth.js';
import { isPM } from '../access.js';

const router = Router();

const LIST_SQL = `
  SELECT u.id, u.name, u.email, u.role, u.team_id, u.is_active, u.created_at, t.name AS team_name, t.type AS team_type,
    (SELECT COUNT(*) FROM tasks x WHERE x.assignee_id = u.id AND x.status IN ('TODO','REASSIGN','IN_PROGRESS','QA'))::int AS open_tasks
  FROM users u LEFT JOIN teams t ON t.id = u.team_id`;

// PM: everyone. Lead: own team. Member: own team (names only, used for @mentions).
router.get('/', wrap(async (req, res) => {
  const u = req.user;
  const { rows } = isPM(u)
    ? await query(`${LIST_SQL} ORDER BY u.is_active DESC, u.role, u.name`)
    : await query(`${LIST_SQL} WHERE u.team_id = $1 OR u.role = 'PM' ORDER BY u.role, u.name`, [u.team_id]);
  res.json(rows.map((r) => ({ ...publicUser(r), openTasks: isPM(u) || u.role === 'LEAD' ? r.open_tasks : undefined, createdAt: r.created_at })));
}));

function validate(b, partial = false) {
  const out = {};
  if (!partial || b.name !== undefined) { out.name = String(b.name || '').trim(); if (!out.name) throw badRequest('Name is required.'); }
  if (!partial || b.email !== undefined) {
    out.email = String(b.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.email)) throw badRequest('Enter a valid email.');
  }
  if (!partial || b.role !== undefined) {
    if (!['PM', 'LEAD', 'MEMBER'].includes(b.role)) throw badRequest('Pick a role.');
    out.role = b.role;
  }
  if (!partial || b.teamId !== undefined || b.role !== undefined) out.teamId = b.teamId ? Number(b.teamId) : null;
  if (out.role && out.role !== 'PM' && !out.teamId) throw badRequest('Leads and members need a team.');
  if (out.role === 'PM') out.teamId = null;
  return out;
}

async function syncTeamLead(db, userId, role, teamId) {
  // A team has one lead: making someone LEAD of a team points the team at them.
  await db.query('UPDATE teams SET lead_id = NULL WHERE lead_id = $1 AND id IS DISTINCT FROM $2::int', [userId, role === 'LEAD' ? teamId : null]);
  if (role === 'LEAD') {
    const { rows: [t] } = await db.query('SELECT lead_id FROM teams WHERE id = $1', [teamId]);
    if (t?.lead_id && t.lead_id !== userId) {
      // Previous lead becomes a member so the team never has two leads.
      await db.query("UPDATE users SET role = 'MEMBER' WHERE id = $1", [t.lead_id]);
    }
    await db.query('UPDATE teams SET lead_id = $1 WHERE id = $2', [userId, teamId]);
  }
}

router.post('/', requirePM, wrap(async (req, res) => {
  const v = validate(req.body || {});
  const password = String(req.body?.password || '');
  if (password.length < 8) throw badRequest('The first password needs at least 8 characters.');
  const user = await tx(async (db) => {
    const dup = await db.query('SELECT 1 FROM users WHERE lower(email) = $1', [v.email]);
    if (dup.rows[0]) throw badRequest('Someone already uses that email.');
    const { rows: [r] } = await db.query(
      'INSERT INTO users (name, email, password_hash, role, team_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [v.name, v.email, await hashPassword(password), v.role, v.teamId]);
    await syncTeamLead(db, r.id, v.role, v.teamId);
    const { rows: [full] } = await db.query(`${LIST_SQL} WHERE u.id = $1`, [r.id]);
    return full;
  });
  res.status(201).json(publicUser(user));
}));

router.patch('/:id', requirePM, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const user = await tx(async (db) => {
    const { rows: [cur] } = await db.query('SELECT * FROM users WHERE id = $1', [id]);
    if (!cur) throw notFound('User not found.');
    const v = validate({ name: cur.name, email: cur.email, role: cur.role, teamId: cur.team_id, ...b });
    if (id === req.user.id && (v.role !== 'PM' || b.isActive === false)) throw forbidden('You cannot remove your own PM access.');
    const isActive = b.isActive === undefined ? cur.is_active : !!b.isActive;
    if (v.teamId !== cur.team_id) {
      const open = await db.query("SELECT COUNT(*)::int AS n FROM tasks WHERE assignee_id = $1 AND status IN ('TODO','REASSIGN','IN_PROGRESS','QA')", [id]);
      if (open.rows[0].n) throw badRequest(`Reassign this person's ${open.rows[0].n} open task(s) before moving them to another team.`);
    }
    await db.query('UPDATE users SET name=$1, email=$2, role=$3, team_id=$4, is_active=$5 WHERE id=$6', [v.name, v.email, v.role, v.teamId, isActive, id]);
    if (b.password) {
      if (String(b.password).length < 8) throw badRequest('The new password needs at least 8 characters.');
      await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(String(b.password)), id]);
    }
    if (!isActive) await db.query('UPDATE time_logs SET ended_at = now(), minutes = FLOOR(EXTRACT(EPOCH FROM (now() - started_at)) / 60) WHERE user_id = $1 AND ended_at IS NULL', [id]);
    await syncTeamLead(db, id, isActive ? v.role : null, v.teamId);
    const { rows: [full] } = await db.query(`${LIST_SQL} WHERE u.id = $1`, [id]);
    return full;
  });
  res.json(publicUser(user));
}));

export default router;
