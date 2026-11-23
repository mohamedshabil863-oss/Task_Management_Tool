import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { DndContext, DragOverlay, MouseSensor, TouchSensor, KeyboardSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { get, post } from '../api.js';
import { useAuth, useLoad, useToast } from '../context.jsx';
import { STATUSES, STATUS, PRIORITIES, PRIORITY, minutes, relativeDue, allowedMovesFor } from '../format.js';
import { Avatar, PriorityTag, TeamTag, Icon, MoveDialog, Loading, ErrorBox } from '../components/ui.jsx';

export default function Board() {
  const { user, isPM, isMember } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [projectId, setProjectId] = useState(location.state?.projectId ? String(location.state.projectId) : '');
  const [teamId, setTeamId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [priority, setPriority] = useState('');
  const [due, setDue] = useState('');
  const [q, setQ] = useState('');
  const [showSubs, setShowSubs] = useState(true);
  const [dragging, setDragging] = useState(null);
  const [pending, setPending] = useState(null); // { task, move }

  const meta = useLoad(() => Promise.all([get('/projects'), get('/teams'), get('/users')]), []);
  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (teamId) params.set('teamId', teamId);
  if (assigneeId) params.set('assigneeId', assigneeId);
  if (priority) params.set('priority', priority);
  if (due) params.set('due', due);
  if (q.trim()) params.set('q', q.trim());
  if (!showSubs) params.set('topLevel', 'true');
  const qs = params.toString();
  const tasks = useLoad(() => get(`/tasks?${qs}`), [qs]);

  const [projects, teams, users] = meta.data || [[], [], []];
  const columns = useMemo(() => {
    const by = Object.fromEntries(STATUSES.map((s) => [s, []]));
    for (const t of tasks.data || []) by[t.status].push(t);
    return by;
  }, [tasks.data]);
  const allowed = dragging ? allowedMovesFor(user, dragging) : [];

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // On phones a long press starts the drag, so a normal swipe still scrolls the board.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const applyMove = async (task, move, extra = {}) => {
    const prev = tasks.data;
    tasks.setData((list) => list.map((t) => (t.id === task.id ? { ...t, status: move.to } : t)));
    try {
      const updated = await post(`/tasks/${task.id}/status`, { status: move.to, ...extra });
      tasks.setData((list) => list.map((t) => (t.id === task.id ? updated : t)));
      toast(`${task.key} moved to ${STATUS[move.to].label}.`);
    } catch (err) {
      tasks.setData(prev);
      throw err;
    }
  };

  const onDragEnd = ({ active, over }) => {
    const task = dragging;
    setDragging(null);
    if (!over || !task || over.id === task.status) return;
    const move = allowedMovesFor(user, task).find((m) => m.to === over.id);
    if (!move) {
      toast(`You cannot move ${task.key} from ${STATUS[task.status].label} to ${STATUS[over.id].label}.`, 'error');
      return;
    }
    if (move.commentRequired || move.needsAssignee) { setPending({ task, move }); return; }
    applyMove(task, move).catch((err) => toast(err.message, 'error'));
    void active;
  };

  const project = projects.find((p) => String(p.id) === projectId);
  const scopeText = isPM ? 'All teams' : isMember ? 'Tasks assigned to you' : `${user.team?.name} team`;
  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <div className="sub">{scopeText}</div>
          <h1>{project ? project.name : 'Board'}</h1>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <label className="search">
            {Icon.search}
            <input type="search" placeholder="Search tasks" aria-label="Search tasks" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          {!isMember && <Link className="btn primary" to={`/tasks/new${projectId ? `?projectId=${projectId}` : ''}`}>+ New task</Link>}
        </div>
      </div>

      <div className="row" role="group" aria-label="Filters">
        <span className="small muted" style={{ marginRight: 4 }}>Filter</span>
        <select className="compact" aria-label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {isPM && (
          <>
            <button className={`chip ${!teamId ? 'on' : ''}`} aria-pressed={!teamId} onClick={() => setTeamId('')}>Team: All</button>
            {teams.map((t) => (
              <button key={t.id} className={`chip ${teamId === String(t.id) ? 'on' : ''}`} aria-pressed={teamId === String(t.id)} onClick={() => setTeamId(String(t.id))}>{t.name}</button>
            ))}
          </>
        )}
        {!isMember && (
          <select className="compact" aria-label="Assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">Any assignee</option>
            {users.filter((u) => u.role !== 'PM' && u.isActive).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
        <select className="compact" aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY[p].label}</option>)}
        </select>
        <select className="compact" aria-label="Due date" value={due} onChange={(e) => setDue(e.target.value)}>
          <option value="">Any due date</option>
          <option value="overdue">Overdue</option>
          <option value="week">Due in 7 days</option>
          <option value="none">No due date</option>
        </select>
        <label className="row small" style={{ gap: 6, marginLeft: 4 }}>
          <input type="checkbox" checked={showSubs} onChange={(e) => setShowSubs(e.target.checked)} /> Show subtasks
        </label>
        <span className="spacer small muted">Drag a card to change its status</span>
      </div>

      {(tasks.error || meta.error) && <ErrorBox error={tasks.error || meta.error} />}
      {tasks.loading && !tasks.data ? <Loading /> : (
        <DndContext
          sensors={sensors}
          onDragStart={({ active }) => setDragging((tasks.data || []).find((t) => t.id === active.id) || null)}
          onDragCancel={() => setDragging(null)}
          onDragEnd={onDragEnd}
        >
          <div className="board-scroll">
            <div className="board">
              {STATUSES.map((s) => (
                <Column key={s} status={s} tasks={columns[s]} dragging={dragging}
                  canDrop={allowed.some((m) => m.to === s)} onOpen={(t) => navigate(`/tasks/${t.id}`)} />
              ))}
            </div>
          </div>
          <DragOverlay>{dragging ? <CardBody task={dragging} className="overlay" /> : null}</DragOverlay>
        </DndContext>
      )}

      {pending && (
        <MoveDialog
          task={pending.task}
          move={pending.move}
          users={users.filter((u) => u.team?.id === pending.task.team.id && u.isActive)}
          onClose={() => setPending(null)}
          onConfirm={async (extra) => { await applyMove(pending.task, pending.move, extra); setPending(null); }}
        />
      )}
    </>
  );
}

