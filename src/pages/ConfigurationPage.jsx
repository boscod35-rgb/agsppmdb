import { useEffect, useState } from 'react';

const EMPTY_FORM = { valueCode: '', valueLabel: '', sortOrder: 0, isDefault: false, notes: '' };

export default function ConfigurationPage() {
  const [categories, setCategories] = useState([]);
  const [categoryStatus, setCategoryStatus] = useState('loading');
  const [categoryErrorDetail, setCategoryErrorDetail] = useState('');
  const [activeCategory, setActiveCategory] = useState(null);

  const [values, setValues] = useState([]);
  const [valueStatus, setValueStatus] = useState('loading');
  const [valueErrorDetail, setValueErrorDetail] = useState('');

  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    loadCategories();
  }, []);

  useEffect(() => {
    if (activeCategory) loadValues(activeCategory);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory]);

  async function loadCategories() {
    setCategoryStatus('loading');
    setCategoryErrorDetail('');
    try {
      const res = await fetch('/api/config/categories');
      const data = await res.json();
      if (res.ok && data.success) {
        setCategories(data.categories);
        setCategoryStatus('ok');
        if (data.categories.length > 0 && !activeCategory) {
          setActiveCategory(data.categories[0].CategoryCode);
        }
      } else {
        setCategoryStatus('error');
        setCategoryErrorDetail(data.detail || data.message || `HTTP ${res.status}`);
      }
    } catch {
      setCategoryStatus('error');
      setCategoryErrorDetail('Could not reach /api/config/categories.');
    }
  }

  async function loadValues(categoryCode) {
    setValueStatus('loading');
    setValueErrorDetail('');
    try {
      const res = await fetch(`/api/config/values?category=${categoryCode}`);
      const data = await res.json();
      if (res.ok && data.success) {
        setValues(data.values);
        setValueStatus('ok');
      } else {
        setValueStatus('error');
        setValueErrorDetail(data.detail || data.message || `HTTP ${res.status}`);
      }
    } catch {
      setValueStatus('error');
      setValueErrorDetail('Could not reach /api/config/values.');
    }
  }

  function switchCategory(code) {
    setActiveCategory(code);
    setShowAddForm(false);
    setEditingId(null);
    setActionError('');
  }

  async function handleAdd(e) {
    e.preventDefault();
    setActionError('');
    try {
      const res = await fetch('/api/config/values', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryCode: activeCategory, ...form, sortOrder: Number(form.sortOrder) || 0 }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setForm(EMPTY_FORM);
        setShowAddForm(false);
        loadValues(activeCategory);
      } else {
        setActionError(data.detail || data.message || 'Could not add value.');
      }
    } catch {
      setActionError('Could not reach /api/config/values.');
    }
  }

  function startEdit(v) {
    setEditingId(v.ConfigValueId);
    setEditForm({ valueLabel: v.ValueLabel, sortOrder: v.SortOrder, isDefault: !!v.IsDefault, notes: v.Notes || '' });
    setActionError('');
  }

  async function handleSaveEdit(id) {
    setActionError('');
    try {
      const res = await fetch(`/api/config/values/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...editForm, sortOrder: Number(editForm.sortOrder) || 0 }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setEditingId(null);
        loadValues(activeCategory);
      } else {
        setActionError(data.detail || data.message || 'Could not save changes.');
      }
    } catch {
      setActionError('Could not reach /api/config/values.');
    }
  }

  async function handleDeactivate(id, label) {
    if (!window.confirm(`Deactivate "${label}"? It will be hidden from new selections but its history is kept.`)) return;
    setActionError('');
    try {
      const res = await fetch(`/api/config/values/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) {
        loadValues(activeCategory);
      } else {
        setActionError(data.detail || data.message || 'Could not deactivate value.');
      }
    } catch {
      setActionError('Could not reach /api/config/values.');
    }
  }

  return (
    <div className="page">
      <h1>Project Configuration</h1>
      <p className="subtitle">
        Configurable picklists used across the platform (Module 05).
      </p>

      {categoryStatus === 'loading' && <p>Loading categories&hellip;</p>}

      {categoryStatus === 'error' && (
        <div className="error-box">
          <strong>Could not load configuration categories.</strong>
          <p>{categoryErrorDetail}</p>
        </div>
      )}

      {categoryStatus === 'ok' && (
        <>
          <div className="filter-row">
            {categories.map((c) => (
              <button
                key={c.CategoryCode}
                className={`filter-chip ${activeCategory === c.CategoryCode ? 'active' : ''}`}
                onClick={() => switchCategory(c.CategoryCode)}
              >
                {c.CategoryName}
              </button>
            ))}
          </div>

          {valueStatus === 'loading' && <p>Loading values&hellip;</p>}

          {valueStatus === 'error' && (
            <div className="error-box">
              <strong>Could not load configuration values.</strong>
              <p>{valueErrorDetail}</p>
            </div>
          )}

          {actionError && (
            <div className="error-box">
              <strong>Action failed.</strong>
              <p>{actionError}</p>
            </div>
          )}

          {valueStatus === 'ok' && (
            <>
              <div className="table-wrap">
                <table className="cmdb-table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Label</th>
                      <th>Sort</th>
                      <th>Default</th>
                      <th>Active</th>
                      <th>Notes</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {values.map((v) =>
                      editingId === v.ConfigValueId ? (
                        <tr key={v.ConfigValueId}>
                          <td>{v.ValueCode}</td>
                          <td>
                            <input
                              value={editForm.valueLabel}
                              onChange={(e) => setEditForm({ ...editForm, valueLabel: e.target.value })}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              style={{ width: 60 }}
                              value={editForm.sortOrder}
                              onChange={(e) => setEditForm({ ...editForm, sortOrder: e.target.value })}
                            />
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              checked={editForm.isDefault}
                              onChange={(e) => setEditForm({ ...editForm, isDefault: e.target.checked })}
                            />
                          </td>
                          <td>
                            <span className={`status-pill status-${v.IsActive ? 'active' : 'deprecated'}`}>
                              {v.IsActive ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td>
                            <input
                              value={editForm.notes}
                              onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                            />
                          </td>
                          <td>
                            <button onClick={() => handleSaveEdit(v.ConfigValueId)}>Save</button>{' '}
                            <button onClick={() => setEditingId(null)}>Cancel</button>
                          </td>
                        </tr>
                      ) : (
                        <tr key={v.ConfigValueId}>
                          <td>{v.ValueCode}</td>
                          <td>{v.ValueLabel}</td>
                          <td>{v.SortOrder}</td>
                          <td>{v.IsDefault ? 'Yes' : '\u2014'}</td>
                          <td>
                            <span className={`status-pill status-${v.IsActive ? 'active' : 'deprecated'}`}>
                              {v.IsActive ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td>{v.Notes || '\u2014'}</td>
                          <td>
                            <button onClick={() => startEdit(v)}>Edit</button>{' '}
                            {v.IsActive ? (
                              <button onClick={() => handleDeactivate(v.ConfigValueId, v.ValueLabel)}>
                                Deactivate
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
                {values.length === 0 && <p>No values recorded for this category.</p>}
              </div>

              {!showAddForm ? (
                <button style={{ marginTop: 16 }} onClick={() => setShowAddForm(true)}>
                  + Add Value
                </button>
              ) : (
                <form className="detail-panel" style={{ marginTop: 16 }} onSubmit={handleAdd}>
                  <div className="detail-header">
                    <h3>Add value to {categories.find((c) => c.CategoryCode === activeCategory)?.CategoryName}</h3>
                    <button type="button" onClick={() => setShowAddForm(false)}>Cancel</button>
                  </div>
                  <dl>
                    <dt>Value Code</dt>
                    <dd>
                      <input
                        required
                        value={form.valueCode}
                        onChange={(e) => setForm({ ...form, valueCode: e.target.value.toUpperCase() })}
                        placeholder="e.g. PILOT"
                      />
                    </dd>
                    <dt>Label</dt>
                    <dd>
                      <input
                        required
                        value={form.valueLabel}
                        onChange={(e) => setForm({ ...form, valueLabel: e.target.value })}
                        placeholder="e.g. Pilot"
                      />
                    </dd>
                    <dt>Sort Order</dt>
                    <dd>
                      <input
                        type="number"
                        style={{ width: 80 }}
                        value={form.sortOrder}
                        onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
                      />
                    </dd>
                    <dt>Default</dt>
                    <dd>
                      <input
                        type="checkbox"
                        checked={form.isDefault}
                        onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
                      />
                    </dd>
                    <dt>Notes</dt>
                    <dd>
                      <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                    </dd>
                  </dl>
                  <button type="submit" style={{ marginTop: 12 }}>Save Value</button>
                </form>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
