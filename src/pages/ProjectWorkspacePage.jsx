import { useEffect, useState } from 'react';

// Shell only - per CHECKLIST.md Chunk 03 scope, no tab has real
// content yet. Which tabs render is driven by the WorkspaceModules
// Configuration Engine category (migration 007) so a module can be
// hidden platform-wide via Administration -> Project Configuration
// without a code change, once its real content is built in a later
// chunk.

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

      <div className="placeholder-box" style={{ marginTop: 0 }}>
        {activeModule ? (
          <>
            <p><strong>{activeModule.ValueLabel}</strong> hasn't been built yet.</p>
            <p className="placeholder-detail">This tab is scoped for a later chunk (Chunk 04 onward) — see CHECKLIST.md.</p>
          </>
        ) : (
          <p className="placeholder-detail">No workspace tabs are enabled. Enable some under Administration -&gt; Project Configuration (category: Workspace Modules).</p>
        )}
      </div>
    </div>
  );
}
