import { useEffect, useState } from 'react';

export default function LifecyclePage() {
  const [lifecycles, setLifecycles] = useState([]);
  const [status, setStatus] = useState('loading');
  const [errorDetail, setErrorDetail] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [showAddLifecycle, setShowAddLifecycle] = useState(false);
  const [lifecycleForm, setLifecycleForm] = useState({ lifecycleCode: '', lifecycleName: '', notes: '' });
  const [showAddPhase, setShowAddPhase] = useState(null); // lifecycleId or null
  const [phaseForm, setPhaseForm] = useState({ phaseName: '', sequenceOrder: 0 });
  const [actionError, setActionError] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setStatus('loading');
    setErrorDetail('');
    try {
      const res = await fetch('/api/config/lifecycle');
      const data = await res.json();
      if (res.ok && data.success) {
        setLifecycles(data.lifecycles);
        setStatus('ok');
        if (data.lifecycles.length > 0 && expandedId === null) setExpandedId(data.lifecycles[0].LifecycleId);
      } else { setStatus('error'); setErrorDetail(data.detail || data.message || `HTTP ${res.status}`); }
    } catch { setStatus('error'); setErrorDetail('Could not reach /api/config/lifecycle.'); }
  }

  async function handleAddLifecycle(e) {
    e.preventDefault();
    setActionError('');
    try {
      const res = await fetch('/api/config/lifecycle', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lifecycleForm),
      });
      const data = await res.json();
      if (res.ok && data.success) { setLifecycleForm({ lifecycleCode: '', lifecycleName: '', notes: '' }); setShowAddLifecycle(false); load(); }
      else setActionError(data.detail || data.message || 'Could not add lifecycle.');
    } catch { setActionError('Could not reach /api/config/lifecycle.'); }
  }

  async function handleAddPhase(e, lifecycleId) {
    e.preventDefault();
    setActionError('');
    try {
      const res = await fetch(`/api/config/lifecycle/${lifecycleId}/phases`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...phaseForm, sequenceOrder: Number(phaseForm.sequenceOrder) || 0 }),
      });
      const data = await res.json();
      if (res.ok && data.success) { setPhaseForm({ phaseName: '', sequenceOrder: 0 }); setShowAddPhase(null); load(); }
      else setActionError(data.detail || data.message || 'Could not add phase.');
    } catch { setActionError('Could not reach /api/config/lifecycle.'); }
  }

  async function handleDeactivatePhase(lifecycleId, phaseId, phaseName) {
    if (!window.confirm(`Deactivate phase "${phaseName}"?`)) return;
    try {
      const res = await fetch(`/api/config/lifecycle/${lifecycleId}/phases/${phaseId}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not deactivate phase.');
    } catch { setActionError('Could not reach /api/config/lifecycle.'); }
  }

  return (
    <div className="page">
      <h1>Lifecycle / Stage-Gate</h1>
      <p className="subtitle">Project lifecycle definitions and their ordered phases (Module 07).</p>

      {status === 'loading' && <p>Loading&hellip;</p>}
      {status === 'error' && <div className="error-box"><strong>Could not load lifecycles.</strong><p>{errorDetail}</p></div>}
      {actionError && <div className="error-box"><strong>Action failed.</strong><p>{actionError}</p></div>}

      {status === 'ok' && (
        <>
          <div className="filter-row">
            {lifecycles.map((l) => (
              <button key={l.LifecycleId} className={`filter-chip ${expandedId === l.LifecycleId ? 'active' : ''}`} onClick={() => setExpandedId(l.LifecycleId)}>
                {l.LifecycleName}
              </button>
            ))}
          </div>

          {lifecycles.filter((l) => l.LifecycleId === expandedId).map((l) => (
            <div key={l.LifecycleId} className="table-wrap">
              <table className="cmdb-table">
                <thead>
                  <tr><th>Seq</th><th>Phase</th><th>Required</th><th>Active</th><th></th></tr>
                </thead>
                <tbody>
                  {l.phases.map((p) => (
                    <tr key={p.PhaseId}>
                      <td>{p.SequenceOrder}</td>
                      <td>{p.PhaseName}</td>
                      <td>{p.IsRequired ? 'Yes' : 'No'}</td>
                      <td><span className={`status-pill status-${p.IsActive ? 'active' : 'deprecated'}`}>{p.IsActive ? 'Active' : 'Inactive'}</span></td>
                      <td>
                        {p.IsActive ? <button onClick={() => handleDeactivatePhase(l.LifecycleId, p.PhaseId, p.PhaseName)}>Deactivate</button> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {l.phases.length === 0 && <p>No phases yet.</p>}

              {showAddPhase !== l.LifecycleId ? (
                <button style={{ marginTop: 12 }} onClick={() => setShowAddPhase(l.LifecycleId)}>+ Add Phase</button>
              ) : (
                <form className="detail-panel" style={{ marginTop: 12 }} onSubmit={(e) => handleAddPhase(e, l.LifecycleId)}>
                  <div className="detail-header"><h3>Add Phase</h3><button type="button" onClick={() => setShowAddPhase(null)}>Cancel</button></div>
                  <dl>
                    <dt>Phase Name</dt><dd><input required value={phaseForm.phaseName} onChange={(e) => setPhaseForm({ ...phaseForm, phaseName: e.target.value })} /></dd>
                    <dt>Sequence Order</dt><dd><input type="number" style={{ width: 70 }} value={phaseForm.sequenceOrder} onChange={(e) => setPhaseForm({ ...phaseForm, sequenceOrder: e.target.value })} /></dd>
                  </dl>
                  <button type="submit" style={{ marginTop: 12 }}>Save Phase</button>
                </form>
              )}
            </div>
          ))}

          {!showAddLifecycle ? (
            <button style={{ marginTop: 16 }} onClick={() => setShowAddLifecycle(true)}>+ Add Lifecycle</button>
          ) : (
            <form className="detail-panel" style={{ marginTop: 16 }} onSubmit={handleAddLifecycle}>
              <div className="detail-header"><h3>Add Lifecycle</h3><button type="button" onClick={() => setShowAddLifecycle(false)}>Cancel</button></div>
              <dl>
                <dt>Code</dt><dd><input required value={lifecycleForm.lifecycleCode} onChange={(e) => setLifecycleForm({ ...lifecycleForm, lifecycleCode: e.target.value.toUpperCase() })} /></dd>
                <dt>Name</dt><dd><input required value={lifecycleForm.lifecycleName} onChange={(e) => setLifecycleForm({ ...lifecycleForm, lifecycleName: e.target.value })} /></dd>
                <dt>Notes</dt><dd><input value={lifecycleForm.notes} onChange={(e) => setLifecycleForm({ ...lifecycleForm, notes: e.target.value })} /></dd>
              </dl>
              <button type="submit" style={{ marginTop: 12 }}>Save Lifecycle</button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
