import { Link } from 'react-router-dom';
import { get } from '../api.js';
import { useAuth, useLoad, useNow, useTimer, useToast } from '../context.jsx';
import { minutes, relativeDue, clock, todayStr } from '../format.js';
import { PriorityTag, StatusText, TeamTag, Loading, ErrorBox, Icon } from '../components/ui.jsx';

export default function MyTasks() {
  const { user } = useAuth();
  const timer = useTimer();
  const toast = useToast();
  const tasks = useLoad(() => get(`/tasks?assigneeId=${user.id}`), [user.id, timer.version]);
  const now = useNow(!!timer.timer);

  if (tasks.error) return <ErrorBox error={tasks.error} />;
  if (!tasks.data) return <Loading />;
  const today = todayStr();
  const week = new Date(Date.now() + 7 * 864e5).toLocaleDateString('en-CA');
  const open = tasks.data.filter((t) => !['COMPLETED', 'CANCELLED'].includes(t.status));
  const groups = [
    { name: 'Overdue', items: open.filter((t) => t.isLate) },
    { name: 'Due this week', items: open.filter((t) => !t.isLate && t.dueDate && t.dueDate >= today && t.dueDate <= week) },
    { name: 'Later or no due date', items: open.filter((t) => !t.isLate && (!t.dueDate || t.dueDate > week)) },
  ];
  const done = tasks.data.filter((t) => ['COMPLETED', 'CANCELLED'].includes(t.status));
  const startTimer = (t) => timer.start(t.id).then(() => toast(`Timer started on ${t.key}.`)).catch((e) => toast(e.message, 'error'));

  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <div className="sub">{open.length} open task{open.length === 1 ? '' : 's'}</div>
          <h1>My tasks</h1>
        </div>
      </div>

      {timer.timer && (
        <section className="panel tight" style={{ borderColor: '#ABEFC6', background: '#F6FEF9' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="stack" style={{ gap: 2 }}>
              <span className="small" style={{ color: 'var(--success)', fontWeight: 600 }}>Timer running</span>
              <Link to={`/tasks/${timer.timer.taskId}`} style={{ fontWeight: 600, color: 'var(--text)', textDecoration: 'none' }}>{timer.timer.taskKey} · {timer.timer.taskTitle}</Link>
            </div>
            <div className="row" style={{ gap: 16 }}>
              <span className="timer">{clock(now - new Date(timer.timer.startedAt).getTime())}</span>
              <button className="btn danger" onClick={() => timer.stop().then((r) => toast(`${r.minutes} min saved.`))}>Stop</button>
            </div>
          </div>
        </section>
      )}

      {groups.map((g) => (
        <section key={g.name} className="panel">
          <h2>{g.name} <span className="count">{g.items.length}</span></h2>
          {g.items.length === 0 ? <div className="hint">Nothing here.</div> : (
            <div className="table-wrap">
              <table className="table" style={{ tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: 80 }} /><col /><col style={{ width: 110 }} /><col style={{ width: 90 }} />
                  <col style={{ width: 110 }} /><col style={{ width: 100 }} /><col style={{ width: 120 }} /><col style={{ width: 130 }} />
                </colgroup>
                <tbody>
                  {g.items.map((t) => (
                    <tr key={t.id}>
                      <td style={{ width: 90 }} className="small muted">{t.key}</td>
                      <td>
                        <Link to={`/tasks/${t.id}`} style={{ color: 'var(--text)', fontWeight: 500, textDecoration: 'none' }}>{t.title}</Link>
                        {t.parent && <div className="small muted">{Icon.sub} Subtask of {t.parent.key}</div>}
                      </td>
                      <td><TeamTag team={t.team} /></td>
                      <td><PriorityTag priority={t.priority} /></td>
                      <td><StatusText status={t.status} /></td>
                      <td className={t.isLate ? 'late' : 'small muted'}>{t.dueDate ? relativeDue(t.dueDate) : 'No date'}</td>
                      <td className="small muted">{minutes(t.spentMinutes)}{t.estimateMinutes ? ` / ${minutes(t.estimateMinutes)}` : ''}</td>
                      <td style={{ textAlign: 'right' }}>
                        {timer.timer?.taskId === t.id
                          ? <span className="small" style={{ color: 'var(--success)', fontWeight: 600 }}>Running</span>
                          : ['TODO', 'IN_PROGRESS'].includes(t.status) && <button className="btn small" onClick={() => startTimer(t)}>Start timer</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}

      {done.length > 0 && (
        <details className="panel">
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Completed and cancelled ({done.length})</summary>
          {done.map((t) => (
            <Link key={t.id} to={`/tasks/${t.id}`} className="list-row">
              <span className="small muted">{t.key}</span><span>{t.title}</span><StatusText status={t.status} />
              <span className="small muted">{minutes(t.spentMinutes)}</span><span />
            </Link>
          ))}
        </details>
      )}
    </>
  );
}
