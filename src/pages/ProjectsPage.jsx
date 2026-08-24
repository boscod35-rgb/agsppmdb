import { useEffect, useState } from 'react';

const EMPTY = {
  name: '', portfolioCode: '', programCode: '', projectManagerName: '',
  projectTypeCode: '', projectCategoryCode: '', projectSizeCode: '', projectComplexityCode: '', projectPriorityCode: '',
  statusCode: '', healthStatusCode: '', lifecycleCode: '', startDate: '', targetEndDate: '', description: '', notes: '',
};

const PAGE_SIZE = 25;

export default function ProjectsPage({ onOpenProject }) {
  const [projects, setProjects] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [portfolioFilter, setPortfolioFilter] = useState('');
  const [sortBy, setSortBy] = useState('ProjectName');
  const [sortDir, setSortDir] = useState('asc');

  const [portfolios, setPortfolios] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [lookups, setLookups] = useState({ types: [], categories: [], sizes: [], complexities: [], priorities: [], statuses: [], healthStatuses: [] });
  const [lifecycles, setLifecycles] = useState([]);

  const [status, setStatus] = useState('loading');
  const [errorDetail, setErrorDetail] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [actionError, setActionError] = useState('');

  useEffect(() => { loadLookups(); }, []);
  useEffect(() => { loadProjects(); }, [page, search, statusFilter, portfolioFilter, sortBy, sortDir]);

  async function loadLookups() {
    try {
      const [pfRes, catRes, lcRes] = await Promise.all([
        fetch('/api/ppm/portfolios'),
        Promise.all([
          fetch('/api/config/values?category=ProjectType'),
          fetch('/api/config/values?category=ProjectCategory'),
          fetch('/api/config/values?category=ProjectSize'),
          fetch('/api/config/values?category=ProjectComplexity'),
          fetch('/api/config/values?category=ProjectPriority'),
          fetch('/api/config/values?category=ProjectStatus'),
          fetch('/api/config/values?category=ProjectHealthStatus'),
        ]),
        fetch('/api/config/lifecycle'),
      ]);
      const pfData = await pfRes.json();
      const [typeR, catR, sizeR, cxR, prR, stR, hR] = await Promise.all(catRes.map((r) => r.json()));
      const lcData = await lcRes.json();

      setPortfolios(pfData.success ? pfData.portfolios : []);
      setLookups({
        types: typeR.success ? typeR.values : [],
        categories: catR.success ? catR.values : [],
        sizes: sizeR.success ? sizeR.values : [],
        complexities: cxR.success ? cxR.values : [],
        priorities: prR.success ? prR.values : [],
        statuses: stR.success ? stR.values : [],
        healthStatuses: hR.success ? hR.values : [],
      });
      setLifecycles(lcData.success ? lcData.lifecycles : []);
    } catch {
      // Non-fatal for the list view itself; dropdowns just render empty.
    }
  }

  async function loadPrograms(portfolioCode) {
    if (!portfolioCode) { setPrograms([]); return; }
    try {
      const res = await fetch(`/api/ppm/programs?portfolio=${encodeURIComponent(portfolioCode)}`);
      const data = await res.json();
      setPrograms(data.success ? data.programs : []);
    } catch { setPrograms([]); }
  }

  async function loadProjects() {
    setStatus('loading');
    setErrorDetail('');
    try {
      const params = new URLSearchParams({
        page: String(page), pageSize: String(PAGE_SIZE), sortBy, sortDir,
      });
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      if (portfolioFilter) params.set('portfolio', portfolioFilter);
      const res = await fetch(`/api/ppm/projects?${params.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        setProjects(data.projects);
        setTotalPages(data.totalPages);
        setTotalCount(data.totalCount);
        setStatus('ok');
      } else {
        setStatus('error'); setErrorDetail(data.detail || data.message || `HTTP ${res.status}`);
      }
    } catch {
      setStatus('error'); setErrorDetail('Could not reach /api/ppm/projects.');
    }
  }

  function handleSearchSubmit(e) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  function toggleSort(col) {
    if (sortBy === col) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
    setPage(1);
  }

  async function handleAdd(e) {
    e.preventDefault();
    setActionError('');
    try {
      const payload = { ...form };
      Object.keys(payload).forEach((k) => { if (payload[k] === '') payload[k] = null; });
      const res = await fetch('/api/ppm/projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.success) { setForm(EMPTY); setShowAdd(false); setPage(1); loadProjects(); }
      else setActionError(data.detail || data.message || 'Could not add project.');
    } catch { setActionError('Could not reach /api/ppm/projects.'); }
  }

  async function handleArchive(id, name) {
    if (!window.confirm(`Archive project "${name}"? This does not delete it - it can still be viewed, just hidden from active views.`)) return;
    try {
      const res = await fetch(`/api/ppm/projects/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) loadProjects();
      else setActionError(data.detail || data.message || 'Could not archive.');
    } catch { setActionError('Could not reach /api/ppm/projects.'); }
  }

  function sortArrow(col) {
    if (sortBy !== col) return '';
    return sortDir === 'asc' ? ' \u25B2' : ' \u25BC';
  }

  return (
    <div className="page">
      <h1>Projects</h1>
      <p className="subtitle">Every project across the portfolio, built for the 250+ project scale this platform manages (Module 04).</p>

      <form onSubmit={handleSearchSubmit} className="filter-row" style={{ flexWrap: 'wrap' }}>
        <input
          placeholder="Search name or code&hellip;"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          style={{ minWidth: 220 }}
        />
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">All Statuses</option>
          {lookups.statuses.map((s) => <option key={s.ConfigValueId} value={s.ValueCode}>{s.ValueLabel}</option>)}
        </select>
        <select value={portfolioFilter} onChange={(e) => { setPortfolioFilter(e.target.value); setPage(1); }}>
          <option value="">All Portfolios</option>
          {portfolios.map((p) => <option key={p.PortfolioId} value={p.PortfolioCode}>{p.PortfolioName}</option>)}
        </select>
        <button type="submit">Search</button>
      </form>

      {status === 'loading' && <p>Loading&hellip;</p>}
      {status === 'error' && <div className="error-box"><strong>Could not load projects.</strong><p>{errorDetail}</p></div>}
      {actionError && <div className="error-box"><strong>Action failed.</strong><p>{actionError}</p></div>}

      {status === 'ok' && (
        <>
          <div className="table-wrap">
            <table className="cmdb-table">
              <thead>
                <tr>
                  <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('ProjectCode')}>Code{sortArrow('ProjectCode')}</th>
                  <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('ProjectName')}>Name{sortArrow('ProjectName')}</th>
                  <th>Portfolio</th>
                  <th>Program</th>
                  <th>Status</th>
                  <th>Health</th>
                  <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('TargetEndDate')}>Target End{sortArrow('TargetEndDate')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.ProjectId} className="clickable-row" onClick={() => onOpenProject && onOpenProject(p.ProjectId)}>
                    <td><code>{p.ProjectCode}</code></td>
                    <td>{p.ProjectName}</td>
                    <td>{p.PortfolioName}</td>
                    <td>{p.ProgramName || '\u2014'}</td>
                    <td>{p.StatusLabel || '\u2014'}</td>
                    <td>{p.HealthStatusLabel ? <span className={`status-pill status-${p.HealthStatusCode === 'GREEN' ? 'active' : p.HealthStatusCode === 'RED' ? 'deprecated' : 'paused'}`}>{p.HealthStatusLabel}</span> : '\u2014'}</td>
                    <td>{p.TargetEndDate ? new Date(p.TargetEndDate).toLocaleDateString() : '\u2014'}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {p.IsActive ? <button onClick={() => handleArchive(p.ProjectId, p.ProjectName)}>Archive</button> : <span className="status-pill status-deprecated">Archived</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {projects.length === 0 && <p style={{ padding: 16 }}>No projects match the current filters.</p>}
          </div>

          <div className="filter-row" style={{ marginTop: 12, alignItems: 'center' }}>
            <button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <span style={{ fontSize: '0.85rem', color: '#555' }}>Page {page} of {totalPages} &middot; {totalCount} project{totalCount === 1 ? '' : 's'}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
          </div>

          {!showAdd ? (
            <button style={{ marginTop: 16 }} onClick={() => setShowAdd(true)} disabled={portfolios.length === 0}>+ Add Project</button>
          ) : (
            <form className="detail-panel" style={{ marginTop: 16, maxWidth: 640 }} onSubmit={handleAdd}>
              <div className="detail-header"><h3>Add Project</h3><button type="button" onClick={() => setShowAdd(false)}>Cancel</button></div>
              <dl>
                <dt>Name</dt><dd><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></dd>

                <dt>Portfolio</dt>
                <dd>
                  <select required value={form.portfolioCode} onChange={(e) => { setForm({ ...form, portfolioCode: e.target.value, programCode: '' }); loadPrograms(e.target.value); }}>
                    <option value="">Select&hellip;</option>
                    {portfolios.map((pf) => <option key={pf.PortfolioId} value={pf.PortfolioCode}>{pf.PortfolioName}</option>)}
                  </select>
                </dd>

                <dt>Program (optional)</dt>
                <dd>
                  <select value={form.programCode} onChange={(e) => setForm({ ...form, programCode: e.target.value })} disabled={!form.portfolioCode}>
                    <option value="">None</option>
                    {programs.map((pg) => <option key={pg.ProgramId} value={pg.ProgramCode}>{pg.ProgramName}</option>)}
                  </select>
                </dd>

                <dt>Project Manager</dt><dd><input value={form.projectManagerName} onChange={(e) => setForm({ ...form, projectManagerName: e.target.value })} /></dd>

                <dt>Type</dt>
                <dd>
                  <select value={form.projectTypeCode} onChange={(e) => setForm({ ...form, projectTypeCode: e.target.value })}>
                    <option value="">&mdash;</option>
                    {lookups.types.map((v) => <option key={v.ConfigValueId} value={v.ValueCode}>{v.ValueLabel}</option>)}
                  </select>
                </dd>
                <dt>Category</dt>
                <dd>
                  <select value={form.projectCategoryCode} onChange={(e) => setForm({ ...form, projectCategoryCode: e.target.value })}>
                    <option value="">&mdash;</option>
                    {lookups.categories.map((v) => <option key={v.ConfigValueId} value={v.ValueCode}>{v.ValueLabel}</option>)}
                  </select>
                </dd>
                <dt>Size</dt>
                <dd>
                  <select value={form.projectSizeCode} onChange={(e) => setForm({ ...form, projectSizeCode: e.target.value })}>
                    <option value="">&mdash;</option>
                    {lookups.sizes.map((v) => <option key={v.ConfigValueId} value={v.ValueCode}>{v.ValueLabel}</option>)}
                  </select>
                </dd>
                <dt>Complexity</dt>
                <dd>
                  <select value={form.projectComplexityCode} onChange={(e) => setForm({ ...form, projectComplexityCode: e.target.value })}>
                    <option value="">&mdash;</option>
                    {lookups.complexities.map((v) => <option key={v.ConfigValueId} value={v.ValueCode}>{v.ValueLabel}</option>)}
                  </select>
                </dd>
                <dt>Priority</dt>
                <dd>
                  <select value={form.projectPriorityCode} onChange={(e) => setForm({ ...form, projectPriorityCode: e.target.value })}>
                    <option value="">&mdash;</option>
                    {lookups.priorities.map((v) => <option key={v.ConfigValueId} value={v.ValueCode}>{v.ValueLabel}</option>)}
                  </select>
                </dd>
                <dt>Status</dt>
                <dd>
                  <select value={form.statusCode} onChange={(e) => setForm({ ...form, statusCode: e.target.value })}>
                    <option value="">&mdash;</option>
                    {lookups.statuses.map((v) => <option key={v.ConfigValueId} value={v.ValueCode}>{v.ValueLabel}</option>)}
                  </select>
                </dd>
                <dt>Health</dt>
                <dd>
                  <select value={form.healthStatusCode} onChange={(e) => setForm({ ...form, healthStatusCode: e.target.value })}>
                    <option value="">&mdash;</option>
                    {lookups.healthStatuses.map((v) => <option key={v.ConfigValueId} value={v.ValueCode}>{v.ValueLabel}</option>)}
                  </select>
                </dd>
                <dt>Lifecycle</dt>
                <dd>
                  <select value={form.lifecycleCode} onChange={(e) => setForm({ ...form, lifecycleCode: e.target.value })}>
                    <option value="">&mdash;</option>
                    {lifecycles.map((l) => <option key={l.LifecycleId} value={l.LifecycleCode}>{l.LifecycleName}</option>)}
                  </select>
                </dd>
                <dt>Start Date</dt><dd><input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></dd>
                <dt>Target End Date</dt><dd><input type="date" value={form.targetEndDate} onChange={(e) => setForm({ ...form, targetEndDate: e.target.value })} /></dd>
                <dt>Description</dt><dd><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></dd>
                <dt>Notes</dt><dd><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></dd>
              </dl>
              <button type="submit" style={{ marginTop: 12 }}>Save Project</button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
