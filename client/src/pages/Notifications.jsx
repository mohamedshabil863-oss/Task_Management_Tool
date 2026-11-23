import { useNavigate } from 'react-router-dom';
import { get, post } from '../api.js';
import { useLoad } from '../context.jsx';
import { dateTime } from '../format.js';
import { Loading, ErrorBox } from '../components/ui.jsx';

const TYPE_LABEL = { ASSIGNED: 'Assigned', STATUS: 'Status', MENTION: 'Mention', COMMENT: 'Comment', DUE_SOON: 'Due tomorrow', QA_RESULT: 'QA result' };
const TYPE_COLOR = { ASSIGNED: '#3B5BDB', STATUS: '#7C3AED', MENTION: '#C2410C', COMMENT: '#5B6470', DUE_SOON: '#B42318', QA_RESULT: '#15803D' };

export default function Notifications() {
  const navigate = useNavigate();
  const list = useLoad(() => get('/notifications'), []);
  if (list.error) return <ErrorBox error={list.error} />;
  if (!list.data) return <Loading />;
  const unread = list.data.filter((n) => !n.isRead).length;
  const open = async (n) => {
    if (!n.isRead) await post(`/notifications/${n.id}/read`).catch(() => {});
    if (n.taskId) navigate(`/tasks/${n.taskId}`); else list.reload();
  };
  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <div className="sub">{unread} unread</div>
          <h1>Notifications</h1>
        </div>
        {unread > 0 && <button className="btn" onClick={() => post('/notifications/read-all').then(list.reload)}>Mark all as read</button>}
      </div>
      <section className="panel" style={{ gap: 0 }}>
        {list.data.map((n) => (
          <button key={n.id} className={`notif ${n.isRead ? '' : 'unread'}`} onClick={() => open(n)}
            style={{ background: 'none', border: 0, borderBottom: '1px solid var(--divider)', textAlign: 'left', cursor: 'pointer', width: '100%' }}>
            <span className="dot" style={{ marginTop: 6, background: n.isRead ? 'transparent' : 'var(--accent)' }} aria-label={n.isRead ? undefined : 'Unread'} />
            <span className="stack grow" style={{ gap: 2 }}>
              <span className="notif-msg">{n.message}</span>
              <span className="small muted"><span style={{ color: TYPE_COLOR[n.type], fontWeight: 600 }}>{TYPE_LABEL[n.type]}</span> · {dateTime(n.createdAt)}</span>
            </span>
          </button>
        ))}
        {!list.data.length && <div className="empty">You are all caught up.</div>}
      </section>
    </>
  );
}
