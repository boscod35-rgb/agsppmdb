import { useState } from 'react';
import HomePage from './pages/HomePage.jsx';
import AzureInfoPage from './pages/AzureInfoPage.jsx';
import SystemHealthPage from './pages/SystemHealthPage.jsx';
import PlaceholderPage from './pages/PlaceholderPage.jsx';

// Top-level navigation, per Framework Section 87.
// Only Home and Administration are wired to real pages right now -
// everything else is a placeholder until its own chunk builds it.
const NAV_ITEMS = [
  { id: 'home', label: 'Home', built: true },
  { id: 'strategy', label: 'Strategy', built: false },
  { id: 'portfolio', label: 'Portfolio', built: false },
  { id: 'programs', label: 'Programs', built: false },
  { id: 'projects', label: 'Projects', built: false },
  { id: 'rmg', label: 'RMG / Resources', built: false },
  { id: 'financials', label: 'Financials', built: false },
  { id: 'governance', label: 'Governance', built: false },
  { id: 'audits', label: 'Audits', built: false },
  { id: 'reports', label: 'Reports', built: false },
  { id: 'admin', label: 'Administration', built: true },
];

// Settings sub-navigation, per Framework Section 88.
const ADMIN_ITEMS = [
  { id: 'admin-cmdb', label: 'CMDB \u2192 Azure Info', built: true },
  { id: 'admin-health', label: 'System Health', built: true },
  { id: 'admin-org', label: 'Organization', built: false },
  { id: 'admin-config', label: 'Project Configuration', built: false },
  { id: 'admin-numbering', label: 'Numbering', built: false },
  { id: 'admin-rules', label: 'Rules', built: false },
  { id: 'admin-templates', label: 'Global Templates', built: false },
  { id: 'admin-modules', label: 'Modules', built: false },
  { id: 'admin-security', label: 'Security', built: false },
];

export default function App() {
  const [activeNav, setActiveNav] = useState('home');
  const [activeAdmin, setActiveAdmin] = useState('admin-cmdb');

  function renderContent() {
    if (activeNav === 'home') return <HomePage />;

    if (activeNav === 'admin') {
      const current = ADMIN_ITEMS.find((i) => i.id === activeAdmin);
      if (!current?.built) return <PlaceholderPage label={current?.label} />;
      if (activeAdmin === 'admin-cmdb') return <AzureInfoPage />;
      if (activeAdmin === 'admin-health') return <SystemHealthPage />;
    }

    const navItem = NAV_ITEMS.find((i) => i.id === activeNav);
    return <PlaceholderPage label={navItem?.label} />;
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">PPM Enterprise Platform</div>
        <nav className="topnav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`topnav-item ${activeNav === item.id ? 'active' : ''} ${!item.built ? 'unbuilt' : ''}`}
              onClick={() => setActiveNav(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="body">
        {activeNav === 'admin' && (
          <aside className="sidebar">
            {ADMIN_ITEMS.map((item) => (
              <button
                key={item.id}
                className={`sidebar-item ${activeAdmin === item.id ? 'active' : ''} ${!item.built ? 'unbuilt' : ''}`}
                onClick={() => setActiveAdmin(item.id)}
              >
                {item.label}
              </button>
            ))}
          </aside>
        )}

        <main className="content">{renderContent()}</main>
      </div>
    </div>
  );
}
