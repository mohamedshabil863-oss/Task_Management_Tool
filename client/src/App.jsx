import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, Link, useLocation } from 'react-router-dom';
import { useAuth, TimerProvider, useTimer, useNow, useToast } from './context.jsx';
import { get } from './api.js';
import { clock } from './format.js';
import { Avatar, Icon, Loading } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Board from './pages/Board.jsx';
import TaskDetail from './pages/TaskDetail.jsx';
import TaskForm from './pages/TaskForm.jsx';
import MyTasks from './pages/MyTasks.jsx';
import Timesheet from './pages/Timesheet.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Projects from './pages/Projects.jsx';
import Users from './pages/Users.jsx';
import Teams from './pages/Teams.jsx';
import Notifications from './pages/Notifications.jsx';
import Account from './pages/Account.jsx';

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }
  const canPlan = user.role !== 'MEMBER';
  return (
    <TimerProvider>
      <Shell>
        <Routes>
          <Route path="/" element={<Navigate to={user.role === 'MEMBER' ? '/my-tasks' : '/board'} replace />} />
          <Route path="/board" element={<Board />} />
          <Route path="/my-tasks" element={<MyTasks />} />
          <Route path="/timesheet" element={<Timesheet />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/account" element={<Account />} />
          <Route path="/tasks/new" element={<TaskForm />} />
          <Route path="/tasks/:id" element={<TaskDetail />} />
          <Route path="/tasks/:id/edit" element={canPlan ? <TaskForm /> : <Navigate to="/" replace />} />
          {user.role === 'PM' && <Route path="/users" element={<Users />} />}
          {user.role === 'PM' && <Route path="/teams" element={<Teams />} />}
          <Route path="*" element={<div className="empty">This page does not exist, or you do not have access to it.</div>} />
        </Routes>
      </Shell>
    </TimerProvider>
  );
}

function Shell({ children }) {
  const { user, logout, isPM } = useAuth();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const location = useLocation();
  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    let alive = true;
    const load = () => get('/notifications/unread-count').then((r) => alive && setUnread(r.count)).catch(() => {});
    load();
    const id = setInterval(load, 30000);
    return () => { alive = false; clearInterval(id); };
  }, [location.pathname]);

  const link = (to, label, badge) => (
    <NavLink to={to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
      <span>{label}</span>{badge ? <span className="nav-badge" aria-label={`${badge} unread`}>{badge}</span> : null}
    </NavLink>
  );
  return (
    <div className="shell">
      <nav className={`sidebar ${open ? 'open' : ''}`} aria-label="Main">
        <Link to="/" className="brand"><span className="brand-mark">T</span>TaskBoard</Link>
        {link('/board', 'Board')}
        {link('/my-tasks', 'My tasks')}
        {link('/timesheet', 'My timesheet')}
        {link('/dashboard', user.role === 'MEMBER' ? 'My work' : 'Dashboard')}
        {link('/projects', 'Projects')}
        {link('/notifications', 'Notifications', unread)}
        {isPM && <div className="nav-section">PM only</div>}
        {isPM && link('/users', 'Users and roles')}
        {isPM && link('/teams', 'Teams')}
        <div className="sidebar-foot">
          {link('/account', 'My account')}
          <button className="btn ghost" style={{ justifyContent: 'flex-start' }} onClick={logout}>Log out</button>
        </div>
      </nav>
      <div className="main">
        <header className="topbar">
          <button className="btn ghost menu-btn" aria-label="Open menu" onClick={() => setOpen((o) => !o)}>{Icon.menu}</button>
          <RunningTimer />
          <Link to="/notifications" className="btn ghost" aria-label={`Notifications, ${unread} unread`} style={{ position: 'relative' }}>
            {Icon.bell}{unread > 0 && <span className="nav-badge" style={{ position: 'absolute', top: 2, right: 2, transform: 'scale(.85)' }}>{unread}</span>}
          </Link>
          <Link to="/account" className="row" style={{ textDecoration: 'none', color: 'inherit' }}>
            <Avatar name={user.name} large />
            <span className="stack" style={{ gap: 0 }}><strong>{user.name}</strong><span className="small muted">{user.roleLabel}</span></span>
          </Link>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}

function RunningTimer() {
  const { timer, stop } = useTimer();
  const toast = useToast();
  const now = useNow(!!timer);
  if (!timer) return null;
  return (
    <span className="timer-pill">
      <span className="pulse" aria-hidden="true" />
      <Link to={`/tasks/${timer.taskId}`} style={{ color: 'inherit', textDecoration: 'none' }} title={timer.taskTitle}>
        {timer.taskKey} · {clock(now - new Date(timer.startedAt).getTime())}
      </Link>
      <button className="btn danger small" style={{ minHeight: 28, borderRadius: 14 }} onClick={() => stop().then((r) => toast(`Timer stopped: ${r.minutes} min saved.`)).catch((e) => toast(e.message, 'error'))}>Stop</button>
    </span>
  );
}
