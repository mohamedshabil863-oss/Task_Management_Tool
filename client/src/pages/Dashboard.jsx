import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../api.js';
import { useAuth, useLoad } from '../context.jsx';
import { STATUSES, STATUS, minutes, relativeDue } from '../format.js';
import { Loading, ErrorBox, StatusText } from '../components/ui.jsx';

export default function Dashboard() {
  const { user } = useAuth();
  const [projectId, setProjectId] = useState('');
  const projects = useLoad(() => get('/projects'), []);
  const d = useLoad(() => get(`/dashboard${projectId ? `?projectId=${projectId}` : ''}`), [projectId]);
  if (d.error) return <ErrorBox error={d.error} />;
  if (!d.data) return <Loading />;
  const { counts, byTeam, dueSoon, workload, scope, myMinutesThisWeek } = d.data;
  const title = scope === 'ALL' ? 'Team progress' : scope === 'TEAM' ? `${user.team?.name} team progress` : 'My work';
  const stat = (label, value, note, color) => (
    <div className="stat"><span className="label">{label}</span><span className="value" style={color ? { color } : undefined}>{value}</span><span className="small muted">{note}</span></div>
  );

  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <h1>{title}</h1>
          <div className="sub">{scope === 'ALL' ? 'All teams' : scope === 'TEAM' ? 'Your team only' : 'Tasks assigned to you'}</div>
        </div>
        <select className="compact" aria-label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">All projects</option>
          {(projects.data || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <div className="stats">
        {stat('Open tasks', counts.open, 'To Do, Re Assign, In Progress, QA')}
        {stat('Overdue', counts.overdue, 'Past due date, not completed', counts.overdue ? 'var(--danger)' : undefined)}
        {stat('Waiting in QA', counts.qa, scope === 'ME' ? 'Waiting for your lead' : 'Needs a lead to approve')}
        {stat('Sent back (Re Assign)', counts.reassign, scope === 'ME' ? 'With your lead' : 'Lead must pick a new assignee', counts.reassign ? 'var(--warn)' : undefined)}
        {scope === 'ME'
          ? stat('Logged this week', minutes(myMinutesThisWeek), 'From your timesheet')
          : stat('Completed this week', counts.completedThisWeek, 'Approved since Monday', 'var(--success)')}
      </div>

      <div className="two-col">
        <section className="panel wide" aria-label="Tasks by team and status">
          <h2>Tasks by team and status</h2>
          <div className="legend">
            {STATUSES.map((s) => <span key={s}><i style={{ background: s === 'CANCELLED' ? '#D5D9E0' : s === 'TODO' ? '#9AA3B0' : STATUS[s].color }} />{STATUS[s].label}</span>)}
          </div>
          {byTeam.map((t) => (
            <div key={t.id} className="stack" style={{ gap: 6 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{t.name}</strong>
                <span className="small muted">{t.counts.COMPLETED || 0} of {t.total} done{t.lead ? ` · Lead: ${t.lead}` : ''}</span>
              </div>
              <div className="stacked" role="img" aria-label={STATUSES.map((s) => `${STATUS[s].label} ${t.counts[s] || 0}`).join(', ')}>
                {STATUSES.filter((s) => t.counts[s]).map((s) => (
                  <span key={s} title={`${STATUS[s].label}: ${t.counts[s]}`} style={{ width: `${(t.counts[s] / t.total) * 100}%`, background: s === 'CANCELLED' ? '#D5D9E0' : s === 'TODO' ? '#9AA3B0' : STATUS[s].color }} />
                ))}
              </div>
            </div>
          ))}
          {!byTeam.length && <div className="hint">No tasks yet.</div>}
        </section>

        <section className="panel side" aria-label="Overdue and due soon">
          <h2>Overdue and due soon</h2>
          {dueSoon.map((t) => (
            <Link key={t.id} to={`/tasks/${t.id}`} className="row" style={{ justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--divider)', textDecoration: 'none', color: 'var(--text)', flexWrap: 'nowrap' }}>
              <span className="grow"><span className="small muted">{t.key}</span> {t.title}<br /><StatusText status={t.status} />{t.assignee && <span className="small muted"> · {t.assignee.name}</span>}</span>
              <span className={t.isLate ? 'late small' : 'small muted'} style={{ whiteSpace: 'nowrap' }}>{t.isLate ? `Overdue · ${relativeDue(t.dueDate)}` : relativeDue(t.dueDate)}</span>
            </Link>
          ))}
          {!dueSoon.length && <div className="hint">Nothing due in the next 3 days.</div>}
        </section>
      </div>

      {workload.length > 0 && (
        <section className="panel" aria-label="Workload by person">
          <h2>Workload by person</h2>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Person</th><th>Team</th><th>Open</th><th>In QA</th><th>Overdue</th><th>Completed</th><th>Hours this week</th></tr></thead>
              <tbody>
                {workload.map((w) => (
                  <tr key={w.id}>
                    <td style={{ fontWeight: 500 }}>{w.name}</td><td>{w.team}</td><td>{w.open}</td><td>{w.qa}</td>
                    <td className={w.overdue ? 'late' : ''}>{w.overdue}</td><td>{w.completed}</td><td>{minutes(w.minutesThisWeek)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
