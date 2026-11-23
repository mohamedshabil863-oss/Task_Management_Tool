import { useEffect, useRef, useState } from 'react';
import { PRIORITY, STATUS, TEAM, initials } from '../format.js';

export const Avatar = ({ name, large }) => (
  <span className={`avatar ${large ? 'lg' : ''}`} title={name} aria-label={name}>{initials(name)}</span>
);

export const PriorityTag = ({ priority, suffix = '' }) => {
  const p = PRIORITY[priority];
  return <span className="tag" style={{ background: p.bg, color: p.fg }}>{p.label}{suffix}</span>;
};

export const TeamTag = ({ team }) => {
  const c = TEAM[team.type] || TEAM.OTHER;
  return <span className="tag" style={{ background: c.bg, color: c.fg }}>{team.name}</span>;
};

export const StatusText = ({ status }) => (
  <span className="status-text" style={{ color: STATUS[status].fg }}>{STATUS[status].label}</span>
);

export const StatusPill = ({ status }) => (
  <span className="row" style={{ gap: 6 }}>
    <span className="dot" style={{ background: STATUS[status].color }} />
    <span>{STATUS[status].label}</span>
  </span>
);

export const Icon = {
  search: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>,
  clock: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  list: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" /></svg>,
  bell: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" /></svg>,
  menu: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>,
  sub: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 3v12a3 3 0 003 3h9M15 15l3 3-3 3" /></svg>,
};

export function Modal({ title, children, onClose, footer }) {
  const ref = useRef();
  useEffect(() => {
    const prev = document.activeElement;
    const first = ref.current?.querySelector('textarea, input, select, button');
    first?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2>{title}</h2>
        {children}
        {footer && <div className="row" style={{ justifyContent: 'flex-end' }}>{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Asks for what a status move needs (reason, new assignee) before calling onConfirm.
 * move = { to, commentRequired, commentHint, needsAssignee }
 */
export function MoveDialog({ task, move, users = [], onConfirm, onClose }) {
  const [comment, setComment] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await onConfirm({ comment: comment.trim() || undefined, assigneeId: assigneeId ? Number(assigneeId) : undefined }); }
    catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Modal title={`Move ${task.key} to ${STATUS[move.to].label}`} onClose={onClose}>
      <form className="stack" style={{ gap: 14 }} onSubmit={submit}>
        {move.needsAssignee && (
          <label className="field">
            <span>New assignee</span>
            <select className="input" required value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Pick a person</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === task.assignee?.id ? ' (current)' : ''}</option>)}
            </select>
          </label>
        )}
        <label className="field">
          <span>{move.commentRequired ? move.commentHint : 'Comment (optional)'}</span>
          <textarea className="input" rows={3} required={move.commentRequired} value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
        {error && <div className="error-box">{error}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>Move to {STATUS[move.to].label}</button>
        </div>
      </form>
    </Modal>
  );
}

export const Loading = () => <div className="empty">Loading…</div>;
export const ErrorBox = ({ error }) => <div className="error-box">{error?.message || 'Something went wrong.'}</div>;
