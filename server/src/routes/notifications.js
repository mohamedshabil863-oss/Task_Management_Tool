import { Router } from 'express';
import { query } from '../db.js';
import { wrap } from '../errors.js';

const router = Router();

router.get('/', wrap(async (req, res) => {
  const { rows } = await query(`
    SELECT n.*, (p.key || '-' || t.number) AS task_key FROM notifications n
    LEFT JOIN tasks t ON t.id = n.task_id LEFT JOIN projects p ON p.id = t.project_id
    WHERE n.user_id = $1 ORDER BY n.is_read, n.created_at DESC LIMIT 100`, [req.user.id]);
  res.json(rows.map((n) => ({ id: n.id, type: n.type, message: n.message, isRead: n.is_read, createdAt: n.created_at, taskId: n.task_id, taskKey: n.task_key })));
}));

router.get('/unread-count', wrap(async (req, res) => {
  const { rows: [r] } = await query('SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND NOT is_read', [req.user.id]);
  res.json({ count: r.n });
}));

router.post('/:id/read', wrap(async (req, res) => {
  await query('UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2', [Number(req.params.id), req.user.id]);
  res.json({ ok: true });
}));

router.post('/read-all', wrap(async (req, res) => {
  await query('UPDATE notifications SET is_read = true WHERE user_id = $1', [req.user.id]);
  res.json({ ok: true });
}));

/** "Due tomorrow" reminders; safe to run often, each task is reminded once per due date. */
export async function createDueSoonNotifications() {
  await query(`
    INSERT INTO notifications (user_id, task_id, type, message)
    SELECT t.assignee_id, t.id, 'DUE_SOON', (p.key || '-' || t.number) || ' is due tomorrow: ' || t.title
    FROM tasks t JOIN projects p ON p.id = t.project_id
    WHERE t.due_date = CURRENT_DATE + 1 AND t.assignee_id IS NOT NULL
      AND t.status NOT IN ('COMPLETED', 'CANCELLED')
      AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.task_id = t.id AND n.type = 'DUE_SOON' AND n.created_at >= CURRENT_DATE - 1)`);
}

export default router;
