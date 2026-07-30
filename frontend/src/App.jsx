import { useState, useEffect, useCallback } from 'react';
import './index.css';

const API_BASE = 'http://localhost:5000/api';
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
function KpiCard({ icon, label, value, sub, variant }) {
  return (
    <div className={`kpi-card ${variant}`}>
      <div className="kpi-icon">{icon}</div>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

/* ── Checkout Modal ──────────────────────────────────────────── */
function CheckoutModal({ equipment, onClose, onCheckout }) {
  const available = equipment.filter(e => e.status === 'AVAILABLE');
  const [form, setForm] = useState({ equipmentId: '', siteId: '', operatorId: '', checkOutDate: '' });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok) {
        onCheckout(data);
        onClose();
      } else {
        alert(data.error || 'Checkout failed');
      }
    } catch (err) {
      alert('Network error: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3>⚡ Equipment Checkout</h3>
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
              {submitting ? 'Processing...' : '🔒 Confirm Checkout'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Main App ────────────────────────────────────────────────── */
export default function App() {
  const [equipment, setEquipment] = useState([]);
  const [stats, setStats] = useState(null);
  const [anomalies, setAnomalies] = useState([]);
  const [forecast, setForecast] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCheckout, setShowCheckout] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Clock ticker
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Data fetcher
  const fetchData = useCallback(async () => {
    try {
      const [eqRes, statsRes, anomRes, forecastRes] = await Promise.all([
        fetch(`${API_BASE}/equipment`),
        fetch(`${API_BASE}/equipment/stats`),
        fetch(`${API_BASE}/anomalies`),
        fetch(`${API_BASE}/forecast`),
      ]);

      if (!eqRes.ok || !statsRes.ok || !anomRes.ok) throw new Error('API error');

      const [eqData, statsData, anomData, forecastData] = await Promise.all([
        eqRes.json(), statsRes.json(), anomRes.json(), forecastRes.ok ? forecastRes.json() : []
      ]);

      setEquipment(eqData);
      setStats(statsData);
      setAnomalies(anomData);
      setForecast(forecastData);
      setError(null);
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchData]);

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
        <div style={{ fontSize: '48px' }}>⚠️</div>
        <div className="loading-text">Unable to connect to the backend API</div>
        <div style={{ color: '#E53935', fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{error}</div>
        <button className="btn btn-primary" onClick={fetchData}>Retry Connection</button>
      </div>
    );
  }

  const s = stats || {};
  const unresolvedAnomalies = anomalies.filter(a => !a.resolved);

  return (
    <div className="app-container">
      {/* ── Header ── */}
      <header className="header">
        <div className="header-brand">
          <div className="logo-icon">▲</div>
          <h1>Zero<span>Latency</span> RMS</h1>
        </div>
        <div className="header-right">
          <div className="live-badge">Live Telemetry</div>
          <div className="header-time">
            {currentTime.toLocaleTimeString('en-US', { hour12: false })}
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setShowCheckout(true)}>
            + Checkout
          </button>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="main-content">
        {/* ── KPI Row ── */}
        <div className="kpi-row">
          <KpiCard icon="🏗️" label="Total Fleet" value={s.total_fleet || 0}
            sub={`${s.maintenance || 0} in maintenance`} variant="kpi-total" />
          <KpiCard icon="✅" label="Available" value={s.available || 0}
            sub="Ready for rental" variant="kpi-available" />
          <KpiCard icon="📋" label="Rented Out" value={Number(s.rented || 0) + Number(s.reserved || 0)}
            sub={`${s.reserved || 0} pending handshake`} variant="kpi-rented" />
          <KpiCard icon="⚡" label="Engines Running" value={s.engine_running || 0}
            sub={`${formatHours(s.total_engine_hours)}h total`} variant="kpi-running" />
          <KpiCard icon="⏸️" label="Idle" value={s.engine_idle || 0}
            sub={`${formatHours(s.total_idle_hours)}h total idle`} variant="kpi-idle" />
          <KpiCard icon="🚨" label="Action Required" value={Number(s.unauthorized || 0) + unresolvedAnomalies.length}
            sub={`${s.unauthorized || 0} unauthorized`} variant="kpi-alert" />
        </div>

        {/* ── Content Grid: Fleet Table + Alerts ── */}
        <div className="content-grid">
          {/* ── Fleet Table ── */}
          <div className="fleet-panel">
            <div className="section-header" style={{ padding: '16px 20px 0' }}>
              <h2>Fleet Equipment</h2>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Avg Fuel: {Number(s.avg_fuel || 0).toFixed(1)}%
              </span>
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
                  {equipment.map(eq => {
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
                          {eq.status === 'AVAILABLE' && (
                            <button className="btn btn-primary btn-sm"
                              onClick={() => setShowCheckout(true)}>
                              Checkout
                            </button>
                          )}
                          {(eq.status === 'RENTED' || eq.status === 'UNAUTHORIZED_USE') && (
                            <button className="btn btn-danger btn-sm"
                              onClick={async () => {
                                if (!confirm(`Return ${eq.equipment_id}?`)) return;
                                await fetch(`${API_BASE}/checkin`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ equipmentId: eq.equipment_id }),
                                });
                                fetchData();
                              }}>
                              Return
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Alerts Panel ── */}
          <div className="alerts-panel">
            <div className="section-header">
              <h2>🚨 Live Anomalies ({unresolvedAnomalies.length})</h2>
            </div>
            <div className="alerts-list">
              {unresolvedAnomalies.length === 0 ? (
                <div className="alerts-empty">
                  <div style={{ fontSize: '32px', marginBottom: '8px' }}>✅</div>
                  All systems operational
                </div>
              ) : (
                unresolvedAnomalies.slice(0, 20).map(a => (
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
          </div>
        </div>

        {/* ── Demand Forecast Panel ── */}
        <div className="fleet-panel" style={{ marginTop: '24px' }}>
          <div className="section-header" style={{ padding: '16px 20px 0' }}>
            <h2>📊 Predictive Demand Forecast (Next 30 Days)</h2>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Powered by Machine Learning Analytics
            </span>
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
                        {f.trend === 'UP' ? '📈 INCREASING' : (f.trend === 'DOWN' ? '📉 DECREASING' : '➡️ STABLE')}
                      </span>
                    </td>
                    <td>
                      <span className="hours-value" style={{ fontSize: '16px' }}>{f.predicted_demand_next_month} units</span>
                    </td>
                    <td>
                      <span className="meta-tag">{f.recommendation}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* ── Checkout Modal ── */}
      {showCheckout && (
        <CheckoutModal
          equipment={equipment}
          onClose={() => setShowCheckout(false)}
          onCheckout={() => fetchData()}
        />
      )}
    </div>
  );
}
