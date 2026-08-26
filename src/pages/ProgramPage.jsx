import { useEffect, useState } from 'react';

const EMPTY = { name: '', portfolioCode: '', programManagerName: '', statusCode: '', description: '', notes: '' };

export default function ProgramPage() {
  const [programs, setPrograms] = useState([]);
  const [portfolios, setPortfolios] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [portfolioFilter, setPortfolioFilter] = useState('');
  const [status, setStatus] = useState('loading');
  const [errorDetail, setErrorDetail] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [actionError, setActionError] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [rollup, setRollup] = useState(null);
  const [rollupStatus, setRollupStatus] = useState('idle');

  useEffect(() => { load(); }, [portfolioFilter]);

  async function load() {
    setStatus('loading');
    setErrorDetail('');
    try {
      const qs = portfolioFilter ? `?portfolio=${encodeURIComponent(portfolioFilter)}` : '';
      const [pgRes, pfRes, statusRes] = await Promise.all([
        fetch(`/api/ppm/programs${qs}`),
        fetch('/api/ppm/portfolios'),
        fetch('/api/config/values?category=ProgramStatus'),
      ]);
      const pgData = await pgRes.json();
      const pfData = await pfRes.json();
      const statusData = await statusRes.json();
      if (pgRes.ok && pgData.success) {
        setPrograms(pgData.programs);
        setPortfolios(pfData.success ? pfData.portfolios : []);
        setStatuses(statusData.success ? statusData.values : []);
        setStatus('ok');
      } else {
        setStatus('error'); setErrorDetail(pgData.detail || pgData.message || `HTTP ${pgRes.status}`);
      }
    } catch {
      setStatus('error'); setErrorDetail('Could not reach /api/ppm/programs.');
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    setActionError('');
    try {
      const res = await fetch('/api/ppm/programs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          portfolioCode: form.portfolioCode,
          programManagerName: form.programManagerName || null,
          statusCode: form.statusCode || null,
          description: form.description || null,
          notes: form.notes || null,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) { setForm(EMPTY); setShowAdd(false); load(); }
      else setActionError(data.detail || data.message || 'Could not add program.');
    } catch { setActionError('Could not reach /api/ppm/programs.'); }
  }

  function startEdit(p) {
    setEditingId(p.ProgramId);
    setEditForm({
      name: p.ProgramName,
      portfolioCode: p.PortfolioCode,
      programManagerName: p.ProgramManagerName || '',
      statusCode: p.StatusCode || '',
      description: p.Description || '',
      notes: p.Notes || '',
    });
    setActionError('');
  }

  async function handleSaveEdit(id) {
    setActionError('');
    try {
      const res = await fetch(`/api/ppm/programs/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name,
          portfolioCode: editForm.portfolioCode,
          programManagerName: editForm.programManagerName || null,
          statusCode: editForm.statusCode || null,
          description: editForm.description || null,
          notes: editForm.notes || null,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) { setEditingId(null); load(); }
      else setActionError(data.detail || data.message || 'Could not save.');
    } catch { setActionError('Could not reach /api/ppm/programs.'); }
  }

  async function handleArchive(id, name) {
    if (!window.confirm(`Archive program "${name}"? This does not delete it - it can still be viewed, just hidden from active views.`)) return;
    try {
      const res = await fetch(`/api/ppm/programs/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not archive.');
    } catch { setActionError('Could not reach /api/ppm/programs.'); }
  }

  async function toggleRollup(id) {
    if (expandedId === id) { setExpandedId(null); setRollup(null); return; }
    setExpandedId(id);
    setRollupStatus('loading');
    try {
      const res = await fetch(`/api/ppm/raid-rollup/program/${id}`);
      const data = await res.json();
      setRollup(res.ok && data.success ? data.rollup : null);
      setRollupStatus('ok');
    } catch { setRollup(null); setRollupStatus('error'); }
  }

  return (
    <div className="page">
      <h1>Programs</h1>
      <p className="subtitle">Programs group related Projects under a Portfolio (Module 03).</p>

      <div className="filter-row">
        <select value={portfolioFilter} onChange={(e) => setPortfolioFilter(e.target.value)}>
          <option value="">All Portfolios</option>
          {portfolios.map((p) => <option key={p.PortfolioId} value={p.PortfolioCode}>{p.PortfolioName}</option>)}
        </select>
      </div>

      {status === 'loading' && <p>Loading&hellip;</p>}
      {status === 'error' && <div className="error-box"><strong>Could not load programs.</strong><p>{errorDetail}</p></div>}
      {actionError && <div className="error-box"><strong>Action failed.</strong><p>{actionError}</p></div>}

      {status === 'ok' && (
        <>
          <div className="table-wrap">
            <table className="cmdb-table">
              <thead>
                <tr>
                  <th>Code</th><th>Name</th><th>Portfolio</th><th>Program Manager</th><th>Status</th><th>Active</th><th>RAID</th><th></th>
                </tr>
              </thead>
              <tbody>
                {programs.map((p) => editingId === p.ProgramId ? (
                  <tr key={p.ProgramId}>
                    <td><code>{p.ProgramCode}</code></td>
                    <td><input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></td>
                    <td>
                      <select value={editForm.portfolioCode} onChange={(e) => setEditForm({ ...editForm, portfolioCode: e.target.value })}>
                        {portfolios.map((pf) => <option key={pf.PortfolioId} value={pf.PortfolioCode}>{pf.PortfolioName}</option>)}
                      </select>
                    </td>
                    <td><input value={editForm.programManagerName} onChange={(e) => setEditForm({ ...editForm, programManagerName: e.target.value })} /></td>
                    <td>
                      <select value={editForm.statusCode} onChange={(e) => setEditForm({ ...editForm, statusCode: e.target.value })}>
                        <option value="">&mdash;</option>
                        {statuses.map((s) => <option key={s.ConfigValueId} value={s.ValueCode}>{s.ValueLabel}</option>)}
                      </select>
                    </td>
                    <td><span className={`status-pill status-${p.IsActive ? 'active' : 'deprecated'}`}>{p.IsActive ? 'Active' : 'Archived'}</span></td>
                    <td>&mdash;</td>
                    <td>
                      <button onClick={() => handleSaveEdit(p.ProgramId)}>Save</button>{' '}
                      <button onClick={() => setEditingId(null)}>Cancel</button>
                    </td>
                  </tr>
                ) : (
                  <tr key={p.ProgramId}>
                    <td><code>{p.ProgramCode}</code></td>
                    <td>{p.ProgramName}</td>
                    <td>{p.PortfolioName}</td>
                    <td>{p.ProgramManagerName || '\u2014'}</td>
                    <td>{p.StatusLabel ? <span className="status-pill status-active">{p.StatusLabel}</span> : '\u2014'}</td>
                    <td><span className={`status-pill status-${p.IsActive ? 'active' : 'deprecated'}`}>{p.IsActive ? 'Active' : 'Archived'}</span></td>
                    <td><button onClick={() => toggleRollup(p.ProgramId)}>{expandedId === p.ProgramId ? 'Hide' : 'Rollup'}</button></td>
                    <td>
                      <button onClick={() => startEdit(p)}>Edit</button>{' '}
                      {p.IsActive ? <button onClick={() => handleArchive(p.ProgramId, p.ProgramName)}>Archive</button> : null}
                    </td>
                  </tr>
                ))}
                {programs.map((p) => expandedId === p.ProgramId && (
                  <tr key={`${p.ProgramId}-rollup`}>
                    <td colSpan={8} style={{ background: '#f8f9fb', padding: 16 }}>
                      <strong>RAID Rollup — all projects under this program</strong>
                      {rollupStatus === 'loading' && <p className="placeholder-detail">Loading&hellip;</p>}
                      {rollupStatus === 'error' && <p className="placeholder-detail">Could not load rollup.</p>}
                      {rollupStatus === 'ok' && rollup && (
                        <p style={{ margin: '8px 0 0' }}>
                          Open: {rollup.totalOpen} &middot; Escalated: {rollup.totalEscalated} &middot; Closed: {rollup.totalClosed} &middot; Overdue: {rollup.totalOverdue}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {programs.length === 0 && <p style={{ padding: 16 }}>No programs yet.</p>}
          </div>

          {!showAdd ? (
            <button style={{ marginTop: 16 }} onClick={() => setShowAdd(true)} disabled={portfolios.length === 0}>+ Add Program</button>
          ) : (
            <form className="detail-panel" style={{ marginTop: 16 }} onSubmit={handleAdd}>
              <div className="detail-header"><h3>Add Program</h3><button type="button" onClick={() => setShowAdd(false)}>Cancel</button></div>
              <dl>
                <dt>Name</dt><dd><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></dd>
                <dt>Portfolio</dt>
                <dd>
                  <select required value={form.portfolioCode} onChange={(e) => setForm({ ...form, portfolioCode: e.target.value })}>
                    <option value="">Select&hellip;</option>
                    {portfolios.map((pf) => <option key={pf.PortfolioId} value={pf.PortfolioCode}>{pf.PortfolioName}</option>)}
                  </select>
                </dd>
                <dt>Program Manager</dt><dd><input value={form.programManagerName} onChange={(e) => setForm({ ...form, programManagerName: e.target.value })} /></dd>
                <dt>Status</dt>
                <dd>
                  <select value={form.statusCode} onChange={(e) => setForm({ ...form, statusCode: e.target.value })}>
                    <option value="">&mdash;</option>
                    {statuses.map((s) => <option key={s.ConfigValueId} value={s.ValueCode}>{s.ValueLabel}</option>)}
                  </select>
                </dd>
                <dt>Description</dt><dd><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></dd>
                <dt>Notes</dt><dd><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></dd>
              </dl>
              <button type="submit" style={{ marginTop: 12 }}>Save Program</button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
