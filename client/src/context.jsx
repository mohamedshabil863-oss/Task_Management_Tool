import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { get, post, setToken, getToken, setUnauthorizedHandler } from './api.js';

const AuthCtx = createContext(null);
const ToastCtx = createContext(() => {});
const TimerCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!getToken());

  const logout = useCallback(() => { setToken(null); setUser(null); }, []);
  useEffect(() => { setUnauthorizedHandler(logout); }, [logout]);

  useEffect(() => {
    if (!getToken()) return;
    get('/auth/me').then(setUser).catch(() => logout()).finally(() => setLoading(false));
  }, [logout]);

  const login = useCallback(async (email, password) => {
    const res = await post('/auth/login', { email, password });
    setToken(res.token);
    setUser(res.user);
  }, []);

  const value = useMemo(() => ({
    user, loading, login, logout,
    isPM: user?.role === 'PM', isLead: user?.role === 'LEAD', isMember: user?.role === 'MEMBER',
  }), [user, loading, login, logout]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timer = useRef();
  const show = useCallback((message, kind = 'info') => {
    clearTimeout(timer.current);
    setToast({ message, kind });
    timer.current = setTimeout(() => setToast(null), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && <div role="status" className={`toast ${toast.kind === 'error' ? 'error' : ''}`}>{toast.message}</div>}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** The current user's running timer, shared by the top bar and task pages. */
export function TimerProvider({ children }) {
  const { user } = useAuth();
  const [timer, setTimer] = useState(null);
  const [version, setVersion] = useState(0); // bump to tell pages that time changed
  const refresh = useCallback(async () => {
    if (!user) { setTimer(null); return; }
    try { setTimer(await get('/time/current')); } catch { /* ignore */ }
  }, [user]);
  useEffect(() => { refresh(); const id = setInterval(refresh, 60000); return () => clearInterval(id); }, [refresh]);
  const start = useCallback(async (taskId) => { const t = await post('/time/start', { taskId }); setTimer(t); setVersion((v) => v + 1); return t; }, []);
  const stop = useCallback(async () => { const r = await post('/time/stop'); setTimer(null); setVersion((v) => v + 1); return r; }, []);
  const changed = useCallback(() => { refresh(); setVersion((v) => v + 1); }, [refresh]);
  return <TimerCtx.Provider value={{ timer, start, stop, refresh, changed, version }}>{children}</TimerCtx.Provider>;
}
export const useTimer = () => useContext(TimerCtx);

/** Load data on mount / when deps change. Returns { data, error, loading, reload, setData }. */
export function useLoad(fn, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fn().then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error) => alive && setState({ data: null, error, loading: false }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((data) => setState((s) => ({ ...s, data: typeof data === 'function' ? data(s.data) : data })), []);
  return { ...state, reload, setData };
}

/** Re-render every second (for live timers). */
export function useNow(active = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}
