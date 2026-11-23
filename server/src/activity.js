// Helpers for the activity log [A8] and in-app notifications.
export async function logActivity(db, taskId, userId, action, oldValue = null, newValue = null) {
  await db.query(
    'INSERT INTO task_activity (task_id, user_id, action, old_value, new_value) VALUES ($1, $2, $3, $4, $5)',
    [taskId, userId, action, oldValue == null ? null : String(oldValue), newValue == null ? null : String(newValue)],
  );
}

export async function notify(db, userId, taskId, type, message, actorId) {
  if (!userId || userId === actorId) return; // never notify people about their own actions
  await db.query('INSERT INTO notifications (user_id, task_id, type, message) VALUES ($1, $2, $3, $4)', [userId, taskId, type, message]);
}

/** Lead of a team, if any. */
export async function teamLeadId(db, teamId) {
  const { rows } = await db.query('SELECT lead_id FROM teams WHERE id = $1', [teamId]);
  return rows[0]?.lead_id || null;
}
