import { useState } from 'react';
import { get, post, patch } from '../api.js';
import { useLoad, useToast } from '../context.jsx';
import { Loading, ErrorBox, TeamTag } from '../components/ui.jsx';

export default function Teams() {
  const toast = useToast();
  const teams = useLoad(() => get('/teams'), []);
  const [name, setName] = useState('');
  const [type, setType] = useState('OTHER');
  const [renaming, setRenaming] = useState({});

  if (teams.error) return <ErrorBox error={teams.error} />;
  if (!teams.data) return <Loading />;
  const add = async (e) => {
    e.preventDefault();
    try { await post('/teams', { name, type }); setName(''); toast('Team added.'); teams.reload(); } catch (err) { toast(err.message, 'error'); }
  };
  const rename = async (t) => {
    try { await patch(`/teams/${t.id}`, { name: renaming[t.id] }); setRenaming((r) => ({ ...r, [t.id]: undefined })); teams.reload(); } catch (err) { toast(err.message, 'error'); }
  };
  return (
    <>
      <div className="page-head"><h1>Teams</h1></div>
      <section className="panel">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Team</th><th>Type</th><th>Lead</th><th>Active members</th><th /></tr></thead>
            <tbody>
              {teams.data.map((t) => (
                <tr key={t.id}>
                  <td>{renaming[t.id] !== undefined
                    ? <input className="input" aria-label="Team name" value={renaming[t.id]} onChange={(e) => setRenaming((r) => ({ ...r, [t.id]: e.target.value }))} />
                    : <TeamTag team={t} />}</td>
                  <td className="small muted">{t.type}</td>
                  <td>{t.lead?.name || <span className="muted">No lead. Set one on Users and roles.</span>}</td>
                  <td>{t.members}</td>
                  <td style={{ textAlign: 'right' }}>
                    {renaming[t.id] !== undefined
                      ? <button className="btn small primary" onClick={() => rename(t)}>Save</button>
                      : <button className="btn ghost small" onClick={() => setRenaming((r) => ({ ...r, [t.id]: t.name }))}>Rename</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <form className="panel" onSubmit={add}>
        <h2>Add a team</h2>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="field grow"><span>Name</span><input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field"><span>Type</span>
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="OTHER">Other</option><option value="FRONTEND">Frontend</option><option value="BACKEND">Backend</option><option value="HR">HR</option>
            </select>
          </label>
          <button className="btn primary" type="submit">Add team</button>
        </div>
        <div className="hint">Each team sees only its own tasks. Add the team to a project on the Projects page before creating tasks for it.</div>
      </form>
    </>
  );
}
