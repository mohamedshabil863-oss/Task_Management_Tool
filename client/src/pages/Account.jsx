import { useState } from 'react';
import { post } from '../api.js';
import { useAuth, useToast } from '../context.jsx';

export default function Account() {
  const { user } = useAuth();
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState('');
  const save = async (e) => {
    e.preventDefault();
    setError('');
    try { await post('/auth/change-password', { currentPassword: cur, newPassword: next }); setCur(''); setNext(''); toast('Password changed.'); } catch (err) { setError(err.message); }
  };
  return (
    <div className="stack" style={{ gap: 20, maxWidth: 560 }}>
      <h1>My account</h1>
      <section className="panel">
        <div className="details-grid">
          <div className="k">Name</div><div className="v">{user.name}</div>
          <div className="k">Email</div><div className="v">{user.email}</div>
          <div className="k">Role</div><div className="v">{user.roleLabel}</div>
          <div className="k">Team</div><div className="v">{user.team?.name || 'All teams'}</div>
        </div>
      </section>
      <form className="panel" onSubmit={save}>
        <h2>Change password</h2>
        <label className="field"><span>Current password</span><input className="input" type="password" autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} /></label>
        <label className="field"><span>New password (at least 8 characters)</span><input className="input" type="password" autoComplete="new-password" minLength={8} required value={next} onChange={(e) => setNext(e.target.value)} /></label>
        {error && <div className="error-box">{error}</div>}
        <div><button className="btn primary" type="submit">Change password</button></div>
      </form>
    </div>
  );
}
