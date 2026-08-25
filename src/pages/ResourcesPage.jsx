import { useEffect, useState } from 'react';

const EMPTY = { name: '', email: '', businessUnitCode: '', resourceTypeCode: '', resourceRoleCode: '', defaultCapacityHoursPerWeek: 40, notes: '' };

export default function ResourcesPage() {
  const [resources, setResources] = useState([]);
  const [businessUnits, setBusinessUnits] = useState([]);
  const [lookups, setLookups] = useState({ types: [], roles: [], skills: [], proficiencies: [] });
  const [status, setStatus] = useState('loading');
  const [errorDetail, setErrorDetail] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [actionError, setActionError] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [newSkill, setNewSkill] = useState({ skillCode: '', proficiencyCode: '' });
  const [utilization, setUtilization] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setStatus('loading');
    setErrorDetail('');
    try {
      const [resRes, buRes, typeRes, roleRes, skillRes, profRes] = await Promise.all([
        fetch('/api/ppm/resources'),
        fetch('/api/org/business-units'),
        fetch('/api/config/values?category=ResourceType'),
        fetch('/api/config/values?category=ResourceRole'),
        fetch('/api/config/values?category=Skill'),
        fetch('/api/config/values?category=SkillProficiencyLevel'),
      ]);
      const resData = await resRes.json();
      const buData = await buRes.json();
      if (resRes.ok && resData.success) {
        setResources(resData.resources);
        setBusinessUnits(buData.success ? buData.businessUnits : []);
        setLookups({
          types: (await typeRes.json()).values || [],
          roles: (await roleRes.json()).values || [],
          skills: (await skillRes.json()).values || [],
          proficiencies: (await profRes.json()).values || [],
        });
        setStatus('ok');
      } else {
        setStatus('error'); setErrorDetail(resData.detail || resData.message || `HTTP ${resRes.status}`);
      }
    } catch {
      setStatus('error'); setErrorDetail('Could not reach /api/ppm/resources.');
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    setActionError('');
    try {
      const res = await fetch('/api/ppm/resources', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name, email: form.email || null, businessUnitCode: form.businessUnitCode || null,
          resourceTypeCode: form.resourceTypeCode || null, resourceRoleCode: form.resourceRoleCode || null,
          defaultCapacityHoursPerWeek: form.defaultCapacityHoursPerWeek, notes: form.notes || null,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) { setForm(EMPTY); setShowAdd(false); load(); }
      else setActionError(data.detail || data.message || 'Could not add resource.');
    } catch { setActionError('Could not reach /api/ppm/resources.'); }
  }

  async function handleArchive(id, name) {
    if (!window.confirm(`Archive resource "${name}"?`)) return;
    try {
      const res = await fetch(`/api/ppm/resources/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not archive.');
    } catch { setActionError('Could not reach /api/ppm/resources.'); }
  }

  async function toggleExpand(id) {
    if (expandedId === id) { setExpandedId(null); setUtilization(null); return; }
    setExpandedId(id);
    try {
      const res = await fetch(`/api/ppm/resources/${id}/utilization`);
      const data = await res.json();
      setUtilization(res.ok && data.success ? data.utilization : null);
    } catch { setUtilization(null); }
  }

  async function handleAddSkill(resourceId) {
    if (!newSkill.skillCode) return;
    setActionError('');
    try {
      const res = await fetch(`/api/ppm/resources/${resourceId}/skills`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSkill),
      });
      const data = await res.json();
      if (res.ok && data.success) { setNewSkill({ skillCode: '', proficiencyCode: '' }); load(); }
      else setActionError(data.detail || data.message || 'Could not add skill.');
    } catch { setActionError('Could not reach /api/ppm/resources.'); }
  }

  async function handleRemoveSkill(resourceId, resourceSkillId) {
    try {
      const res = await fetch(`/api/ppm/resources/${resourceId}/skills/${resourceSkillId}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not remove skill.');
    } catch { setActionError('Could not reach /api/ppm/resources.'); }
  }

  return (
    <div className="page">
      <h1>RMG / Resources</h1>
      <p className="subtitle">The enterprise resource master — staffing, capacity, and skills (Modules 16 &amp; 20).</p>

      {status === 'loading' && <p>Loading&hellip;</p>}
      {status === 'error' && <div className="error-box"><strong>Could not load resources.</strong><p>{errorDetail}</p></div>}
      {actionError && <div className="error-box"><strong>Action failed.</strong><p>{actionError}</p></div>}

      {status === 'ok' && (
        <>
          <div className="table-wrap">
            <table className="cmdb-table">
              <thead>
                <tr><th>Code</th><th>Name</th><th>Type</th><th>Role</th><th>Business Unit</th><th>Capacity/wk</th><th>Active</th><th></th></tr>
              </thead>
              <tbody>
                {resources.map((r) => (
                  <>
                    <tr key={r.ResourceId} className="clickable-row" onClick={() => toggleExpand(r.ResourceId)}>
                      <td><code>{r.ResourceCode}</code></td>
                      <td>{r.ResourceName}</td>
                      <td>{r.ResourceTypeLabel || '\u2014'}</td>
                      <td>{r.ResourceRoleLabel || '\u2014'}</td>
                      <td>{r.BusinessUnitName || '\u2014'}</td>
                      <td>{r.DefaultCapacityHoursPerWeek}h</td>
                      <td><span className={`status-pill status-${r.IsActive ? 'active' : 'deprecated'}`}>{r.IsActive ? 'Active' : 'Archived'}</span></td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {r.IsActive ? <button onClick={() => handleArchive(r.ResourceId, r.ResourceName)}>Archive</button> : null}
                      </td>
                    </tr>
                    {expandedId === r.ResourceId && (
                      <tr key={`${r.ResourceId}-detail`}>
                        <td colSpan={8} style={{ background: '#f8f9fb', padding: 16 }}>
                          <strong>Utilization</strong>
                          {utilization ? (
                            <p style={{ margin: '4px 0 12px' }}>
                              Planned: {utilization.totalPlannedPercent}%{utilization.isOverAllocatedPlanned && <span className="status-pill status-deprecated" style={{ marginLeft: 8 }}>Over-allocated</span>}
                              {' · '}Actual: {utilization.totalActualPercent}%
                              {' · '}across {utilization.allocations.length} project{utilization.allocations.length === 1 ? '' : 's'}
                            </p>
                          ) : <p className="placeholder-detail">Loading utilization&hellip;</p>}

                          <strong>Skills</strong>
                          <ul style={{ margin: '8px 0' }}>
                            {(r.skills || []).map((s) => (
                              <li key={s.ResourceSkillId} style={{ marginBottom: 4 }}>
                                {s.SkillLabel} {s.ProficiencyLabel ? `(${s.ProficiencyLabel})` : ''}{' '}
                                <button onClick={() => handleRemoveSkill(r.ResourceId, s.ResourceSkillId)}>Remove</button>
                              </li>
                            ))}
                            {(r.skills || []).length === 0 && <li style={{ color: '#777' }}>No skills recorded.</li>}
                          </ul>
                          <div className="filter-row">
                            <select value={newSkill.skillCode} onChange={(e) => setNewSkill({ ...newSkill, skillCode: e.target.value })}>
                              <option value="">Select skill&hellip;</option>
                              {lookups.skills.map((s) => <option key={s.ConfigValueId} value={s.ValueCode}>{s.ValueLabel}</option>)}
                            </select>
                            <select value={newSkill.proficiencyCode} onChange={(e) => setNewSkill({ ...newSkill, proficiencyCode: e.target.value })}>
                              <option value="">Proficiency&hellip;</option>
                              {lookups.proficiencies.map((p) => <option key={p.ConfigValueId} value={p.ValueCode}>{p.ValueLabel}</option>)}
                            </select>
                            <button onClick={() => handleAddSkill(r.ResourceId)}>+ Add Skill</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
            {resources.length === 0 && <p style={{ padding: 16 }}>No resources yet.</p>}
          </div>

          {!showAdd ? (
            <button style={{ marginTop: 16 }} onClick={() => setShowAdd(true)}>+ Add Resource</button>
          ) : (
            <form className="detail-panel" style={{ marginTop: 16 }} onSubmit={handleAdd}>
              <div className="detail-header"><h3>Add Resource</h3><button type="button" onClick={() => setShowAdd(false)}>Cancel</button></div>
              <dl>
                <dt>Name</dt><dd><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></dd>
                <dt>Email</dt><dd><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></dd>
                <dt>Business Unit</dt>
                <dd>
                  <select value={form.businessUnitCode} onChange={(e) => setForm({ ...form, businessUnitCode: e.target.value })}>
                    <option value="">&mdash;</option>
                    {businessUnits.map((bu) => <option key={bu.BusinessUnitId} value={bu.BusinessUnitCode}>{bu.BusinessUnitName}</option>)}
                  </select>
                </dd>
                <dt>Type</dt>
                <dd>
                  <select value={form.resourceTypeCode} onChange={(e) => setForm({ ...form, resourceTypeCode: e.target.value })}>
                    <option value="">&mdash;</option>
                    {lookups.types.map((v) => <option key={v.ConfigValueId} value={v.ValueCode}>{v.ValueLabel}</option>)}
                  </select>
                </dd>
                <dt>Role</dt>
                <dd>
                  <select value={form.resourceRoleCode} onChange={(e) => setForm({ ...form, resourceRoleCode: e.target.value })}>
                    <option value="">&mdash;</option>
                    {lookups.roles.map((v) => <option key={v.ConfigValueId} value={v.ValueCode}>{v.ValueLabel}</option>)}
                  </select>
                </dd>
                <dt>Default Capacity (hrs/wk)</dt>
                <dd><input type="number" min="0" max="168" value={form.defaultCapacityHoursPerWeek} onChange={(e) => setForm({ ...form, defaultCapacityHoursPerWeek: Number(e.target.value) })} /></dd>
                <dt>Notes</dt><dd><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></dd>
              </dl>
              <button type="submit" style={{ marginTop: 12 }}>Save Resource</button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
