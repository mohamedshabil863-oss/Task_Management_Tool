import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { get, post, patch, del } from '../api.js';
import { useAuth, useLoad, useNow, useTimer, useToast } from '../context.jsx';
import { STATUS, minutes, shortDate, dateTime, since, clock, parseDuration, todayStr, PRIORITY } from '../format.js';
import { Avatar, PriorityTag, TeamTag, StatusText, MoveDialog, Modal, Loading, ErrorBox } from '../components/ui.jsx';

export default function TaskDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const timer = useTimer();
  const task = useLoad(() => get(`/tasks/${id}`), [id, timer.version]);
  const comments = useLoad(() => get(`/tasks/${id}/comments`), [id]);
  const activity = useLoad(() => get(`/tasks/${id}/activity`), [id, timer.version]);
  const [pendingMove, setPendingMove] = useState(null);

  if (task.error) return <ErrorBox error={task.error.status === 404 ? { message: 'This task does not exist, or it is outside what your role can see.' } : task.error} />;
  if (!task.data) return <Loading />;
  const t = task.data;

  const reloadAll = () => { task.reload(); comments.reload(); activity.reload(); timer.refresh(); };
  const move = async (m, extra = {}) => {
    await post(`/tasks/${t.id}/status`, { status: m.to, ...extra });
    toast(`Moved to ${STATUS[m.to].label}.`);
    reloadAll();
  };
  const onPickStatus = (to) => {
    const m = t.allowedMoves.find((x) => x.to === to);
    if (!m) return;
    if (m.commentRequired || m.needsAssignee) setPendingMove(m);
    else move(m).catch((e) => toast(e.message, 'error'));
  };
  const remove = async () => {
    if (!window.confirm(`Delete ${t.key} and its subtasks for good? Leads usually cancel instead.`)) return;
    try { await del(`/tasks/${t.id}`); toast(`${t.key} deleted.`); navigate('/board'); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <div className="small muted">
        <Link to="/board" style={{ textDecoration: 'none' }}>{t.project.name}</Link> / {t.team.name}
        {t.parent && <> / {t.parentVisible ? <Link to={`/tasks/${t.parent.id}`}>{t.parent.key}</Link> : t.parent.key}</>} / {t.key}
      </div>
      <div className="two-col">
        <div className="wide">
          <section className="panel">
            <div className="row" style={{ gap: 10 }}>
              <TeamTag team={t.team} />
              <PriorityTag priority={t.priority} suffix=" priority" />
              {t.parent && <span className="tag" style={{ background: '#F2F4F7', color: '#344054' }}>Subtask of {t.parent.key}</span>}
              {t.isLate && <span className="tag" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>Overdue</span>}
              <span className="spacer row">
                {t.permissions.edit && <Link className="btn small" to={`/tasks/${t.id}/edit`}>Edit</Link>}
                {t.permissions.delete && <button className="btn small" onClick={remove}>Delete</button>}
              </span>
            </div>
            <h1 style={{ fontSize: 26 }}>{t.title}</h1>
            <div className="stack">
              <h3 className="muted">Description</h3>
              <p style={{ margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{t.description || <span className="muted">No description.</span>}</p>
            </div>
          </section>

          {!t.parent && <Subtasks task={t} onChange={reloadAll} />}
          <Comments taskId={t.id} comments={comments} onPosted={() => { comments.reload(); activity.reload(); }} />
        </div>

        <aside className="side">
          <section className="panel tight" aria-label="Details">
            <label className="field">
              <span>Status</span>
              <select className="input" value={t.status} onChange={(e) => onPickStatus(e.target.value)}
                style={{ borderColor: STATUS[t.status].color, color: STATUS[t.status].fg, fontWeight: 600 }} disabled={!t.allowedMoves.length}>
                <option value={t.status}>{STATUS[t.status].label}</option>
                {t.allowedMoves.map((m) => <option key={m.to} value={m.to}>Move to {STATUS[m.to].label}{m.commentRequired ? ' (reason needed)' : ''}</option>)}
              </select>
            </label>
            <div className="hint">
              {STATUS[t.status].label} for {since(t.statusChangedAt)}.
              {!t.allowedMoves.length && ' You cannot change the status of this task.'}
              {t.subtasks.total > t.subtasks.done && t.status === 'QA' && ' It can be completed only after all subtasks are Completed or Cancelled.'}
            </div>
            <div style={{ height: 1, background: 'var(--border)' }} />
            <div className="details-grid">
              <div className="k">Assignee</div><div className="v row" style={{ gap: 8 }}>{t.assignee ? <><Avatar name={t.assignee.name} />{t.assignee.name}</> : <span className="muted">Nobody</span>}</div>
              <div className="k">Reporter</div><div className="v">{t.reporter.name}</div>
              <div className="k">Team</div><div className="v">{t.team.name}</div>
              <div className="k">Priority</div><div className="v">{PRIORITY[t.priority].label}</div>
              <div className="k">Start date</div><div className="v">{t.startDate ? shortDate(t.startDate) : '—'}</div>
              <div className="k">Due date</div><div className={`v ${t.isLate ? 'late' : ''}`}>{t.dueDate ? shortDate(t.dueDate) : '—'}</div>
              <div className="k">Started on</div><div className="v">{t.startedAt ? shortDate(t.startedAt.slice(0, 10)) : '—'}</div>
              {t.completedAt && <><div className="k">Completed</div><div className="v">{shortDate(t.completedAt.slice(0, 10))}</div></>}
              <div className="k">Project</div><div className="v">{t.project.name}</div>
            </div>
          </section>

          <TimeTracking task={t} user={user} onChange={reloadAll} />

          <section className="panel tight" aria-label="Activity">
            <h3>Activity</h3>
            {(activity.data || []).slice(0, 15).map((a) => (
              <div key={a.id} className="activity-item">
                <strong>{a.user}</strong> {a.action}
                {(a.oldValue || a.newValue) && <> {a.oldValue && <span className="muted">{a.oldValue} → </span>}{a.newValue}</>}
                <br /><span className="muted small">{dateTime(a.createdAt)}</span>
              </div>
            ))}
            {activity.data?.length > 15 && <div className="hint">Showing the latest 15 of {activity.data.length} changes.</div>}
          </section>
        </aside>
      </div>

      {pendingMove && (
        <MoveDialog task={t} move={pendingMove} users={t.assignableUsers}
          onClose={() => { setPendingMove(null); task.reload(); }}
          onConfirm={async (extra) => { await move(pendingMove, extra); setPendingMove(null); }} />
      )}
    </>
  );
}

function Subtasks({ task, onChange }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const pct = task.subtasks.total ? Math.round((task.subtasks.done / task.subtasks.total) * 100) : 0;
  const add = async (e) => {
    e.preventDefault();
    try {
      await post('/tasks', { parentId: task.id, title, assigneeId: assigneeId || undefined, dueDate: dueDate || undefined, startDate: !dueDate || dueDate >= todayStr() ? todayStr() : undefined, priority: task.priority });
      setTitle(''); setDueDate(''); setAdding(false);
      toast('Subtask added.');
      onChange();
    } catch (err) { toast(err.message, 'error'); }
  };
  return (
    <section className="panel" aria-label="Subtasks">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Subtasks · {task.subtasks.done} of {task.subtasks.total} done</h2>
        {task.permissions.addSubtask && <button className="btn small" onClick={() => setAdding((a) => !a)}>+ Add subtask</button>}
      </div>
      {task.subtasks.total > 0 && (
        <div className="progress" role="progressbar" aria-label="Subtasks done" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${pct}%` }} /></div>
      )}
      {adding && (
        <form className="row" onSubmit={add} style={{ alignItems: 'flex-end' }}>
          <label className="field grow"><span>Subtask title</span><input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          {task.permissions.edit && (
            <label className="field"><span>Assignee</span>
              <select className="input" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                <option value="">Nobody yet</option>
                {task.assignableUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
          )}
          <label className="field"><span>Due date</span><input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
          <button className="btn primary" type="submit">Add</button>
        </form>
      )}
      <div className="stack" style={{ gap: 0 }}>
        {task.subtaskList.map((s) => (
          <Link key={s.id} to={`/tasks/${s.id}`} className="list-row">
            <span className="small muted">{s.key}</span>
            <span style={s.status === 'COMPLETED' ? { textDecoration: 'line-through', color: 'var(--muted)' } : undefined}>{s.title}</span>
            <StatusText status={s.status} />
            <span className="small muted">{minutes(s.spentMinutes)}</span>
            {s.assignee ? <Avatar name={s.assignee.name} /> : <span className="avatar">?</span>}
          </Link>
        ))}
        {task.hiddenSubtasks > 0 && <div className="hint" style={{ paddingTop: 8 }}>{task.hiddenSubtasks} more subtask(s) are assigned to other people.</div>}
        {!task.subtasks.total && !adding && <div className="hint">No subtasks yet.</div>}
      </div>
      {task.subtasks.total > 0 && <div className="hint">This task can be completed only after all subtasks are Completed or Cancelled.</div>}
    </section>
  );
}

function Comments({ taskId, comments, onPosted }) {
  const toast = useToast();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await post(`/tasks/${taskId}/comments`, { body }); setBody(''); onPosted(); } catch (err) { toast(err.message, 'error'); }
    setBusy(false);
  };
  const list = comments.data || [];
  return (
    <section className="panel" aria-label="Comments">
      <h2>Comments ({list.length})</h2>
      {list.map((c) => (
        <div key={c.id} className="comment">
          <Avatar name={c.author.name} />
          <div className="stack" style={{ gap: 4 }}>
            <div><strong>{c.author.name}</strong> <span className="small muted">{c.author.roleLabel} · {dateTime(c.createdAt)}</span></div>
            <div className="comment-body">{c.body}</div>
          </div>
        </div>
      ))}
      <form className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }} onSubmit={submit}>
        <label className="field"><span>Add a comment</span>
          <textarea className="input" rows={3} placeholder="Write a comment. Type @Name to mention a teammate." value={body} onChange={(e) => setBody(e.target.value)} required />
        </label>
        <div><button className="btn primary" type="submit" disabled={busy || !body.trim()}>Post comment</button></div>
      </form>
    </section>
  );
}

function TimeTracking({ task, user, onChange }) {
  const timer = useTimer();
  const toast = useToast();
  const logs = useLoad(() => get(`/time/task/${task.id}`), [task.id, timer.version, task.spentMinutes]);
  const running = timer.timer && timer.timer.taskId === task.id;
  const now = useNow(running);
  const [manual, setManual] = useState(false);
  const [editing, setEditing] = useState(null);
  const canTime = task.permissions.trackTime && ['TODO', 'IN_PROGRESS'].includes(task.status);
  const runningMs = running ? now - new Date(timer.timer.startedAt).getTime() : 0;
  const spent = task.spentMinutes;
  const est = task.estimateMinutes;
  const pct = est ? Math.min(100, Math.round((spent / est) * 100)) : 0;

  const start = () => timer.start(task.id).then(() => { toast('Timer started.'); onChange(); }).catch((e) => toast(e.message, 'error'));
  const stop = () => timer.stop().then((r) => { toast(`Timer stopped: ${r.minutes} min saved.`); onChange(); }).catch((e) => toast(e.message, 'error'));
  // The server enforces the exact rule (members: own entries, same day only).
  const canChange = (l) => task.permissions.seeAllTime || l.user.id === user.id;

  return (
    <section className="panel tight" aria-label="Time tracking">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3>Time tracking</h3>
        {running && <span className="row small" style={{ gap: 6, color: 'var(--success)', fontWeight: 600 }}><span className="dot" style={{ width: 8, height: 8, background: 'var(--success)' }} />Timer running</span>}
      </div>
      {task.permissions.trackTime && (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="timer">{clock(runningMs)}</div>
          {running
            ? <button className="btn danger" onClick={stop}>Stop</button>
            : <button className="btn primary" onClick={start} disabled={!canTime} title={canTime ? '' : 'The timer runs only while the task is To Do or In Progress'}>Start</button>}
        </div>
      )}
      {timer.timer && !running && task.permissions.trackTime && canTime && <div className="hint">Starting here stops your timer on {timer.timer.taskKey}.</div>}
      <div className="stack" style={{ gap: 6 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <strong>Spent {minutes(spent)}</strong>
          <span className="small muted">{est ? `of ${minutes(est)} estimate` : 'No estimate'}</span>
        </div>
        {est > 0 && <div className={`progress blue ${spent > est ? 'over' : ''}`} role="progressbar" aria-label="Time spent against estimate" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${pct}%` }} /></div>}
        {task.subtasks.total > 0 && <div className="hint">{minutes(task.spentOwnMinutes)} on this task, {minutes(spent - task.spentOwnMinutes)} on subtasks.</div>}
      </div>
      {task.permissions.trackTime && <button className="btn small" onClick={() => setManual(true)}>+ Add time by hand</button>}
      {(logs.data || []).length > 0 && (
        <details>
          <summary className="small" style={{ cursor: 'pointer' }}>Time entries ({logs.data.length})</summary>
          <div className="stack" style={{ marginTop: 8 }}>
            {logs.data.map((l) => (
              <div key={l.id} className="row small" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--divider)', paddingBottom: 6 }}>
                <span>{shortDate(l.date)} · {l.user.name}{l.taskId !== task.id ? ` · ${l.taskKey}` : ''}{l.isManual ? ' · by hand' : ''}{l.note ? ` · ${l.note}` : ''}</span>
                <span className="row" style={{ gap: 6 }}>
                  <strong>{l.running ? 'running' : minutes(l.minutes)}</strong>
                  {!l.running && canChange(l) && <button className="btn ghost small" onClick={() => setEditing(l)} aria-label="Edit time entry">Edit</button>}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
      {manual && <ManualTime taskId={task.id} onClose={() => setManual(false)} onSaved={() => { setManual(false); timer.changed(); onChange(); }} />}
      {editing && <EditTime log={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); timer.changed(); onChange(); }} />}
    </section>
  );
}

export function ManualTime({ taskId, onClose, onSaved, tasks }) {
  const toast = useToast();
  const [date, setDate] = useState(todayStr());
  const [dur, setDur] = useState('');
  const [note, setNote] = useState('');
  const [pick, setPick] = useState(taskId || '');
  const [error, setError] = useState('');
  const save = async (e) => {
    e.preventDefault();
    const m = parseDuration(dur);
    if (!m) { setError('Write the time like 1h 30m, 45m or 1.5'); return; }
    try { await post('/time/manual', { taskId: Number(pick), date, minutes: m, note }); toast(`${minutes(m)} added.`); onSaved(); } catch (err) { setError(err.message); }
  };
  return (
    <Modal title="Add time by hand" onClose={onClose}>
      <form className="stack" style={{ gap: 14 }} onSubmit={save}>
        {tasks && (
          <label className="field"><span>Task</span>
            <select className="input" required value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Pick a task</option>
              {tasks.map((t) => <option key={t.id} value={t.id}>{t.key} · {t.title}</option>)}
            </select>
          </label>
        )}
        <div className="form-grid">
          <label className="field"><span>Date</span><input className="input" type="date" max={todayStr()} required value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field"><span>Time spent</span><input className="input" placeholder="1h 30m" required value={dur} onChange={(e) => setDur(e.target.value)} /></label>
        </div>
        <label className="field"><span>Note (optional)</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {error && <div className="error-box">{error}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">Add time</button>
        </div>
      </form>
    </Modal>
  );
}

export function EditTime({ log, onClose, onSaved }) {
  const toast = useToast();
  const [dur, setDur] = useState(minutes(log.minutes));
  const [note, setNote] = useState(log.note || '');
  const [error, setError] = useState('');
  const save = async (e) => {
    e.preventDefault();
    const m = parseDuration(dur);
    if (!m) { setError('Write the time like 1h 30m, 45m or 1.5'); return; }
    try { await patch(`/time/${log.id}`, { minutes: m, note }); toast('Time entry updated.'); onSaved(); } catch (err) { setError(err.message); }
  };
  const remove = async () => {
    try { await del(`/time/${log.id}`); toast('Time entry deleted.'); onSaved(); } catch (err) { setError(err.message); }
  };
  return (
    <Modal title={`Time entry · ${log.taskKey} · ${shortDate(log.date)}`} onClose={onClose}>
      <form className="stack" style={{ gap: 14 }} onSubmit={save}>
        <label className="field"><span>Time spent</span><input className="input" required value={dur} onChange={(e) => setDur(e.target.value)} /></label>
        <label className="field"><span>Note</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <div className="hint">Members can change their own entries only on the day they added them. Leads and the PM can correct any entry in their scope.</div>
        {error && <div className="error-box">{error}</div>}
        <div className="row">
          <button type="button" className="btn" onClick={remove}>Delete entry</button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">Save</button>
        </div>
      </form>
    </Modal>
  );
}
