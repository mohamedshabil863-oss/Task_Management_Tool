import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post, patch } from '../api.js';
import { useAuth, useLoad, useToast } from '../context.jsx';
import { minutes, shortDate } from '../format.js';
import { Modal, TeamTag, Loading, ErrorBox } from '../components/ui.jsx';

const STATUS_LABEL = { ACTIVE: 'Active', ON_HOLD: 'On hold', DONE: 'Done' };

export default function Projects() {
  const { isPM } = useAuth();
  const projects = useLoad(() => get('/projects'), []);
  const teams = useLoad(() => get('/teams'), []);
  const [edit, setEdit] = useState(null); // project or {} for new

  if (projects.error) return <ErrorBox error={projects.error} />;
  if (!projects.data) return <Loading />;
  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <div className="sub">{isPM ? 'All projects' : "Projects your team works on"}</div>
          <h1>Projects</h1>
        </div>
        {isPM && <button className="btn primary" onClick={() => setEdit({})}>+ New project</button>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
        {projects.data.map((p) => {
          const pct = p.tasks.total ? Math.round((p.tasks.done / p.tasks.total) * 100) : 0;
          return (
            <section key={p.id} className="panel tight">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="small muted">{p.key} · {STATUS_LABEL[p.status]}</span>
                {isPM && <button className="btn ghost small" onClick={() => setEdit(p)}>Edit</button>}
              </div>
              <h2 style={{ fontSize: 18 }}>{p.name}</h2>
              {p.description && <p className="muted" style={{ margin: 0 }}>{p.description}</p>}
              <div className="row">{p.teams.map((t) => <TeamTag key={t.id} team={t} />)}{!p.teams.length && <span className="hint">No teams yet</span>}</div>
              <div className="small muted">{p.startDate ? shortDate(p.startDate) : '—'} to {p.endDate ? shortDate(p.endDate) : '—'}</div>
              <div className="stack" style={{ gap: 6 }}>
                <div className="row small" style={{ justifyContent: 'space-between' }}>
                  <span>{p.tasks.done} of {p.tasks.total} tasks completed</span><span className="muted">{pct}%</span>
                </div>
                <div className="progress" role="progressbar" aria-label="Progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${pct}%` }} /></div>
              </div>
              <div className="row small" style={{ justifyContent: 'space-between' }}>
                <span>{minutes(p.minutesLogged)} logged</span>
                {p.tasks.overdue > 0 && <span className="late">{p.tasks.overdue} overdue</span>}
                <Link to={`/board`} state={{ projectId: p.id }}>Open board</Link>
              </div>
            </section>
          );
        })}
        {!projects.data.length && <div className="empty">No projects yet.</div>}
      </div>
      {edit && <ProjectDialog project={edit} teams={teams.data || []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); projects.reload(); }} />}
    </>
  );
}

function ProjectDialog({ project, teams, onClose, onSaved }) {
  const toast = useToast();
  const isNew = !project.id;
  const [f, setF] = useState({
    name: project.name || '', key: project.key || '', description: project.description || '',
    startDate: project.startDate || '', endDate: project.endDate || '', status: project.status || 'ACTIVE',
    teamIds: (project.teams || []).map((t) => t.id),
  });
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const toggle = (id) => setF((s) => ({ ...s, teamIds: s.teamIds.includes(id) ? s.teamIds.filter((x) => x !== id) : [...s.teamIds, id] }));
  const save = async (e) => {
    e.preventDefault();
    try {
      if (isNew) await post('/projects', f); else await patch(`/projects/${project.id}`, f);
      toast(isNew ? 'Project created.' : 'Project saved.');
      onSaved();
    } catch (err) { setError(err.message); }
  };
  return (
    <Modal title={isNew ? 'New project' : `Edit ${project.name}`} onClose={onClose}>
      <form className="stack" style={{ gap: 14 }} onSubmit={save}>
        <div className="form-grid">
          <label className="field"><span>Name</span><input className="input" required value={f.name} onChange={set('name')} /></label>
          <label className="field"><span>Key (used in task IDs)</span><input className="input" required disabled={!isNew} placeholder="WR" value={f.key} onChange={(e) => setF((s) => ({ ...s, key: e.target.value.toUpperCase() }))} /></label>
        </div>
        <label className="field"><span>Description</span><textarea className="input" rows={2} value={f.description} onChange={set('description')} /></label>
        <div className="form-grid">
          <label className="field"><span>Start</span><input className="input" type="date" value={f.startDate} onChange={set('startDate')} /></label>
          <label className="field"><span>End</span><input className="input" type="date" value={f.endDate} onChange={set('endDate')} /></label>
          <label className="field"><span>Status</span>
            <select className="input" value={f.status} onChange={set('status')}>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </label>
        </div>
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label-text" style={{ marginBottom: 6 }}>Teams on this project</legend>
          <div className="row">
            {teams.map((t) => (
              <label key={t.id} className="row" style={{ gap: 6, marginRight: 12 }}><input type="checkbox" checked={f.teamIds.includes(t.id)} onChange={() => toggle(t.id)} />{t.name}</label>
            ))}
          </div>
        </fieldset>
        {error && <div className="error-box">{error}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">{isNew ? 'Create project' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}
