import { Router } from 'express';
import { query } from '../db.js';
import { wrap } from '../errors.js';
import { taskScope, isPM } from '../access.js';
import { TASK_SELECT, formatTask, LOG_MINUTES } from '../taskQueries.js';

const router = Router();

// PM: all teams. Lead: own team. Member: personal "My work". The scope comes from taskScope().
router.get('/', wrap(async (req, res) => {
  const u = req.user;
  const [scope, params] = taskScope(u, 1);
  let where = scope;
  if (req.query.projectId) { params.push(Number(req.query.projectId)); where += ` AND t.project_id = $${params.length}`; }

  const { rows: [counts] } = await query(`
    SELECT
      COUNT(*) FILTER (WHERE t.status IN ('TODO','REASSIGN','IN_PROGRESS','QA'))::int AS open,
      COUNT(*) FILTER (WHERE t.due_date < CURRENT_DATE AND t.status NOT IN ('COMPLETED','CANCELLED'))::int AS overdue,
      COUNT(*) FILTER (WHERE t.status = 'QA')::int AS qa,
      COUNT(*) FILTER (WHERE t.status = 'REASSIGN')::int AS reassign,
      COUNT(*) FILTER (WHERE t.status = 'COMPLETED' AND t.completed_at >= date_trunc('week', now()))::int AS completed_week
    FROM tasks t WHERE ${where}`, params);

  const { rows: byTeamRows } = await query(`
    SELECT tm.id, tm.name, tm.type, l.name AS lead_name, t.status, COUNT(*)::int AS n
    FROM tasks t JOIN teams tm ON tm.id = t.team_id LEFT JOIN users l ON l.id = tm.lead_id
    WHERE ${where} GROUP BY tm.id, tm.name, tm.type, l.name, t.status ORDER BY tm.id`, params);
  const teams = new Map();
  for (const r of byTeamRows) {
    if (!teams.has(r.id)) teams.set(r.id, { id: r.id, name: r.name, type: r.type, lead: r.lead_name, counts: {}, total: 0 });
    const t = teams.get(r.id);
    t.counts[r.status] = r.n;
    t.total += r.n;
  }

  const { rows: soon } = await query(`${TASK_SELECT}
    WHERE ${where} AND t.due_date <= CURRENT_DATE + 3 AND t.status NOT IN ('COMPLETED','CANCELLED')
    ORDER BY t.due_date, t.id LIMIT 10`, params);

  let workload = [];
  if (isPM(u) || u.role === 'LEAD') {
    const wp = isPM(u) ? [] : [u.team_id];
    const { rows } = await query(`
      SELECT u.id, u.name, tm.name AS team,
        COUNT(t.id) FILTER (WHERE t.status IN ('TODO','REASSIGN','IN_PROGRESS'))::int AS open,
        COUNT(t.id) FILTER (WHERE t.status = 'QA')::int AS qa,
        COUNT(t.id) FILTER (WHERE t.due_date < CURRENT_DATE AND t.status NOT IN ('COMPLETED','CANCELLED'))::int AS overdue,
        COUNT(t.id) FILTER (WHERE t.status = 'COMPLETED')::int AS completed,
        COALESCE((SELECT SUM(${LOG_MINUTES}) FROM time_logs l WHERE l.user_id = u.id AND l.started_at >= date_trunc('week', now())), 0)::int AS minutes_week
      FROM users u JOIN teams tm ON tm.id = u.team_id LEFT JOIN tasks t ON t.assignee_id = u.id
      WHERE u.is_active ${isPM(u) ? '' : 'AND u.team_id = $1'}
      GROUP BY u.id, u.name, tm.name, tm.id ORDER BY tm.id, u.name`, wp);
    workload = rows.map((r) => ({ id: r.id, name: r.name, team: r.team, open: r.open, qa: r.qa, overdue: r.overdue, completed: r.completed, minutesThisWeek: r.minutes_week }));
  }

  const { rows: [mine] } = await query(
    `SELECT COALESCE(SUM(${LOG_MINUTES}), 0)::int AS m FROM time_logs l WHERE l.user_id = $1 AND l.started_at >= date_trunc('week', now())`, [u.id]);

  res.json({
    scope: isPM(u) ? 'ALL' : u.role === 'LEAD' ? 'TEAM' : 'ME',
    counts: { open: counts.open, overdue: counts.overdue, qa: counts.qa, reassign: counts.reassign, completedThisWeek: counts.completed_week },
    byTeam: [...teams.values()],
    dueSoon: soon.map(formatTask),
    workload,
    myMinutesThisWeek: mine.m,
  });
}));

export default router;
