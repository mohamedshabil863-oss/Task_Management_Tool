// Shared SQL for reading tasks with their computed fields (time spent, subtask progress, late flag).
import { STATUS_LABELS } from './access.js';

// Minutes of a time_logs row (alias l); a running timer counts up to now.
export const LOG_MINUTES = `CASE WHEN l.ended_at IS NULL THEN FLOOR(EXTRACT(EPOCH FROM (now() - l.started_at)) / 60) ELSE l.minutes END`;

export const TASK_SELECT = `
  SELECT t.*,
    p.key AS project_key, p.name AS project_name,
    tm.name AS team_name, tm.type AS team_type,
    a.name AS assignee_name, r.name AS reporter_name,
    pt.number AS parent_number, pt.title AS parent_title, pt.assignee_id AS parent_assignee_id,
    COALESCE((SELECT SUM(${LOG_MINUTES}) FROM time_logs l WHERE l.task_id = t.id), 0)::int AS spent_own,
    COALESCE((SELECT SUM(${LOG_MINUTES}) FROM time_logs l JOIN tasks s ON s.id = l.task_id WHERE s.parent_task_id = t.id), 0)::int AS spent_subs,
    (SELECT COUNT(*) FROM tasks s WHERE s.parent_task_id = t.id)::int AS sub_total,
    (SELECT COUNT(*) FROM tasks s WHERE s.parent_task_id = t.id AND s.status IN ('COMPLETED', 'CANCELLED'))::int AS sub_done,
    EXISTS (SELECT 1 FROM time_logs l WHERE l.task_id = t.id AND l.ended_at IS NULL) AS timer_running
  FROM tasks t
  JOIN projects p ON p.id = t.project_id
  JOIN teams tm ON tm.id = t.team_id
  LEFT JOIN users a ON a.id = t.assignee_id
  JOIN users r ON r.id = t.reporter_id
  LEFT JOIN tasks pt ON pt.id = t.parent_task_id`;

// Local date of the server (set TZ in .env to the office time zone), as YYYY-MM-DD.
export const today = () => new Date().toLocaleDateString('en-CA');

export function formatTask(row) {
  const key = `${row.project_key}-${row.number}`;
  const isClosed = row.status === 'COMPLETED' || row.status === 'CANCELLED';
  return {
    id: row.id,
    key,
    title: row.title,
    description: row.description,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status],
    priority: row.priority,
    project: { id: row.project_id, key: row.project_key, name: row.project_name },
    team: { id: row.team_id, name: row.team_name, type: row.team_type },
    assignee: row.assignee_id ? { id: row.assignee_id, name: row.assignee_name } : null,
    reporter: { id: row.reporter_id, name: row.reporter_name },
    parent: row.parent_task_id
      ? { id: row.parent_task_id, key: `${row.project_key}-${row.parent_number}`, title: row.parent_title }
      : null,
    startDate: row.start_date,
    dueDate: row.due_date,
    estimateMinutes: row.estimate_minutes,
    spentMinutes: row.spent_own + row.spent_subs,
    spentOwnMinutes: row.spent_own,
    subtasks: { total: row.sub_total, done: row.sub_done },
    timerRunning: row.timer_running,
    isLate: !!row.due_date && !isClosed && row.due_date < today(),
    statusChangedAt: row.status_changed_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadTaskRow(db, id) {
  const { rows } = await db.query(`${TASK_SELECT} WHERE t.id = $1`, [id]);
  return rows[0] || null;
}
