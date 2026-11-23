# TaskBoard

An internal task management tool for the Frontend, Backend and HR teams, built from the approved design doc.

- **Stack:** React (Vite, dnd-kit) + Node.js (Express) + PostgreSQL
- **Roles:** Project Manager (everything) > Team Leads (own team) > Developers / HR Staff (own tasks). Every rule is checked on the server, so a junior cannot open another team's task even by typing its link.
- **Statuses:** To Do, Re Assign, In Progress, QA, Completed, Cancelled, with the transition rules from the design doc.

## Run it on your computer

You need Node.js 20 or newer and PostgreSQL 14 or newer (or Docker).

```bash
npm run install:all          # install server and client packages
npm run db:up                # start PostgreSQL in Docker (skip if you have PostgreSQL already)
cp server/.env.example server/.env   # then edit JWT_SECRET and TZ
npm run seed                 # create tables and demo data (wipes existing data)
npm run build                # build the React app
npm start                    # open http://localhost:4000
```

For development with live reload, run `npm run dev:server` and `npm run dev:client` in two terminals and open http://localhost:5173.

### Demo accounts

All demo accounts use the password `password123`.

| Role | Name | Email |
|---|---|---|
| Project Manager | Shabil | pm@taskboard.local |
| Frontend Lead | Meera K | meera@taskboard.local |
| Backend Lead | Arjun | arjun@taskboard.local |
| HR Lead | Divya | divya@taskboard.local |
| Developer (Frontend) | Anu, Vishnu | anu@ / vishnu@taskboard.local |
| Developer (Backend) | Rahul | rahul@taskboard.local |
| HR Staff | Nisha | nisha@taskboard.local |

Change these passwords (or run without `npm run seed` and create real users) before real use.

## Tests

The API tests reset the database they run against, so point them at a separate test database:

```bash
createdb taskboard_test
DATABASE_URL=postgres://taskboard:taskboard@localhost:5432/taskboard_test npm test
```

They cover scope per role, hidden tasks returning 404, who may create tasks and subtasks, every workflow rule (reasons required, new assignee after Re Assign, PM-only restore), parent completion after subtasks, one timer per person, timer stop on QA, same-day edit of time entries, PM-only delete and user management, and the append-only activity log.

## What is in version 1

| # | Screen | Path | Who |
|---|---|---|---|
| 1 | Login | `/` | Everyone |
| 2 | Kanban board, drag and drop, filters | `/board` | Everyone, in their scope |
| 3 | Task detail: subtasks, timer, comments, activity | `/tasks/:id` | Anyone who can see the task |
| 4 | Create or edit task | `/tasks/new`, `/tasks/:id/edit` | PM, Leads |
| 5 | My tasks (overdue, this week, later) | `/my-tasks` | Everyone |
| 6 | My timesheet (week grid, add time by hand) | `/timesheet` | Everyone (Leads/PM can view others) |
| 7 | Dashboard | `/dashboard` | PM all teams, Leads own team, members "My work" |
| 8 | Projects | `/projects` | PM edits, others view |
| 9 | Users and roles, Teams | `/users`, `/teams` | PM only |
| 10 | Notifications | `/notifications` | Everyone |

### Rules worth knowing

- Only the assignee moves work forward (To Do → In Progress → QA) or sends it back with Re Assign (reason required). Only a Lead or the PM approves QA → Completed, fails QA (reason required), cancels (reason required) or reopens. Only the PM restores a cancelled task.
- Moving Re Assign → To Do asks the lead for the new assignee.
- A parent task can be Completed only when every subtask is Completed or Cancelled. Subtasks go one level deep and stay in the parent's team.
- One running timer per person. Starting another stops the first. The timer stops by itself when the task moves to QA, Re Assign, Completed or Cancelled.
- Members can edit or delete their own time entries on the day they added them; Leads and the PM can correct entries in their scope.
- Only the PM deletes tasks. Every change is saved in an activity log that the database refuses to edit.
- Notifications are in-app: assigned, status changes, QA results, @mentions, comments and "due tomorrow".
- Forgot password: the PM sets a new one on Users and roles; people change it under My account.

## Project layout

```
server/  Express API (src/routes/*), access rules (src/access.js), schema (src/schema.sql), seed, tests
client/  React app (src/pages/*), shared UI (src/components/ui.jsx), workflow mirror (src/format.js)
```
