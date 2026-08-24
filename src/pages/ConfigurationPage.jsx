import { useEffect, useState } from 'react';

export default function ConfigurationPage() {
  const [categories, setCategories] = useState([]);
  const [categoryStatus, setCategoryStatus] = useState('loading'); // loading | ok | error
  const [categoryErrorDetail, setCategoryErrorDetail] = useState('');
  const [activeCategory, setActiveCategory] = useState(null);

  const [values, setValues] = useState([]);
  const [valueStatus, setValueStatus] = useState('loading');
  const [valueErrorDetail, setValueErrorDetail] = useState('');

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
        if (data.categories.length > 0) setActiveCategory(data.categories[0].CategoryCode);
      } else {
        setCategoryStatus('error');
        setCategoryErrorDetail(data.detail || data.message || `HTTP ${res.status}`);
      }
    } catch (err) {
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
    } catch (err) {
      setValueStatus('error');
      setValueErrorDetail('Could not reach /api/config/values.');
    }
  }

  return (
    <div className="page">
      <h1>Project Configuration</h1>
      <p className="subtitle">
        Configurable picklists used across the platform (Module 05). Read-only
        for now &mdash; Create/Update/Delete lands in a later slice.
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
                onClick={() => setActiveCategory(c.CategoryCode)}
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

          {valueStatus === 'ok' && (
            <div className="table-wrap">
              <table className="cmdb-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Label</th>
                    <th>Default</th>
                    <th>Active</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {values.map((v) => (
                    <tr key={v.ConfigValueId}>
                      <td>{v.ValueCode}</td>
                      <td>{v.ValueLabel}</td>
                      <td>{v.IsDefault ? 'Yes' : '—'}</td>
                      <td>
                        <span className={`status-pill status-${v.IsActive ? 'active' : 'deprecated'}`}>
                          {v.IsActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>{v.Notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {values.length === 0 && <p>No values recorded for this category.</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
