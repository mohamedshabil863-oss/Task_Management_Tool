import { Router } from 'express';
import { query, tx } from '../db.js';
import { wrap, badRequest, forbidden, notFound } from '../errors.js';
import { assertCanSee, isPM, isLeadOf } from '../access.js';
import { loadTaskRow, LOG_MINUTES, today } from '../taskQueries.js';
import { logActivity } from '../activity.js';

const router = Router();
const TIMER_STATUSES = ['TODO', 'IN_PROGRESS'];

/** Close every running timer on a task (used when it leaves active work). */
export async function stopTimersOnTask(db, taskId) {
  await db.query(
    `UPDATE time_logs SET ended_at = now(), minutes = FLOOR(EXTRACT(EPOCH FROM (now() - started_at)) / 60)
     WHERE task_id = $1 AND ended_at IS NULL`, [taskId]);
}

async function stopUserTimer(db, userId) {
  const { rows } = await db.query(
    `UPDATE time_logs SET ended_at = now(), minutes = FLOOR(EXTRACT(EPOCH FROM (now() - started_at)) / 60)
     WHERE user_id = $1 AND ended_at IS NULL RETURNING id, task_id, minutes`, [userId]);
  return rows[0] || null;
}

const canLogOn = (u, task) => task.assignee_id === u.id || isPM(u);

function formatLog(l) {
  return {
    id: l.id, taskId: l.task_id, taskKey: l.task_key, taskTitle: l.task_title,
    user: { id: l.user_id, name: l.user_name },
    startedAt: l.started_at, endedAt: l.ended_at, minutes: l.live_minutes ?? l.minutes,
    running: !l.ended_at, isManual: l.is_manual, note: l.note, date: l.log_date, createdAt: l.created_at,
  };
}

const LOG_SELECT = `
  SELECT l.*, (${LOG_MINUTES})::int AS live_minutes, to_char(l.started_at, 'YYYY-MM-DD') AS log_date,
         u.name AS user_name, (p.key || '-' || t.number) AS task_key, t.title AS task_title, t.team_id, t.assignee_id
  FROM time_logs l JOIN users u ON u.id = l.user_id JOIN tasks t ON t.id = l.task_id JOIN projects p ON p.id = t.project_id`;

// Running timer for the current user (shown in the header on every page).
router.get('/current', wrap(async (req, res) => {
  const { rows } = await query(`${LOG_SELECT} WHERE l.user_id = $1 AND l.ended_at IS NULL`, [req.user.id]);
  res.json(rows[0] ? formatLog(rows[0]) : null);
}));

router.post('/start', wrap(async (req, res) => {
  const u = req.user;
  const log = await tx(async (db) => {
    const task = await loadTaskRow(db, Number(req.body?.taskId));
    assertCanSee(u, task);
    if (!canLogOn(u, task)) throw forbidden('You can track time only on tasks assigned to you.');
    if (!TIMER_STATUSES.includes(task.status)) throw badRequest('The timer runs only while a task is To Do or In Progress.');
    const stopped = await stopUserTimer(db, u.id); // [A10] one timer at a time
    if (stopped) await logActivity(db, stopped.task_id, u.id, 'stopped the timer', null, `${stopped.minutes} min`);
    const { rows } = await db.query(
      'INSERT INTO time_logs (task_id, user_id, started_at) VALUES ($1, $2, now()) RETURNING id', [task.id, u.id]);
    await logActivity(db, task.id, u.id, 'started the timer');
    const { rows: [l] } = await db.query(`${LOG_SELECT} WHERE l.id = $1`, [rows[0].id]);
    return l;
  });
  res.status(201).json(formatLog(log));
}));

router.post('/stop', wrap(async (req, res) => {
  const stopped = await tx(async (db) => {
    const s = await stopUserTimer(db, req.user.id);
    if (s) await logActivity(db, s.task_id, req.user.id, 'stopped the timer', null, `${s.minutes} min`);
    return s;
  });
  res.json({ stopped: !!stopped, minutes: stopped?.minutes ?? 0 });
}));

// Time entries of one task. Members see their own task's entries; leads and PM see all.
router.get('/task/:taskId', wrap(async (req, res) => {
  const task = await loadTaskRow({ query }, Number(req.params.taskId));
  assertCanSee(req.user, task);
  const { rows } = await query(`${LOG_SELECT} WHERE l.task_id = $1 OR t.parent_task_id = $1 ORDER BY l.started_at DESC`, [task.id]);
  res.json(rows.map(formatLog));
}));

function parseMinutes(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0 || n > 24 * 60) throw badRequest('Time must be between 1 minute and 24 hours.');
  return n;
}
function parseDate(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) throw badRequest('Pick a date.');
  if (v > today()) throw badRequest('You cannot log time for a future date.');
  return v;
}

