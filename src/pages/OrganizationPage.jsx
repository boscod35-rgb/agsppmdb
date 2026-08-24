import { useEffect, useState } from 'react';

const TABS = [
  { id: 'business-units', label: 'Business Units' },
  { id: 'departments', label: 'Departments' },
  { id: 'locations', label: 'Locations' },
];

export default function OrganizationPage() {
  const [activeTab, setActiveTab] = useState('business-units');
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('loading');
  const [errorDetail, setErrorDetail] = useState('');
  const [businessUnits, setBusinessUnits] = useState([]); // for department dropdown

  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', businessUnitCode: '', country: '', timeZone: '', notes: '' });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    load();
    setShowAddForm(false);
    setEditingId(null);
    setActionError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    fetch('/api/org/business-units')
      .then((r) => r.json())
      .then((d) => d.success && setBusinessUnits(d.businessUnits))
      .catch(() => {});
  }, []);

  async function load() {
    setStatus('loading');
    setErrorDetail('');
    try {
      const res = await fetch(`/api/org/${activeTab}`);
      const data = await res.json();
      if (res.ok && data.success) {
        setItems(data.businessUnits || data.departments || data.locations || []);
        setStatus('ok');
      } else {
        setStatus('error');
        setErrorDetail(data.detail || data.message || `HTTP ${res.status}`);
      }
    } catch {
      setStatus('error');
      setErrorDetail(`Could not reach /api/org/${activeTab}.`);
    }
  }

  function idOf(item) {
    return item.BusinessUnitId || item.DepartmentId || item.LocationId;
  }
  function codeOf(item) {
    return item.BusinessUnitCode || item.DepartmentCode || item.LocationCode;
  }
  function nameOf(item) {
    return item.BusinessUnitName || item.DepartmentName || item.LocationName;
  }

  async function handleAdd(e) {
    e.preventDefault();
    setActionError('');
    try {
      const res = await fetch(`/api/org/${activeTab}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setForm({ code: '', name: '', businessUnitCode: '', country: '', timeZone: '', notes: '' });
        setShowAddForm(false);
        load();
      } else {
        setActionError(data.detail || data.message || 'Could not add record.');
      }
    } catch {
      setActionError(`Could not reach /api/org/${activeTab}.`);
    }
  }

  function startEdit(item) {
    setEditingId(idOf(item));
    setEditForm({
      name: nameOf(item),
      notes: item.Notes || '',
      country: item.Country || '',
      timeZone: item.TimeZone || '',
    });
    setActionError('');
  }

  async function handleSaveEdit(id) {
    setActionError('');
    try {
      const res = await fetch(`/api/org/${activeTab}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setEditingId(null);
        load();
      } else {
        setActionError(data.detail || data.message || 'Could not save changes.');
      }
    } catch {
      setActionError(`Could not reach /api/org/${activeTab}.`);
    }
  }

  async function handleDeactivate(id, name) {
    if (!window.confirm(`Deactivate "${name}"? Its history is kept, it just won't be selectable going forward.`)) return;
    setActionError('');
    try {
      const res = await fetch(`/api/org/${activeTab}/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not deactivate.');
    } catch {
      setActionError(`Could not reach /api/org/${activeTab}.`);
    }
  }

  return (
    <div className="page">
      <h1>Organization</h1>
      <p className="subtitle">Business Units, Departments, and Locations (Module 01).</p>

      <div className="filter-row">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`filter-chip ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {status === 'loading' && <p>Loading&hellip;</p>}
      {status === 'error' && (
        <div className="error-box">
          <strong>Could not load {activeTab}.</strong>
          <p>{errorDetail}</p>
        </div>
      )}
      {actionError && (
        <div className="error-box">
          <strong>Action failed.</strong>
          <p>{actionError}</p>
        </div>
      )}

      {status === 'ok' && (
        <>
          <div className="table-wrap">
            <table className="cmdb-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  {activeTab === 'departments' && <th>Business Unit</th>}
                  {activeTab === 'locations' && <th>Country</th>}
                  {activeTab === 'locations' && <th>Time Zone</th>}
                  <th>Active</th>
                  <th>Notes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const id = idOf(item);
                  const isEditing = editingId === id;
                  return isEditing ? (
                    <tr key={id}>
                      <td>{codeOf(item)}</td>
                      <td><input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></td>
                      {activeTab === 'departments' && <td>{item.BusinessUnitCode}</td>}
                      {activeTab === 'locations' && (
                        <td><input value={editForm.country} onChange={(e) => setEditForm({ ...editForm, country: e.target.value })} /></td>
                      )}
                      {activeTab === 'locations' && (
                        <td><input value={editForm.timeZone} onChange={(e) => setEditForm({ ...editForm, timeZone: e.target.value })} /></td>
                      )}
                      <td>
                        <span className={`status-pill status-${item.IsActive ? 'active' : 'deprecated'}`}>
                          {item.IsActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td><input value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} /></td>
                      <td>
                        <button onClick={() => handleSaveEdit(id)}>Save</button>{' '}
                        <button onClick={() => setEditingId(null)}>Cancel</button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={id}>
                      <td>{codeOf(item)}</td>
                      <td>{nameOf(item)}</td>
                      {activeTab === 'departments' && <td>{item.BusinessUnitCode}</td>}
                      {activeTab === 'locations' && <td>{item.Country || '\u2014'}</td>}
                      {activeTab === 'locations' && <td>{item.TimeZone || '\u2014'}</td>}
                      <td>
                        <span className={`status-pill status-${item.IsActive ? 'active' : 'deprecated'}`}>
                          {item.IsActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>{item.Notes || '\u2014'}</td>
                      <td>
                        <button onClick={() => startEdit(item)}>Edit</button>{' '}
                        {item.IsActive ? (
                          <button onClick={() => handleDeactivate(id, nameOf(item))}>Deactivate</button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {items.length === 0 && <p>No records yet.</p>}
          </div>

          {!showAddForm ? (
            <button style={{ marginTop: 16 }} onClick={() => setShowAddForm(true)}>
              + Add {TABS.find((t) => t.id === activeTab)?.label.replace(/s$/, '')}
            </button>
          ) : (
            <form className="detail-panel" style={{ marginTop: 16 }} onSubmit={handleAdd}>
              <div className="detail-header">
                <h3>Add {TABS.find((t) => t.id === activeTab)?.label.replace(/s$/, '')}</h3>
                <button type="button" onClick={() => setShowAddForm(false)}>Cancel</button>
              </div>
              <dl>
                <dt>Code</dt>
                <dd><input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} /></dd>
                <dt>Name</dt>
                <dd><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></dd>
                {activeTab === 'departments' && (
                  <>
                    <dt>Business Unit</dt>
                    <dd>
                      <select
                        required
                        value={form.businessUnitCode}
                        onChange={(e) => setForm({ ...form, businessUnitCode: e.target.value })}
                      >
                        <option value="">Select...</option>
                        {businessUnits.map((bu) => (
                          <option key={bu.BusinessUnitId} value={bu.BusinessUnitCode}>{bu.BusinessUnitName}</option>
                        ))}
                      </select>
                    </dd>
                  </>
                )}
                {activeTab === 'locations' && (
                  <>
                    <dt>Country</dt>
                    <dd><input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></dd>
                    <dt>Time Zone</dt>
                    <dd><input value={form.timeZone} onChange={(e) => setForm({ ...form, timeZone: e.target.value })} placeholder="e.g. Asia/Singapore" /></dd>
                  </>
                )}
                <dt>Notes</dt>
                <dd><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></dd>
              </dl>
              <button type="submit" style={{ marginTop: 12 }}>Save</button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
