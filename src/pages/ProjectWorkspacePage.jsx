import { useEffect, useState } from 'react';

// Which tabs render is driven by the WorkspaceModules Configuration
// Engine category (migration 007, extended in migration 008) so a
// module can be hidden platform-wide via Administration -> Project
// Configuration without a code change. Every tab is still a
// placeholder EXCEPT Charter (Chunk 04, Module 10), which is the
// first to get real content - see CharterPanel below.

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

      <div className={activeTab === 'CHARTER' ? 'detail-panel' : 'placeholder-box'} style={{ marginTop: 0 }}>
        {activeTab === 'CHARTER' ? (
          <CharterPanel projectId={projectId} />
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
