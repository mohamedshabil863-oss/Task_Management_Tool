// Demo data that matches the UI mockups. Run: npm run seed  (add --reset to wipe existing data first)
import { pool, tx } from './db.js';
import { migrate } from './migrate.js';
import { hashPassword } from './auth.js';

const PASSWORD = process.env.SEED_PASSWORD || 'password123';
const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toLocaleDateString('en-CA'); };

async function seed() {
  await migrate();
  const reset = process.argv.includes('--reset');
  await tx(async (db) => {
    const { rows: [{ n }] } = await db.query('SELECT COUNT(*)::int AS n FROM users');
    if (n && !reset) { console.log('Database already has users. Use --reset to replace them with demo data.'); return; }
    if (reset) {
      await db.query('TRUNCATE notifications, task_activity, comments, time_logs, tasks, project_teams, projects, users, teams RESTART IDENTITY CASCADE');
    }
    const hash = await hashPassword(PASSWORD);
    const team = {};
    for (const [name, type] of [['Frontend', 'FRONTEND'], ['Backend', 'BACKEND'], ['HR', 'HR']]) {
      team[type] = (await db.query('INSERT INTO teams (name, type) VALUES ($1, $2) RETURNING id', [name, type])).rows[0].id;
    }
    const user = {};
    const people = [
      ['shabil', 'Shabil', 'pm@taskboard.local', 'PM', null],
      ['meera', 'Meera K', 'meera@taskboard.local', 'LEAD', 'FRONTEND'],
      ['arjun', 'Arjun', 'arjun@taskboard.local', 'LEAD', 'BACKEND'],
      ['divya', 'Divya', 'divya@taskboard.local', 'LEAD', 'HR'],
      ['anu', 'Anu', 'anu@taskboard.local', 'MEMBER', 'FRONTEND'],
      ['vishnu', 'Vishnu', 'vishnu@taskboard.local', 'MEMBER', 'FRONTEND'],
      ['rahul', 'Rahul', 'rahul@taskboard.local', 'MEMBER', 'BACKEND'],
      ['nisha', 'Nisha', 'nisha@taskboard.local', 'MEMBER', 'HR'],
    ];
    for (const [k, name, email, role, t] of people) {
      user[k] = (await db.query('INSERT INTO users (name, email, password_hash, role, team_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [name, email, hash, role, t ? team[t] : null])).rows[0].id;
    }
    await db.query('UPDATE teams SET lead_id = $1 WHERE id = $2', [user.meera, team.FRONTEND]);
    await db.query('UPDATE teams SET lead_id = $1 WHERE id = $2', [user.arjun, team.BACKEND]);
    await db.query('UPDATE teams SET lead_id = $1 WHERE id = $2', [user.divya, team.HR]);

    const wr = (await db.query(`INSERT INTO projects (key, name, description, start_date, end_date, created_by)
      VALUES ('WR', 'Website Revamp', 'New company website and internal task board.', $1, $2, $3) RETURNING id`, [day(-21), day(40), user.shabil])).rows[0].id;
    const hr = (await db.query(`INSERT INTO projects (key, name, description, start_date, end_date, created_by)
      VALUES ('HR', 'HR Operations', 'Onboarding, policies and employee records.', $1, $2, $3) RETURNING id`, [day(-30), day(60), user.shabil])).rows[0].id;
    for (const [p, t] of [[wr, team.FRONTEND], [wr, team.BACKEND], [hr, team.HR]]) await db.query('INSERT INTO project_teams VALUES ($1, $2)', [p, t]);

    const next = { [wr]: 1, [hr]: 1 };
    const task = async (p, t, title, status, priority, assignee, reporter, start, due, estimateH, parent = null, desc = '') => {
      const num = next[p]++;
      const { rows: [r] } = await db.query(`
        INSERT INTO tasks (project_id, team_id, parent_task_id, number, title, description, status, priority, assignee_id, reporter_id,
          start_date, due_date, estimate_minutes, status_changed_at, started_at, completed_at, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now() - interval '2 days',
          CASE WHEN $7 IN ('IN_PROGRESS','QA','COMPLETED') THEN $11::date + time '10:00' END,
          CASE WHEN $7 = 'COMPLETED' THEN now() - interval '1 day' END, $11::date + time '09:00') RETURNING id`,
        [p, team[t], parent, num, title, desc, status, priority, assignee, reporter, start, due, estimateH ? estimateH * 60 : null]);
      await db.query("INSERT INTO task_activity (task_id, user_id, action, created_at) VALUES ($1, $2, $3, $4::date + time '09:00')",
        [r.id, reporter, parent ? 'created the subtask' : 'created the task', start]);
      return r.id;
    };
    const log = (taskId, who, daysAgo, minutes, manual = false) => db.query(
      `INSERT INTO time_logs (task_id, user_id, started_at, ended_at, minutes, is_manual)
       VALUES ($1, $2, (CURRENT_DATE - $3::int) + time '10:00', (CURRENT_DATE - $3::int) + time '10:00' + make_interval(mins => $4), $4, $5)`,
      [taskId, who, daysAgo, minutes, manual]);

    const { meera, arjun, divya, anu, vishnu, rahul, nisha } = user;
    const login = await task(wr, 'FRONTEND', 'Build login page UI', 'IN_PROGRESS', 'HIGH', anu, meera, day(-2), day(5), 8, null,
      'Create the login screen with email and password fields, a "Forgot password" link and error messages. After login, send each user to the board filtered to their own scope.');
    const s1 = await task(wr, 'FRONTEND', 'Email and password form', 'COMPLETED', 'HIGH', anu, meera, day(-2), day(1), 2, login);
    await task(wr, 'FRONTEND', 'Error messages and validation', 'IN_PROGRESS', 'MEDIUM', anu, anu, day(-1), day(3), 2, login);
    await task(wr, 'FRONTEND', 'Forgot password screen', 'TODO', 'MEDIUM', vishnu, meera, day(0), day(5), 2, login);
    const rbac = await task(wr, 'BACKEND', 'Role-based access middleware', 'IN_PROGRESS', 'URGENT', rahul, arjun, day(-4), day(1), 12, null,
      'Express middleware that limits every query to the user\'s scope: PM all, lead own team, member own tasks.');
    await task(wr, 'BACKEND', 'Scope helper for task queries', 'COMPLETED', 'HIGH', rahul, arjun, day(-4), day(-1), 3, rbac);
    await task(wr, 'BACKEND', 'Tests for each role', 'COMPLETED', 'HIGH', rahul, arjun, day(-3), day(0), 3, rbac);
    await task(wr, 'BACKEND', 'Return 404 for hidden tasks', 'TODO', 'MEDIUM', rahul, arjun, day(-1), day(1), 2, rbac);
    const dnd = await task(wr, 'FRONTEND', 'Drag and drop for kanban', 'IN_PROGRESS', 'HIGH', anu, meera, day(-6), day(-1), 10);
    const api = await task(wr, 'BACKEND', 'Create tasks API endpoints', 'TODO', 'MEDIUM', rahul, arjun, day(2), day(9), 16);
    const mobile = await task(wr, 'FRONTEND', 'Fix board layout on mobile', 'REASSIGN', 'MEDIUM', vishnu, meera, day(-3), day(2), 4);
    const schema = await task(wr, 'BACKEND', 'Database schema migration', 'QA', 'HIGH', arjun, arjun, day(-5), day(0), 8);
    const panel = await task(wr, 'FRONTEND', 'Task detail side panel', 'QA', 'MEDIUM', vishnu, meera, day(-4), day(3), 6);
    const pg = await task(wr, 'BACKEND', 'Set up PostgreSQL server', 'COMPLETED', 'MEDIUM', arjun, arjun, day(-10), day(-5), 4);
    await task(wr, 'FRONTEND', 'Dark mode (moved to v2)', 'CANCELLED', 'LOW', anu, meera, day(-8), day(-3), 6);
    const onboard = await task(hr, 'HR', 'Plan December onboarding', 'TODO', 'LOW', nisha, divya, day(1), day(12), 6);
    const leave = await task(hr, 'HR', 'Update leave policy document', 'IN_PROGRESS', 'MEDIUM', nisha, divya, day(-3), day(7), 5);
    const docs = await task(hr, 'HR', 'Collect employee documents', 'COMPLETED', 'LOW', divya, divya, day(-12), day(-8), 4);

    await log(s1, anu, 2, 130); await log(login, anu, 1, 65); await log(dnd, anu, 3, 240); await log(dnd, anu, 2, 300); await log(dnd, anu, 1, 185);
    await log(rbac, rahul, 3, 200); await log(rbac, rahul, 2, 180, true); await log(rbac, rahul, 1, 200);
    await log(mobile, vishnu, 2, 80); await log(panel, vishnu, 3, 170); await log(panel, vishnu, 2, 140);
    await log(schema, arjun, 3, 230); await log(schema, arjun, 2, 240); await log(pg, arjun, 7, 240);
    await log(leave, nisha, 2, 90); await log(leave, nisha, 1, 60); await log(docs, divya, 9, 225);
    // A little time logged earlier today, so this week's totals are not empty.
    const logToday = (taskId, who, mins) => db.query(
      `INSERT INTO time_logs (task_id, user_id, started_at, ended_at, minutes) VALUES ($1, $2, now() - make_interval(mins => $3), now(), $3)`, [taskId, who, mins]);
    await logToday(dnd, anu, 45); await logToday(rbac, rahul, 70); await logToday(leave, nisha, 30);

    const comment = (t, who, body) => db.query('INSERT INTO comments (task_id, user_id, body, created_at) VALUES ($1,$2,$3, now() - interval \'1 day\')', [t, who, body]);
    await comment(login, meera, 'Please follow the new brand colours. The mockup is in the project files.');
    await comment(login, anu, 'Starting today. @Meera K should the reset link go to email only?');
    await comment(mobile, vishnu, '[In Progress → Re Assign] I need the final mobile designs before I can continue.');
    await db.query("INSERT INTO notifications (user_id, task_id, type, message) VALUES ($1, $2, 'STATUS', 'Vishnu sent WR-11 back (Re Assign): Fix board layout on mobile')", [meera, mobile]);
    await db.query("INSERT INTO notifications (user_id, task_id, type, message) VALUES ($1, $2, 'MENTION', 'Anu mentioned you on WR-1: \"should the reset link go to email only?\"')", [meera, login]);
    await db.query("INSERT INTO notifications (user_id, task_id, type, message) VALUES ($1, $2, 'ASSIGNED', 'Arjun assigned you WR-10: Create tasks API endpoints')", [rahul, api]);
    void onboard;
    await db.query("UPDATE projects p SET next_number = COALESCE((SELECT MAX(number) FROM tasks t WHERE t.project_id = p.id), 0) + 1");
    console.log(`Demo data created. Every demo account uses the password "${PASSWORD}".`);
    console.log(people.map(([, name, email, role]) => `  ${role.padEnd(6)} ${name.padEnd(8)} ${email}`).join('\n'));
  });
}

seed().then(() => pool.end()).catch((err) => { console.error(err); process.exit(1); });
