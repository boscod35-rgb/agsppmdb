import { useEffect, useState } from 'react';

const EMPTY = {
  themeCode: '', themeName: '', companyName: '', tagline: '',
  colorPrimary: '#B8860B', colorSecondary: '#1B2A4A', colorAccent: '#D4AF37',
  colorStatusGreen: '#1A7F37', colorStatusAmber: '#C77700', colorStatusRed: '#B3261E',
  notes: '',
};

function Swatch({ color }) {
  return (
    <span
      style={{
        display: 'inline-block', width: 14, height: 14, borderRadius: 3,
        background: color || '#ccc', border: '1px solid #999', marginRight: 6, verticalAlign: 'middle',
      }}
    />
  );
}

export default function BrandingPage() {
  const [themes, setThemes] = useState([]);
  const [status, setStatus] = useState('loading');
  const [errorDetail, setErrorDetail] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [actionError, setActionError] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setStatus('loading');
    setErrorDetail('');
    try {
      const res = await fetch('/api/config/branding');
      const data = await res.json();
      if (res.ok && data.success) { setThemes(data.themes); setStatus('ok'); }
      else { setStatus('error'); setErrorDetail(data.detail || data.message || `HTTP ${res.status}`); }
    } catch { setStatus('error'); setErrorDetail('Could not reach /api/config/branding.'); }
  }

  async function handleAdd(e) {
    e.preventDefault();
    setActionError('');
    try {
      const res = await fetch('/api/config/branding', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok && data.success) { setForm(EMPTY); setShowAdd(false); load(); }
      else setActionError(data.detail || data.message || 'Could not add theme.');
    } catch { setActionError('Could not reach /api/config/branding.'); }
  }

  async function handleSetDefault(id) {
    setActionError('');
    try {
      const res = await fetch(`/api/config/branding/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isDefault: true }),
      });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not set default.');
    } catch { setActionError('Could not reach /api/config/branding.'); }
  }

  async function handleDeactivate(id, name) {
    if (!window.confirm(`Deactivate theme "${name}"?`)) return;
    try {
      const res = await fetch(`/api/config/branding/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not deactivate.');
    } catch { setActionError('Could not reach /api/config/branding.'); }
  }

  return (
    <div className="page">
      <h1>Branding &amp; Theme</h1>
      <p className="subtitle">
        Theme definitions (Section 106). Management only for now &mdash;
        not yet applied to this app&rsquo;s live colors/fonts.
      </p>

      {status === 'loading' && <p>Loading&hellip;</p>}
      {status === 'error' && <div className="error-box"><strong>Could not load themes.</strong><p>{errorDetail}</p></div>}
      {actionError && <div className="error-box"><strong>Action failed.</strong><p>{actionError}</p></div>}

      {status === 'ok' && (
        <>
          <div className="table-wrap">
            <table className="cmdb-table">
              <thead>
                <tr><th>Code</th><th>Name</th><th>Colors</th><th>Default</th><th>Active</th><th></th></tr>
              </thead>
              <tbody>
                {themes.map((t) => (
                  <tr key={t.ThemeId}>
                    <td>{t.ThemeCode}</td>
                    <td>{t.ThemeName}</td>
                    <td>
                      <Swatch color={t.ColorPrimary} /><Swatch color={t.ColorSecondary} /><Swatch color={t.ColorAccent} />
                    </td>
                    <td>{t.IsDefault ? 'Yes' : (
                      <button onClick={() => handleSetDefault(t.ThemeId)}>Make Default</button>
                    )}</td>
                    <td><span className={`status-pill status-${t.IsActive ? 'active' : 'deprecated'}`}>{t.IsActive ? 'Active' : 'Inactive'}</span></td>
                    <td>
                      {t.IsActive && !t.IsDefault ? <button onClick={() => handleDeactivate(t.ThemeId, t.ThemeName)}>Deactivate</button> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {themes.length === 0 && <p>No themes yet.</p>}
          </div>

          {!showAdd ? (
            <button style={{ marginTop: 16 }} onClick={() => setShowAdd(true)}>+ Add Theme</button>
          ) : (
            <form className="detail-panel" style={{ marginTop: 16, maxWidth: 600 }} onSubmit={handleAdd}>
              <div className="detail-header"><h3>Add Theme</h3><button type="button" onClick={() => setShowAdd(false)}>Cancel</button></div>
              <dl>
                <dt>Code</dt><dd><input required value={form.themeCode} onChange={(e) => setForm({ ...form, themeCode: e.target.value.toUpperCase() })} /></dd>
                <dt>Name</dt><dd><input required value={form.themeName} onChange={(e) => setForm({ ...form, themeName: e.target.value })} /></dd>
                <dt>Company Name</dt><dd><input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} /></dd>
                <dt>Tagline</dt><dd><input value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} /></dd>
                <dt>Primary Color</dt><dd><input type="color" value={form.colorPrimary} onChange={(e) => setForm({ ...form, colorPrimary: e.target.value })} /></dd>
                <dt>Secondary Color</dt><dd><input type="color" value={form.colorSecondary} onChange={(e) => setForm({ ...form, colorSecondary: e.target.value })} /></dd>
                <dt>Accent Color</dt><dd><input type="color" value={form.colorAccent} onChange={(e) => setForm({ ...form, colorAccent: e.target.value })} /></dd>
                <dt>Notes</dt><dd><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></dd>
              </dl>
              <button type="submit" style={{ marginTop: 12 }}>Save Theme</button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
