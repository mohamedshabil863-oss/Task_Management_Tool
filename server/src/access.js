// All role-based access rules live here, so the routes stay small and the rules are easy to review.
import { forbidden, badRequest } from './errors.js';

export const STATUSES = ['TODO', 'REASSIGN', 'IN_PROGRESS', 'QA', 'COMPLETED', 'CANCELLED'];
export const OPEN_STATUSES = ['TODO', 'REASSIGN', 'IN_PROGRESS', 'QA'];
export const STATUS_LABELS = {
  TODO: 'To Do', REASSIGN: 'Re Assign', IN_PROGRESS: 'In Progress',
  QA: 'QA', COMPLETED: 'Completed', CANCELLED: 'Cancelled',
};
export const PRIORITIES = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];

export const isPM = (u) => u.role === 'PM';
export const isLeadOf = (u, teamId) => u.role === 'LEAD' && u.team_id === teamId;

/**
 * SQL condition limiting tasks (aliased `t`) to what the user may see.
 * PM sees all; LEAD sees tasks.team_id = my team; MEMBER sees tasks.assignee_id = me.
 * Returns [sql, params] where params continue from `startIndex`.
 */
export function taskScope(user, startIndex = 1) {
  if (isPM(user)) return ['TRUE', []];
  if (user.role === 'LEAD') return [`t.team_id = $${startIndex}`, [user.team_id]];
  return [`t.assignee_id = $${startIndex}`, [user.id]];
}

export function canSeeTask(user, task) {
  if (isPM(user)) return true;
  if (user.role === 'LEAD') return task.team_id === user.team_id;
  return task.assignee_id === user.id;
}

/** PM, or the lead of the task's team. */
export const canManageTask = (user, task) => isPM(user) || isLeadOf(user, task.team_id);

export function assertCanSee(user, task) {
  // Answer "not found" rather than "forbidden" so people can't probe for other teams' tasks.
  if (!task || !canSeeTask(user, task)) {
    const err = forbidden('Task not found.');
    err.status = 404;
    throw err;
  }
}

/**
 * Status workflow from the design doc.
 * who: 'assignee' (the task's assignee), 'lead' (lead of the task's team), 'pm'.
 */
export const TRANSITIONS = [
  { from: ['TODO'], to: 'IN_PROGRESS', who: ['assignee', 'lead', 'pm'] },
  { from: ['IN_PROGRESS'], to: 'QA', who: ['assignee', 'lead', 'pm'] },
  { from: ['QA'], to: 'COMPLETED', who: ['lead', 'pm'] },
  { from: ['QA'], to: 'IN_PROGRESS', who: ['lead', 'pm'], comment: 'Say what failed in QA.' },
  { from: ['TODO', 'IN_PROGRESS'], to: 'REASSIGN', who: ['assignee', 'lead', 'pm'], comment: 'Give the reason for sending it back.' },
  { from: ['REASSIGN'], to: 'TODO', who: ['lead', 'pm'], needsAssignee: true },
  { from: OPEN_STATUSES, to: 'CANCELLED', who: ['lead', 'pm'], comment: 'Give the reason for cancelling.' },
  { from: ['COMPLETED'], to: 'IN_PROGRESS', who: ['lead', 'pm'], comment: 'Say why the task is reopened.' },
  { from: ['CANCELLED'], to: 'TODO', who: ['pm'] },
];

function rolesFor(user, task) {
  const roles = [];
  if (isPM(user)) roles.push('pm');
  if (isLeadOf(user, task.team_id)) roles.push('lead');
  if (task.assignee_id === user.id) roles.push('assignee');
  return roles;
}

export function findTransition(user, task, to) {
  const roles = rolesFor(user, task);
  return TRANSITIONS.find((t) => t.from.includes(task.status) && t.to === to && t.who.some((w) => roles.includes(w)));
}

/** Statuses this user may move this task to, with what each move needs. */
export function allowedMoves(user, task) {
  return STATUSES.filter((s) => s !== task.status)
    .map((s) => ({ to: s, rule: findTransition(user, task, s) }))
    .filter((m) => m.rule)
    .map((m) => ({ to: m.to, commentRequired: !!m.rule.comment, commentHint: m.rule.comment || null, needsAssignee: !!m.rule.needsAssignee }));
}

export function assertTransition(user, task, to, { comment, assigneeId }) {
  if (!STATUSES.includes(to)) throw badRequest('Unknown status.');
  if (to === task.status) throw badRequest('The task is already in that status.');
  const rule = findTransition(user, task, to);
  if (!rule) {
    throw forbidden(`You cannot move a task from ${STATUS_LABELS[task.status]} to ${STATUS_LABELS[to]}.`);
  }
  if (rule.comment && !(comment && comment.trim())) throw badRequest(rule.comment, { commentRequired: true });
  if (rule.needsAssignee && !assigneeId) throw badRequest('Pick the new assignee before moving the task back to To Do.', { needsAssignee: true });
  return rule;
}

export function roleLabel(user, teamType) {
  if (user.role === 'PM') return 'Project Manager';
  const team = { FRONTEND: 'Frontend', BACKEND: 'Backend', HR: 'HR' }[teamType] || 'Team';
  if (user.role === 'LEAD') return `${team} Lead`;
  return teamType === 'HR' ? 'HR Staff' : 'Developer';
}
