import { useEffect, useState } from 'react';

const EMPTY = { rateCardCode: '', rateCardName: '', resourceRoleCode: '', resourceTypeCode: '', locationCode: '', costRatePerHour: '', billRatePerHour: '', effectiveStartDate: '', notes: '' };

export default function RateCardsPage() {
  const [rateCards, setRateCards] = useState([]);
  const [roles, setRoles] = useState([]);
  const [types, setTypes] = useState([]);
  const [locations, setLocations] = useState([]);
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
      const [rcRes, roleRes, typeRes, locRes] = await Promise.all([
        fetch('/api/ppm/rate-cards'),
        fetch('/api/config/values?category=ResourceRole'),
        fetch('/api/config/values?category=ResourceType'),
        fetch('/api/org/locations'),
      ]);
      const rcData = await rcRes.json();
      const locData = await locRes.json();
      if (rcRes.ok && rcData.success) {
        setRateCards(rcData.rateCards);
        setRoles((await roleRes.json()).values || []);
        setTypes((await typeRes.json()).values || []);
        setLocations(locData.success ? locData.locations : []);
        setStatus('ok');
      } else {
        setStatus('error'); setErrorDetail(rcData.detail || rcData.message || `HTTP ${rcRes.status}`);
      }
    } catch {
      setStatus('error'); setErrorDetail('Could not reach /api/ppm/rate-cards.');
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    setActionError('');
    try {
      const res = await fetch('/api/ppm/rate-cards', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rateCardCode: form.rateCardCode, rateCardName: form.rateCardName,
          resourceRoleCode: form.resourceRoleCode || null, resourceTypeCode: form.resourceTypeCode || null,
          locationCode: form.locationCode || null, costRatePerHour: Number(form.costRatePerHour),
          billRatePerHour: form.billRatePerHour ? Number(form.billRatePerHour) : null,
          effectiveStartDate: form.effectiveStartDate || null, notes: form.notes || null,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) { setForm(EMPTY); setShowAdd(false); load(); }
      else setActionError(data.detail || data.message || 'Could not add rate card.');
    } catch { setActionError('Could not reach /api/ppm/rate-cards.'); }
  }

  async function handleArchive(id, name) {
    if (!window.confirm(`Archive rate card "${name}"?`)) return;
    try {
      const res = await fetch(`/api/ppm/rate-cards/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not archive.');
    } catch { setActionError('Could not reach /api/ppm/rate-cards.'); }
  }

  return (
    <div className="page">
      <h1>Financials — Rate Cards</h1>
      <p className="subtitle">Enterprise cost and billing rates by Role, Resource Type, and Location (Module 22).</p>

      {status === 'loading' && <p>Loading&hellip;</p>}
      {status === 'error' && <div className="error-box"><strong>Could not load rate cards.</strong><p>{errorDetail}</p></div>}
      {actionError && <div className="error-box"><strong>Action failed.</strong><p>{actionError}</p></div>}

      {status === 'ok' && (
        <>
          <div className="table-wrap">
            <table className="cmdb-table">
              <thead>
                <tr><th>Code</th><th>Name</th><th>Role</th><th>Type</th><th>Location</th><th>Cost/hr</th><th>Bill/hr</th><th>Active</th><th></th></tr>
              </thead>
              <tbody>
                {rateCards.map((rc) => (
                  <tr key={rc.RateCardId}>
                    <td><code>{rc.RateCardCode}</code></td>
                    <td>{rc.RateCardName}</td>
                    <td>{rc.ResourceRoleLabel || '\u2014'}</td>
                    <td>{rc.ResourceTypeLabel || '\u2014'}</td>
                    <td>{rc.LocationName || '\u2014'}</td>
                    <td>${Number(rc.CostRatePerHour).toFixed(2)}</td>
                    <td>{rc.BillRatePerHour != null ? `$${Number(rc.BillRatePerHour).toFixed(2)}` : '\u2014'}</td>
                    <td><span className={`status-pill status-${rc.IsActive ? 'active' : 'deprecated'}`}>{rc.IsActive ? 'Active' : 'Archived'}</span></td>
                    <td>{rc.IsActive ? <button onClick={() => handleArchive(rc.RateCardId, rc.RateCardName)}>Archive</button> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rateCards.length === 0 && <p style={{ padding: 16 }}>No rate cards yet.</p>}
          </div>

          {!showAdd ? (
            <button style={{ marginTop: 16 }} onClick={() => setShowAdd(true)}>+ Add Rate Card</button>
          ) : (
            <form className="detail-panel" style={{ marginTop: 16 }} onSubmit={handleAdd}>
              <div className="detail-header"><h3>Add Rate Card</h3><button type="button" onClick={() => setShowAdd(false)}>Cancel</button></div>
              <dl>
                <dt>Code</dt><dd><input required value={form.rateCardCode} onChange={(e) => setForm({ ...form, rateCardCode: e.target.value })} /></dd>
                <dt>Name</dt><dd><input required value={form.rateCardName} onChange={(e) => setForm({ ...form, rateCardName: e.target.value })} /></dd>
                <dt>Role</dt>
                <dd>
                  <select value={form.resourceRoleCode} onChange={(e) => setForm({ ...form, resourceRoleCode: e.target.value })}>
                    <option value="">Any</option>
                    {roles.map((r) => <option key={r.ConfigValueId} value={r.ValueCode}>{r.ValueLabel}</option>)}
                  </select>
                </dd>
                <dt>Resource Type</dt>
                <dd>
                  <select value={form.resourceTypeCode} onChange={(e) => setForm({ ...form, resourceTypeCode: e.target.value })}>
                    <option value="">Any</option>
                    {types.map((t) => <option key={t.ConfigValueId} value={t.ValueCode}>{t.ValueLabel}</option>)}
                  </select>
                </dd>
                <dt>Location</dt>
                <dd>
                  <select value={form.locationCode} onChange={(e) => setForm({ ...form, locationCode: e.target.value })}>
                    <option value="">Any</option>
                    {locations.map((l) => <option key={l.LocationId} value={l.LocationCode}>{l.LocationName}</option>)}
                  </select>
                </dd>
                <dt>Cost Rate / hr</dt><dd><input required type="number" min="0" step="0.01" value={form.costRatePerHour} onChange={(e) => setForm({ ...form, costRatePerHour: e.target.value })} /></dd>
                <dt>Bill Rate / hr</dt><dd><input type="number" min="0" step="0.01" value={form.billRatePerHour} onChange={(e) => setForm({ ...form, billRatePerHour: e.target.value })} /></dd>
                <dt>Effective From</dt><dd><input type="date" value={form.effectiveStartDate} onChange={(e) => setForm({ ...form, effectiveStartDate: e.target.value })} /></dd>
                <dt>Notes</dt><dd><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></dd>
              </dl>
              <button type="submit" style={{ marginTop: 12 }}>Save Rate Card</button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
