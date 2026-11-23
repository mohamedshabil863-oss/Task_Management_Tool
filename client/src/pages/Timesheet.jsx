import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../api.js';
import { useAuth, useLoad, useTimer } from '../context.jsx';
import { minutes, todayStr, dateTime } from '../format.js';
import { Loading, ErrorBox } from '../components/ui.jsx';
import { ManualTime, EditTime } from './TaskDetail.jsx';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const shift = (d, days) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + days); return x.toLocaleDateString('en-CA'); };

export default function Timesheet() {
  const { user, isMember } = useAuth();
  const timer = useTimer();
  const [week, setWeek] = useState(todayStr());
  const [who, setWho] = useState(String(user.id));
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const people = useLoad(() => (isMember ? Promise.resolve([]) : get('/users')), [isMember]);
  const sheet = useLoad(() => get(`/time/timesheet?week=${week}&userId=${who}`), [week, who, timer.version]);
  const myTasks = useLoad(() => get(`/tasks?assigneeId=${user.id}`), [user.id]);

  if (sheet.error) return <ErrorBox error={sheet.error} />;
  if (!sheet.data) return <Loading />;
  const s = sheet.data;
  const today = todayStr();
  const isMe = who === String(user.id);
  const todays = s.entries.filter((e) => e.date === today);
  const fmtDay = (d) => Number(d.slice(8, 10));

  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <div className="sub">Week of {new Date(`${s.weekStart}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</div>
          <h1>{isMe ? 'My timesheet' : 'Timesheet'}</h1>
        </div>
        <div className="row">
          {!isMember && (
            <select className="compact" aria-label="Person" value={who} onChange={(e) => setWho(e.target.value)}>
              {(people.data || []).filter((p) => p.isActive).map((p) => <option key={p.id} value={p.id}>{p.id === user.id ? `${p.name} (me)` : p.name}</option>)}
            </select>
          )}
          <button className="btn small" onClick={() => setWeek(shift(s.weekStart, -7))} aria-label="Previous week">‹ Prev</button>
          <button className="btn small" onClick={() => setWeek(today)}>This week</button>
          <button className="btn small" onClick={() => setWeek(shift(s.weekStart, 7))} aria-label="Next week">Next ›</button>
          {isMe && <button className="btn primary" onClick={() => setAdding(true)}>+ Add time by hand</button>}
        </div>
      </div>

      <div className="stats">
        <div className="stat"><span className="label">Total this week</span><span className="value">{minutes(s.total)}</span></div>
        <div className="stat"><span className="label">Today</span><span className="value">{minutes(s.dayTotals[today] || 0)}</span></div>
        <div className="stat"><span className="label">Tasks worked on</span><span className="value">{s.rows.length}</span></div>
      </div>

      <section className="panel">
        <h2>Week</h2>
        <div className="table-wrap">
          <table className="table week-grid">
            <thead>
              <tr>
                <th>Task</th>
                {s.days.map((d, i) => <th key={d} style={d === today ? { color: 'var(--accent)' } : undefined}>{DAY_NAMES[i]} {fmtDay(d)}</th>)}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r) => (
                <tr key={r.taskId}>
                  <td><Link to={`/tasks/${r.taskId}`} style={{ color: 'var(--text)', textDecoration: 'none' }}><span className="small muted">{r.taskKey}</span> {r.taskTitle}</Link></td>
                  {s.days.map((d) => <td key={d} className={r.days[d] ? '' : 'muted'}>{r.days[d] ? minutes(r.days[d]) : '–'}</td>)}
                  <td><strong>{minutes(r.total)}</strong></td>
                </tr>
              ))}
              {!s.rows.length && <tr><td colSpan={9} className="empty">No time logged this week.</td></tr>}
              {s.rows.length > 0 && (
                <tr>
                  <td><strong>Total</strong></td>
                  {s.days.map((d) => <td key={d}><strong>{s.dayTotals[d] ? minutes(s.dayTotals[d]) : '–'}</strong></td>)}
                  <td><strong>{minutes(s.total)}</strong></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>{s.weekStart <= today && today <= s.days[6] ? "Today's entries" : 'Entries this week'}</h2>
        {(s.weekStart <= today && today <= s.days[6] ? todays : s.entries).map((e) => (
          <div key={e.id} className="row" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--divider)', padding: '8px 0' }}>
            <span><Link to={`/tasks/${e.taskId}`}>{e.taskKey}</Link> {e.taskTitle}<span className="small muted"> · {e.isManual ? 'added by hand' : `${dateTime(e.startedAt)}${e.endedAt ? '' : ' (running)'}`}{e.note ? ` · ${e.note}` : ''}</span></span>
            <span className="row"><strong>{minutes(e.minutes)}</strong>{!e.running && <button className="btn ghost small" onClick={() => setEditing(e)}>Edit</button>}</span>
          </div>
        ))}
        {!(s.weekStart <= today && today <= s.days[6] ? todays : s.entries).length && <div className="hint">No entries.</div>}
      </section>

      {adding && <ManualTime tasks={(myTasks.data || []).filter((t) => !['CANCELLED'].includes(t.status))} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); timer.changed(); }} />}
      {editing && <EditTime log={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); timer.changed(); }} />}
    </>
  );
}
