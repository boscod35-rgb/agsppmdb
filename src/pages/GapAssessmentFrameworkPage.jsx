import { useEffect, useState } from 'react';

export default function GapAssessmentFrameworkPage() {
  const [pillars, setPillars] = useState([]);
  const [status, setStatus] = useState('loading');
  const [errorDetail, setErrorDetail] = useState('');
  const [actionError, setActionError] = useState('');
  const [showAddPillar, setShowAddPillar] = useState(false);
  const [newPillar, setNewPillar] = useState({ pillarCode: '', pillarName: '' });
  const [expandedPillarId, setExpandedPillarId] = useState(null);
  const [newSubArea, setNewSubArea] = useState('');
  const [newQuestionFor, setNewQuestionFor] = useState(null);
  const [newQuestion, setNewQuestion] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setStatus('loading');
    setErrorDetail('');
    try {
      const res = await fetch('/api/ppm/gap-framework/pillars');
      const data = await res.json();
      if (res.ok && data.success) { setPillars(data.pillars); setStatus('ok'); }
      else { setStatus('error'); setErrorDetail(data.detail || data.message || `HTTP ${res.status}`); }
    } catch {
      setStatus('error'); setErrorDetail('Could not reach /api/ppm/gap-framework/pillars.');
    }
  }

  async function handleAddPillar(e) {
    e.preventDefault();
    setActionError('');
    try {
      const res = await fetch('/api/ppm/gap-framework/pillars', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newPillar),
      });
      const data = await res.json();
      if (res.ok && data.success) { setNewPillar({ pillarCode: '', pillarName: '' }); setShowAddPillar(false); load(); }
      else setActionError(data.detail || data.message || 'Could not add pillar.');
    } catch { setActionError('Could not reach the Gap Framework API.'); }
  }

  async function handleArchivePillar(id, name) {
    if (!window.confirm(`Archive pillar "${name}"? Its sub-areas and questions stay but the pillar itself hides from active views.`)) return;
    try {
      const res = await fetch(`/api/ppm/gap-framework/pillars/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not archive.');
    } catch { setActionError('Could not reach the Gap Framework API.'); }
  }

  async function handleAddSubArea(pillarId) {
    if (!newSubArea.trim()) return;
    setActionError('');
    try {
      const res = await fetch(`/api/ppm/gap-framework/subareas/${pillarId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subAreaName: newSubArea }),
      });
      const data = await res.json();
      if (res.ok && data.success) { setNewSubArea(''); load(); }
      else setActionError(data.detail || data.message || 'Could not add sub-area.');
    } catch { setActionError('Could not reach the Gap Framework API.'); }
  }

  async function handleAddQuestion(subAreaId) {
    if (!newQuestion.trim()) return;
    setActionError('');
    try {
      const res = await fetch(`/api/ppm/gap-framework/questions/${subAreaId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questionText: newQuestion }),
      });
      const data = await res.json();
      if (res.ok && data.success) { setNewQuestion(''); setNewQuestionFor(null); load(); }
      else setActionError(data.detail || data.message || 'Could not add question.');
    } catch { setActionError('Could not reach the Gap Framework API.'); }
  }

  async function handleArchiveSubArea(id) {
    try {
      const res = await fetch(`/api/ppm/gap-framework/subareas/x/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not archive sub-area.');
    } catch { setActionError('Could not reach the Gap Framework API.'); }
  }

  async function handleArchiveQuestion(id) {
    try {
      const res = await fetch(`/api/ppm/gap-framework/questions/x/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) load();
      else setActionError(data.detail || data.message || 'Could not archive question.');
    } catch { setActionError('Could not reach the Gap Framework API.'); }
  }

  return (
    <div className="page">
      <h1>Gap Assessment Framework</h1>
      <p className="subtitle">The reusable Pillar &rarr; Sub-Area &rarr; Question structure used to assess every project (Module 32).</p>

      {status === 'loading' && <p>Loading&hellip;</p>}
      {status === 'error' && <div className="error-box"><strong>Could not load framework.</strong><p>{errorDetail}</p></div>}
      {actionError && <div className="error-box"><strong>Action failed.</strong><p>{actionError}</p></div>}

      {status === 'ok' && (
        <>
          {pillars.map((p) => (
            <div key={p.PillarId} className="detail-panel" style={{ marginBottom: 12 }}>
              <div className="detail-header" style={{ cursor: 'pointer' }} onClick={() => setExpandedPillarId(expandedPillarId === p.PillarId ? null : p.PillarId)}>
                <h3><code>{p.PillarCode}</code> {p.PillarName}</h3>
                <span className="placeholder-detail">{p.subAreas?.length ?? 0} sub-area{p.subAreas?.length === 1 ? '' : 's'}</span>
              </div>
              {expandedPillarId === p.PillarId && (
                <div style={{ marginTop: 8 }}>
                  {(p.subAreas || []).map((s) => (
                    <div key={s.SubAreaId} style={{ marginLeft: 16, marginTop: 8 }}>
                      <strong>{s.SubAreaName}</strong>{' '}
                      <button onClick={() => handleArchiveSubArea(s.SubAreaId)}>Remove</button>
                      <ul style={{ margin: '4px 0 4px 16px' }}>
                        {(s.questions || []).map((q) => (
                          <li key={q.QuestionId}>
                            {q.QuestionText} <button onClick={() => handleArchiveQuestion(q.QuestionId)}>Remove</button>
                          </li>
                        ))}
                      </ul>
                      {newQuestionFor === s.SubAreaId ? (
                        <div style={{ marginLeft: 16 }}>
                          <input style={{ width: 300 }} value={newQuestion} onChange={(e) => setNewQuestion(e.target.value)} placeholder="Question text" />{' '}
                          <button onClick={() => handleAddQuestion(s.SubAreaId)}>Add</button>{' '}
                          <button onClick={() => setNewQuestionFor(null)}>Cancel</button>
                        </div>
                      ) : (
                        <button style={{ marginLeft: 16 }} onClick={() => setNewQuestionFor(s.SubAreaId)}>+ Add Question</button>
                      )}
                    </div>
                  ))}
                  <div style={{ marginTop: 12, marginLeft: 16 }}>
                    <input placeholder="New sub-area name" value={newSubArea} onChange={(e) => setNewSubArea(e.target.value)} />{' '}
                    <button onClick={() => handleAddSubArea(p.PillarId)}>+ Add Sub-Area</button>
                  </div>
                  <button style={{ marginTop: 12 }} onClick={() => handleArchivePillar(p.PillarId, p.PillarName)}>Archive Pillar</button>
                </div>
              )}
            </div>
          ))}
          {pillars.length === 0 && <p style={{ padding: 16 }}>No pillars yet.</p>}

          {!showAddPillar ? (
            <button style={{ marginTop: 16 }} onClick={() => setShowAddPillar(true)}>+ Add Pillar</button>
          ) : (
            <form className="detail-panel" style={{ marginTop: 16 }} onSubmit={handleAddPillar}>
              <div className="detail-header"><h3>Add Pillar</h3><button type="button" onClick={() => setShowAddPillar(false)}>Cancel</button></div>
              <dl>
                <dt>Code</dt><dd><input required value={newPillar.pillarCode} onChange={(e) => setNewPillar({ ...newPillar, pillarCode: e.target.value })} /></dd>
                <dt>Name</dt><dd><input required value={newPillar.pillarName} onChange={(e) => setNewPillar({ ...newPillar, pillarName: e.target.value })} /></dd>
              </dl>
              <button type="submit" style={{ marginTop: 12 }}>Save Pillar</button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
