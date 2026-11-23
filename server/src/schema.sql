-- TaskBoard schema (version 1). Safe to run more than once.

CREATE TABLE IF NOT EXISTS teams (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  type        TEXT NOT NULL CHECK (type IN ('FRONTEND', 'BACKEND', 'HR', 'OTHER')),
  lead_id     INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('PM', 'LEAD', 'MEMBER')),
  team_id        INTEGER REFERENCES teams(id),
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The PM has no team; everybody else belongs to exactly one team.
  CHECK ((role = 'PM' AND team_id IS NULL) OR (role <> 'PM' AND team_id IS NOT NULL))
);

DO $$ BEGIN
  ALTER TABLE teams ADD CONSTRAINT teams_lead_fk FOREIGN KEY (lead_id) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS projects (
  id           SERIAL PRIMARY KEY,
  key          TEXT NOT NULL UNIQUE CHECK (key ~ '^[A-Z][A-Z0-9]{1,5}$'),
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  start_date   DATE,
  end_date     DATE,
  status       TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ON_HOLD', 'DONE')),
  next_number  INTEGER NOT NULL DEFAULT 1,
  created_by   INTEGER REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_teams (
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  team_id     INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, team_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id                 SERIAL PRIMARY KEY,
  project_id         INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  team_id            INTEGER NOT NULL REFERENCES teams(id),
  parent_task_id     INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  number             INTEGER NOT NULL,
  title              TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'TODO'
                     CHECK (status IN ('TODO', 'REASSIGN', 'IN_PROGRESS', 'QA', 'COMPLETED', 'CANCELLED')),
  priority           TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('URGENT', 'HIGH', 'MEDIUM', 'LOW')),
  assignee_id        INTEGER REFERENCES users(id),
  reporter_id        INTEGER NOT NULL REFERENCES users(id),
  start_date         DATE,
  due_date           DATE,
  estimate_minutes   INTEGER CHECK (estimate_minutes IS NULL OR estimate_minutes >= 0),
  status_changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, number),
  CHECK (start_date IS NULL OR due_date IS NULL OR start_date <= due_date)
);
CREATE INDEX IF NOT EXISTS tasks_team_idx ON tasks(team_id);
CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS tasks_parent_idx ON tasks(parent_task_id);

CREATE TABLE IF NOT EXISTS time_logs (
  id          SERIAL PRIMARY KEY,
  task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  started_at  TIMESTAMPTZ NOT NULL,
  ended_at    TIMESTAMPTZ,
  minutes     INTEGER CHECK (minutes IS NULL OR minutes >= 0),
  is_manual   BOOLEAN NOT NULL DEFAULT false,
  note        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS time_logs_task_idx ON time_logs(task_id);
CREATE INDEX IF NOT EXISTS time_logs_user_idx ON time_logs(user_id, started_at);
-- [A10] one running timer per person
CREATE UNIQUE INDEX IF NOT EXISTS time_logs_one_running ON time_logs(user_id) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS comments (
  id          SERIAL PRIMARY KEY,
  task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS comments_task_idx ON comments(task_id);

-- [A8] history of every change; the app only ever inserts here.
CREATE TABLE IF NOT EXISTS task_activity (
  id          SERIAL PRIMARY KEY,
  task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  action      TEXT NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_activity_task_idx ON task_activity(task_id);

CREATE OR REPLACE FUNCTION task_activity_no_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'task_activity is append-only';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS task_activity_no_update ON task_activity;
CREATE TRIGGER task_activity_no_update BEFORE UPDATE ON task_activity
  FOR EACH ROW EXECUTE FUNCTION task_activity_no_change();

CREATE TABLE IF NOT EXISTS notifications (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id     INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('ASSIGNED', 'STATUS', 'MENTION', 'COMMENT', 'DUE_SOON', 'QA_RESULT')),
  message     TEXT NOT NULL,
  is_read     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, is_read, created_at DESC);
