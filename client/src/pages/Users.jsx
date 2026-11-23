import { useState } from 'react';
import { get, post, patch } from '../api.js';
import { useAuth, useLoad, useToast } from '../context.jsx';
import { Avatar, Modal, Loading, ErrorBox, TeamTag } from '../components/ui.jsx';

const ROLE_LABEL = { PM: 'Project Manager', LEAD: 'Team Lead', MEMBER: 'Developer / HR Staff' };

export default function Users() {
  const { user: me } = useAuth();
  const toast = useToast();
  const users = useLoad(() => get('/users'), []);
  const teams = useLoad(() => get('/teams'), []);
  const [edit, setEdit] = useState(null);
  const [filter, setFilter] = useState('');

  if (users.error) return <ErrorBox error={users.error} />;
  if (!users.data) return <Loading />;
  const list = users.data.filter((u) => !filter || (filter === 'inactive' ? !u.isActive : u.team?.id === Number(filter)));
  const toggleActive = async (u) => {
    if (u.isActive && !window.confirm(`Deactivate ${u.name}? They will not be able to log in. Their tasks and history stay.`)) return;
    try { await patch(`/users/${u.id}`, { isActive: !u.isActive }); toast(`${u.name} ${u.isActive ? 'deactivated' : 'activated'}.`); users.reload(); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <div className="sub">{users.data.filter((u) => u.isActive).length} active people</div>
          <h1>Users and roles</h1>
        </div>
        <div className="row">
          <select className="compact" aria-label="Filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">Everyone</option>
            {(teams.data || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            <option value="inactive">Deactivated</option>
          </select>
          <button className="btn primary" onClick={() => setEdit({})}>+ Add user</button>
        </div>
      </div>
      <section className="panel">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Team</th><th>Open tasks</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.id} style={u.isActive ? undefined : { opacity: 0.6 }}>
                  <td><span className="row"><Avatar name={u.name} /><strong>{u.name}</strong></span></td>
                  <td className="small">{u.email}</td>
                  <td>{u.roleLabel}</td>
                  <td>{u.team ? <TeamTag team={u.team} /> : <span className="muted">—</span>}</td>
                  <td>{u.openTasks}</td>
                  <td>{u.isActive ? <span style={{ color: 'var(--success)', fontWeight: 600 }}>Active</span> : <span className="muted">Deactivated</span>}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn ghost small" onClick={() => setEdit(u)}>Edit</button>
                    {u.id !== me.id && <button className="btn ghost small" onClick={() => toggleActive(u)}>{u.isActive ? 'Deactivate' : 'Activate'}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="hint">Roles: the Project Manager sees everything. A Team Lead sees and manages only their own team. Developers and HR staff see only tasks assigned to them. Making someone the lead of a team turns the previous lead into a member.</div>
      {edit && <UserDialog user={edit} teams={teams.data || []} isSelf={edit.id === me.id} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); users.reload(); teams.reload(); }} />}
    </>
  );
}

function UserDialog({ user, teams, isSelf, onClose, onSaved }) {
  const toast = useToast();
  const isNew = !user.id;
  const [f, setF] = useState({ name: user.name || '', email: user.email || '', role: user.role || 'MEMBER', teamId: user.team?.id || '', password: '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    const body = { name: f.name, email: f.email, role: f.role, teamId: f.role === 'PM' ? null : Number(f.teamId) || null };
    if (f.password) body.password = f.password;
    try {
      if (isNew) await post('/users', body); else await patch(`/users/${user.id}`, body);
      toast(isNew ? `${f.name} added.` : 'User saved.');
      onSaved();
    } catch (err) { setError(err.message); }
  };
  return (
    <Modal title={isNew ? 'Add user' : `Edit ${user.name}`} onClose={onClose}>
      <form className="stack" style={{ gap: 14 }} onSubmit={save}>
        <label className="field"><span>Name</span><input className="input" required value={f.name} onChange={set('name')} /></label>
        <label className="field"><span>Email (used to log in)</span><input className="input" type="email" required value={f.email} onChange={set('email')} /></label>
        <div className="form-grid">
          <label className="field"><span>Role</span>
            <select className="input" value={f.role} onChange={set('role')} disabled={isSelf}>
              {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          {f.role !== 'PM' && (
            <label className="field"><span>Team</span>
              <select className="input" required value={f.teamId} onChange={set('teamId')}>
                <option value="">Pick a team</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}{t.lead && f.role === 'LEAD' && t.lead.id !== user.id ? ` (lead now: ${t.lead.name})` : ''}</option>)}
              </select>
            </label>
          )}
        </div>
        <label className="field"><span>{isNew ? 'First password (at least 8 characters)' : 'Set a new password (leave empty to keep)'}</span>
          <input className="input" type="text" autoComplete="new-password" required={isNew} minLength={8} value={f.password} onChange={set('password')} />
        </label>
        {error && <div className="error-box">{error}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">{isNew ? 'Add user' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}
