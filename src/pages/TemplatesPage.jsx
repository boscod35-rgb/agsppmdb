import { useEffect, useState } from 'react';

const EMPTY = { templateCode: '', name: '', projectTypeCode: '', lifecycleCode: '', description: '', notes: '' };
const EMPTY_ITEM = { itemName: '', sequenceOrder: 0, isRequired: true };

export default function TemplatesPage() {
  const [templates, setTemplates] = useState([]);
  const [types, setTypes] = useState([]);
  const [lifecycles, setLifecycles] = useState([]);
  const [status, setStatus] = useState('loading');
  const [errorDetail, setErrorDetail] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [actionError, setActionError] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [newItem, setNewItem] = useState(EMPTY_ITEM);

  useEffect(() => { load(); }, []);

  async function load() {
    setStatus('loading');
    setErrorDetail('');
    try {
      const [tplRes, typeRes, lcRes] = await Promise.all([
        fetch('/api/ppm/templates'),
        fetch('/api/config/values?category=ProjectType'),
        fetch('/api/config/lifecycle'),
      ]);
      const tplData = await tplRes.json();
      const typeData = await typeRes.json();
      const lcData = await lcRes.json();
      if (tplRes.ok && tplData.success) {
        setTemplates(tplData.templates);
        setTypes(typeData.success ? typeData.values : []);
        setLifecycles(lcData.success ? lcData.lifecycles : []);
        setStatus('ok');
      } else {
        setStatus('error'); setErrorDetail(tplData.detail || tplData.message || `HTTP ${tplRes.status}`);
      }
    } catch {
      setStatus('error'); setErrorDetail('Could not reach /api/ppm/templates.');
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    setActionError('');
    try {
      const res = await fetch('/api/ppm/templates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateCode: form.templateCode, name: form.name,
          projectTypeCode: form.projectTypeCode || null, lifecycleCode: form.lifecycleCode || null,
          description: form.description || null, notes: form.notes || null,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) { setForm(EMPTY); setShowAdd(false); load(); }
      else setActionError(data.detail || data.message || 'Could not add template.');
    } catch { setActionError('Could not reach /api/ppm/templates.'); }
  }

  async function handleArchive(id, name) {
    if (!window.confirm(`Archive template "${name}"?`)) return;
    try {
      const res = await fetch(`/api/ppm/templates/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not archive.');
    } catch { setActionError('Could not reach /api/ppm/templates.'); }
  }

  async function handleAddItem(templateId) {
    if (!newItem.itemName.trim()) return;
    setActionError('');
    try {
      const res = await fetch(`/api/ppm/templates/${templateId}/items`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newItem),
      });
      const data = await res.json();
      if (res.ok && data.success) { setNewItem(EMPTY_ITEM); load(); }
      else setActionError(data.detail || data.message || 'Could not add process matrix item.');
    } catch { setActionError('Could not reach /api/ppm/templates.'); }
  }

  async function handleRemoveItem(templateId, itemId) {
    try {
      const res = await fetch(`/api/ppm/templates/${templateId}/items/${itemId}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not remove item.');
    } catch { setActionError('Could not reach /api/ppm/templates.'); }
  }

  return (
    <div className="page">
      <h1>Global Templates</h1>
      <p className="subtitle">Reusable enterprise templates, each with its own Process Matrix checklist (Modules 08 &amp; 11).</p>

      {status === 'loading' && <p>Loading&hellip;</p>}
      {status === 'error' && <div className="error-box"><strong>Could not load templates.</strong><p>{errorDetail}</p></div>}
      {actionError && <div className="error-box"><strong>Action failed.</strong><p>{actionError}</p></div>}

      {status === 'ok' && (
        <>
          <div className="table-wrap">
            <table className="cmdb-table">
              <thead>
                <tr><th>Code</th><th>Name</th><th>Project Type</th><th>Lifecycle</th><th>Items</th><th>Active</th><th></th></tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <>
                    <tr key={t.TemplateId} className="clickable-row" onClick={() => setExpandedId(expandedId === t.TemplateId ? null : t.TemplateId)}>
                      <td><code>{t.TemplateCode}</code></td>
                      <td>{t.TemplateName}</td>
                      <td>{t.ProjectTypeLabel || '\u2014'}</td>
                      <td>{t.LifecycleName || '\u2014'}</td>
                      <td>{t.items?.length ?? 0}</td>
                      <td><span className={`status-pill status-${t.IsActive ? 'active' : 'deprecated'}`}>{t.IsActive ? 'Active' : 'Archived'}</span></td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {t.IsActive ? <button onClick={() => handleArchive(t.TemplateId, t.TemplateName)}>Archive</button> : null}
                      </td>
                    </tr>
                    {expandedId === t.TemplateId && (
                      <tr key={`${t.TemplateId}-items`}>
                        <td colSpan={7} style={{ background: '#f8f9fb', padding: 16 }}>
                          <strong>Process Matrix</strong>
                          <ul style={{ margin: '8px 0' }}>
                            {(t.items || []).filter((i) => i.IsActive).sort((a, b) => a.SequenceOrder - b.SequenceOrder).map((i) => (
                              <li key={i.ProcessMatrixItemId} style={{ marginBottom: 4 }}>
                                {i.SequenceOrder}. {i.ItemName} {i.IsRequired ? '' : '(optional)'}{' '}
                                <button onClick={() => handleRemoveItem(t.TemplateId, i.ProcessMatrixItemId)}>Remove</button>
                              </li>
                            ))}
                            {(t.items || []).filter((i) => i.IsActive).length === 0 && <li style={{ color: '#777' }}>No items yet.</li>}
                          </ul>
                          <div className="filter-row">
                            <input placeholder="Item name" value={newItem.itemName} onChange={(e) => setNewItem({ ...newItem, itemName: e.target.value })} />
                            <input type="number" style={{ width: 70 }} placeholder="Order" value={newItem.sequenceOrder} onChange={(e) => setNewItem({ ...newItem, sequenceOrder: Number(e.target.value) })} />
                            <label style={{ fontSize: '0.85rem' }}>
                              <input type="checkbox" checked={newItem.isRequired} onChange={(e) => setNewItem({ ...newItem, isRequired: e.target.checked })} /> Required
                            </label>
                            <button onClick={() => handleAddItem(t.TemplateId)}>+ Add Item</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
            {templates.length === 0 && <p style={{ padding: 16 }}>No templates yet.</p>}
          </div>

          {!showAdd ? (
            <button style={{ marginTop: 16 }} onClick={() => setShowAdd(true)}>+ Add Template</button>
          ) : (
            <form className="detail-panel" style={{ marginTop: 16 }} onSubmit={handleAdd}>
              <div className="detail-header"><h3>Add Template</h3><button type="button" onClick={() => setShowAdd(false)}>Cancel</button></div>
              <dl>
                <dt>Code</dt><dd><input required value={form.templateCode} onChange={(e) => setForm({ ...form, templateCode: e.target.value })} /></dd>
                <dt>Name</dt><dd><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></dd>
                <dt>Project Type</dt>
                <dd>
                  <select value={form.projectTypeCode} onChange={(e) => setForm({ ...form, projectTypeCode: e.target.value })}>
                    <option value="">&mdash;</option>
                    {types.map((v) => <option key={v.ConfigValueId} value={v.ValueCode}>{v.ValueLabel}</option>)}
                  </select>
                </dd>
                <dt>Lifecycle</dt>
                <dd>
                  <select value={form.lifecycleCode} onChange={(e) => setForm({ ...form, lifecycleCode: e.target.value })}>
                    <option value="">&mdash;</option>
                    {lifecycles.map((l) => <option key={l.LifecycleId} value={l.LifecycleCode}>{l.LifecycleName}</option>)}
                  </select>
                </dd>
                <dt>Description</dt><dd><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></dd>
                <dt>Notes</dt><dd><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></dd>
              </dl>
              <button type="submit" style={{ marginTop: 12 }}>Save Template</button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
