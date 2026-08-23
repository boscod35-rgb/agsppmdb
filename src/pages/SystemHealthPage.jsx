import { useState } from 'react';

const API_STATE = {
  NOT_TESTED: { label: 'Not Tested', color: '#666' },
  TESTING: { label: 'Testing...', color: '#666' },
  ONLINE: { label: 'ONLINE', color: '#1a7f37' },
  UNREACHABLE: { label: 'API unreachable', color: '#b3261e' },
  FUNCTION_ERROR: { label: 'Azure Function error', color: '#b3261e' },
};

const DB_STATE = {
  NOT_TESTED: { label: 'Not Tested', color: '#666' },
  TESTING: { label: 'Testing...', color: '#666' },
  CONNECTED: { label: 'CONNECTED', color: '#1a7f37' },
  API_UNREACHABLE: { label: 'API unreachable', color: '#b3261e' },
  SQL_AUTH_FAILED: { label: 'SQL authentication failed', color: '#b3261e' },
  SQL_NETWORK_BLOCKED: { label: 'SQL firewall/network blocked', color: '#b3261e' },
  CONFIG_MISSING: { label: 'Azure Function error (missing config)', color: '#b3261e' },
  DATABASE_UNAVAILABLE: { label: 'Database unavailable', color: '#b3261e' },
};

function StatusCard({ title, state, detail }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <p className="status" style={{ color: state.color }}>{state.label}</p>
      {detail && <p className="detail">{detail}</p>}
    </div>
  );
}

export default function SystemHealthPage() {
  const [apiKey, setApiKey] = useState('NOT_TESTED');
  const [apiDetail, setApiDetail] = useState('');
  const [dbKey, setDbKey] = useState('NOT_TESTED');
  const [dbDetail, setDbDetail] = useState('');

  async function testApi() {
    setApiKey('TESTING');
    setApiDetail('');
    try {
      const res = await fetch('/api/health');
      let data = null;
      try { data = await res.json(); } catch {}
      if (res.ok && data && data.success) {
        setApiKey('ONLINE');
        setApiDetail(data.message || 'Azure Functions API is running');
      } else {
        setApiKey('FUNCTION_ERROR');
        setApiDetail(`Function responded with HTTP ${res.status}.`);
      }
    } catch {
      setApiKey('UNREACHABLE');
      setApiDetail('Could not reach /api/health.');
    }
  }

  async function testDatabase() {
    setDbKey('TESTING');
    setDbDetail('');
    try {
      const res = await fetch('/api/db-test');
      let data = null;
      try { data = await res.json(); } catch {}
      if (res.ok && data && data.success) {
        setDbKey('CONNECTED');
        setDbDetail(`Database Name: ${data.database}  |  Server Time (UTC): ${data.serverTime}`);
        return;
      }
      const category = data && data.error;
      setDbKey(category && DB_STATE[category] ? category : 'DATABASE_UNAVAILABLE');
      setDbDetail((data && data.detail) || `Function responded with HTTP ${res.status}.`);
    } catch {
      setDbKey('API_UNREACHABLE');
      setDbDetail('Could not reach /api/db-test.');
    }
  }

  return (
    <div className="page">
      <h1>System Health</h1>
      <p className="subtitle">
        Office Browser &rarr; Azure Static Web Apps &rarr; Azure Functions API &rarr; Azure SQL
      </p>

      <div className="cards">
        <StatusCard title="Frontend Status" state={{ label: 'ONLINE', color: '#1a7f37' }} />
        <StatusCard title="API Status" state={API_STATE[apiKey]} detail={apiDetail} />
        <StatusCard title="Database Status" state={DB_STATE[dbKey]} detail={dbDetail} />
      </div>

      <div className="buttons">
        <button onClick={testApi} disabled={apiKey === 'TESTING'}>
          {apiKey === 'TESTING' ? 'Testing API...' : 'Test API'}
        </button>
        <button onClick={testDatabase} disabled={dbKey === 'TESTING'}>
          {dbKey === 'TESTING' ? 'Testing Database...' : 'Test Database'}
        </button>
      </div>
    </div>
  );
}
