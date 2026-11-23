import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { get, post, patch } from '../api.js';
import { useAuth, useLoad, useToast } from '../context.jsx';
import { PRIORITIES, PRIORITY, minutes, parseDuration, todayStr } from '../format.js';
import { Loading, ErrorBox } from '../components/ui.jsx';

export default function TaskForm() {
  const { id } = useParams();
  const editing = !!id;
  const [search] = useSearchParams();
  const { user, isPM, isMember } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const meta = useLoad(() => Promise.all([get('/projects'), get('/teams'), get('/users'), editing ? get(`/tasks/${id}`) : Promise.resolve(null)]), [id]);
  const [f, setF] = useState({
    projectId: search.get('projectId') || '', teamId: isPM ? '' : String(user.team?.id || ''), parentId: search.get('parentId') || '',
    title: '', description: '', priority: 'MEDIUM', assigneeId: '', startDate: todayStr(), dueDate: '', estimate: '',
  });
  const [parents, setParents] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  useEffect(() => {
    const t = meta.data?.[3];
    if (!t) return;
    setF({
      projectId: String(t.project.id), teamId: String(t.team.id), parentId: t.parent ? String(t.parent.id) : '',
      title: t.title, description: t.description, priority: t.priority, assigneeId: t.assignee ? String(t.assignee.id) : '',
      startDate: t.startDate || '', dueDate: t.dueDate || '', estimate: t.estimateMinutes ? minutes(t.estimateMinutes) : '',
    });
  }, [meta.data]);

  // Parent task choices: top-level tasks of the chosen project and team.
  useEffect(() => {
    if (editing || !f.projectId || !f.teamId) { setParents([]); return; }
    get(`/tasks?projectId=${f.projectId}&teamId=${f.teamId}&topLevel=true`).then(setParents).catch(() => setParents([]));
  }, [editing, f.projectId, f.teamId]);

  if (meta.error) return <ErrorBox error={meta.error} />;
  if (!meta.data) return <Loading />;
  const [projects, teams, users, existing] = meta.data;
  if (isMember && !editing) {
    return <div className="panel"><h2>Only the PM or a team lead can create tasks</h2><p className="muted" style={{ margin: 0 }}>You can add subtasks for yourself from inside one of your own tasks.</p></div>;
  }
  const project = projects.find((p) => String(p.id) === f.projectId);
  const teamChoices = project ? teams.filter((t) => project.teams.some((pt) => pt.id === t.id)) : teams;
  const assignees = users.filter((u) => u.isActive && u.team && String(u.team.id) === f.teamId);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    let estimateMinutes = null;
    if (f.estimate.trim()) {
      estimateMinutes = parseDuration(f.estimate);
      if (estimateMinutes == null) { setError('Write the estimate like 8h, 1h 30m or 1.5'); return; }
    }
    const body = {
      title: f.title, description: f.description, priority: f.priority, assigneeId: f.assigneeId ? Number(f.assigneeId) : null,
      startDate: f.startDate || null, dueDate: f.dueDate || null, estimateMinutes,
    };
    setBusy(true);
    try {
      const saved = editing
        ? await patch(`/tasks/${id}`, body)
        : await post('/tasks', { ...body, projectId: Number(f.projectId), teamId: Number(f.teamId), parentId: f.parentId ? Number(f.parentId) : undefined });
      toast(editing ? 'Task saved.' : `${saved.key} created.`);
      navigate(`/tasks/${saved.id}`);
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <form className="stack" style={{ gap: 20, maxWidth: 860 }} onSubmit={submit}>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <div className="sub">{editing ? existing.key : 'New task'}</div>
          <h1>{editing ? 'Edit task' : 'Create a task'}</h1>
        </div>
      </div>
      <section className="panel">
        {!editing && (
          <div className="form-grid">
            <label className="field"><span>Project</span>
              <select className="input" required value={f.projectId} onChange={(e) => setF((s) => ({ ...s, projectId: e.target.value, parentId: '' }))}>
                <option value="">Pick a project</option>
                {projects.filter((p) => p.status !== 'DONE').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="field"><span>Team</span>
              <select className="input" required value={f.teamId} disabled={!isPM} onChange={(e) => setF((s) => ({ ...s, teamId: e.target.value, assigneeId: '', parentId: '' }))}>
                <option value="">Pick a team</option>
                {teamChoices.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label className="field"><span>Parent task (makes this a subtask)</span>
              <select className="input" value={f.parentId} onChange={set('parentId')}>
                <option value="">None, a normal task</option>
                {parents.map((p) => <option key={p.id} value={p.id}>{p.key} · {p.title}</option>)}
              </select>
            </label>
          </div>
        )}
        {!editing && project && f.teamId && !project.teams.some((t) => String(t.id) === f.teamId) && (
          <div className="error-box">This team is not part of {project.name}. The PM can add it on the Projects page.</div>
        )}
        <label className="field"><span>Title</span><input className="input" required value={f.title} onChange={set('title')} /></label>
        <label className="field"><span>Description</span><textarea className="input" rows={5} value={f.description} onChange={set('description')} /></label>
        <div className="form-grid">
          <label className="field"><span>Priority</span>
            <select className="input" value={f.priority} onChange={set('priority')}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY[p].label}</option>)}
            </select>
          </label>
          <label className="field"><span>Assignee</span>
            <select className="input" value={f.assigneeId} onChange={set('assigneeId')} disabled={!f.teamId}>
              <option value="">Nobody yet</option>
              {assignees.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.roleLabel}</option>)}
            </select>
          </label>
          <label className="field"><span>Start date</span><input className="input" type="date" value={f.startDate} onChange={set('startDate')} /></label>
          <label className="field"><span>Due date</span><input className="input" type="date" min={f.startDate || undefined} value={f.dueDate} onChange={set('dueDate')} /></label>
          <label className="field"><span>Estimate (optional)</span><input className="input" placeholder="8h or 1h 30m" value={f.estimate} onChange={set('estimate')} /></label>
        </div>
        {error && <div className="error-box" role="alert">{error}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Link className="btn" to={editing ? `/tasks/${id}` : '/board'}>Cancel</Link>
          <button className="btn primary" type="submit" disabled={busy}>{editing ? 'Save changes' : 'Create task'}</button>
        </div>
      </section>
    </form>
  );
}