// Add time by hand, e.g. "1h 30m yesterday".
router.post('/manual', wrap(async (req, res) => {
  const u = req.user;
  const b = req.body || {};
  const minutes = parseMinutes(b.minutes);
  const date = parseDate(b.date);
  const log = await tx(async (db) => {
    const task = await loadTaskRow(db, Number(b.taskId));
    assertCanSee(u, task);
    if (!canLogOn(u, task)) throw forbidden('You can add time only on tasks assigned to you.');
    const { rows } = await db.query(
      `INSERT INTO time_logs (task_id, user_id, started_at, ended_at, minutes, is_manual, note)
       VALUES ($1, $2, $3::date + time '09:00', $3::date + time '09:00' + make_interval(mins => $4), $4, true, $5) RETURNING id`,
      [task.id, u.id, date, minutes, String(b.note || '')]);
    await logActivity(db, task.id, u.id, 'added time by hand', null, `${minutes} min on ${date}`);
    const { rows: [l] } = await db.query(`${LOG_SELECT} WHERE l.id = $1`, [rows[0].id]);
    return l;
  });
  res.status(201).json(formatLog(log));
}));

/** PM: any entry. Lead: entries on their team's tasks. Others: own entries, same day only. */
async function loadEditableLog(db, user, id) {
  const { rows: [l] } = await db.query(`${LOG_SELECT} WHERE l.id = $1`, [id]);
  if (!l) throw notFound('Time entry not found.');
  if (isPM(user) || isLeadOf(user, l.team_id)) return l;
  if (l.user_id === user.id && l.created_at.toLocaleDateString('en-CA') === today()) return l;
  throw forbidden('You can change your own time entries only on the day you added them.');
}

router.patch('/:id', wrap(async (req, res) => {
  const b = req.body || {};
  const log = await tx(async (db) => {
    const l = await loadEditableLog(db, req.user, Number(req.params.id));
    if (!l.ended_at) throw badRequest('Stop the timer before editing this entry.');
    const minutes = b.minutes !== undefined ? parseMinutes(b.minutes) : l.minutes;
    const note = b.note !== undefined ? String(b.note) : l.note;
    await db.query('UPDATE time_logs SET minutes = $1, note = $2, ended_at = started_at + make_interval(mins => $1) WHERE id = $3', [minutes, note, l.id]);
    if (minutes !== l.minutes) await logActivity(db, l.task_id, req.user.id, 'corrected a time entry', `${l.minutes} min`, `${minutes} min`);
    const { rows: [fresh] } = await db.query(`${LOG_SELECT} WHERE l.id = $1`, [l.id]);
    return fresh;
  });
  res.json(formatLog(log));
}));

router.delete('/:id', wrap(async (req, res) => {
  await tx(async (db) => {
    const l = await loadEditableLog(db, req.user, Number(req.params.id));
    await db.query('DELETE FROM time_logs WHERE id = $1', [l.id]);
    await logActivity(db, l.task_id, req.user.id, 'deleted a time entry', `${l.live_minutes} min`, null);
  });
  res.status(204).end();
}));

// Week grid: rows = tasks, columns = days (Mon..Sun).
router.get('/timesheet', wrap(async (req, res) => {
  const u = req.user;
  let userId = req.query.userId ? Number(req.query.userId) : u.id;
  if (userId !== u.id) {
    const { rows: [other] } = await query('SELECT id, team_id FROM users WHERE id = $1', [userId]);
    if (!other) throw notFound('User not found.');
    if (!isPM(u) && !isLeadOf(u, other.team_id)) throw forbidden('You can see only your own timesheet.');
  }
  const ref = /^\d{4}-\d{2}-\d{2}$/.test(req.query.week || '') ? req.query.week : today();
  const { rows: [{ monday }] } = await query(`SELECT to_char(date_trunc('week', $1::date), 'YYYY-MM-DD') AS monday`, [ref]);
  const { rows } = await query(
    `${LOG_SELECT} WHERE l.user_id = $1 AND l.started_at >= $2::date AND l.started_at < $2::date + 7 ORDER BY l.started_at`,
    [userId, monday]);
  const days = [...Array(7)].map((_, i) => {
    const d = new Date(`${monday}T12:00:00`); d.setDate(d.getDate() + i); return d.toLocaleDateString('en-CA');
  });
  const byTask = new Map();
  for (const l of rows) {
    if (!byTask.has(l.task_id)) byTask.set(l.task_id, { taskId: l.task_id, taskKey: l.task_key, taskTitle: l.task_title, days: Object.fromEntries(days.map((d) => [d, 0])), total: 0 });
    const r = byTask.get(l.task_id);
    r.days[l.log_date] = (r.days[l.log_date] || 0) + l.live_minutes;
    r.total += l.live_minutes;
  }
  const dayTotals = Object.fromEntries(days.map((d) => [d, rows.filter((l) => l.log_date === d).reduce((a, l) => a + l.live_minutes, 0)]));
  res.json({
    userId, weekStart: monday, days, rows: [...byTask.values()], dayTotals,
    total: rows.reduce((a, l) => a + l.live_minutes, 0),
    entries: rows.map(formatLog).reverse(),
  });
}));

export default router;
