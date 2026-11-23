import { Router } from 'express';
import { query, tx } from '../db.js';
import { wrap, badRequest, forbidden, notFound } from '../errors.js';
import {
  taskScope, assertCanSee, canManageTask, canSeeTask, isPM, assertTransition, allowedMoves,
  PRIORITIES, STATUSES, STATUS_LABELS, roleLabel,
} from '../access.js';
import { TASK_SELECT, formatTask, loadTaskRow } from '../taskQueries.js';
import { logActivity, notify, teamLeadId } from '../activity.js';
import { stopTimersOnTask } from './time.js';

const router = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function cleanDate(v, field) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (!DATE_RE.test(v)) throw badRequest(`${field} must be a date (YYYY-MM-DD).`);
  return v;
}
function cleanMinutes(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw badRequest('Estimate must be a whole number of minutes.');
  return n;
}

async function assertAssignable(db, assigneeId, teamId) {
  const { rows } = await db.query('SELECT id FROM users WHERE id = $1 AND team_id = $2 AND is_active', [assigneeId, teamId]);
  if (!rows[0]) throw badRequest('The assignee must be an active member of the task\'s team.');
}

// ---------- List ----------
router.get('/', wrap(async (req, res) => {
  const [scopeSql, params] = taskScope(req.user);
  const where = [scopeSql];
  const add = (sql, value) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };
  const q = req.query;
  if (q.projectId) add('t.project_id = ?', Number(q.projectId));
  if (q.teamId) add('t.team_id = ?', Number(q.teamId));
  if (q.assigneeId) add('t.assignee_id = ?', Number(q.assigneeId));
  if (q.priority && PRIORITIES.includes(q.priority)) add('t.priority = ?', q.priority);
  if (q.status && STATUSES.includes(q.status)) add('t.status = ?', q.status);
  if (q.parentId) add('t.parent_task_id = ?', Number(q.parentId));
  if (q.topLevel === 'true') where.push('t.parent_task_id IS NULL');
  if (q.q) {
    params.push(`%${q.q}%`);
    where.push(`(t.title ILIKE $${params.length} OR (p.key || '-' || t.number) ILIKE $${params.length})`);
  }
  if (q.due === 'overdue') where.push("t.due_date < CURRENT_DATE AND t.status NOT IN ('COMPLETED','CANCELLED')");
  if (q.due === 'week') where.push("t.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7");
  if (q.due === 'none') where.push('t.due_date IS NULL');
  const { rows } = await query(
    `${TASK_SELECT} WHERE ${where.join(' AND ')}
     ORDER BY CASE t.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
              t.due_date NULLS LAST, t.id`,
    params,
  );
  res.json(rows.map(formatTask));
}));

