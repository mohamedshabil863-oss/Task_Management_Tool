export const STATUSES = ['TODO', 'REASSIGN', 'IN_PROGRESS', 'QA', 'COMPLETED', 'CANCELLED'];
export const STATUS = {
  TODO: { label: 'To Do', color: '#6B7280', fg: '#475467', rule: '' },
  REASSIGN: { label: 'Re Assign', color: '#C2410C', fg: '#B54708', rule: 'Sent back to lead' },
  IN_PROGRESS: { label: 'In Progress', color: '#2563EB', fg: '#1D4ED8', rule: '' },
  QA: { label: 'QA', color: '#7C3AED', fg: '#6D28D9', rule: 'Lead or PM approves' },
  COMPLETED: { label: 'Completed', color: '#15803D', fg: '#15803D', rule: 'Lead or PM only' },
  CANCELLED: { label: 'Cancelled', color: '#9CA3AF', fg: '#5B6470', rule: 'Lead or PM only' },
};
export const PRIORITIES = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];
export const PRIORITY = {
  URGENT: { label: 'Urgent', bg: '#FDE8E8', fg: '#B42318' },
  HIGH: { label: 'High', bg: '#FFF1E6', fg: '#B54708' },
  MEDIUM: { label: 'Medium', bg: '#EEF2FF', fg: '#3538CD' },
  LOW: { label: 'Low', bg: '#F2F4F7', fg: '#475467' },
};
export const TEAM = {
  FRONTEND: { bg: '#E0EAFF', fg: '#1D3A9E' },
  BACKEND: { bg: '#DCFCE7', fg: '#166534' },
  HR: { bg: '#FCE7F6', fg: '#9D174D' },
  OTHER: { bg: '#F2F4F7', fg: '#344054' },
};

export function minutes(m) {
  if (!m) return '0h';
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (!h) return `${mm}m`;
  return mm ? `${h}h ${String(mm).padStart(2, '0')}m` : `${h}h`;
}

/** Parse "1h 30m", "1.5", "90m", "1:30" into minutes. */
export function parseDuration(s) {
  const str = String(s || '').trim().toLowerCase();
  if (!str) return null;
  let m = str.match(/^(\d+):(\d{1,2})$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = str.match(/^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$/);
  if (m && (m[1] || m[2])) return Math.round(Number(m[1] || 0) * 60) + Number(m[2] || 0);
  if (/^\d+(\.\d+)?$/.test(str)) return Math.round(Number(str) * 60);
  return null;
}

export function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function shortDate(d) {
  if (!d) return '';
  const [y, mo, da] = d.slice(0, 10).split('-').map(Number);
  const cur = new Date().getFullYear();
  return `${MONTHS[mo - 1]} ${da}${y !== cur ? `, ${y}` : ''}`;
}
export function dateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
export const todayStr = () => new Date().toLocaleDateString('en-CA');

export function relativeDue(d) {
  if (!d) return '';
  const t = todayStr();
  const diff = Math.round((new Date(`${d}T12:00:00`) - new Date(`${t}T12:00:00`)) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return shortDate(d);
}

export function since(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'}`;
  const days = Math.floor(h / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';

// Mirror of the server's workflow table, used to light up allowed columns while dragging.
// The server checks every move again, so this is only for a friendly UI.
const OPEN = ['TODO', 'REASSIGN', 'IN_PROGRESS', 'QA'];
const TRANSITIONS = [
  { from: ['TODO'], to: 'IN_PROGRESS', who: ['assignee', 'lead', 'pm'] },
  { from: ['IN_PROGRESS'], to: 'QA', who: ['assignee', 'lead', 'pm'] },
  { from: ['QA'], to: 'COMPLETED', who: ['lead', 'pm'] },
  { from: ['QA'], to: 'IN_PROGRESS', who: ['lead', 'pm'], comment: 'Say what failed in QA.' },
  { from: ['TODO', 'IN_PROGRESS'], to: 'REASSIGN', who: ['assignee', 'lead', 'pm'], comment: 'Give the reason for sending it back.' },
  { from: ['REASSIGN'], to: 'TODO', who: ['lead', 'pm'], needsAssignee: true },
  { from: OPEN, to: 'CANCELLED', who: ['lead', 'pm'], comment: 'Give the reason for cancelling.' },
  { from: ['COMPLETED'], to: 'IN_PROGRESS', who: ['lead', 'pm'], comment: 'Say why the task is reopened.' },
  { from: ['CANCELLED'], to: 'TODO', who: ['pm'] },
];
export function allowedMovesFor(user, task) {
  const roles = [];
  if (user.role === 'PM') roles.push('pm');
  if (user.role === 'LEAD' && user.team?.id === task.team.id) roles.push('lead');
  if (task.assignee?.id === user.id) roles.push('assignee');
  return TRANSITIONS.filter((t) => t.from.includes(task.status) && t.who.some((w) => roles.includes(w)))
    .map((t) => ({ to: t.to, commentRequired: !!t.comment, commentHint: t.comment || null, needsAssignee: !!t.needsAssignee }));
}
