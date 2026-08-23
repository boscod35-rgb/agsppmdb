import { useEffect, useState } from 'react';

const ENV_FILTERS = ['All', 'DEV', 'TEST', 'PROD'];

export default function AzureInfoPage() {
  const [resources, setResources] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ok | error
  const [errorDetail, setErrorDetail] = useState('');
  const [envFilter, setEnvFilter] = useState('All');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    load(envFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envFilter]);

  async function load(env) {
    setStatus('loading');
    setErrorDetail('');
    try {
      const query = env && env !== 'All' ? `?environment=${env}` : '';
      const res = await fetch(`/api/cmdb/azure-resources${query}`);
      const data = await res.json();

      if (res.ok && data.success) {
        setResources(data.resources);
        setStatus('ok');
      } else {
        setStatus('error');
        setErrorDetail(data.detail || data.message || `HTTP ${res.status}`);
      }
    } catch (err) {
      setStatus('error');
      setErrorDetail('Could not reach /api/cmdb/azure-resources.');
    }
  }

  function findParentName(parentId) {
    const parent = resources.find((r) => r.ResourceId === parentId);
    return parent ? parent.ResourceName : null;
  }

  return (
    <div className="page">
      <h1>CMDB &mdash; Azure Info</h1>
      <p className="subtitle">
        Infrastructure this platform actually runs on. Metadata only &mdash;
        never credentials or connection strings.
      </p>

      <div className="filter-row">
        {ENV_FILTERS.map((env) => (
          <button
            key={env}
            className={`filter-chip ${envFilter === env ? 'active' : ''}`}
            onClick={() => setEnvFilter(env)}
          >
            {env}
          </button>
        ))}
      </div>

      {status === 'loading' && <p>Loading&hellip;</p>}

      {status === 'error' && (
        <div className="error-box">
          <strong>Could not load CMDB data.</strong>
          <p>{errorDetail}</p>
        </div>
      )}

      {status === 'ok' && (
        <div className="table-wrap">
          <table className="cmdb-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Env</th>
                <th>Type</th>
                <th>Name</th>
                <th>Resource Group</th>
                <th>Region</th>
                <th>Endpoint</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {resources.map((r) => (
                <tr key={r.ResourceId} onClick={() => setSelected(r)} className="clickable-row">
                  <td>{r.ResourceCode}</td>
                  <td>{r.Environment}</td>
                  <td>{r.ResourceType}</td>
                  <td>{r.ResourceName}</td>
                  <td>{r.ResourceGroup}</td>
                  <td>{r.Region || '\u2014'}</td>
                  <td className="endpoint-cell">{r.Endpoint || '\u2014'}</td>
                  <td>
                    <span className={`status-pill status-${(r.Status || '').toLowerCase()}`}>
                      {r.Status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {resources.length === 0 && <p>No resources recorded for this filter.</p>}
        </div>
      )}

      {selected && (
        <div className="detail-panel">
          <div className="detail-header">
            <h3>{selected.ResourceName}</h3>
            <button onClick={() => setSelected(null)}>Close</button>
          </div>
          <dl>
            <dt>Code</dt><dd>{selected.ResourceCode}</dd>
            <dt>Environment</dt><dd>{selected.Environment}</dd>
            <dt>Type</dt><dd>{selected.ResourceType}</dd>
            <dt>Resource Group</dt><dd>{selected.ResourceGroup}</dd>
            <dt>Region</dt><dd>{selected.Region || '\u2014'}</dd>
            <dt>Endpoint</dt><dd>{selected.Endpoint || '\u2014'}</dd>
            <dt>Admin Login</dt><dd>{selected.AdminLogin || '\u2014'}</dd>
            <dt>Parent</dt>
            <dd>
              {selected.ParentResourceId
                ? findParentName(selected.ParentResourceId) || `#${selected.ParentResourceId}`
                : '\u2014'}
            </dd>
            <dt>Status</dt><dd>{selected.Status}</dd>
            <dt>Notes</dt><dd>{selected.Notes || '\u2014'}</dd>
            <dt>Created</dt><dd>{new Date(selected.CreatedDate).toLocaleString()}</dd>
            <dt>Last Verified</dt>
            <dd>{selected.LastVerifiedDate ? new Date(selected.LastVerifiedDate).toLocaleString() : 'Never'}</dd>
          </dl>
        </div>
      )}
    </div>
  );
}
