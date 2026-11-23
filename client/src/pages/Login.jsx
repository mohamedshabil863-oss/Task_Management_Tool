import { useState } from 'react';
import { useAuth } from '../context.jsx';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await login(email, password); } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="row" style={{ gap: 10 }}>
          <span className="brand-mark" style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--accent)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700 }}>T</span>
          <strong style={{ fontSize: 18 }}>TaskBoard</strong>
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <h1 style={{ fontSize: 22 }}>Log in</h1>
          <span className="muted small">Use the email and password your PM gave you.</span>
        </div>
        <label className="field"><span>Email</span>
          <input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field"><span>Password</span>
          <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="error-box" role="alert">{error}</div>}
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
        <button type="button" className="btn ghost small" onClick={() => setForgot((f) => !f)}>Forgot password?</button>
        {forgot && <div className="hint">Ask the Project Manager to set a new password for you on the Users and roles page. You can then change it under My account.</div>}
      </form>
    </div>
  );
}
