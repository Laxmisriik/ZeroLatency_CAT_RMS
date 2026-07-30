import {
  LayoutDashboard, Map, Database, AlertTriangle, TrendingUp, BarChart3,
  ChevronsLeft, ChevronsRight
} from 'lucide-react';

const BASE_ITEMS = [
  { id: 'section-overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'section-map', label: 'Fleet Map', icon: Map },
  { id: 'section-registry', label: 'Fleet Registry', icon: Database },
  { id: 'section-alerts', label: 'Alerts', icon: AlertTriangle },
  { id: 'section-pacing', label: 'Contract Pacing', icon: TrendingUp },
];

const FORECAST_ITEM = { id: 'section-forecast', label: 'Demand Forecast', icon: BarChart3 };

export default function Sidebar({ collapsed, onToggle, showForecast, activeSection, onNavigate }) {
  const items = showForecast ? [...BASE_ITEMS, FORECAST_ITEM] : BASE_ITEMS;

  return (
    <aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <nav className="sidebar-nav">
        <div className="sidebar-section-label">Workspace</div>
        {items.map(item => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className={`sidebar-nav-item ${activeSection === item.id ? 'active' : ''}`}
              onClick={() => onNavigate(item.id)}
              title={item.label}
            >
              <Icon size={18} strokeWidth={1.75} />
              <span className="sidebar-nav-label">{item.label}</span>
            </button>
          );
        })}
      </nav>
      <button type="button" className="sidebar-collapse-btn" onClick={onToggle}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        <span>Collapse</span>
      </button>
    </aside>
  );
}