// ---------- Create ----------
router.post('/', wrap(async (req, res) => {
  const u = req.user;
  const b = req.body || {};
  const title = (b.title || '').trim();
  if (!title) throw badRequest('Title is required.');
  const priority = b.priority || 'MEDIUM';
  if (!PRIORITIES.includes(priority)) throw badRequest('Unknown priority.');
  const startDate = cleanDate(b.startDate, 'Start date') ?? null;
  const dueDate = cleanDate(b.dueDate, 'Due date') ?? null;
  if (startDate && dueDate && startDate > dueDate) throw badRequest('Start date must be on or before the due date.');
  const estimate = cleanMinutes(b.estimateMinutes) ?? null;

  const created = await tx(async (db) => {
    let projectId = Number(b.projectId);
    let teamId = Number(b.teamId);
    let assigneeId = b.assigneeId ? Number(b.assigneeId) : null;
    let parentId = b.parentId ? Number(b.parentId) : null;

    if (parentId) {
      const parent = await loadTaskRow(db, parentId);
      assertCanSee(u, parent);
      if (parent.parent_task_id) throw badRequest('A subtask cannot have its own subtasks.'); // [A9]
      projectId = parent.project_id;
      teamId = parent.team_id; // a subtask stays in its parent's team
      if (!canManageTask(u, parent)) {
        // [A11] an assignee may add subtasks under their own task, for themselves only
        if (parent.assignee_id !== u.id) throw forbidden('You can add subtasks only under your own tasks.');
        assigneeId = u.id;
      }
    } else {
      if (!isPM(u) && !(u.role === 'LEAD')) throw forbidden('Only the PM or a team lead can create tasks.');
      if (u.role === 'LEAD') {
        if (teamId && teamId !== u.team_id) throw forbidden('Leads can create tasks only for their own team.');
        teamId = u.team_id;
      }
      if (!projectId || !teamId) throw badRequest('Pick a project and a team.');
      const link = await db.query('SELECT 1 FROM project_teams WHERE project_id = $1 AND team_id = $2', [projectId, teamId]);
      if (!link.rows[0]) throw badRequest('That team is not part of this project. The PM can add it on the Projects page.');
    }
    if (assigneeId) await assertAssignable(db, assigneeId, teamId);

    const num = await db.query('UPDATE projects SET next_number = next_number + 1 WHERE id = $1 RETURNING next_number - 1 AS n', [projectId]);
    if (!num.rows[0]) throw notFound('Project not found.');
    const ins = await db.query(
      `INSERT INTO tasks (project_id, team_id, parent_task_id, number, title, description, priority, assignee_id, reporter_id,
                          start_date, due_date, estimate_minutes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [projectId, teamId, parentId, num.rows[0].n, title, b.description || '', priority, assigneeId, u.id, startDate, dueDate, estimate],
    );
    const id = ins.rows[0].id;
    await logActivity(db, id, u.id, parentId ? 'created the subtask' : 'created the task');
    const row = await loadTaskRow(db, id);
    if (assigneeId) {
      await logActivity(db, id, u.id, 'assigned', null, row.assignee_name);
      await notify(db, assigneeId, id, 'ASSIGNED', `${u.name} assigned you ${row.project_key}-${row.number}: ${title}`, u.id);
    }
    return row;
  });
  res.status(201).json(formatTask(created));
}));

// ---------- Detail ----------
router.get('/:id', wrap(async (req, res) => {
  const u = req.user;
  const row = await loadTaskRow({ query }, Number(req.params.id));
  assertCanSee(u, row);
  const subs = await query(`${TASK_SELECT} WHERE t.parent_task_id = $1 ORDER BY t.number`, [row.id]);
  const visibleSubs = subs.rows.filter((s) => canSeeTask(u, s)).map(formatTask);
  const assignable = await query(
    'SELECT id, name, role FROM users WHERE team_id = $1 AND is_active ORDER BY role, name', [row.team_id],
  );
  const myTimer = await query('SELECT id, started_at FROM time_logs WHERE task_id = $1 AND user_id = $2 AND ended_at IS NULL', [row.id, u.id]);
  const canManage = canManageTask(u, row);
  res.json({
    ...formatTask(row),
    parentVisible: row.parent_task_id ? canSeeTask(u, { team_id: row.team_id, assignee_id: row.parent_assignee_id }) : false,
    subtaskList: visibleSubs,
    hiddenSubtasks: subs.rows.length - visibleSubs.length,
    allowedMoves: allowedMoves(u, row),
    assignableUsers: canManage ? assignable.rows : [],
    myTimer: myTimer.rows[0] ? { id: myTimer.rows[0].id, startedAt: myTimer.rows[0].started_at } : null,
    permissions: {
      edit: canManage,
      delete: isPM(u),
      addSubtask: !row.parent_task_id && (canManage || row.assignee_id === u.id),
      trackTime: row.assignee_id === u.id || isPM(u),
      seeAllTime: canManage,
    },
  });
}));

// ---------- Edit ----------
const EDITABLE = {
  title: { col: 'title', label: 'title' },
  description: { col: 'description', label: 'description' },
  priority: { col: 'priority', label: 'priority' },
  startDate: { col: 'start_date', label: 'start date' },
  dueDate: { col: 'due_date', label: 'due date' },
  estimateMinutes: { col: 'estimate_minutes', label: 'estimate' },
  assigneeId: { col: 'assignee_id', label: 'assignee' },
};

router.patch('/:id', wrap(async (req, res) => {
  const u = req.user;
  const b = req.body || {};
  const updated = await tx(async (db) => {
    const row = await loadTaskRow(db, Number(req.params.id));
    assertCanSee(u, row);
    if (!canManageTask(u, row)) throw forbidden('Only the PM or the team lead can edit this task.');
    const values = {};
    if (b.title !== undefined) { values.title = String(b.title).trim(); if (!values.title) throw badRequest('Title is required.'); }
    if (b.description !== undefined) values.description = String(b.description);
    if (b.priority !== undefined) { if (!PRIORITIES.includes(b.priority)) throw badRequest('Unknown priority.'); values.priority = b.priority; }
    if (b.startDate !== undefined) values.startDate = cleanDate(b.startDate, 'Start date');
    if (b.dueDate !== undefined) values.dueDate = cleanDate(b.dueDate, 'Due date');
    if (b.estimateMinutes !== undefined) values.estimateMinutes = cleanMinutes(b.estimateMinutes);
    if (b.assigneeId !== undefined) {
      values.assigneeId = b.assigneeId ? Number(b.assigneeId) : null;
      if (values.assigneeId) await assertAssignable(db, values.assigneeId, row.team_id);
    }
    const start = values.startDate !== undefined ? values.startDate : row.start_date;
    const due = values.dueDate !== undefined ? values.dueDate : row.due_date;
    if (start && due && start > due) throw badRequest('Start date must be on or before the due date.');

    const sets = [];
    const params = [];
    for (const [field, v] of Object.entries(values)) {
      const { col, label } = EDITABLE[field];
      const old = row[col];
      if ((old ?? null) === (v ?? null)) continue;
      params.push(v);
      sets.push(`${col} = $${params.length}`);
      if (field === 'assigneeId') continue; // logged below with names
      await logActivity(db, row.id, u.id, `changed ${label}`, field === 'description' ? null : old, field === 'description' ? null : v);
    }
    if (!sets.length) return row;
    params.push(row.id);
    await db.query(`UPDATE tasks SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}`, params);
    const fresh = await loadTaskRow(db, row.id);
    if (values.assigneeId !== undefined && values.assigneeId !== row.assignee_id) {
      await logActivity(db, row.id, u.id, 'assigned', row.assignee_name, fresh.assignee_name || 'nobody');
      await notify(db, values.assigneeId, row.id, 'ASSIGNED', `${u.name} assigned you ${fresh.project_key}-${fresh.number}: ${fresh.title}`, u.id);
    }
    return fresh;
  });
  res.json(formatTask(updated));
}));

// ---------- Delete (PM only) ----------
router.delete('/:id', wrap(async (req, res) => {
  if (!isPM(req.user)) throw forbidden('Only the PM can delete tasks. Leads can cancel them instead.');
  const { rowCount } = await query('DELETE FROM tasks WHERE id = $1', [Number(req.params.id)]);
  if (!rowCount) throw notFound('Task not found.');
  res.status(204).end();
}));

// ---------- Status change (the workflow) ----------
const TIMER_STOPS_ON = ['QA', 'REASSIGN', 'COMPLETED', 'CANCELLED'];

router.post('/:id/status', wrap(async (req, res) => {
  const u = req.user;
  const { status: to, comment, assigneeId } = req.body || {};
  const updated = await tx(async (db) => {
    const { rows: locked } = await db.query('SELECT id FROM tasks WHERE id = $1 FOR UPDATE', [Number(req.params.id)]);
    const row = locked[0] ? await loadTaskRow(db, locked[0].id) : null;
    assertCanSee(u, row);
    const rule = assertTransition(u, row, to, { comment, assigneeId });
    if (to === 'COMPLETED' && row.sub_total > row.sub_done) {
      throw badRequest(`Finish the subtasks first: ${row.sub_done} of ${row.sub_total} are Completed or Cancelled.`);
    }
    const key = `${row.project_key}-${row.number}`;
    let newAssignee = row.assignee_id;
    if (rule.needsAssignee) {
      newAssignee = Number(assigneeId);
      await assertAssignable(db, newAssignee, row.team_id);
    }
    await db.query(
      `UPDATE tasks SET status = $1, status_changed_at = now(), updated_at = now(), assignee_id = $2,
         started_at = CASE WHEN $1 = 'IN_PROGRESS' AND started_at IS NULL THEN now() ELSE started_at END,
         completed_at = CASE WHEN $1 = 'COMPLETED' THEN now() ELSE NULL END
       WHERE id = $3`,
      [to, newAssignee, row.id],
    );
    if (TIMER_STOPS_ON.includes(to)) await stopTimersOnTask(db, row.id);
    await logActivity(db, row.id, u.id, 'changed status', STATUS_LABELS[row.status], STATUS_LABELS[to]);
    if (comment && comment.trim()) {
      await db.query('INSERT INTO comments (task_id, user_id, body) VALUES ($1, $2, $3)',
        [row.id, u.id, `[${STATUS_LABELS[row.status]} → ${STATUS_LABELS[to]}] ${comment.trim()}`]);
    }
    if (newAssignee !== row.assignee_id) {
      const { rows: [a] } = await db.query('SELECT name FROM users WHERE id = $1', [newAssignee]);
      await logActivity(db, row.id, u.id, 'assigned', row.assignee_name, a.name);
      await notify(db, newAssignee, row.id, 'ASSIGNED', `${u.name} assigned you ${key}: ${row.title}`, u.id);
    }
    const qaResult = row.status === 'QA' && (to === 'COMPLETED' || to === 'IN_PROGRESS');
    await notify(db, newAssignee, row.id, qaResult ? 'QA_RESULT' : 'STATUS',
      qaResult ? `${key} ${to === 'COMPLETED' ? 'passed QA and is Completed' : 'failed QA and is back In Progress'}`
        : `${u.name} moved ${key} to ${STATUS_LABELS[to]}`, u.id);
    if (to === 'REASSIGN' || to === 'QA') {
      const lead = await teamLeadId(db, row.team_id);
      if (lead !== newAssignee) {
        await notify(db, lead, row.id, 'STATUS', to === 'QA'
          ? `${key} is ready for QA: ${row.title}` : `${u.name} sent ${key} back (Re Assign): ${row.title}`, u.id);
      }
    }
    return loadTaskRow(db, row.id);
  });
  res.json(formatTask(updated));
}));

// ---------- Comments ----------
router.get('/:id/comments', wrap(async (req, res) => {
  const row = await loadTaskRow({ query }, Number(req.params.id));
  assertCanSee(req.user, row);
  const { rows } = await query(
    `SELECT c.id, c.body, c.created_at, c.edited_at, u.id AS user_id, u.name, u.role, tm.type AS team_type
     FROM comments c JOIN users u ON u.id = c.user_id LEFT JOIN teams tm ON tm.id = u.team_id
     WHERE c.task_id = $1 ORDER BY c.created_at`, [row.id]);
  res.json(rows.map((c) => ({
    id: c.id, body: c.body, createdAt: c.created_at, editedAt: c.edited_at,
    author: { id: c.user_id, name: c.name, roleLabel: roleLabel(c, c.team_type) },
  })));
}));

router.post('/:id/comments', wrap(async (req, res) => {
  const u = req.user;
  const body = String(req.body?.body || '').trim();
  if (!body) throw badRequest('Write a comment first.');
  const result = await tx(async (db) => {
    const row = await loadTaskRow(db, Number(req.params.id));
    assertCanSee(u, row);
    const { rows: [c] } = await db.query('INSERT INTO comments (task_id, user_id, body) VALUES ($1,$2,$3) RETURNING id, created_at', [row.id, u.id, body]);
    await logActivity(db, row.id, u.id, 'commented');
    const key = `${row.project_key}-${row.number}`;
    // @mentions: notify each mentioned person who can see the task.
    const { rows: people } = await db.query('SELECT id, name, role, team_id FROM users WHERE is_active');
    const mentioned = new Set();
    for (const p of people) {
      if (body.toLowerCase().includes(`@${p.name.toLowerCase()}`) && canSeeTask(p, row)) {
        mentioned.add(p.id);
        await notify(db, p.id, row.id, 'MENTION', `${u.name} mentioned you on ${key}: "${body.slice(0, 80)}"`, u.id);
      }
    }
    if (row.assignee_id && !mentioned.has(row.assignee_id)) {
      await notify(db, row.assignee_id, row.id, 'COMMENT', `${u.name} commented on ${key}`, u.id);
    }
    return c;
  });
  res.status(201).json({ id: result.id, createdAt: result.created_at });
}));

// ---------- Activity log ----------
router.get('/:id/activity', wrap(async (req, res) => {
  const row = await loadTaskRow({ query }, Number(req.params.id));
  assertCanSee(req.user, row);
  const { rows } = await query(
    `SELECT a.id, a.action, a.old_value, a.new_value, a.created_at, u.name
     FROM task_activity a JOIN users u ON u.id = a.user_id WHERE a.task_id = $1 ORDER BY a.created_at DESC, a.id DESC`, [row.id]);
  res.json(rows.map((a) => ({ id: a.id, action: a.action, oldValue: a.old_value, newValue: a.new_value, createdAt: a.created_at, user: a.name })));
}));

export default router;
