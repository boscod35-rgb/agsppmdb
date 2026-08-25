import { useState } from 'react';
import HomePage from './pages/HomePage.jsx';
import AzureInfoPage from './pages/AzureInfoPage.jsx';
import SystemHealthPage from './pages/SystemHealthPage.jsx';
import ConfigurationPage from './pages/ConfigurationPage.jsx';
import OrganizationPage from './pages/OrganizationPage.jsx';
import NumberingPage from './pages/NumberingPage.jsx';
import LifecyclePage from './pages/LifecyclePage.jsx';
import BrandingPage from './pages/BrandingPage.jsx';
import PortfolioPage from './pages/PortfolioPage.jsx';
import ProgramPage from './pages/ProgramPage.jsx';
import ProjectsPage from './pages/ProjectsPage.jsx';
import ProjectWorkspacePage from './pages/ProjectWorkspacePage.jsx';
import TemplatesPage from './pages/TemplatesPage.jsx';
import IntakePage from './pages/IntakePage.jsx';
import ResourcesPage from './pages/ResourcesPage.jsx';
import RateCardsPage from './pages/RateCardsPage.jsx';
import PlaceholderPage from './pages/PlaceholderPage.jsx';

// Top-level navigation, per Framework Section 87.
// Portfolio / Programs / Projects flipped to built:true in Chunk 03.
// Intake added in Chunk 04 (Module 09) - sits before Portfolio since
// a request has no Portfolio yet until it's Converted to a Project.
const NAV_ITEMS = [
  { id: 'home', label: 'Home', built: true },
  { id: 'strategy', label: 'Strategy', built: false },
  { id: 'intake', label: 'Intake', built: true },
  { id: 'portfolio', label: 'Portfolio', built: true },
  { id: 'programs', label: 'Programs', built: true },
  { id: 'projects', label: 'Projects', built: true },
  { id: 'rmg', label: 'RMG / Resources', built: true }, // Chunk 06
  { id: 'financials', label: 'Financials', built: true }, // Chunk 07 - Rate Card admin (Module 22)
  { id: 'governance', label: 'Governance', built: false },
  { id: 'audits', label: 'Audits', built: false },
  { id: 'reports', label: 'Reports', built: false },
  { id: 'admin', label: 'Administration', built: true },
];

// Settings sub-navigation, per Framework Section 88.
const ADMIN_ITEMS = [
  { id: 'admin-cmdb', label: 'CMDB → Azure Info', built: true },
  { id: 'admin-health', label: 'System Health', built: true },
  { id: 'admin-org', label: 'Organization', built: true },
  { id: 'admin-config', label: 'Project Configuration', built: true },
  { id: 'admin-numbering', label: 'Numbering', built: true },
  { id: 'admin-lifecycle', label: 'Lifecycle / Stage-Gate', built: true },
  { id: 'admin-branding', label: 'Branding & Theme', built: true },
  { id: 'admin-rules', label: 'Rules', built: false },
  { id: 'admin-templates', label: 'Global Templates', built: true }, // Chunk 04, Module 08
  { id: 'admin-modules', label: 'Modules', built: false },
  { id: 'admin-security', label: 'Security', built: false },
];

export default function App() {
  const [activeNav, setActiveNav] = useState('home');
  const [activeAdmin, setActiveAdmin] = useState('admin-cmdb');
  const [openProjectId, setOpenProjectId] = useState(null);

  function goToNav(id) {
    setActiveNav(id);
    if (id !== 'projects') setOpenProjectId(null);
  }

  function renderContent() {
    if (activeNav === 'home') return <HomePage />;

    if (activeNav === 'admin') {
      const current = ADMIN_ITEMS.find((i) => i.id === activeAdmin);
      if (!current?.built) return <PlaceholderPage label={current?.label} />;
      if (activeAdmin === 'admin-cmdb') return <AzureInfoPage />;
      if (activeAdmin === 'admin-health') return <SystemHealthPage />;
      if (activeAdmin === 'admin-config') return <ConfigurationPage />;
      if (activeAdmin === 'admin-org') return <OrganizationPage />;
      if (activeAdmin === 'admin-numbering') return <NumberingPage />;
      if (activeAdmin === 'admin-lifecycle') return <LifecyclePage />;
      if (activeAdmin === 'admin-branding') return <BrandingPage />;
      if (activeAdmin === 'admin-templates') return <TemplatesPage />;
    }

    if (activeNav === 'intake') return <IntakePage />;
    if (activeNav === 'rmg') return <ResourcesPage />;
    if (activeNav === 'financials') return <RateCardsPage />;
    if (activeNav === 'portfolio') return <PortfolioPage />;
    if (activeNav === 'programs') return <ProgramPage />;
    if (activeNav === 'projects') {
      if (openProjectId) return <ProjectWorkspacePage projectId={openProjectId} onBack={() => setOpenProjectId(null)} />;
      return <ProjectsPage onOpenProject={(id) => setOpenProjectId(id)} />;
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
              onClick={() => goToNav(item.id)}
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
