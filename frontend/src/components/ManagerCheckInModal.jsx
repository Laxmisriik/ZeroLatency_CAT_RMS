import { useState } from 'react';
import { apiFetch } from '../api.js';
import QrScanner from './QrScanner.jsx';
import { PackageCheck, AlertCircle, Check } from 'lucide-react';

export default function ManagerCheckInModal({ token, sites, onClose, onCheckedIn }) {
  const [equipmentId, setEquipmentId] = useState('');
  const [siteId, setSiteId] = useState(sites[0]?.site_id || '');
  const [checkInDate, setCheckInDate] = useState(new Date().toISOString().slice(0, 10));
  const [checkOutDate, setCheckOutDate] = useState('');
  const [dailyShiftHours, setDailyShiftHours] = useState(8);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [scanMsg, setScanMsg] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const data = await apiFetch('/manager/check-in', {
        method: 'POST',
        token,
        body: { equipmentId, siteId, checkInDate, checkOutDate, dailyShiftHours: Number(dailyShiftHours) },
      });
      onCheckedIn?.(data.message);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3><PackageCheck size={18} /> Check In New Machine</h3>
        <p className="modal-sub">Scan the QR label delivered with the machine, then confirm the site &amp; contract window</p>

        <QrScanner
          onScan={(id) => { setEquipmentId(id); setScanMsg(`Scanned: ${id}`); }}
          onError={setError}
        />
        {scanMsg && <div className="operator-status">{scanMsg}</div>}

        <form onSubmit={handleSubmit} style={{ marginTop: '16px' }}>
          <div className="form-group">
            <label>Equipment ID</label>
            <input type="text" placeholder="Scan above or type manually" value={equipmentId}
              onChange={e => setEquipmentId(e.target.value.toUpperCase())} required />
          </div>
          <div className="form-group">
            <label>Site</label>
            <select value={siteId} onChange={e => setSiteId(e.target.value)} required>
              {sites.map(s => <option key={s.site_id} value={s.site_id}>{s.site_id} — {s.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Check-In Date</label>
            <input type="date" value={checkInDate} onChange={e => setCheckInDate(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Check-Out Date (Contract End)</label>
            <input type="date" value={checkOutDate} onChange={e => setCheckOutDate(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Daily Shift Hours</label>
            <input type="number" step="0.5" min="1" max="24" value={dailyShiftHours}
              onChange={e => setDailyShiftHours(e.target.value)} required />
          </div>
          {error && <div className="operator-status status-error"><AlertCircle size={13} /> {error}</div>}
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary btn-full" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-full" disabled={submitting}>
              <Check size={15} /> {submitting ? 'Checking in...' : 'Confirm Check-In'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
