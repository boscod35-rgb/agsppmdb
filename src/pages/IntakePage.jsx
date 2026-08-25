import { useEffect, useState } from 'react';

const EMPTY = {
  requestTitle: '', businessNeed: '', sponsorName: '', requestedByName: '', businessUnitCode: '',
  projectTypeCode: '', projectCategoryCode: '', priorityCode: '', templateCode: '', requestedDate: '',
  description: '', notes: '',
};

export default function IntakePage() {
  const [intakes, setIntakes] = useState([]);
  const [businessUnits, setBusinessUnits] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [portfolios, setPortfolios] = useState([]);
  const [lookups, setLookups] = useState({ types: [], categories: [], priorities: [] });
  const [status, setStatus] = useState('loading');
  const [errorDetail, setErrorDetail] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [actionError, setActionError] = useState('');
  const [convertingId, setConvertingId] = useState(null);
  const [convertForm, setConvertForm] = useState({ portfolioCode: '', programCode: '', projectName: '', projectManagerName: '' });

  useEffect(() => { load(); }, []);

  async function load() {
    setStatus('loading');
    setErrorDetail('');
    try {
      const [ikRes, buRes, tplRes, pfRes, typeRes, catRes, prRes] = await Promise.all([
        fetch('/api/ppm/intakes'),
        fetch('/api/org/business-units'),
        fetch('/api/ppm/templates'),
        fetch('/api/ppm/portfolios'),
        fetch('/api/config/values?category=ProjectType'),
        fetch('/api/config/values?category=ProjectCategory'),
        fetch('/api/config/values?category=ProjectPriority'),
      ]);
      const ikData = await ikRes.json();
      const buData = await buRes.json();
      const tplData = await tplRes.json();
      const pfData = await pfRes.json();
      const typeData = await typeRes.json();
      const catData = await catRes.json();
      const prData = await prRes.json();
      if (ikRes.ok && ikData.success) {
        setIntakes(ikData.intakes);
        setBusinessUnits(buData.success ? buData.businessUnits : []);
        setTemplates(tplData.success ? tplData.templates : []);
        setPortfolios(pfData.success ? pfData.portfolios : []);
        setLookups({
          types: typeData.success ? typeData.values : [],
          categories: catData.success ? catData.values : [],
          priorities: prData.success ? prData.values : [],
        });
        setStatus('ok');
      } else {
        setStatus('error'); setErrorDetail(ikData.detail || ikData.message || `HTTP ${ikRes.status}`);
      }
    } catch {
      setStatus('error'); setErrorDetail('Could not reach /api/ppm/intakes.');
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    setActionError('');
    try {
      const payload = { ...form };
      Object.keys(payload).forEach((k) => { if (payload[k] === '') payload[k] = null; });
      const res = await fetch('/api/ppm/intakes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.success) { setForm(EMPTY); setShowAdd(false); load(); }
      else setActionError(data.detail || data.message || 'Could not add intake.');
    } catch { setActionError('Could not reach /api/ppm/intakes.'); }
  }

  async function handleArchive(id, title) {
    if (!window.confirm(`Archive intake "${title}"?`)) return;
    try {
      const res = await fetch(`/api/ppm/intakes/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not archive.');
    } catch { setActionError('Could not reach /api/ppm/intakes.'); }
  }

  function startConvert(ik) {
    setConvertingId(ik.IntakeId);
    setConvertForm({ portfolioCode: '', programCode: '', projectName: ik.RequestTitle, projectManagerName: '' });
    setActionError('');
  }

  async function handleConvert(id) {
    setActionError('');
    try {
      const res = await fetch(`/api/ppm/intakes/${id}/convert`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portfolioCode: convertForm.portfolioCode,
          programCode: convertForm.programCode || null,
          projectName: convertForm.projectName || null,
          projectManagerName: convertForm.projectManagerName || null,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) { setConvertingId(null); load(); }
      else setActionError(data.detail || data.message || 'Could not convert intake.');
    } catch { setActionError('Could not reach /api/ppm/intakes.'); }
  }

  return (
    <div className="page">
      <h1>Intake</h1>
      <p className="subtitle">Initial project requests, before they become a real Project (Module 09).</p>

      {status === 'loading' && <p>Loading&hellip;</p>}
      {status === 'error' && <div className="error-box"><strong>Could not load intakes.</strong><p>{errorDetail}</p></div>}
      {actionError && <div className="error-box"><strong>Action failed.</strong><p>{actionError}</p></div>}

      {status === 'ok' && (
        <>
          <div className="table-wrap">
            <table className="cmdb-table">
              <thead>
                <tr><th>Code</th><th>Title</th><th>Sponsor</th><th>Status</th><th>Converted Project</th><th></th></tr>
              </thead>
              <tbody>
                {intakes.map((ik) => (
                  <tr key={ik.IntakeId}>
                    <td><code>{ik.IntakeCode}</code></td>
                    <td>{ik.RequestTitle}</td>
                    <td>{ik.SponsorName || '\u2014'}</td>
                    <td>{ik.StatusLabel || '\u2014'}</td>
                    <td>{ik.ConvertedProjectCode ? <code>{ik.ConvertedProjectCode}</code> : '\u2014'}</td>
                    <td>
                      {!ik.ProjectId && ik.IsActive && <button onClick={() => startConvert(ik)}>Convert to Project</button>}{' '}
                      {ik.IsActive && !ik.ProjectId ? <button onClick={() => handleArchive(ik.IntakeId, ik.RequestTitle)}>Archive</button> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {intakes.length === 0 && <p style={{ padding: 16 }}>No intake requests yet.</p>}
          </div>

          {convertingId && (
            <div className="detail-panel" style={{ marginTop: 16, maxWidth: 480 }}>
              <div className="detail-header"><h3>Convert to Project</h3><button onClick={() => setConvertingId(null)}>Cancel</button></div>
              <dl>
                <dt>Portfolio</dt>
                <dd>
                  <select required value={convertForm.portfolioCode} onChange={(e) => setConvertForm({ ...convertForm, portfolioCode: e.target.value })}>
                    <option value="">Select&hellip;</option>
                    {portfolios.map((pf) => <option key={pf.PortfolioId} value={pf.PortfolioCode}>{pf.PortfolioName}</option>)}
                  </select>
                </dd>
                <dt>Project Name</dt><dd><input value={convertForm.projectName} onChange={(e) => setConvertForm({ ...convertForm, projectName: e.target.value })} /></dd>
                <dt>Project Manager</dt><dd><input value={convertForm.projectManagerName} onChange={(e) => setConvertForm({ ...convertForm, projectManagerName: e.target.value })} /></dd>
              </dl>
              <button style={{ marginTop: 12 }} onClick={() => handleConvert(convertingId)} disabled={!convertForm.portfolioCode}>Convert</button>
            </div>
          )}

          {!showAdd ? (
            <button style={{ marginTop: 16 }} onClick={() => setShowAdd(true)}>+ Add Intake</button>
          ) : (
            <form className="detail-panel" style={{ marginTop: 16, maxWidth: 600 }} onSubmit={handleAdd}>
              <div className="detail-header"><h3>Add Intake</h3><button type="button" onClick={() => setShowAdd(false)}>Cancel</button></div>
              <dl>
                <dt>Request Title</dt><dd><input required value={form.requestTitle} onChange={(e) => setForm({ ...form, requestTitle: e.target.value })} /></dd>
                <dt>Business Need</dt><dd><input value={form.businessNeed} onChange={(e) => setForm({ ...form, businessNeed: e.target.value })} /></dd>
                <dt>Sponsor</dt><dd><input value={form.sponsorName} onChange={(e) => setForm({ ...form, sponsorName: e.target.value })} /></dd>
                <dt>Requested By</dt><dd><input value={form.requestedByName} onChange={(e) => setForm({ ...form, requestedByName: e.target.value })} /></dd>
                <dt>Business Unit</dt>
                <dd>
                  <select value={form.businessUnitCode} onChange={(e) => setForm({ ...form, businessUnitCode: e.target.value })}>
                    <option value="">&mdash;</option>
                    {businessUnits.map((bu) => <option key={bu.BusinessUnitId} value={bu.BusinessUnitCode}>{bu.BusinessUnitName}</option>)}
                  </select>
                </dd>
                <dt>Type</dt>
                <dd>
                  <select value={form.projectTypeCode} onChange={(e) => setForm({ ...form, projectTypeCode: e.target.value })}>
                    <option value="">&mdash;</option>
                    {lookups.types.map((v) => <option key={v.ConfigValueId} value={v.ValueCode}>{v.ValueLabel}</option>)}
                  </select>
                </dd>
                <dt>Category</dt>
                <dd>
                  <select value={form.projectCategoryCode} onChange={(e) => setForm({ ...form, projectCategoryCode: e.target.value })}>
                    <option value="">&mdash;</option>
                    {lookups.categories.map((v) => <option key={v.ConfigValueId} value={v.ValueCode}>{v.ValueLabel}</option>)}
                  </select>
                </dd>
                <dt>Priority</dt>
                <dd>
                  <select value={form.priorityCode} onChange={(e) => setForm({ ...form, priorityCode: e.target.value })}>
                    <option value="">&mdash;</option>
                    {lookups.priorities.map((v) => <option key={v.ConfigValueId} value={v.ValueCode}>{v.ValueLabel}</option>)}
                  </select>
                </dd>
                <dt>Template</dt>
                <dd>
                  <select value={form.templateCode} onChange={(e) => setForm({ ...form, templateCode: e.target.value })}>
                    <option value="">&mdash;</option>
                    {templates.map((t) => <option key={t.TemplateId} value={t.TemplateCode}>{t.TemplateName}</option>)}
                  </select>
                </dd>
                <dt>Requested Date</dt><dd><input type="date" value={form.requestedDate} onChange={(e) => setForm({ ...form, requestedDate: e.target.value })} /></dd>
                <dt>Description</dt><dd><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></dd>
                <dt>Notes</dt><dd><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></dd>
              </dl>
              <button type="submit" style={{ marginTop: 12 }}>Save Intake</button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
