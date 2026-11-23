import { Router } from 'express';
import { query, tx } from '../db.js';
import { wrap, badRequest, notFound } from '../errors.js';
import { requirePM } from '../auth.js';
import { isPM, taskScope } from '../access.js';
import { LOG_MINUTES } from '../taskQueries.js';

const router = Router();

// PM sees all projects; others see projects their team works on. Counts follow each person's task scope.
router.get('/', wrap(async (req, res) => {
  const u = req.user;
  const [scope, params] = taskScope(u, 1);
  const filter = isPM(u) ? '' : `WHERE EXISTS (SELECT 1 FROM project_teams x WHERE x.project_id = p.id AND x.team_id = $${params.length + 1})`;
  if (!isPM(u)) params.push(u.team_id);
  const { rows } = await query(`
    SELECT p.*,
      COALESCE((SELECT json_agg(json_build_object('id', tm.id, 'name', tm.name, 'type', tm.type) ORDER BY tm.id)
        FROM project_teams pt JOIN teams tm ON tm.id = pt.team_id WHERE pt.project_id = p.id), '[]') AS teams,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.parent_task_id IS NULL AND ${scope})::int AS total,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.parent_task_id IS NULL AND t.status = 'COMPLETED' AND ${scope})::int AS done,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.due_date < CURRENT_DATE AND t.status NOT IN ('COMPLETED','CANCELLED') AND ${scope})::int AS overdue,
      COALESCE((SELECT SUM(${LOG_MINUTES}) FROM time_logs l JOIN tasks t ON t.id = l.task_id WHERE t.project_id = p.id AND ${scope}), 0)::int AS minutes
    FROM projects p ${filter} ORDER BY p.status, p.created_at DESC`, params);
  res.json(rows.map((p) => ({
    id: p.id, key: p.key, name: p.name, description: p.description, startDate: p.start_date, endDate: p.end_date,
    status: p.status, teams: p.teams, tasks: { total: p.total, done: p.done, overdue: p.overdue }, minutesLogged: p.minutes,
  })));
}));

function validate(b) {
  const name = String(b.name || '').trim();
  const key = String(b.key || '').trim().toUpperCase();
  if (!name) throw badRequest('Project name is required.');
  if (!/^[A-Z][A-Z0-9]{1,5}$/.test(key)) throw badRequest('Key must be 2 to 6 letters or digits, starting with a letter (for example WR).');
  const status = b.status || 'ACTIVE';
  if (!['ACTIVE', 'ON_HOLD', 'DONE'].includes(status)) throw badRequest('Unknown project status.');
  const startDate = b.startDate || null;
  const endDate = b.endDate || null;
  if (startDate && endDate && startDate > endDate) throw badRequest('Start date must be before the end date.');
  const teamIds = Array.isArray(b.teamIds) ? b.teamIds.map(Number) : [];
  return { name, key, status, startDate, endDate, description: String(b.description || ''), teamIds };
}

async function setTeams(db, projectId, teamIds) {
  await db.query('DELETE FROM project_teams WHERE project_id = $1 AND NOT (team_id = ANY($2::int[]))', [projectId, teamIds]);
  for (const t of teamIds) await db.query('INSERT INTO project_teams VALUES ($1, $2) ON CONFLICT DO NOTHING', [projectId, t]);
}

router.post('/', requirePM, wrap(async (req, res) => {
  const v = validate(req.body || {});
  const id = await tx(async (db) => {
    const dup = await db.query('SELECT 1 FROM projects WHERE key = $1', [v.key]);
    if (dup.rows[0]) throw badRequest('Another project uses that key.');
    const { rows: [p] } = await db.query(
      'INSERT INTO projects (key, name, description, start_date, end_date, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [v.key, v.name, v.description, v.startDate, v.endDate, v.status, req.user.id]);
    await setTeams(db, p.id, v.teamIds);
    return p.id;
  });
  res.status(201).json({ id });
}));

router.patch('/:id', requirePM, wrap(async (req, res) => {
  const id = Number(req.params.id);
  await tx(async (db) => {
    const { rows: [cur] } = await db.query('SELECT * FROM projects WHERE id = $1', [id]);
    if (!cur) throw notFound('Project not found.');
    const v = validate({ key: cur.key, ...req.body });
    if (v.key !== cur.key) throw badRequest('A project key cannot change once tasks use it.');
    const inUse = await db.query('SELECT DISTINCT team_id FROM tasks WHERE project_id = $1 AND NOT (team_id = ANY($2::int[]))', [id, v.teamIds]);
    if (inUse.rows.length) throw badRequest('A team that already has tasks in this project cannot be removed from it.');
    await db.query('UPDATE projects SET name=$1, description=$2, start_date=$3, end_date=$4, status=$5 WHERE id=$6',
      [v.name, v.description, v.startDate, v.endDate, v.status, id]);
    await setTeams(db, id, v.teamIds);
  });
  res.json({ ok: true });
}));

export default router;
