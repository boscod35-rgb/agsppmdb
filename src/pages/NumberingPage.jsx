import { useEffect, useState } from 'react';

const EMPTY = { entityType: '', prefix: '', suffix: '', separator: '-', sequenceLength: 5, resetRule: 'Never', notes: '' };

export default function NumberingPage() {
  const [rules, setRules] = useState([]);
  const [status, setStatus] = useState('loading');
  const [errorDetail, setErrorDetail] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [actionError, setActionError] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setStatus('loading');
    setErrorDetail('');
    try {
      const res = await fetch('/api/config/numbering');
      const data = await res.json();
      if (res.ok && data.success) { setRules(data.rules); setStatus('ok'); }
      else { setStatus('error'); setErrorDetail(data.detail || data.message || `HTTP ${res.status}`); }
    } catch {
      setStatus('error'); setErrorDetail('Could not reach /api/config/numbering.');
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    setActionError('');
    try {
      const res = await fetch('/api/config/numbering', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, sequenceLength: Number(form.sequenceLength) || 5 }),
      });
      const data = await res.json();
      if (res.ok && data.success) { setForm(EMPTY); setShowAdd(false); load(); }
      else setActionError(data.detail || data.message || 'Could not add rule.');
    } catch { setActionError('Could not reach /api/config/numbering.'); }
  }

  function startEdit(r) {
    setEditingId(r.NumberingRuleId);
    setEditForm({ prefix: r.Prefix, suffix: r.Suffix, separator: r.Separator, sequenceLength: r.SequenceLength, resetRule: r.ResetRule, notes: r.Notes || '' });
    setActionError('');
  }

  async function handleSaveEdit(id) {
    setActionError('');
    try {
      const res = await fetch(`/api/config/numbering/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...editForm, sequenceLength: Number(editForm.sequenceLength) || 5 }),
      });
      const data = await res.json();
      if (res.ok && data.success) { setEditingId(null); load(); }
      else setActionError(data.detail || data.message || 'Could not save.');
    } catch { setActionError('Could not reach /api/config/numbering.'); }
  }

  async function handleDeactivate(id, entityType) {
    if (!window.confirm(`Deactivate the numbering rule for "${entityType}"?`)) return;
    try {
      const res = await fetch(`/api/config/numbering/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not deactivate.');
    } catch { setActionError('Could not reach /api/config/numbering.'); }
  }

  return (
    <div className="page">
      <h1>Numbering</h1>
      <p className="subtitle">Business-visible ID generation rules per entity type (Module 06).</p>

      {status === 'loading' && <p>Loading&hellip;</p>}
      {status === 'error' && <div className="error-box"><strong>Could not load numbering rules.</strong><p>{errorDetail}</p></div>}
      {actionError && <div className="error-box"><strong>Action failed.</strong><p>{actionError}</p></div>}

      {status === 'ok' && (
        <>
          <div className="table-wrap">
            <table className="cmdb-table">
              <thead>
                <tr>
                  <th>Entity Type</th><th>Pattern</th><th>Next Preview</th><th>Reset</th><th>Active</th><th></th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => editingId === r.NumberingRuleId ? (
                  <tr key={r.NumberingRuleId}>
                    <td>{r.EntityType}</td>
                    <td>
                      <input style={{ width: 50 }} value={editForm.prefix} onChange={(e) => setEditForm({ ...editForm, prefix: e.target.value })} placeholder="prefix" />
                      {' '}
                      <input style={{ width: 30 }} value={editForm.separator} onChange={(e) => setEditForm({ ...editForm, separator: e.target.value })} />
                      {' '}
                      <input type="number" style={{ width: 50 }} value={editForm.sequenceLength} onChange={(e) => setEditForm({ ...editForm, sequenceLength: e.target.value })} />
                    </td>
                    <td>&mdash;</td>
                    <td>
                      <select value={editForm.resetRule} onChange={(e) => setEditForm({ ...editForm, resetRule: e.target.value })}>
                        <option>Never</option><option>Monthly</option><option>Annual</option>
                      </select>
                    </td>
                    <td>
                      <span className={`status-pill status-${r.IsActive ? 'active' : 'deprecated'}`}>{r.IsActive ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td>
                      <button onClick={() => handleSaveEdit(r.NumberingRuleId)}>Save</button>{' '}
                      <button onClick={() => setEditingId(null)}>Cancel</button>
                    </td>
                  </tr>
                ) : (
                  <tr key={r.NumberingRuleId}>
                    <td>{r.EntityType}</td>
                    <td><code>{r.Prefix}{r.Separator}{'0'.repeat(r.SequenceLength)}{r.Suffix}</code></td>
                    <td><code>{r.PreviewNext}</code></td>
                    <td>{r.ResetRule}</td>
                    <td>
                      <span className={`status-pill status-${r.IsActive ? 'active' : 'deprecated'}`}>{r.IsActive ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td>
                      <button onClick={() => startEdit(r)}>Edit</button>{' '}
                      {r.IsActive ? <button onClick={() => handleDeactivate(r.NumberingRuleId, r.EntityType)}>Deactivate</button> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rules.length === 0 && <p>No numbering rules yet.</p>}
          </div>

          {!showAdd ? (
            <button style={{ marginTop: 16 }} onClick={() => setShowAdd(true)}>+ Add Numbering Rule</button>
          ) : (
            <form className="detail-panel" style={{ marginTop: 16 }} onSubmit={handleAdd}>
              <div className="detail-header"><h3>Add Numbering Rule</h3><button type="button" onClick={() => setShowAdd(false)}>Cancel</button></div>
              <dl>
                <dt>Entity Type</dt><dd><input required value={form.entityType} onChange={(e) => setForm({ ...form, entityType: e.target.value })} placeholder="e.g. Program" /></dd>
                <dt>Prefix</dt><dd><input value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value.toUpperCase() })} placeholder="e.g. PG" /></dd>
                <dt>Separator</dt><dd><input style={{ width: 50 }} value={form.separator} onChange={(e) => setForm({ ...form, separator: e.target.value })} /></dd>
                <dt>Sequence Length</dt><dd><input type="number" style={{ width: 70 }} value={form.sequenceLength} onChange={(e) => setForm({ ...form, sequenceLength: e.target.value })} /></dd>
                <dt>Reset Rule</dt>
                <dd>
                  <select value={form.resetRule} onChange={(e) => setForm({ ...form, resetRule: e.target.value })}>
                    <option>Never</option><option>Monthly</option><option>Annual</option>
                  </select>
                </dd>
                <dt>Notes</dt><dd><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></dd>
              </dl>
              <button type="submit" style={{ marginTop: 12 }}>Save Rule</button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