function Column({ status, tasks, dragging, canDrop, onOpen }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const st = STATUS[status];
  const cls = dragging && dragging.status !== status ? (canDrop ? (isOver ? 'over' : 'can-drop') : 'no-drop') : '';
  return (
    <section ref={setNodeRef} className={`column ${cls}`} aria-label={st.label}>
      <div className="column-head">
        <span className="dot" style={{ background: st.color }} />
        <h2 style={{ fontSize: 14 }}>{st.label}</h2>
        <span className="count">{tasks.length}</span>
      </div>
      <div className="small muted" style={{ padding: '0 4px', minHeight: 16 }}>{st.rule}</div>
      {tasks.map((t) => <DraggableCard key={t.id} task={t} onOpen={onOpen} />)}
      {!tasks.length && <div className="empty" style={{ padding: 12 }}>No tasks</div>}
    </section>
  );
}

function DraggableCard({ task, onOpen }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} aria-roledescription="Draggable task card"
      onClick={() => onOpen(task)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(task); listeners?.onKeyDown?.(e); }}>
      <CardBody task={task} className={isDragging ? 'dragging' : ''} />
    </div>
  );
}

function CardBody({ task, className = '' }) {
  return (
    <div className={`card ${className}`}>
      <div className="card-meta">
        <span>{task.key}{task.parent && <span title={`Subtask of ${task.parent.key}`}> · {Icon.sub} {task.parent.key}</span>}</span>
        <TeamTag team={task.team} />
      </div>
      <div className="title">{task.title}</div>
      <div className="card-meta">
        <span className="row" style={{ gap: 10 }}>
          <PriorityTag priority={task.priority} />
          {task.subtasks.total > 0 && <span className="icon-text" title="Subtasks done">{Icon.list}{task.subtasks.done}/{task.subtasks.total}</span>}
          <span className="icon-text" title="Time spent" style={task.timerRunning ? { color: 'var(--success)', fontWeight: 600 } : undefined}>{Icon.clock}{minutes(task.spentMinutes)}</span>
        </span>
        <span className="row" style={{ gap: 8 }}>
          {task.dueDate && <span className={task.isLate ? 'late' : ''}>{relativeDue(task.dueDate)}</span>}
          {task.assignee ? <Avatar name={task.assignee.name} /> : <span className="avatar" title="Unassigned">?</span>}
        </span>
      </div>
    </div>
  );
}
