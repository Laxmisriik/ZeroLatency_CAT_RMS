import { useState, useEffect, useCallback } from 'react';
import './index.css';
import { apiFetch } from './api.js';
import FleetMap from './components/FleetMap.jsx';
import OperatorPortal from './components/OperatorPortal.jsx';
import PacingPanel from './components/PacingPanel.jsx';
import FleetCharts from './components/FleetCharts.jsx';
import LoginPage from './components/LoginPage.jsx';
import CreateEquipmentModal from './components/CreateEquipmentModal.jsx';
import ManagerCheckInModal from './components/ManagerCheckInModal.jsx';
import QrCodeModal from './components/QrCodeModal.jsx';
import Sidebar from './components/Sidebar.jsx';
import {
  Triangle, Menu, LogOut, HardHat, PackagePlus, ClipboardCheck,
  Truck, CheckCircle2, ClipboardList, Zap, PauseCircle, AlertTriangle,
  Search, ShieldCheck, BarChart3, TrendingUp, TrendingDown, Minus,
  QrCode as QrCodeIcon, ArrowLeftRight,
} from 'lucide-react';

const POLL_INTERVAL = 3000;

/* ── Utility Helpers ──────────────────────────────────────────── */
function fuelClass(pct) {
  if (pct > 50) return 'fuel-high';
  if (pct > 20) return 'fuel-mid';
  return 'fuel-low';
}

function statusClass(status) {
  return `status-${(status || '').toLowerCase().replace(/\s/g, '_')}`;
}

function engineColor(status) {
  return (status || 'OFF').toLowerCase();
}

function relativeTime(iso) {
  if (!iso) return '—';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 5) return 'Just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function formatHours(h) {
  return Number(h || 0).toFixed(1);
}

