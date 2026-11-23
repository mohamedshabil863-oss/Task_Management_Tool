// API tests for the role and workflow rules. They reset the database to the demo data first,
// so run them against a test database: DATABASE_URL=postgres://.../taskboard_test npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';

let server;
let base;
const tokens = {};

before(async () => {
  execFileSync(process.execPath, [fileURLToPath(new URL('../src/seed.js', import.meta.url)), '--reset'], { stdio: 'ignore' });
  server = createApp().listen(0);
  base = `http://localhost:${server.address().port}/api`;
  for (const who of ['pm', 'meera', 'arjun', 'divya', 'anu', 'vishnu', 'rahul', 'nisha']) {
    const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${who}@taskboard.local`, password: 'password123' }) });
    tokens[who] = (await r.json()).token;
  }
});
after(async () => { server.close(); await pool.end(); });

async function api(who, method, path, body) {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}
const findTask = async (who, title) => (await api(who, 'GET', `/tasks?q=${encodeURIComponent(title)}`)).body.find((t) => t.title === title);

test('login rejects a wrong password and requests without a token', async () => {
  const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'pm@taskboard.local', password: 'nope' }) });
  assert.equal(r.status, 401);
  assert.equal((await api(null, 'GET', '/tasks')).status, 401);
});

test('each role sees only its scope', async () => {
  const all = (await api('pm', 'GET', '/tasks')).body;
  const meera = (await api('meera', 'GET', '/tasks')).body;
  const anu = (await api('anu', 'GET', '/tasks')).body;
  const nisha = (await api('nisha', 'GET', '/tasks')).body;
  assert.ok(all.some((t) => t.team.type === 'HR') && all.some((t) => t.team.type === 'BACKEND'));
  assert.ok(meera.length > 0 && meera.every((t) => t.team.type === 'FRONTEND'));
  assert.ok(anu.length > 0 && anu.every((t) => t.assignee?.name === 'Anu'));
  assert.ok(nisha.every((t) => t.team.type === 'HR' && t.assignee?.name === 'Nisha'));
});

test('a junior cannot open another team\'s or HR task by its link', async () => {
  const hrTask = await findTask('pm', 'Update leave policy document');
  const beTask = await findTask('pm', 'Create tasks API endpoints');
  assert.equal((await api('anu', 'GET', `/tasks/${hrTask.id}`)).status, 404);
  assert.equal((await api('meera', 'GET', `/tasks/${beTask.id}`)).status, 404);
  assert.equal((await api('arjun', 'GET', `/tasks/${hrTask.id}`)).status, 404);
  assert.equal((await api('divya', 'GET', `/tasks/${hrTask.id}`)).status, 200);
});

test('only PM and leads create tasks; leads only for their team', async () => {
  const projects = (await api('pm', 'GET', '/projects')).body;
  const wr = projects.find((p) => p.key === 'WR');
  const teams = (await api('pm', 'GET', '/teams')).body;
  const be = teams.find((t) => t.type === 'BACKEND');
  const fe = teams.find((t) => t.type === 'FRONTEND');
  assert.equal((await api('anu', 'POST', '/tasks', { title: 'x', projectId: wr.id, teamId: fe.id })).status, 403);
  assert.equal((await api('meera', 'POST', '/tasks', { title: 'x', projectId: wr.id, teamId: be.id })).status, 403);
  const ok = await api('meera', 'POST', '/tasks', { title: 'Lead task', projectId: wr.id, teamId: fe.id, dueDate: '2099-01-01' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.team.type, 'FRONTEND');
  assert.match(ok.body.key, /^WR-\d+$/);
});

test('a junior adds subtasks only under their own task, for themselves', async () => {
  const own = await findTask('anu', 'Drag and drop for kanban');
  const r = await api('anu', 'POST', '/tasks', { title: 'Touch support', parentId: own.id, assigneeId: (await api('pm', 'GET', '/users')).body.find((u) => u.name === 'Vishnu').id });
  assert.equal(r.status, 201);
  assert.equal(r.body.assignee.name, 'Anu');
  const sub = await api('anu', 'POST', '/tasks', { title: 'Too deep', parentId: r.body.id });
  assert.equal(sub.status, 400); // one level only
  const notMine = await findTask('pm', 'Task detail side panel');
  assert.equal((await api('anu', 'POST', '/tasks', { title: 'x', parentId: notMine.id })).status, 404);
});

test('status workflow: juniors cannot approve, comments are required where the doc says', async () => {
  const panel = await findTask('vishnu', 'Task detail side panel'); // in QA
  assert.equal((await api('vishnu', 'POST', `/tasks/${panel.id}/status`, { status: 'COMPLETED' })).status, 403);
  const fail = await api('meera', 'POST', `/tasks/${panel.id}/status`, { status: 'IN_PROGRESS' });
  assert.equal(fail.status, 400);
  assert.equal(fail.body.commentRequired, true);
  assert.equal((await api('meera', 'POST', `/tasks/${panel.id}/status`, { status: 'IN_PROGRESS', comment: 'Close button missing' })).status, 200);
  assert.equal((await api('vishnu', 'POST', `/tasks/${panel.id}/status`, { status: 'QA' })).status, 200);
  const done = await api('meera', 'POST', `/tasks/${panel.id}/status`, { status: 'COMPLETED' });
  assert.equal(done.status, 200);
  assert.ok(done.body.completedAt);
  assert.equal((await api('vishnu', 'POST', `/tasks/${panel.id}/status`, { status: 'IN_PROGRESS' })).status, 403); // reopen is lead/PM
  // Cancelled -> To Do is PM only
  const lead = await findTask('meera', 'Dark mode (moved to v2)');
  assert.equal((await api('meera', 'POST', `/tasks/${lead.id}/status`, { status: 'TODO' })).status, 403);
  assert.equal((await api('pm', 'POST', `/tasks/${lead.id}/status`, { status: 'TODO' })).status, 200);
});

test('Re Assign needs a reason, and back to To Do needs a new assignee', async () => {
  const t = await findTask('vishnu', 'Forgot password screen');
  assert.equal((await api('vishnu', 'POST', `/tasks/${t.id}/status`, { status: 'REASSIGN' })).status, 400);
  assert.equal((await api('vishnu', 'POST', `/tasks/${t.id}/status`, { status: 'REASSIGN', comment: 'Need designs' })).status, 200);
  assert.equal((await api('meera', 'POST', `/tasks/${t.id}/status`, { status: 'TODO' })).status, 400);
  const anuId = (await api('meera', 'GET', '/users')).body.find((u) => u.name === 'Anu').id;
  const r = await api('meera', 'POST', `/tasks/${t.id}/status`, { status: 'TODO', assigneeId: anuId });
  assert.equal(r.status, 200);
  assert.equal(r.body.assignee.name, 'Anu');
  const notes = (await api('meera', 'GET', '/notifications')).body;
  assert.ok(notes.some((n) => n.message.includes('sent') && n.message.includes('back')));
});

test('a parent completes only after all subtasks are done', async () => {
  const rbac = await findTask('arjun', 'Role-based access middleware');
  await api('rahul', 'POST', `/tasks/${rbac.id}/status`, { status: 'QA' });
  const r = await api('arjun', 'POST', `/tasks/${rbac.id}/status`, { status: 'COMPLETED' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /subtasks/);
});

test('one timer per person, and the timer stops when the task moves to QA', async () => {
  const a = await findTask('anu', 'Build login page UI');
  const b = await findTask('anu', 'Drag and drop for kanban');
  assert.equal((await api('anu', 'POST', '/time/start', { taskId: a.id })).status, 201);
  assert.equal((await api('anu', 'POST', '/time/start', { taskId: b.id })).status, 201);
  const cur = (await api('anu', 'GET', '/time/current')).body;
  assert.equal(cur.taskId, b.id);
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM time_logs WHERE user_id = (SELECT id FROM users WHERE name = $1) AND ended_at IS NULL', ['Anu']);
  assert.equal(rows[0].n, 1);
  await api('anu', 'POST', `/tasks/${b.id}/status`, { status: 'QA' });
  assert.equal((await api('anu', 'GET', '/time/current')).body, null);
  // nobody else can track time on Anu's task
  assert.equal((await api('vishnu', 'POST', '/time/start', { taskId: a.id })).status, 404);
  assert.equal((await api('meera', 'POST', '/time/start', { taskId: a.id })).status, 403);
});

test('manual time, and members edit only their own entries', async () => {
  const a = await findTask('anu', 'Build login page UI');
  const yesterday = new Date(Date.now() - 864e5).toLocaleDateString('en-CA');
  const r = await api('anu', 'POST', '/time/manual', { taskId: a.id, date: yesterday, minutes: 90, note: 'forgot timer' });
  assert.equal(r.status, 201);
  assert.equal((await api('anu', 'PATCH', `/time/${r.body.id}`, { minutes: 60 })).body.minutes, 60);
  const tomorrow = new Date(Date.now() + 864e5).toLocaleDateString('en-CA');
  assert.equal((await api('anu', 'POST', '/time/manual', { taskId: a.id, date: tomorrow, minutes: 30 })).status, 400);
  const sheet = (await api('anu', 'GET', `/time/timesheet?week=${yesterday}`)).body;
  assert.ok(sheet.total >= 60);
  assert.equal((await api('anu', 'GET', `/time/timesheet?userId=${sheet.userId + 1}`)).status, 403);
});

test('only the PM deletes tasks and manages users', async () => {
  const t = await findTask('meera', 'Lead task');
  assert.equal((await api('meera', 'DELETE', `/tasks/${t.id}`)).status, 403);
  assert.equal((await api('pm', 'DELETE', `/tasks/${t.id}`)).status, 204);
  assert.equal((await api('meera', 'POST', '/users', { name: 'X', email: 'x@x.io', role: 'MEMBER', teamId: 1, password: 'password123' })).status, 403);
  const created = await api('pm', 'POST', '/users', { name: 'New Dev', email: 'new@taskboard.local', role: 'MEMBER', teamId: 1, password: 'password123' });
  assert.equal(created.status, 201);
  assert.equal((await api('pm', 'PATCH', `/users/${created.body.id}`, { isActive: false })).status, 200);
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'new@taskboard.local', password: 'password123' }) });
  assert.equal(login.status, 401);
});

test('activity log is append-only in the database', async () => {
  await assert.rejects(pool.query("UPDATE task_activity SET action = 'x'"), /append-only/);
});

test('dashboard follows the same scope', async () => {
  const pm = (await api('pm', 'GET', '/dashboard')).body;
  const lead = (await api('arjun', 'GET', '/dashboard')).body;
  const me = (await api('rahul', 'GET', '/dashboard')).body;
  assert.equal(pm.scope, 'ALL');
  assert.equal(pm.byTeam.length, 3);
  assert.deepEqual(lead.byTeam.map((t) => t.type), ['BACKEND']);
  assert.equal(me.scope, 'ME');
  assert.equal(me.workload.length, 0);
});
