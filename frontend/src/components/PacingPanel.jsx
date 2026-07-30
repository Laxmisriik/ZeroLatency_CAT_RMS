import { useState } from 'react';
import { apiFetch } from '../api.js';

function pacingBarClass(status) {
  if (status === 'LAGGING') return 'fuel-low';
  if (status === 'AHEAD') return 'fuel-high';
  return 'fuel-mid';
}

export default function PacingPanel({ pacing, token, onExtended }) {
  const [busyId, setBusyId] = useState(null);

  async function extend(equipmentId, extraDays) {
    setBusyId(equipmentId);
    try {
      await apiFetch('/manager/extend-rental', {
        method: 'POST',
        token,
        body: { equipmentId, extraDays },
      });
      onExtended?.();
    } catch (err) {
      alert(err.message || 'Extension failed.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fleet-panel" style={{ marginTop: '24px' }}>
      <div className="section-header" style={{ padding: '16px 20px 0' }}>
        <h2>📈 Contract Pacing &amp; Predictive Overrun</h2>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          Pacing % = Logged Hours ÷ Expected Hours
        </span>
      </div>
      <div style={{ overflowX: 'auto', padding: '16px 20px' }}>
        <table className="fleet-table" style={{ border: '1px solid var(--border-subtle)' }}>
          <thead>
            <tr>
              <th>Equipment</th>
              <th>Contract Window</th>
              <th>Logged / Expected Hrs</th>
              <th>Pacing %</th>
              <th>Status</th>
              <th>Projected Overrun</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {pacing.map(p => (
              <tr key={p.equipmentId} className={p.status === 'LAGGING' ? 'row-alert' : ''}>
                <td><span className="eq-id">{p.equipmentId}</span></td>
                <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {p.checkInDate} → {p.checkOutDate}<br />
                  Day {p.daysElapsed}/{p.totalContractDays}
                </td>
                <td>{p.loggedHours}h / {p.expectedHours}h</td>
                <td>
                  <div className="fuel-bar-container">
                    <div className="fuel-bar">
                      <div className={`fuel-bar-fill ${pacingBarClass(p.status)}`}
                        style={{ width: `${Math.min(100, p.pacingPct)}%` }} />
                    </div>
                    <span className="fuel-text">{p.pacingPct}%</span>
                  </div>
                </td>
                <td>
                  <span className={`status-badge status-${p.status === 'LAGGING' ? 'unauthorized_use' : (p.status === 'AHEAD' ? 'available' : 'reserved')}`}>
                    {p.status}
                  </span>
                </td>
                <td>{p.projectedOverrunDays !== null ? `${p.projectedOverrunDays} day(s)` : '—'}</td>
                <td>
                  {p.status === 'LAGGING' && (
                    <button className="btn btn-primary btn-sm" disabled={busyId === p.equipmentId}
                      onClick={() => extend(p.equipmentId, 3)}>
                      {busyId === p.equipmentId ? '...' : '+3 Days'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