/* ── KPI Card Component ──────────────────────────────────────── */
function KpiCard({ icon: Icon, label, value, sub, variant }) {
  return (
    <div className={`kpi-card ${variant}`}>
      <div className="kpi-icon"><Icon size={18} strokeWidth={1.9} /></div>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

/* ── Checkout Modal ──────────────────────────────────────────── */
function CheckoutModal({ equipment, token, onClose, onCheckout }) {
  const available = equipment.filter(e => e.status === 'AVAILABLE');
  const [form, setForm] = useState({ equipmentId: '', siteId: '', operatorId: '', checkOutDate: '' });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const data = await apiFetch('/checkout', { method: 'POST', token, body: form });
      onCheckout(data);
      onClose();
    } catch (err) {
      alert(err.message || 'Checkout failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3><ArrowLeftRight size={18} /> Equipment Checkout</h3>
        <p className="modal-sub">Initiate a digital handshake to reserve equipment</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Equipment</label>
            <select value={form.equipmentId} onChange={e => setForm({ ...form, equipmentId: e.target.value })} required>
              <option value="">Select available machine...</option>
              {available.map(eq => (
                <option key={eq.equipment_id} value={eq.equipment_id}>
                  {eq.equipment_id} — {eq.type}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Site ID</label>
            <input type="text" placeholder="e.g. S005" value={form.siteId}
              onChange={e => setForm({ ...form, siteId: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>Operator ID</label>
            <input type="text" placeholder="e.g. OP150" value={form.operatorId}
              onChange={e => setForm({ ...form, operatorId: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>Checkout Date</label>
            <input type="date" value={form.checkOutDate}
              onChange={e => setForm({ ...form, checkOutDate: e.target.value })} required />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary btn-full" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-full" disabled={submitting}>
              {submitting ? 'Processing...' : 'Confirm Checkout'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Main App ────────────────────────────────────────────────── */
export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('zlrms_token') || null);
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('zlrms_user');
    return raw ? JSON.parse(raw) : null;
  });

  const [equipment, setEquipment] = useState([]);
  const [stats, setStats] = useState(null);
  const [anomalies, setAnomalies] = useState([]);
  const [forecast, setForecast] = useState([]);
  const [sites, setSites] = useState([]);
  const [pacing, setPacing] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCheckout, setShowCheckout] = useState(false);
  const [showCreateEquipment, setShowCreateEquipment] = useState(false);
  const [showManagerCheckIn, setShowManagerCheckIn] = useState(false);
  const [viewingQrFor, setViewingQrFor] = useState(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  // ── UI-only state: layout & table filtering (no backend impact) ──
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeSection, setActiveSection] = useState('section-overview');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  function handleLogin(newToken, newUser) {
    localStorage.setItem('zlrms_token', newToken);
    localStorage.setItem('zlrms_user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
    setLoading(true);
  }

  function handleLogout() {
    localStorage.removeItem('zlrms_token');
    localStorage.removeItem('zlrms_user');
    setToken(null);
    setUser(null);
  }

  function scrollToSection(id) {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Clock ticker
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Data fetcher
  const fetchData = useCallback(async () => {
    if (!token) return;
    try {
      const [eqData, statsData, anomData, sitesData, pacingData, forecastData] = await Promise.all([
        apiFetch('/equipment', { token }),
        apiFetch('/equipment/stats', { token }),
        apiFetch('/anomalies', { token }),
        apiFetch('/sites', { token }),
        apiFetch('/pacing', { token }),
        user?.role === 'DEALER' ? apiFetch('/forecast', { token }) : Promise.resolve([]),
      ]);

      setEquipment(eqData);
      setStats(statsData);
      setAnomalies(anomData);
      setForecast(forecastData);
      setSites(sitesData);
      setPacing(pacingData);
      setError(null);
      setLoading(false);
    } catch (err) {
      if (err.sessionExpired) { handleLogout(); return; }
      setError(err.message);
      setLoading(false);
    }
  }, [token, user]);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    fetchData();
    const interval = setInterval(fetchData, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [token, fetchData]);

  // ── Auth Gate ──
  if (!token || !user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  // ── Loading / Error States ──
  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <div className="loading-text">Connecting to Fleet Telemetry...</div>
      </div>
    );
  }

  if (error && equipment.length === 0) {
    return (
      <div className="loading-screen">
        <AlertTriangle size={40} className="loading-error-icon" />
        <div className="loading-text">Unable to connect to the backend API</div>
        <div className="loading-error-detail">{error}</div>
        <button className="btn btn-primary" onClick={fetchData}>Retry Connection</button>
      </div>
    );
  }

  const s = stats || {};
  const unresolvedAnomalies = anomalies.filter(a => !a.resolved);

  // Backend already scopes equipment/anomalies/pacing to a Manager's assigned machines.
  const visibleEquipment = equipment;
  const visibleAnomalies = unresolvedAnomalies;
  const visiblePacing = pacing;

  // Client-side search/filter over the already-fetched fleet list — presentation only.
  const filteredEquipment = visibleEquipment.filter(eq => {
    const matchesStatus = statusFilter === 'ALL' || eq.status === statusFilter;
    const term = searchTerm.trim().toLowerCase();
    const matchesSearch = !term ||
      eq.equipment_id.toLowerCase().includes(term) ||
      (eq.type || '').toLowerCase().includes(term) ||
      (eq.current_site_id || '').toLowerCase().includes(term) ||
      (eq.current_operator_id || '').toLowerCase().includes(term);
    return matchesStatus && matchesSearch;
  });

  const distinctStatuses = [...new Set(visibleEquipment.map(eq => eq.status))];

  return (
    <div className="app-shell">
      {/* ── Top Navigation ── */}
      <header className="topbar">
        <div className="topbar-left">
          {user.role !== 'OPERATOR' && (
            <button className="topbar-icon-btn" onClick={() => setSidebarCollapsed(v => !v)} title="Toggle sidebar">
              <Menu size={20} />
            </button>
          )}
          <div className="topbar-brand">
            <div className="logo-icon"><Triangle size={18} fill="currentColor" strokeWidth={0} /></div>
            <div className="topbar-brand-text">
              <h1>Zero<span>Latency</span> RMS</h1>
              <div className="brand-subtitle">Smart Rental Tracking System</div>
            </div>
          </div>
        </div>
        <div className="topbar-right">
          <div className="live-badge"><span className="live-dot" /> Live Telemetry</div>
          <div className="header-time">{currentTime.toLocaleTimeString('en-US', { hour12: false })}</div>
          <div className="user-badge">
            <div className="user-badge-avatar">{(user.displayName || user.username || '?').charAt(0).toUpperCase()}</div>
            <div className="user-badge-text">
              <span className="user-badge-role">{user.role}</span>
              <span className="user-badge-name">{user.displayName}</span>
            </div>
          </div>
          {user.role === 'DEALER' && (
            <>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowCreateEquipment(true)}>
                <HardHat size={14} /> Add Equipment
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => setShowCheckout(true)}>
                <PackagePlus size={14} /> Checkout
              </button>
            </>
          )}
          {user.role === 'MANAGER' && (
            <button className="btn btn-primary btn-sm" onClick={() => setShowManagerCheckIn(true)}>
              <ClipboardCheck size={14} /> Check In Machine
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={handleLogout}>
            <LogOut size={14} /> Logout
          </button>
        </div>
      </header>

      <div className="shell-body">
        {/* ── Operator Mobile Portal (standalone view — no sidebar chrome) ── */}
        {user.role === 'OPERATOR' ? (
          <main className="dashboard-canvas">
            <OperatorPortal equipment={equipment} token={token} user={user} onUnlocked={fetchData} />
          </main>
        ) : (
          <>
            <Sidebar
              collapsed={sidebarCollapsed}
              onToggle={() => setSidebarCollapsed(v => !v)}
              showForecast={user.role === 'DEALER'}
              activeSection={activeSection}
              onNavigate={scrollToSection}
            />
            <main className="dashboard-canvas">
              <div className="page-title-row">
                <div>
                  <h1>Fleet Command Center</h1>
                  <div className="page-subtitle">Real-time asset visibility &amp; contract performance</div>
                </div>
                <div className="page-title-meta">Auto-refresh every 3s</div>
              </div>

              {/* ── Overview: KPIs + Charts ── */}
              <section id="section-overview" className="page-section">
                <div className="kpi-row">
                  <KpiCard icon={Truck} label="Total Fleet" value={s.total_fleet || 0}
                    sub={`${s.maintenance || 0} in maintenance`} variant="kpi-total" />
                  <KpiCard icon={CheckCircle2} label="Available" value={s.available || 0}
                    sub="Ready for rental" variant="kpi-available" />
                  <KpiCard icon={ClipboardList} label="Rented Out" value={Number(s.rented || 0) + Number(s.reserved || 0)}
                    sub={`${s.reserved || 0} pending handshake`} variant="kpi-rented" />
                  <KpiCard icon={Zap} label="Engines Running" value={s.engine_running || 0}
                    sub={`${formatHours(s.total_engine_hours)}h total`} variant="kpi-running" />
                  <KpiCard icon={PauseCircle} label="Idle" value={s.engine_idle || 0}
                    sub={`${formatHours(s.total_idle_hours)}h total idle`} variant="kpi-idle" />
                  <KpiCard icon={AlertTriangle} label="Action Required" value={Number(s.unauthorized || 0) + visibleAnomalies.length}
                    sub={`${s.unauthorized || 0} unauthorized`} variant="kpi-alert" />
                </div>

                <FleetCharts equipment={visibleEquipment} />
              </section>

              {/* ── Live Fleet Map ── */}
              <section id="section-map" className="page-section">
                <FleetMap equipment={visibleEquipment} sites={sites} anomalies={visibleAnomalies} />
              </section>

              {/* ── Content Grid: Fleet Table + Alerts ── */}
              <div className="content-grid">
                {/* ── Fleet Table ── */}
                <section id="section-registry" className="fleet-panel page-section">
                  <div className="section-header" style={{ padding: '18px 20px 0' }}>
                    <h2>Fleet Registry</h2>
                    <span className="section-header-meta">Avg Fuel: {Number(s.avg_fuel || 0).toFixed(1)}%</span>
                  </div>
                  <div className="table-toolbar">
                    <div className="table-search">
                      <Search size={15} />
                      <input
                        type="text"
                        placeholder="Search by ID, type, site, operator…"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                      />
                    </div>
                    <select className="table-filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                      <option value="ALL">All Statuses</option>
                      {distinctStatuses.map(st => <option key={st} value={st}>{st.replace(/_/g, ' ')}</option>)}
                    </select>
                    <span className="table-result-count">{filteredEquipment.length} of {visibleEquipment.length} assets</span>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="fleet-table">
                      <thead>
                        <tr>
                          <th>Equipment ID</th>
                          <th>Type</th>
                          <th>Status</th>
                          <th>Engine</th>
                          <th>Fuel</th>
                          <th>Engine Hrs</th>
                          <th>Idle Hrs</th>
                          <th>Site</th>
                          <th>Operator</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredEquipment.map(eq => {
                          const t = eq.telemetry || {};
                          const fuel = Number(t.fuelLevelPct || 0);
                          const isAlert = eq.status === 'UNAUTHORIZED_USE';

                          return (
                            <tr key={eq.equipment_id} className={isAlert ? 'row-alert' : ''}>
                              <td><span className="eq-id">{eq.equipment_id}</span></td>
                              <td><span className="eq-type">{eq.type}</span></td>
                              <td>
                                <span className={`status-badge ${statusClass(eq.status)}`}>
                                  {eq.status}
                                </span>
                              </td>
                              <td>
                                <div className="engine-indicator">
                                  <span className={`engine-dot ${engineColor(t.engineStatus)}`}></span>
                                  {t.engineStatus || 'OFF'}
                                </div>
                              </td>
                              <td>
                                <div className="fuel-bar-container">
                                  <div className="fuel-bar">
                                    <div className={`fuel-bar-fill ${fuelClass(fuel)}`}
                                      style={{ width: `${fuel}%` }} />
                                  </div>
                                  <span className="fuel-text">{fuel.toFixed(1)}%</span>
                                </div>
                              </td>
                              <td>
                                <span className="hours-display">
                                  <span className="hours-value">{formatHours(t.totalEngineHours)}</span>h
                                </span>
                              </td>
                              <td>
                                <span className="hours-display">
                                  <span className="hours-value">{formatHours(t.totalIdleHours)}</span>h
                                </span>
                              </td>
                              <td>
                                {eq.current_site_id
                                  ? <span className="meta-tag">{eq.current_site_id}</span>
                                  : <span className="meta-tag empty">—</span>}
                              </td>
                              <td>
                                {eq.current_operator_id
                                  ? <span className="meta-tag">{eq.current_operator_id}</span>
                                  : <span className="meta-tag empty">—</span>}
                              </td>
                              <td>
                                <div className="row-actions">
                                  {eq.status === 'AVAILABLE' && user.role === 'DEALER' && (
                                    <button className="btn btn-primary btn-sm"
                                      onClick={() => setShowCheckout(true)}>
                                      Checkout
                                    </button>
                                  )}
                                  {(eq.status === 'RENTED' || eq.status === 'UNAUTHORIZED_USE') && user.role === 'DEALER' && (
                                    <button className="btn btn-danger btn-sm"
                                      onClick={async () => {
                                        if (!confirm(`Return ${eq.equipment_id}?`)) return;
                                        try {
                                          await apiFetch('/checkin', { method: 'POST', token, body: { equipmentId: eq.equipment_id } });
                                          fetchData();
                                        } catch (err) {
                                          alert(err.message || 'Return failed.');
                                        }
                                      }}>
                                      Return
                                    </button>
                                  )}
                                  {user.role === 'DEALER' && (
                                    <button className="btn btn-secondary btn-sm"
                                      onClick={() => setViewingQrFor(eq.equipment_id)}>
                                      <QrCodeIcon size={13} /> QR
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {filteredEquipment.length === 0 && (
                          <tr><td colSpan={10} className="fleet-table-empty">No equipment matches the current search / filter.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                {/* ── Alerts Panel ── */}
                <section id="section-alerts" className="alerts-panel page-section">
                  <div className="section-header">
                    <h2><AlertTriangle size={16} /> Live Anomalies ({visibleAnomalies.length})</h2>
                  </div>
                  <div className="alerts-list">
                    {visibleAnomalies.length === 0 ? (
                      <div className="alerts-empty">
                        <ShieldCheck size={30} />
                        All systems operational
                      </div>
                    ) : (
                      visibleAnomalies.slice(0, 20).map(a => (
                        <div key={a.id}
                          className={`alert-item severity-${(a.severity || 'high').toLowerCase()}`}>
                          <div className="alert-header">
                            <span className={`alert-type type-${(a.severity || 'high').toLowerCase()}`}>
                              {a.type}
                            </span>
                            <span className="alert-eq">{a.equipmentId}</span>
                          </div>
                          <div className="alert-desc">{a.description}</div>
                          <div className="alert-time">{relativeTime(a.detectedAt)}</div>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </div>

              {/* ── Contract Pacing & Predictive Overrun ── */}
              <section id="section-pacing" className="page-section">
                <PacingPanel pacing={visiblePacing} token={token} onExtended={fetchData} />
              </section>

              {/* ── Demand Forecast Panel (Dealer only) ── */}
              {user.role === 'DEALER' && (
                <section id="section-forecast" className="fleet-panel page-section">
                  <div className="section-header" style={{ padding: '18px 20px 0' }}>
                    <h2><BarChart3 size={16} /> Predictive Demand Forecast (Next 30 Days)</h2>
                    <span className="section-header-meta">Powered by Machine Learning Analytics</span>
                  </div>
                  <div style={{ overflowX: 'auto', padding: '16px 20px' }}>
                    <table className="fleet-table" style={{ border: '1px solid var(--border-subtle)' }}>
                      <thead>
                        <tr>
                          <th>Equipment Class</th>
                          <th>Current Utilization</th>
                          <th>Demand Trend</th>
                          <th>Forecasted Need</th>
                          <th>AI Recommendation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {forecast.map(f => (
                          <tr key={f.type}>
                            <td><span className="eq-type">{f.type}</span></td>
                            <td>
                              <div className="fuel-bar-container">
                                <div className="fuel-bar">
                                  <div className={`fuel-bar-fill ${f.current_utilization_pct > 60 ? 'fuel-high' : 'fuel-mid'}`}
                                    style={{ width: `${f.current_utilization_pct}%` }} />
                                </div>
                                <span className="fuel-text">{f.current_utilization_pct}%</span>
                              </div>
                            </td>
                            <td>
                              <span className={`status-badge status-${f.trend === 'UP' ? 'available' : (f.trend === 'DOWN' ? 'under_maintenance' : 'reserved')}`}>
                                {f.trend === 'UP' ? <TrendingUp size={11} /> : (f.trend === 'DOWN' ? <TrendingDown size={11} /> : <Minus size={11} />)}
                                {f.trend === 'UP' ? 'Increasing' : (f.trend === 'DOWN' ? 'Decreasing' : 'Stable')}
                              </span>
                            </td>
                            <td>
                              <span className="hours-value" style={{ fontSize: '15px' }}>{f.predicted_demand_next_month} units</span>
                            </td>
                            <td>
                              <span className="meta-tag">{f.recommendation}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </main>
          </>
        )}
      </div>

      {/* ── Checkout Modal ── */}
      {showCheckout && (
        <CheckoutModal
          equipment={equipment}
          token={token}
          onClose={() => setShowCheckout(false)}
          onCheckout={() => fetchData()}
        />
      )}

      {/* ── Dealer: Register New Equipment + QR ── */}
      {showCreateEquipment && (
        <CreateEquipmentModal
          token={token}
          onClose={() => setShowCreateEquipment(false)}
          onCreated={() => fetchData()}
        />
      )}

      {/* ── Manager: Check In New Machine (QR scan) ── */}
      {showManagerCheckIn && (
        <ManagerCheckInModal
          token={token}
          sites={sites}
          onClose={() => setShowManagerCheckIn(false)}
          onCheckedIn={() => fetchData()}
        />
      )}

      {/* ── View / Download QR for an existing machine ── */}
      {viewingQrFor && (
        <QrCodeModal
          equipmentId={viewingQrFor}
          token={token}
          onClose={() => setViewingQrFor(null)}
        />
      )}
    </div>
  );
}
