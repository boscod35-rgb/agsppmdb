import { useEffect, useState } from 'react';

const EMPTY = { name: '', businessUnitCode: '', ownerName: '', statusCode: '', description: '', notes: '' };

export default function PortfolioPage() {
  const [portfolios, setPortfolios] = useState([]);
  const [businessUnits, setBusinessUnits] = useState([]);
  const [statuses, setStatuses] = useState([]);
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

  useEffect(() => { load(); }, []);

  async function load() {
    setStatus('loading');
    setErrorDetail('');
    try {
      const [pfRes, buRes, statusRes] = await Promise.all([
        fetch('/api/ppm/portfolios'),
        fetch('/api/org/business-units'),
        fetch('/api/config/values?category=PortfolioStatus'),
      ]);
      const pfData = await pfRes.json();
      const buData = await buRes.json();
      const statusData = await statusRes.json();
      if (pfRes.ok && pfData.success) {
        setPortfolios(pfData.portfolios);
        setBusinessUnits(buData.success ? buData.businessUnits : []);
        setStatuses(statusData.success ? statusData.values : []);
        setStatus('ok');
      } else {
        setStatus('error'); setErrorDetail(pfData.detail || pfData.message || `HTTP ${pfRes.status}`);
      }
    } catch {
      setStatus('error'); setErrorDetail('Could not reach /api/ppm/portfolios.');
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    setActionError('');
    try {
      const res = await fetch('/api/ppm/portfolios', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          businessUnitCode: form.businessUnitCode || null,
          ownerName: form.ownerName || null,
          statusCode: form.statusCode || null,
          description: form.description || null,
          notes: form.notes || null,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) { setForm(EMPTY); setShowAdd(false); load(); }
      else setActionError(data.detail || data.message || 'Could not add portfolio.');
    } catch { setActionError('Could not reach /api/ppm/portfolios.'); }
  }

  function startEdit(p) {
    setEditingId(p.PortfolioId);
    setEditForm({
      name: p.PortfolioName,
      businessUnitCode: p.BusinessUnitCode || '',
      ownerName: p.OwnerName || '',
      statusCode: p.StatusCode || '',
      description: p.Description || '',
      notes: p.Notes || '',
    });
    setActionError('');
  }

  async function handleSaveEdit(id) {
    setActionError('');
    try {
      const res = await fetch(`/api/ppm/portfolios/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name,
          businessUnitCode: editForm.businessUnitCode || null,
          ownerName: editForm.ownerName || null,
          statusCode: editForm.statusCode || null,
          description: editForm.description || null,
          notes: editForm.notes || null,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) { setEditingId(null); load(); }
      else setActionError(data.detail || data.message || 'Could not save.');
    } catch { setActionError('Could not reach /api/ppm/portfolios.'); }
  }

  async function handleArchive(id, name) {
    if (!window.confirm(`Archive portfolio "${name}"? This does not delete it - it can still be viewed, just hidden from active views.`)) return;
    try {
      const res = await fetch(`/api/ppm/portfolios/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not archive.');
    } catch { setActionError('Could not reach /api/ppm/portfolios.'); }
  }

  async function toggleRollup(id) {
    if (expandedId === id) { setExpandedId(null); setRollup(null); return; }
    setExpandedId(id);
    setRollupStatus('loading');
    try {
      const res = await fetch(`/api/ppm/raid-rollup/portfolio/${id}`);
      const data = await res.json();
      setRollup(res.ok && data.success ? data.rollup : null);
      setRollupStatus('ok');
    } catch { setRollup(null); setRollupStatus('error'); }
  }

  return (
    <div className="page">
      <h1>Portfolio</h1>
      <p className="subtitle">Portfolios group related Programs and Projects under a Business Unit (Module 02).</p>

      {status === 'loading' && <p>Loading&hellip;</p>}
      {status === 'error' && <div className="error-box"><strong>Could not load portfolios.</strong><p>{errorDetail}</p></div>}
      {actionError && <div className="error-box"><strong>Action failed.</strong><p>{actionError}</p></div>}

      {status === 'ok' && (
        <>
          <div className="table-wrap">
            <table className="cmdb-table">
              <thead>
                <tr>
                  <th>Code</th><th>Name</th><th>Business Unit</th><th>Owner</th><th>Status</th><th>Active</th><th>RAID</th><th></th>
                </tr>
              </thead>
              <tbody>
                {portfolios.map((p) => editingId === p.PortfolioId ? (
                  <tr key={p.PortfolioId}>
                    <td><code>{p.PortfolioCode}</code></td>
                    <td><input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></td>
                    <td>
                      <select value={editForm.businessUnitCode} onChange={(e) => setEditForm({ ...editForm, businessUnitCode: e.target.value })}>
                        <option value="">&mdash;</option>
                        {businessUnits.map((bu) => <option key={bu.BusinessUnitId} value={bu.BusinessUnitCode}>{bu.BusinessUnitName}</option>)}
                      </select>
                    </td>
                    <td><input value={editForm.ownerName} onChange={(e) => setEditForm({ ...editForm, ownerName: e.target.value })} /></td>
                    <td>
                      <select value={editForm.statusCode} onChange={(e) => setEditForm({ ...editForm, statusCode: e.target.value })}>
                        <option value="">&mdash;</option>
                        {statuses.map((s) => <option key={s.ConfigValueId} value={s.ValueCode}>{s.ValueLabel}</option>)}
                      </select>
                    </td>
                    <td><span className={`status-pill status-${p.IsActive ? 'active' : 'deprecated'}`}>{p.IsActive ? 'Active' : 'Archived'}</span></td>
                    <td>&mdash;</td>
                    <td>
                      <button onClick={() => handleSaveEdit(p.PortfolioId)}>Save</button>{' '}
                      <button onClick={() => setEditingId(null)}>Cancel</button>
                    </td>
                  </tr>
                ) : (
                  <tr key={p.PortfolioId}>
                    <td><code>{p.PortfolioCode}</code></td>
                    <td>{p.PortfolioName}</td>
                    <td>{p.BusinessUnitName || '\u2014'}</td>
                    <td>{p.OwnerName || '\u2014'}</td>
                    <td>{p.StatusLabel ? <span className="status-pill status-active">{p.StatusLabel}</span> : '\u2014'}</td>
                    <td><span className={`status-pill status-${p.IsActive ? 'active' : 'deprecated'}`}>{p.IsActive ? 'Active' : 'Archived'}</span></td>
                    <td><button onClick={() => toggleRollup(p.PortfolioId)}>{expandedId === p.PortfolioId ? 'Hide' : 'Rollup'}</button></td>
                    <td>
                      <button onClick={() => startEdit(p)}>Edit</button>{' '}
                      {p.IsActive ? <button onClick={() => handleArchive(p.PortfolioId, p.PortfolioName)}>Archive</button> : null}
                    </td>
                  </tr>
                ))}
                {portfolios.map((p) => expandedId === p.PortfolioId && (
                  <tr key={`${p.PortfolioId}-rollup`}>
                    <td colSpan={8} style={{ background: '#f8f9fb', padding: 16 }}>
                      <strong>RAID Rollup — all projects under this portfolio</strong>
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
            {portfolios.length === 0 && <p style={{ padding: 16 }}>No portfolios yet.</p>}
          </div>

          {!showAdd ? (
            <button style={{ marginTop: 16 }} onClick={() => setShowAdd(true)}>+ Add Portfolio</button>
          ) : (
            <form className="detail-panel" style={{ marginTop: 16 }} onSubmit={handleAdd}>
              <div className="detail-header"><h3>Add Portfolio</h3><button type="button" onClick={() => setShowAdd(false)}>Cancel</button></div>
              <dl>
                <dt>Name</dt><dd><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></dd>
                <dt>Business Unit</dt>
                <dd>
                  <select value={form.businessUnitCode} onChange={(e) => setForm({ ...form, businessUnitCode: e.target.value })}>
                    <option value="">&mdash;</option>
                    {businessUnits.map((bu) => <option key={bu.BusinessUnitId} value={bu.BusinessUnitCode}>{bu.BusinessUnitName}</option>)}
                  </select>
                </dd>
                <dt>Owner</dt><dd><input value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} /></dd>
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
              <button type="submit" style={{ marginTop: 12 }}>Save Portfolio</button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
