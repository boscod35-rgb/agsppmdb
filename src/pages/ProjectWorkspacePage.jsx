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
  const [resources, setResources] = useState([]);
  const [statuses, setStatuses] = useState({ task: [], milestone: [], acceptance: [], dependencyType: [] });
  const [status, setStatus] = useState('loading');
  const [errorDetail, setErrorDetail] = useState('');
  const [actionError, setActionError] = useState('');
  const [newTask, setNewTask] = useState({ taskName: '', startDate: '', dueDate: '' });
  const [newMilestone, setNewMilestone] = useState({ milestoneName: '', plannedDate: '', isPhaseGate: false });
  const [newDeliverable, setNewDeliverable] = useState({ deliverableName: '', ownerName: '', plannedDate: '' });
  const [depFormTaskId, setDepFormTaskId] = useState(null);
  const [depTarget, setDepTarget] = useState('');
  const [effortFormTaskId, setEffortFormTaskId] = useState(null);
  const [newEffort, setNewEffort] = useState({ resourceCode: '', plannedHours: 0 });

  useEffect(() => { load(); }, [projectId]);

  async function load() {
    setStatus('loading');
    setErrorDetail('');
    try {
      const [tRes, mRes, dRes, rRes, tsRes, msRes, asRes, dtRes] = await Promise.all([
        fetch(`/api/ppm/schedule/tasks/${projectId}`),
        fetch(`/api/ppm/milestones/${projectId}`),
        fetch(`/api/ppm/deliverables/${projectId}`),
        fetch('/api/ppm/resources'),
        fetch('/api/config/values?category=TaskStatus'),
        fetch('/api/config/values?category=MilestoneStatus'),
        fetch('/api/config/values?category=DeliverableAcceptanceStatus'),
        fetch('/api/config/values?category=DependencyType'),
      ]);
      const tData = await tRes.json();
      const mData = await mRes.json();
      const dData = await dRes.json();
      const rData = await rRes.json();
      if (tRes.ok && tData.success && mRes.ok && mData.success && dRes.ok && dData.success) {
        setTasks(tData.tasks);
        setMilestones(mData.milestones);
        setDeliverables(dData.deliverables);
        setResources(rData.success ? rData.resources : []);
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

  async function handleAddEffort(taskId) {
    if (!newEffort.resourceCode) return;
    setActionError('');
    try {
      const res = await fetch(`/api/ppm/schedule/tasks/${projectId}/${taskId}/effort`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newEffort),
      });
      const data = await res.json();
      if (res.ok && data.success) { setEffortFormTaskId(null); setNewEffort({ resourceCode: '', plannedHours: 0 }); load(); }
      else setActionError(data.detail || data.message || 'Could not add effort entry.');
    } catch { setActionError('Could not reach the schedule API.'); }
  }

  async function handleUpdateEffortActual(taskId, effortId, actualHours) {
    setActionError('');
    try {
      const res = await fetch(`/api/ppm/schedule/tasks/${projectId}/${taskId}/effort/${effortId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actualHours: Number(actualHours) }),
      });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not update effort entry.');
    } catch { setActionError('Could not reach the schedule API.'); }
  }

  async function handleRemoveEffort(taskId, effortId) {
    try {
      const res = await fetch(`/api/ppm/schedule/tasks/${projectId}/${taskId}/effort/${effortId}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not remove effort entry.');
    } catch { setActionError('Could not reach the schedule API.'); }
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

              <button onClick={() => setEffortFormTaskId(effortFormTaskId === t.ScheduleTaskId ? null : t.ScheduleTaskId)} style={{ marginTop: 4 }}>+ Effort</button>
              {t.effort?.length > 0 && (
                <ul style={{ margin: '4px 0 0 16px', fontSize: '0.85rem' }}>
                  {t.effort.map((e) => (
                    <li key={e.EffortId}>
                      {e.ResourceName} — Planned: {e.PlannedHours}h — Actual:{' '}
                      <input
                        type="number" min="0" step="0.5" style={{ width: 60 }}
                        defaultValue={e.ActualHours ?? ''}
                        onBlur={(ev) => ev.target.value !== '' && handleUpdateEffortActual(t.ScheduleTaskId, e.EffortId, ev.target.value)}
                      />h{e.RateCardCode ? ` — Rate: ${e.RateCardCode}` : ''}{' '}
                      <button onClick={() => handleRemoveEffort(t.ScheduleTaskId, e.EffortId)}>Remove</button>
                    </li>
                  ))}
                </ul>
              )}
              {effortFormTaskId === t.ScheduleTaskId && (
                <div style={{ marginTop: 4 }}>
                  <select value={newEffort.resourceCode} onChange={(e) => setNewEffort({ ...newEffort, resourceCode: e.target.value })}>
                    <option value="">Resource&hellip;</option>
                    {resources.map((r) => <option key={r.ResourceId} value={r.ResourceCode}>{r.ResourceName}</option>)}
                  </select>{' '}
                  <input type="number" min="0" step="0.5" style={{ width: 70 }} placeholder="Planned hrs"
                    value={newEffort.plannedHours} onChange={(e) => setNewEffort({ ...newEffort, plannedHours: Number(e.target.value) })} />{' '}
                  <button onClick={() => handleAddEffort(t.ScheduleTaskId)}>Add</button>
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

function ResourcePanel({ projectId }) {
  const [allocations, setAllocations] = useState([]);
  const [resources, setResources] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [status, setStatus] = useState('loading');
  const [errorDetail, setErrorDetail] = useState('');
  const [actionError, setActionError] = useState('');
  const [newAlloc, setNewAlloc] = useState({ resourceCode: '', plannedAllocationPercent: 100, startDate: '' });

  useEffect(() => { load(); }, [projectId]);

  async function load() {
    setStatus('loading');
    setErrorDetail('');
    try {
      const [aRes, rRes, sRes] = await Promise.all([
        fetch(`/api/ppm/allocations/${projectId}`),
        fetch('/api/ppm/resources'),
        fetch('/api/config/values?category=AllocationStatus'),
      ]);
      const aData = await aRes.json();
      const rData = await rRes.json();
      const sData = await sRes.json();
      if (aRes.ok && aData.success) {
        setAllocations(aData.allocations);
        setResources(rData.success ? rData.resources : []);
        setStatuses(sData.success ? sData.values : []);
        setStatus('ok');
      } else {
        setStatus('error'); setErrorDetail(aData.detail || aData.message || `HTTP ${aRes.status}`);
      }
    } catch {
      setStatus('error'); setErrorDetail(`Could not reach /api/ppm/allocations/${projectId}.`);
    }
  }

  async function handleAdd() {
    if (!newAlloc.resourceCode) return;
    setActionError('');
    try {
      const res = await fetch(`/api/ppm/allocations/${projectId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newAlloc, startDate: newAlloc.startDate || null }),
      });
      const data = await res.json();
      if (res.ok && data.success) { setNewAlloc({ resourceCode: '', plannedAllocationPercent: 100, startDate: '' }); load(); }
      else setActionError(data.detail || data.message || 'Could not add allocation.');
    } catch { setActionError('Could not reach the allocations API.'); }
  }

  async function handleArchive(id) {
    try {
      const res = await fetch(`/api/ppm/allocations/${projectId}/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not archive allocation.');
    } catch { setActionError('Could not reach the allocations API.'); }
  }

  if (status === 'loading') return <p>Loading resources&hellip;</p>;
  if (status === 'error') return <div className="error-box"><strong>Could not load resources.</strong><p>{errorDetail}</p></div>;

  return (
    <div>
      {actionError && <div className="error-box"><strong>Action failed.</strong><p>{actionError}</p></div>}
      {allocations.map((a) => (
        <div key={a.AllocationId} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
          <strong>{a.ResourceName}</strong> <code>{a.ResourceCode}</code> — {a.ResourceRoleLabel || '\u2014'}{' '}
          — Planned: {a.PlannedAllocationPercent}%{a.ActualAllocationPercent != null && ` · Actual: ${a.ActualAllocationPercent}%`}{' '}
          — {a.StatusLabel || '\u2014'}{' '}
          <button onClick={() => handleArchive(a.AllocationId)}>Archive</button>
        </div>
      ))}
      {allocations.length === 0 && <p className="placeholder-detail">No resources staffed on this project yet.</p>}
      <div className="filter-row" style={{ marginTop: 12 }}>
        <select value={newAlloc.resourceCode} onChange={(e) => setNewAlloc({ ...newAlloc, resourceCode: e.target.value })}>
          <option value="">Select resource&hellip;</option>
          {resources.map((r) => <option key={r.ResourceId} value={r.ResourceCode}>{r.ResourceName}</option>)}
        </select>
        <input type="number" min="0" max="100" style={{ width: 70 }} value={newAlloc.plannedAllocationPercent}
          onChange={(e) => setNewAlloc({ ...newAlloc, plannedAllocationPercent: Number(e.target.value) })} />
        <span style={{ fontSize: '0.85rem' }}>%</span>
        <input type="date" value={newAlloc.startDate} onChange={(e) => setNewAlloc({ ...newAlloc, startDate: e.target.value })} />
        <button onClick={handleAdd}>+ Add Resource</button>
      </div>
    </div>
  );
}

function FinancialsPanel({ projectId }) {
  const [budget, setBudget] = useState(null);
  const [computed, setComputed] = useState(null);
  const [status, setStatus] = useState('loading');
  const [errorDetail, setErrorDetail] = useState('');
  const [actionError, setActionError] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);

  useEffect(() => { load(); }, [projectId]);

  async function load() {
    setStatus('loading');
    setErrorDetail('');
    try {
      const res = await fetch(`/api/ppm/budgets/${projectId}`);
      const data = await res.json();
      if (res.ok && data.success) {
        setBudget(data.budget);
        setComputed(data.computed);
        setStatus('ok');
      } else {
        setStatus('error'); setErrorDetail(data.detail || data.message || `HTTP ${res.status}`);
      }
    } catch {
      setStatus('error'); setErrorDetail(`Could not reach /api/ppm/budgets/${projectId}.`);
    }
  }

  function startEdit() {
    setForm({
      budgetAmount: budget?.BudgetAmount ?? '',
      plannedCost: budget?.PlannedCost ?? '',
      forecastCost: budget?.ForecastCost ?? '',
    });
    setEditing(true);
    setActionError('');
  }

  async function handleSave() {
    setActionError('');
    try {
      const method = budget ? 'PUT' : 'POST';
      const payload = {
        budgetAmount: form.budgetAmount === '' ? null : Number(form.budgetAmount),
        plannedCost: form.plannedCost === '' ? null : Number(form.plannedCost),
        forecastCost: form.forecastCost === '' ? null : Number(form.forecastCost),
      };
      const res = await fetch(`/api/ppm/budgets/${projectId}`, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.success) { setEditing(false); load(); }
      else setActionError(data.detail || data.message || 'Could not save budget.');
    } catch { setActionError('Could not reach /api/ppm/budgets.'); }
  }

  if (status === 'loading') return <p>Loading financials&hellip;</p>;
  if (status === 'error') return <div className="error-box"><strong>Could not load financials.</strong><p>{errorDetail}</p></div>;

  const fmt = (n) => n == null ? '\u2014' : `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (editing) {
    return (
      <div>
        {actionError && <div className="error-box"><strong>Action failed.</strong><p>{actionError}</p></div>}
        <dl>
          <dt>Budget Amount</dt><dd><input type="number" step="0.01" value={form.budgetAmount} onChange={(e) => setForm({ ...form, budgetAmount: e.target.value })} /></dd>
          <dt>Planned Cost</dt><dd><input type="number" step="0.01" value={form.plannedCost} onChange={(e) => setForm({ ...form, plannedCost: e.target.value })} /></dd>
          <dt>Forecast Cost (ETC)</dt><dd><input type="number" step="0.01" value={form.forecastCost} onChange={(e) => setForm({ ...form, forecastCost: e.target.value })} /></dd>
        </dl>
        <button onClick={handleSave}>Save</button>{' '}
        <button onClick={() => setEditing(false)}>Cancel</button>
      </div>
    );
  }

  return (
    <div>
      {actionError && <div className="error-box"><strong>Action failed.</strong><p>{actionError}</p></div>}
      <dl>
        <dt>Budget Amount</dt><dd>{fmt(budget?.BudgetAmount)}</dd>
        <dt>Planned Cost</dt><dd>{fmt(budget?.PlannedCost)}</dd>
        <dt>Forecast Cost (ETC)</dt><dd>{fmt(budget?.ForecastCost)}</dd>
        <dt>Actual Cost <span className="placeholder-detail">(computed from effort)</span></dt><dd>{fmt(computed.actualCost)}</dd>
        <dt>Actual Billable <span className="placeholder-detail">(computed from effort)</span></dt><dd>{fmt(computed.actualBillable)}</dd>
        <dt>Estimate at Completion (EAC)</dt><dd>{fmt(computed.estimateAtCompletion)}</dd>
        <dt>Variance</dt><dd>{fmt(computed.variance)}</dd>
      </dl>
      {computed.unresolvedActualHours > 0 && (
        <p className="placeholder-detail">{computed.unresolvedActualHours}h of actual effort has no matching Rate Card and isn't counted in Actual Cost above.</p>
      )}
      <button onClick={startEdit}>{budget ? 'Edit' : 'Set Budget'}</button>
    </div>
  );
}

function RaidPanel({ projectId }) {
  const [items, setItems] = useState([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [lookups, setLookups] = useState({ types: [], statuses: [], severities: [], probabilities: [] });
  const [status, setStatus] = useState('loading');
  const [errorDetail, setErrorDetail] = useState('');
  const [actionError, setActionError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ itemTypeCode: 'RISK', title: '', description: '', severityCode: '', probabilityCode: '', ownerName: '', raisedDate: '', dueDate: '' });

  useEffect(() => { load(); }, [projectId, typeFilter]);

  async function load() {
    setStatus('loading');
    setErrorDetail('');
    try {
      const qs = typeFilter ? `?type=${typeFilter}` : '';
      const [iRes, typeRes, statusRes, sevRes, probRes] = await Promise.all([
        fetch(`/api/ppm/raid/${projectId}${qs}`),
        fetch('/api/config/values?category=RaidItemType'),
        fetch('/api/config/values?category=RaidStatus'),
        fetch('/api/config/values?category=RaidSeverity'),
        fetch('/api/config/values?category=RaidProbability'),
      ]);
      const iData = await iRes.json();
      if (iRes.ok && iData.success) {
        setItems(iData.items);
        setLookups({
          types: (await typeRes.json()).values || [],
          statuses: (await statusRes.json()).values || [],
          severities: (await sevRes.json()).values || [],
          probabilities: (await probRes.json()).values || [],
        });
        setStatus('ok');
      } else {
        setStatus('error'); setErrorDetail(iData.detail || iData.message || `HTTP ${iRes.status}`);
      }
    } catch {
      setStatus('error'); setErrorDetail(`Could not reach /api/ppm/raid/${projectId}.`);
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    setActionError('');
    try {
      const payload = { ...form };
      Object.keys(payload).forEach((k) => { if (payload[k] === '') payload[k] = null; });
      payload.itemTypeCode = form.itemTypeCode;
      const res = await fetch(`/api/ppm/raid/${projectId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setForm({ itemTypeCode: 'RISK', title: '', description: '', severityCode: '', probabilityCode: '', ownerName: '', raisedDate: '', dueDate: '' });
        setShowAdd(false); load();
      } else setActionError(data.detail || data.message || 'Could not add RAID item.');
    } catch { setActionError('Could not reach the RAID API.'); }
  }

  async function handleEscalate(id) {
    const escalatedToName = window.prompt('Escalate to whom?');
    if (escalatedToName === null) return;
    try {
      const res = await fetch(`/api/ppm/raid/${projectId}/${id}/escalate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ escalatedToName }),
      });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not escalate.');
    } catch { setActionError('Could not reach the RAID API.'); }
  }

  async function handleClose(id) {
    try {
      const res = await fetch(`/api/ppm/raid/${projectId}/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statusCode: 'CLOSED', closedDate: new Date().toISOString().slice(0, 10) }),
      });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not close.');
    } catch { setActionError('Could not reach the RAID API.'); }
  }

  async function handleArchive(id) {
    try {
      const res = await fetch(`/api/ppm/raid/${projectId}/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not archive.');
    } catch { setActionError('Could not reach the RAID API.'); }
  }

  if (status === 'loading') return <p>Loading RAID log&hellip;</p>;
  if (status === 'error') return <div className="error-box"><strong>Could not load RAID log.</strong><p>{errorDetail}</p></div>;

  return (
    <div>
      {actionError && <div className="error-box"><strong>Action failed.</strong><p>{actionError}</p></div>}
      <div className="filter-row" style={{ marginBottom: 12 }}>
        {['', 'RISK', 'ISSUE', 'DEPENDENCY', 'ASSUMPTION', 'ACTION'].map((t) => (
          <button key={t || 'all'} onClick={() => setTypeFilter(t)} style={{ fontWeight: typeFilter === t ? 700 : 400 }}>
            {t ? lookups.types.find((lt) => lt.ValueCode === t)?.ValueLabel || t : 'All'}
          </button>
        ))}
      </div>

      {items.map((i) => (
        <div key={i.RaidItemId} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
          <code>{i.RaidItemCode}</code> <strong>{i.Title}</strong> — {i.ItemTypeLabel}{' '}
          {i.SeverityLabel && <span className={`status-pill status-${i.SeverityCode === 'CRITICAL' || i.SeverityCode === 'HIGH' ? 'deprecated' : 'paused'}`}>{i.SeverityLabel}</span>}{' '}
          — {i.StatusLabel || '\u2014'} — {i.OwnerName || 'Unassigned'} — Age: {i.AgeDays}d
          {i.IsEscalated && <span className="status-pill status-deprecated" style={{ marginLeft: 4 }}>Escalated{i.EscalatedToName ? ` to ${i.EscalatedToName}` : ''}</span>}
          <div style={{ marginTop: 2 }}>
            {i.StatusCode !== 'CLOSED' && <button onClick={() => handleClose(i.RaidItemId)}>Close</button>}{' '}
            {i.StatusCode !== 'ESCALATED' && i.StatusCode !== 'CLOSED' && <button onClick={() => handleEscalate(i.RaidItemId)}>Escalate</button>}{' '}
            <button onClick={() => handleArchive(i.RaidItemId)}>Archive</button>
          </div>
        </div>
      ))}
      {items.length === 0 && <p className="placeholder-detail">No RAID items{typeFilter ? ` of type ${typeFilter}` : ''} yet.</p>}

      {!showAdd ? (
        <button style={{ marginTop: 16 }} onClick={() => setShowAdd(true)}>+ Add RAID Item</button>
      ) : (
        <form className="detail-panel" style={{ marginTop: 16, maxWidth: 480 }} onSubmit={handleAdd}>
          <div className="detail-header"><h3>Add RAID Item</h3><button type="button" onClick={() => setShowAdd(false)}>Cancel</button></div>
          <dl>
            <dt>Type</dt>
            <dd>
              <select value={form.itemTypeCode} onChange={(e) => setForm({ ...form, itemTypeCode: e.target.value })}>
                {lookups.types.map((t) => <option key={t.ConfigValueId} value={t.ValueCode}>{t.ValueLabel}</option>)}
              </select>
            </dd>
            <dt>Title</dt><dd><input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></dd>
            <dt>Description</dt><dd><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></dd>
            <dt>Severity</dt>
            <dd>
              <select value={form.severityCode} onChange={(e) => setForm({ ...form, severityCode: e.target.value })}>
                <option value="">&mdash;</option>
                {lookups.severities.map((s) => <option key={s.ConfigValueId} value={s.ValueCode}>{s.ValueLabel}</option>)}
              </select>
            </dd>
            {form.itemTypeCode === 'RISK' && (
              <>
                <dt>Probability</dt>
                <dd>
                  <select value={form.probabilityCode} onChange={(e) => setForm({ ...form, probabilityCode: e.target.value })}>
                    <option value="">&mdash;</option>
                    {lookups.probabilities.map((p) => <option key={p.ConfigValueId} value={p.ValueCode}>{p.ValueLabel}</option>)}
                  </select>
                </dd>
              </>
            )}
            <dt>Owner</dt><dd><input value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} /></dd>
            <dt>Raised Date</dt><dd><input type="date" value={form.raisedDate} onChange={(e) => setForm({ ...form, raisedDate: e.target.value })} /></dd>
            <dt>Due Date</dt><dd><input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></dd>
          </dl>
          <button type="submit" style={{ marginTop: 12 }}>Save</button>
        </form>
      )}
    </div>
  );
}

function GapAssessmentPanel({ projectId }) {
  const [subTab, setSubTab] = useState('gap');
  const [pillars, setPillars] = useState([]);
  const [summary, setSummary] = useState(null);
  const [ratings, setRatings] = useState([]);
  const [correctiveActions, setCorrectiveActions] = useState([]);
  const [threeSixty, setThreeSixty] = useState([]);
  const [threeSixtyRatings, setThreeSixtyRatings] = useState([]);
  const [status, setStatus] = useState('loading');
  const [errorDetail, setErrorDetail] = useState('');
  const [actionError, setActionError] = useState('');
  const [expandedQuestionId, setExpandedQuestionId] = useState(null);
  const [responseForm, setResponseForm] = useState({ ratingCode: '', findingText: '' });
  const [showCapaFor, setShowCapaFor] = useState(null);
  const [newCapa, setNewCapa] = useState({ title: '', ownerName: '', dueDate: '' });
  const [newFeedback, setNewFeedback] = useState({ respondentName: '', respondentRole: '', overallRatingCode: '', feedback: '' });

  useEffect(() => { load(); }, [projectId]);

  async function load() {
    setStatus('loading');
    setErrorDetail('');
    try {
      const [gaRes, ratingRes, capaRes, tsRes, tsRatingRes] = await Promise.all([
        fetch(`/api/ppm/gap-assessment/${projectId}`),
        fetch('/api/config/values?category=GapAssessmentRating'),
        fetch(`/api/ppm/corrective-actions/${projectId}`),
        fetch(`/api/ppm/three-sixty/${projectId}`),
        fetch('/api/config/values?category=ThreeSixtyRating'),
      ]);
      const gaData = await gaRes.json();
      const capaData = await capaRes.json();
      const tsData = await tsRes.json();
      if (gaRes.ok && gaData.success) {
        setPillars(gaData.pillars);
        setSummary(gaData.summary);
        setRatings((await ratingRes.json()).values || []);
        setCorrectiveActions(capaData.success ? capaData.items : []);
        setThreeSixty(tsData.success ? tsData.items : []);
        setThreeSixtyRatings((await tsRatingRes.json()).values || []);
        setStatus('ok');
      } else {
        setStatus('error'); setErrorDetail(gaData.detail || gaData.message || `HTTP ${gaRes.status}`);
      }
    } catch {
      setStatus('error'); setErrorDetail('Could not reach the Gap Assessment APIs.');
    }
  }

  function startAnswering(q) {
    setExpandedQuestionId(q.QuestionId);
    setResponseForm({ ratingCode: q.response?.RatingCode || '', findingText: q.response?.FindingText || '' });
    setActionError('');
  }

  async function handleSaveResponse(questionId) {
    setActionError('');
    try {
      const res = await fetch(`/api/ppm/gap-assessment/${projectId}/${questionId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(responseForm),
      });
      const data = await res.json();
      if (res.ok && data.success) { setExpandedQuestionId(null); load(); }
      else setActionError(data.detail || data.message || 'Could not save response.');
    } catch { setActionError('Could not reach the Gap Assessment API.'); }
  }

  async function handleAddCapa(responseId) {
    if (!newCapa.title.trim()) return;
    setActionError('');
    try {
      const res = await fetch(`/api/ppm/corrective-actions/${projectId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newCapa, gapAssessmentResponseId: responseId, dueDate: newCapa.dueDate || null }),
      });
      const data = await res.json();
      if (res.ok && data.success) { setNewCapa({ title: '', ownerName: '', dueDate: '' }); setShowCapaFor(null); load(); }
      else setActionError(data.detail || data.message || 'Could not add corrective action.');
    } catch { setActionError('Could not reach the corrective actions API.'); }
  }

  async function handleCloseCapa(id) {
    try {
      const res = await fetch(`/api/ppm/corrective-actions/${projectId}/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statusCode: 'CLOSED', closedDate: new Date().toISOString().slice(0, 10) }),
      });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not close.');
    } catch { setActionError('Could not reach the corrective actions API.'); }
  }

  async function handleAddFeedback() {
    if (!newFeedback.feedback.trim()) return;
    setActionError('');
    try {
      const res = await fetch(`/api/ppm/three-sixty/${projectId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newFeedback),
      });
      const data = await res.json();
      if (res.ok && data.success) { setNewFeedback({ respondentName: '', respondentRole: '', overallRatingCode: '', feedback: '' }); load(); }
      else setActionError(data.detail || data.message || 'Could not add feedback.');
    } catch { setActionError('Could not reach the 360 API.'); }
  }

  if (status === 'loading') return <p>Loading assessment&hellip;</p>;
  if (status === 'error') return <div className="error-box"><strong>Could not load assessment.</strong><p>{errorDetail}</p></div>;

  return (
    <div>
      {actionError && <div className="error-box"><strong>Action failed.</strong><p>{actionError}</p></div>}
      <div className="filter-row" style={{ marginBottom: 12 }}>
        <button onClick={() => setSubTab('gap')} style={{ fontWeight: subTab === 'gap' ? 700 : 400 }}>Gap Assessment</button>
        <button onClick={() => setSubTab('360')} style={{ fontWeight: subTab === '360' ? 700 : 400 }}>360 Feedback</button>
      </div>

      {subTab === 'gap' && (
        <div>
          {summary && <p className="placeholder-detail">{summary.answeredQuestions} of {summary.totalQuestions} questions answered ({summary.percentComplete}%)</p>}
          {pillars.map((p) => (
            <div key={p.PillarId} style={{ marginBottom: 12 }}>
              <strong>{p.PillarName}</strong>
              {(p.subAreas || []).map((s) => (
                <div key={s.SubAreaId} style={{ marginLeft: 16, marginTop: 4 }}>
                  <em>{s.SubAreaName}</em>
                  {(s.questions || []).map((q) => (
                    <div key={q.QuestionId} style={{ marginLeft: 16, marginTop: 4, paddingBottom: 4, borderBottom: '1px solid #f0f0f0' }}>
                      {q.QuestionText}{' '}
                      {q.response?.RatingLabel && <span className={`status-pill status-${q.response.RatingCode === 'NON_COMPLIANT' ? 'deprecated' : q.response.RatingCode === 'COMPLIANT' ? 'active' : 'paused'}`}>{q.response.RatingLabel}</span>}{' '}
                      <button onClick={() => startAnswering(q)}>{q.response ? 'Edit' : 'Answer'}</button>
                      {q.response?.FindingText && (
                        <div style={{ fontSize: '0.85rem', color: '#666', marginTop: 2 }}>
                          Finding: {q.response.FindingText}{' '}
                          <button onClick={() => setShowCapaFor(showCapaFor === q.response.ResponseId ? null : q.response.ResponseId)}>+ Corrective Action</button>
                        </div>
                      )}
                      {showCapaFor === q.response?.ResponseId && (
                        <div style={{ marginTop: 4 }}>
                          <input placeholder="CAPA title" value={newCapa.title} onChange={(e) => setNewCapa({ ...newCapa, title: e.target.value })} />{' '}
                          <input placeholder="Owner" value={newCapa.ownerName} onChange={(e) => setNewCapa({ ...newCapa, ownerName: e.target.value })} />{' '}
                          <input type="date" value={newCapa.dueDate} onChange={(e) => setNewCapa({ ...newCapa, dueDate: e.target.value })} />{' '}
                          <button onClick={() => handleAddCapa(q.response.ResponseId)}>Add</button>
                        </div>
                      )}
                      {expandedQuestionId === q.QuestionId && (
                        <div style={{ marginTop: 4 }}>
                          <select value={responseForm.ratingCode} onChange={(e) => setResponseForm({ ...responseForm, ratingCode: e.target.value })}>
                            <option value="">Rating&hellip;</option>
                            {ratings.map((r) => <option key={r.ConfigValueId} value={r.ValueCode}>{r.ValueLabel}</option>)}
                          </select>{' '}
                          <input style={{ width: 240 }} placeholder="Finding (if any)" value={responseForm.findingText} onChange={(e) => setResponseForm({ ...responseForm, findingText: e.target.value })} />{' '}
                          <button onClick={() => handleSaveResponse(q.QuestionId)}>Save</button>{' '}
                          <button onClick={() => setExpandedQuestionId(null)}>Cancel</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
          {pillars.length === 0 && <p className="placeholder-detail">No Gap Assessment framework configured yet — set one up under Administration -&gt; Gap Assessment Framework.</p>}

          <div style={{ marginTop: 16 }}>
            <strong>Corrective Actions</strong>
            {correctiveActions.map((c) => (
              <div key={c.CorrectiveActionId} style={{ padding: '4px 0' }}>
                <code>{c.CorrectiveActionCode}</code> {c.Title} — {c.OwnerName || 'Unassigned'} — {c.StatusLabel || '\u2014'}
                {c.StatusCode !== 'CLOSED' && <button style={{ marginLeft: 8 }} onClick={() => handleCloseCapa(c.CorrectiveActionId)}>Close</button>}
              </div>
            ))}
            {correctiveActions.length === 0 && <p className="placeholder-detail">No corrective actions yet.</p>}
          </div>
        </div>
      )}

      {subTab === '360' && (
        <div>
          {threeSixty.map((t) => (
            <div key={t.AssessmentId} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
              <strong>{t.RespondentName || 'Anonymous'}</strong> {t.RespondentRole ? `(${t.RespondentRole})` : ''}{' '}
              {t.OverallRatingLabel && <span className="status-pill status-active">{t.OverallRatingLabel}</span>}
              <p style={{ margin: '4px 0 0' }}>{t.Feedback}</p>
            </div>
          ))}
          {threeSixty.length === 0 && <p className="placeholder-detail">No 360 feedback yet.</p>}

          <div className="filter-row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
            <input placeholder="Respondent name" value={newFeedback.respondentName} onChange={(e) => setNewFeedback({ ...newFeedback, respondentName: e.target.value })} />
            <input placeholder="Role (e.g. Sponsor)" value={newFeedback.respondentRole} onChange={(e) => setNewFeedback({ ...newFeedback, respondentRole: e.target.value })} />
            <select value={newFeedback.overallRatingCode} onChange={(e) => setNewFeedback({ ...newFeedback, overallRatingCode: e.target.value })}>
              <option value="">Rating&hellip;</option>
              {threeSixtyRatings.map((r) => <option key={r.ConfigValueId} value={r.ValueCode}>{r.ValueLabel}</option>)}
            </select>
            <input style={{ minWidth: 240 }} placeholder="Feedback" value={newFeedback.feedback} onChange={(e) => setNewFeedback({ ...newFeedback, feedback: e.target.value })} />
            <button onClick={handleAddFeedback}>+ Add Feedback</button>
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

      <div className={['CHARTER', 'WBS', 'SCHEDULE', 'RESOURCES', 'FINANCIALS', 'RAID', 'GAP_ASSESSMENT'].includes(activeTab) ? 'detail-panel' : 'placeholder-box'} style={{ marginTop: 0 }}>
        {activeTab === 'CHARTER' ? (
          <CharterPanel projectId={projectId} />
        ) : activeTab === 'WBS' ? (
          <WbsPanel projectId={projectId} project={project} />
        ) : activeTab === 'SCHEDULE' ? (
          <SchedulePanel projectId={projectId} />
        ) : activeTab === 'RESOURCES' ? (
          <ResourcePanel projectId={projectId} />
        ) : activeTab === 'FINANCIALS' ? (
          <FinancialsPanel projectId={projectId} />
        ) : activeTab === 'RAID' ? (
          <RaidPanel projectId={projectId} />
        ) : activeTab === 'GAP_ASSESSMENT' ? (
          <GapAssessmentPanel projectId={projectId} />
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
