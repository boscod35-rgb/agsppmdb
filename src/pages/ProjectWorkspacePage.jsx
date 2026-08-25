import { useEffect, useState } from 'react';

// Which tabs render is driven by the WorkspaceModules Configuration
// Engine category (migration 007, extended in migrations 008 and
// 009) so a module can be hidden platform-wide via Administration ->
// Project Configuration without a code change. Real content so far:
// Charter (Chunk 04), WBS and Schedule - the latter hosting Tasks,
// Dependencies, Milestones, and Deliverables together as sub-tabs,
// matching how the framework's own Chunk 05 scope groups Modules
// 13-15 (see WbsPanel / SchedulePanel below). Every other tab is
// still a placeholder.

function CharterPanel({ projectId }) {
  const [charter, setCharter] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [status, setStatus] = useState('loading');
  const [errorDetail, setErrorDetail] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [actionError, setActionError] = useState('');

  useEffect(() => { load(); }, [projectId]);

  async function load() {
    setStatus('loading');
    setErrorDetail('');
    try {
      const res = await fetch(`/api/ppm/charters/${projectId}`);
      const data = await res.json();
      if (res.ok && data.success) {
        setCharter(data.charter);
        setNotFound(false);
        setStatus('ok');
      } else if (res.status === 404) {
        setNotFound(true);
        setStatus('ok');
      } else {
        setStatus('error'); setErrorDetail(data.detail || data.message || `HTTP ${res.status}`);
      }
    } catch {
      setStatus('error'); setErrorDetail(`Could not reach /api/ppm/charters/${projectId}.`);
    }
  }

  function startEdit() {
    setForm({
      objectives: charter?.Objectives || '',
      scope: charter?.Scope || '',
      assumptions: charter?.Assumptions || '',
      constraints: charter?.Constraints || '',
      businessCase: charter?.BusinessCase || '',
    });
    setEditing(true);
    setActionError('');
  }

  async function handleSave() {
    setActionError('');
    try {
      const method = notFound ? 'POST' : 'PUT';
      const res = await fetch(`/api/ppm/charters/${projectId}`, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok && data.success) { setEditing(false); load(); }
      else setActionError(data.detail || data.message || 'Could not save charter.');
    } catch { setActionError('Could not reach /api/ppm/charters.'); }
  }

  async function handleApprove() {
    const approvedByName = window.prompt('Approver name?');
    if (approvedByName === null) return;
    setActionError('');
    try {
      const res = await fetch(`/api/ppm/charters/${projectId}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approvedByName }),
      });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not approve charter.');
    } catch { setActionError('Could not reach /api/ppm/charters.'); }
  }

  if (status === 'loading') return <p>Loading charter&hellip;</p>;
  if (status === 'error') return <div className="error-box"><strong>Could not load charter.</strong><p>{errorDetail}</p></div>;

  if (editing) {
    return (
      <div>
        {actionError && <div className="error-box"><strong>Action failed.</strong><p>{actionError}</p></div>}
        <dl>
          <dt>Objectives</dt><dd><textarea rows={2} style={{ width: '100%' }} value={form.objectives} onChange={(e) => setForm({ ...form, objectives: e.target.value })} /></dd>
          <dt>Scope</dt><dd><textarea rows={2} style={{ width: '100%' }} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} /></dd>
          <dt>Assumptions</dt><dd><textarea rows={2} style={{ width: '100%' }} value={form.assumptions} onChange={(e) => setForm({ ...form, assumptions: e.target.value })} /></dd>
          <dt>Constraints</dt><dd><textarea rows={2} style={{ width: '100%' }} value={form.constraints} onChange={(e) => setForm({ ...form, constraints: e.target.value })} /></dd>
          <dt>Business Case</dt><dd><textarea rows={2} style={{ width: '100%' }} value={form.businessCase} onChange={(e) => setForm({ ...form, businessCase: e.target.value })} /></dd>
        </dl>
        <button onClick={handleSave}>Save Charter</button>{' '}
        <button onClick={() => setEditing(false)}>Cancel</button>
      </div>
    );
  }

  if (notFound) {
    return (
      <div>
        <p className="placeholder-detail">No charter has been created for this project yet.</p>
        <button onClick={startEdit}>+ Create Charter</button>
      </div>
    );
  }

  return (
    <div>
      {actionError && <div className="error-box"><strong>Action failed.</strong><p>{actionError}</p></div>}
      <div className="detail-header">
        <h3 style={{ fontSize: '1rem' }}>Project Charter</h3>
        <span className={`status-pill status-${charter.ApprovalStatusCode === 'APPROVED' ? 'active' : 'paused'}`}>{charter.ApprovalStatusLabel || '\u2014'}</span>
      </div>
      <dl>
        <dt>Objectives</dt><dd>{charter.Objectives || '\u2014'}</dd>
        <dt>Scope</dt><dd>{charter.Scope || '\u2014'}</dd>
        <dt>Assumptions</dt><dd>{charter.Assumptions || '\u2014'}</dd>
        <dt>Constraints</dt><dd>{charter.Constraints || '\u2014'}</dd>
        <dt>Business Case</dt><dd>{charter.BusinessCase || '\u2014'}</dd>
        <dt>Approved By</dt><dd>{charter.ApprovedByName || '\u2014'}</dd>
        <dt>Approved Date</dt><dd>{charter.ApprovedDate ? new Date(charter.ApprovedDate).toLocaleDateString() : '\u2014'}</dd>
      </dl>
      <button onClick={startEdit}>Edit</button>{' '}
      {charter.ApprovalStatusCode !== 'APPROVED' && <button onClick={handleApprove}>Approve</button>}
    </div>
  );
}

function WbsPanel({ projectId, project }) {
  const [items, setItems] = useState([]);
  const [pathTypes, setPathTypes] = useState([]);
  const [status, setStatus] = useState('loading');
  const [errorDetail, setErrorDetail] = useState('');
  const [actionError, setActionError] = useState('');
  const [newItemName, setNewItemName] = useState('');
  const [newItemParent, setNewItemParent] = useState('');

  useEffect(() => { load(); }, [projectId]);

  async function load() {
    setStatus('loading');
    setErrorDetail('');
    try {
      const [itemsRes, ptRes] = await Promise.all([
        fetch(`/api/ppm/wbs/${projectId}`),
        fetch('/api/config/values?category=WbsPathType'),
      ]);
      const itemsData = await itemsRes.json();
      const ptData = await ptRes.json();
      if (itemsRes.ok && itemsData.success) {
        setItems(itemsData.items);
        setPathTypes(ptData.success ? ptData.values : []);
        setStatus('ok');
      } else {
        setStatus('error'); setErrorDetail(itemsData.detail || itemsData.message || `HTTP ${itemsRes.status}`);
      }
    } catch {
      setStatus('error'); setErrorDetail(`Could not reach /api/ppm/wbs/${projectId}.`);
    }
  }

  async function handleAdd() {
    if (!newItemName.trim()) return;
    setActionError('');
    try {
      const res = await fetch(`/api/ppm/wbs/${projectId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemName: newItemName, parentWbsItemId: newItemParent || null }),
      });
      const data = await res.json();
      if (res.ok && data.success) { setNewItemName(''); load(); }
      else setActionError(data.detail || data.message || 'Could not add WBS item.');
    } catch { setActionError('Could not reach /api/ppm/wbs.'); }
  }

  async function handleToggle(itemId) {
    try {
      const res = await fetch(`/api/ppm/wbs/${projectId}/${itemId}/toggle`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not toggle item.');
    } catch { setActionError('Could not reach /api/ppm/wbs.'); }
  }

  async function handleMove(itemId, dir) {
    try {
      const res = await fetch(`/api/ppm/wbs/${projectId}/${itemId}/move-${dir}`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not move item.');
    } catch { setActionError('Could not reach /api/ppm/wbs.'); }
  }

  async function handleArchive(itemId) {
    if (!window.confirm('Remove this WBS item (and any sub-items)?')) return;
    try {
      const res = await fetch(`/api/ppm/wbs/${projectId}/${itemId}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not remove item.');
    } catch { setActionError('Could not reach /api/ppm/wbs.'); }
  }

  async function handleGenerateFromTemplate() {
    setActionError('');
    try {
      const res = await fetch(`/api/ppm/wbs/${projectId}/generate-from-template`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not generate from template.');
    } catch { setActionError('Could not reach /api/ppm/wbs.'); }
  }

  if (status === 'loading') return <p>Loading WBS&hellip;</p>;
  if (status === 'error') return <div className="error-box"><strong>Could not load WBS.</strong><p>{errorDetail}</p></div>;

  const topLevel = items.filter((i) => !i.ParentWbsItemId);
  const childrenOf = (parentId) => items.filter((i) => i.ParentWbsItemId === parentId);

  function renderItem(item, depth) {
    const children = childrenOf(item.WbsItemId);
    return (
      <div key={item.WbsItemId} style={{ marginLeft: depth * 20, padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
        <input type="checkbox" checked={item.IsComplete} onChange={() => handleToggle(item.WbsItemId)} />{' '}
        <span style={{ textDecoration: item.IsComplete ? 'line-through' : 'none' }}>{item.ItemName}</span>{' '}
        {item.PathTypeCode && item.PathTypeCode !== 'NEUTRAL' && (
          <span className={`status-pill status-${item.PathTypeCode === 'GREEN' ? 'active' : 'deprecated'}`}>{item.PathTypeLabel}</span>
        )}{' '}
        <button onClick={() => handleMove(item.WbsItemId, 'up')}>&uarr;</button>{' '}
        <button onClick={() => handleMove(item.WbsItemId, 'down')}>&darr;</button>{' '}
        <button onClick={() => handleArchive(item.WbsItemId)}>Remove</button>
        {children.map((c) => renderItem(c, depth + 1))}
      </div>
    );
  }

  return (
    <div>
      {actionError && <div className="error-box"><strong>Action failed.</strong><p>{actionError}</p></div>}
      {items.length === 0 && project?.TemplateId && (
        <div style={{ marginBottom: 16 }}>
          <p className="placeholder-detail">This project has a Template assigned but no WBS items yet.</p>
          <button onClick={handleGenerateFromTemplate}>Generate WBS from Template</button>
        </div>
      )}
      <div>
        {topLevel.length === 0 ? <p className="placeholder-detail">No WBS items yet.</p> : topLevel.map((i) => renderItem(i, 0))}
      </div>
      <div className="filter-row" style={{ marginTop: 16 }}>
        <input placeholder="New item name" value={newItemName} onChange={(e) => setNewItemName(e.target.value)} />
        <select value={newItemParent} onChange={(e) => setNewItemParent(e.target.value)}>
          <option value="">Top level</option>
          {items.map((i) => <option key={i.WbsItemId} value={i.WbsItemId}>{i.ItemName}</option>)}
        </select>
        <button onClick={handleAdd}>+ Add Item</button>
      </div>
    </div>
  );
}

function SchedulePanel({ projectId }) {
  const [subTab, setSubTab] = useState('tasks');
  const [tasks, setTasks] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [deliverables, setDeliverables] = useState([]);
  const [statuses, setStatuses] = useState({ task: [], milestone: [], acceptance: [], dependencyType: [] });
  const [status, setStatus] = useState('loading');
  const [errorDetail, setErrorDetail] = useState('');
  const [actionError, setActionError] = useState('');
  const [newTask, setNewTask] = useState({ taskName: '', startDate: '', dueDate: '' });
  const [newMilestone, setNewMilestone] = useState({ milestoneName: '', plannedDate: '', isPhaseGate: false });
  const [newDeliverable, setNewDeliverable] = useState({ deliverableName: '', ownerName: '', plannedDate: '' });
  const [depFormTaskId, setDepFormTaskId] = useState(null);
  const [depTarget, setDepTarget] = useState('');

  useEffect(() => { load(); }, [projectId]);

  async function load() {
    setStatus('loading');
    setErrorDetail('');
    try {
      const [tRes, mRes, dRes, tsRes, msRes, asRes, dtRes] = await Promise.all([
        fetch(`/api/ppm/schedule/tasks/${projectId}`),
        fetch(`/api/ppm/milestones/${projectId}`),
        fetch(`/api/ppm/deliverables/${projectId}`),
        fetch('/api/config/values?category=TaskStatus'),
        fetch('/api/config/values?category=MilestoneStatus'),
        fetch('/api/config/values?category=DeliverableAcceptanceStatus'),
        fetch('/api/config/values?category=DependencyType'),
      ]);
      const tData = await tRes.json();
      const mData = await mRes.json();
      const dData = await dRes.json();
      if (tRes.ok && tData.success && mRes.ok && mData.success && dRes.ok && dData.success) {
        setTasks(tData.tasks);
        setMilestones(mData.milestones);
        setDeliverables(dData.deliverables);
        setStatuses({
          task: (await tsRes.json()).values || [],
          milestone: (await msRes.json()).values || [],
          acceptance: (await asRes.json()).values || [],
          dependencyType: (await dtRes.json()).values || [],
        });
        setStatus('ok');
      } else {
        setStatus('error'); setErrorDetail(tData.detail || mData.detail || dData.detail || 'Could not load schedule data.');
      }
    } catch {
      setStatus('error'); setErrorDetail('Could not reach the schedule APIs.');
    }
  }

  async function handleAddTask() {
    if (!newTask.taskName.trim()) return;
    setActionError('');
    try {
      const res = await fetch(`/api/ppm/schedule/tasks/${projectId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newTask, startDate: newTask.startDate || null, dueDate: newTask.dueDate || null }),
      });
      const data = await res.json();
      if (res.ok && data.success) { setNewTask({ taskName: '', startDate: '', dueDate: '' }); load(); }
      else setActionError(data.detail || data.message || 'Could not add task.');
    } catch { setActionError('Could not reach the schedule API.'); }
  }

  async function handleArchiveTask(id) {
    try {
      const res = await fetch(`/api/ppm/schedule/tasks/${projectId}/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not archive task.');
    } catch { setActionError('Could not reach the schedule API.'); }
  }

  async function handleAddDependency(taskId) {
    if (!depTarget) return;
    setActionError('');
    try {
      const res = await fetch(`/api/ppm/schedule/tasks/${projectId}/${taskId}/dependencies`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dependsOnTaskId: Number(depTarget) }),
      });
      const data = await res.json();
      if (res.ok && data.success) { setDepFormTaskId(null); setDepTarget(''); load(); }
      else setActionError(data.detail || data.message || 'Could not add dependency.');
    } catch { setActionError('Could not reach the schedule API.'); }
  }

  async function handleRemoveDependency(taskId, depId) {
    try {
      const res = await fetch(`/api/ppm/schedule/tasks/${projectId}/${taskId}/dependencies/${depId}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not remove dependency.');
    } catch { setActionError('Could not reach the schedule API.'); }
  }

  async function handleAddMilestone() {
    if (!newMilestone.milestoneName.trim()) return;
    setActionError('');
    try {
      const res = await fetch(`/api/ppm/milestones/${projectId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newMilestone, plannedDate: newMilestone.plannedDate || null }),
      });
      const data = await res.json();
      if (res.ok && data.success) { setNewMilestone({ milestoneName: '', plannedDate: '', isPhaseGate: false }); load(); }
      else setActionError(data.detail || data.message || 'Could not add milestone.');
    } catch { setActionError('Could not reach the milestones API.'); }
  }

  async function handleApproveMilestone(id) {
    const approvedByName = window.prompt('Approver name?');
    if (approvedByName === null) return;
    try {
      const res = await fetch(`/api/ppm/milestones/${projectId}/${id}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approvedByName }),
      });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not approve milestone.');
    } catch { setActionError('Could not reach the milestones API.'); }
  }

  async function handleArchiveMilestone(id) {
    try {
      const res = await fetch(`/api/ppm/milestones/${projectId}/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not archive milestone.');
    } catch { setActionError('Could not reach the milestones API.'); }
  }

  async function handleAddDeliverable() {
    if (!newDeliverable.deliverableName.trim()) return;
    setActionError('');
    try {
      const res = await fetch(`/api/ppm/deliverables/${projectId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newDeliverable, plannedDate: newDeliverable.plannedDate || null }),
      });
      const data = await res.json();
      if (res.ok && data.success) { setNewDeliverable({ deliverableName: '', ownerName: '', plannedDate: '' }); load(); }
      else setActionError(data.detail || data.message || 'Could not add deliverable.');
    } catch { setActionError('Could not reach the deliverables API.'); }
  }

  async function handleArchiveDeliverable(id) {
    try {
      const res = await fetch(`/api/ppm/deliverables/${projectId}/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not archive deliverable.');
    } catch { setActionError('Could not reach the deliverables API.'); }
  }

  if (status === 'loading') return <p>Loading schedule&hellip;</p>;
  if (status === 'error') return <div className="error-box"><strong>Could not load schedule.</strong><p>{errorDetail}</p></div>;

  return (
    <div>
      {actionError && <div className="error-box"><strong>Action failed.</strong><p>{actionError}</p></div>}
      <div className="filter-row" style={{ marginBottom: 12 }}>
        <button onClick={() => setSubTab('tasks')} style={{ fontWeight: subTab === 'tasks' ? 700 : 400 }}>Tasks</button>
        <button onClick={() => setSubTab('milestones')} style={{ fontWeight: subTab === 'milestones' ? 700 : 400 }}>Milestones</button>
        <button onClick={() => setSubTab('deliverables')} style={{ fontWeight: subTab === 'deliverables' ? 700 : 400 }}>Deliverables</button>
      </div>

      {subTab === 'tasks' && (
        <div>
          {tasks.map((t) => (
            <div key={t.ScheduleTaskId} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
              <strong>{t.TaskName}</strong> — {t.StatusLabel || '\u2014'} — {t.PercentComplete}%{' '}
              {t.StartDate && <span>({new Date(t.StartDate).toLocaleDateString()} &rarr; {t.DueDate ? new Date(t.DueDate).toLocaleDateString() : '?'})</span>}{' '}
              <button onClick={() => handleArchiveTask(t.ScheduleTaskId)}>Archive</button>{' '}
              <button onClick={() => setDepFormTaskId(depFormTaskId === t.ScheduleTaskId ? null : t.ScheduleTaskId)}>+ Dependency</button>
              {t.dependencies?.length > 0 && (
                <ul style={{ margin: '4px 0 0 16px', fontSize: '0.85rem' }}>
                  {t.dependencies.map((d) => (
                    <li key={d.TaskDependencyId}>
                      {d.DependencyTypeLabel} on {d.DependsOnTaskName}{' '}
                      <button onClick={() => handleRemoveDependency(t.ScheduleTaskId, d.TaskDependencyId)}>Remove</button>
                    </li>
                  ))}
                </ul>
              )}
              {depFormTaskId === t.ScheduleTaskId && (
                <div style={{ marginTop: 4 }}>
                  <select value={depTarget} onChange={(e) => setDepTarget(e.target.value)}>
                    <option value="">Depends on&hellip;</option>
                    {tasks.filter((o) => o.ScheduleTaskId !== t.ScheduleTaskId).map((o) => <option key={o.ScheduleTaskId} value={o.ScheduleTaskId}>{o.TaskName}</option>)}
                  </select>{' '}
                  <button onClick={() => handleAddDependency(t.ScheduleTaskId)}>Link</button>
                </div>
              )}
            </div>
          ))}
          {tasks.length === 0 && <p className="placeholder-detail">No tasks yet.</p>}
          <div className="filter-row" style={{ marginTop: 12 }}>
            <input placeholder="Task name" value={newTask.taskName} onChange={(e) => setNewTask({ ...newTask, taskName: e.target.value })} />
            <input type="date" value={newTask.startDate} onChange={(e) => setNewTask({ ...newTask, startDate: e.target.value })} />
            <input type="date" value={newTask.dueDate} onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value })} />
            <button onClick={handleAddTask}>+ Add Task</button>
          </div>
        </div>
      )}

      {subTab === 'milestones' && (
        <div>
          {milestones.map((m) => (
            <div key={m.MilestoneId} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
              <strong>{m.MilestoneName}</strong> {m.IsPhaseGate && <span className="status-pill status-paused">Phase Gate{m.PhaseName ? `: ${m.PhaseName}` : ''}</span>}{' '}
              — {m.StatusLabel || '\u2014'} {m.PlannedDate && <span>({new Date(m.PlannedDate).toLocaleDateString()})</span>}{' '}
              {m.StatusCode !== 'ACHIEVED' && <button onClick={() => handleApproveMilestone(m.MilestoneId)}>Approve</button>}{' '}
              <button onClick={() => handleArchiveMilestone(m.MilestoneId)}>Archive</button>
            </div>
          ))}
          {milestones.length === 0 && <p className="placeholder-detail">No milestones yet.</p>}
          <div className="filter-row" style={{ marginTop: 12 }}>
            <input placeholder="Milestone name" value={newMilestone.milestoneName} onChange={(e) => setNewMilestone({ ...newMilestone, milestoneName: e.target.value })} />
            <input type="date" value={newMilestone.plannedDate} onChange={(e) => setNewMilestone({ ...newMilestone, plannedDate: e.target.value })} />
            <label style={{ fontSize: '0.85rem' }}>
              <input type="checkbox" checked={newMilestone.isPhaseGate} onChange={(e) => setNewMilestone({ ...newMilestone, isPhaseGate: e.target.checked })} /> Phase Gate
            </label>
            <button onClick={handleAddMilestone}>+ Add Milestone</button>
          </div>
        </div>
      )}

      {subTab === 'deliverables' && (
        <div>
          {deliverables.map((d) => (
            <div key={d.DeliverableId} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
              <strong>{d.DeliverableName}</strong> — {d.OwnerName || '\u2014'} — {d.AcceptanceStatusLabel || '\u2014'}{' '}
              {d.PlannedDate && <span>({new Date(d.PlannedDate).toLocaleDateString()})</span>}{' '}
              <button onClick={() => handleArchiveDeliverable(d.DeliverableId)}>Archive</button>
            </div>
          ))}
          {deliverables.length === 0 && <p className="placeholder-detail">No deliverables yet.</p>}
          <div className="filter-row" style={{ marginTop: 12 }}>
            <input placeholder="Deliverable name" value={newDeliverable.deliverableName} onChange={(e) => setNewDeliverable({ ...newDeliverable, deliverableName: e.target.value })} />
            <input placeholder="Owner" value={newDeliverable.ownerName} onChange={(e) => setNewDeliverable({ ...newDeliverable, ownerName: e.target.value })} />
            <input type="date" value={newDeliverable.plannedDate} onChange={(e) => setNewDeliverable({ ...newDeliverable, plannedDate: e.target.value })} />
            <button onClick={handleAddDeliverable}>+ Add Deliverable</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProjectWorkspacePage({ projectId, onBack }) {
  const [project, setProject] = useState(null);
  const [modules, setModules] = useState([]);
  const [activeTab, setActiveTab] = useState(null);
  const [status, setStatus] = useState('loading');
  const [errorDetail, setErrorDetail] = useState('');

  useEffect(() => { load(); }, [projectId]);

  async function load() {
    setStatus('loading');
    setErrorDetail('');
    try {
      const [projRes, modRes] = await Promise.all([
        fetch(`/api/ppm/projects/${projectId}`),
        fetch('/api/config/values?category=WorkspaceModules'),
      ]);
      const projData = await projRes.json();
      const modData = await modRes.json();
      if (projRes.ok && projData.success) {
        setProject(projData.project);
        const enabled = modData.success ? modData.values.filter((m) => m.IsActive) : [];
        setModules(enabled);
        setActiveTab(enabled[0]?.ValueCode || null);
        setStatus('ok');
      } else {
        setStatus('error'); setErrorDetail(projData.detail || projData.message || `HTTP ${projRes.status}`);
      }
    } catch {
      setStatus('error'); setErrorDetail(`Could not reach /api/ppm/projects/${projectId}.`);
    }
  }

  if (status === 'loading') return <div className="page"><p>Loading&hellip;</p></div>;
  if (status === 'error') {
    return (
      <div className="page">
        <button onClick={onBack}>&larr; Back to Projects</button>
        <div className="error-box" style={{ marginTop: 16 }}><strong>Could not load project.</strong><p>{errorDetail}</p></div>
      </div>
    );
  }

  const activeModule = modules.find((m) => m.ValueCode === activeTab);

  return (
    <div className="page">
      <button onClick={onBack}>&larr; Back to Projects</button>

      <div className="detail-panel" style={{ marginTop: 16, maxWidth: 'none' }}>
        <div className="detail-header">
          <h3><code>{project.ProjectCode}</code> &nbsp; {project.ProjectName}</h3>
          <span className={`status-pill status-${project.IsActive ? 'active' : 'deprecated'}`}>{project.IsActive ? 'Active' : 'Archived'}</span>
        </div>
        <dl>
          <dt>Portfolio</dt><dd>{project.PortfolioName}</dd>
          <dt>Program</dt><dd>{project.ProgramName || '\u2014'}</dd>
          <dt>Project Manager</dt><dd>{project.ProjectManagerName || '\u2014'}</dd>
          <dt>Status</dt><dd>{project.StatusLabel || '\u2014'}</dd>
          <dt>Health</dt><dd>{project.HealthStatusLabel || '\u2014'}</dd>
          <dt>Lifecycle</dt><dd>{project.LifecycleName || '\u2014'}</dd>
          <dt>Type</dt><dd>{project.ProjectTypeLabel || '\u2014'}</dd>
          <dt>Category</dt><dd>{project.ProjectCategoryLabel || '\u2014'}</dd>
          <dt>Size</dt><dd>{project.ProjectSizeLabel || '\u2014'}</dd>
          <dt>Complexity</dt><dd>{project.ProjectComplexityLabel || '\u2014'}</dd>
          <dt>Priority</dt><dd>{project.ProjectPriorityLabel || '\u2014'}</dd>
          <dt>Start Date</dt><dd>{project.StartDate ? new Date(project.StartDate).toLocaleDateString() : '\u2014'}</dd>
          <dt>Target End</dt><dd>{project.TargetEndDate ? new Date(project.TargetEndDate).toLocaleDateString() : '\u2014'}</dd>
          <dt>Description</dt><dd>{project.Description || '\u2014'}</dd>
        </dl>
      </div>

      <nav className="workspace-tabs">
        {modules.map((m) => (
          <button
            key={m.ValueCode}
            className={`workspace-tab ${activeTab === m.ValueCode ? 'active' : ''}`}
            onClick={() => setActiveTab(m.ValueCode)}
          >
            {m.ValueLabel}
          </button>
        ))}
      </nav>

      <div className={['CHARTER', 'WBS', 'SCHEDULE'].includes(activeTab) ? 'detail-panel' : 'placeholder-box'} style={{ marginTop: 0 }}>
        {activeTab === 'CHARTER' ? (
          <CharterPanel projectId={projectId} />
        ) : activeTab === 'WBS' ? (
          <WbsPanel projectId={projectId} project={project} />
        ) : activeTab === 'SCHEDULE' ? (
          <SchedulePanel projectId={projectId} />
        ) : activeModule ? (
          <>
            <p><strong>{activeModule.ValueLabel}</strong> hasn't been built yet.</p>
            <p className="placeholder-detail">This tab is scoped for a later chunk — see CHECKLIST.md.</p>
          </>
        ) : (
          <p className="placeholder-detail">No workspace tabs are enabled. Enable some under Administration -&gt; Project Configuration (category: Workspace Modules).</p>
        )}
      </div>
    </div>
  );
}
