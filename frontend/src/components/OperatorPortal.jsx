import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../api.js';
import QrScanner from './QrScanner.jsx';

/* Small offset generators for demo GPS simulation (~meters → degrees) */
function offsetCoords(lat, lng, meters) {
  const dLat = (meters / 111_320) * (Math.random() > 0.5 ? 1 : -1);
  const dLng = (meters / (111_320 * Math.cos(lat * Math.PI / 180))) * (Math.random() > 0.5 ? 1 : -1);
  return { lat: lat + dLat, lng: lng + dLng };
}

function StepRow({ label, step }) {
  if (!step) return null;
  return (
    <div className={`verify-step ${step.passed ? 'step-pass' : 'step-fail'}`}>
      <span className="verify-step-icon">{step.passed ? '✅' : '❌'}</span>
      <div>
        <div className="verify-step-label">{label}</div>
        <div className="verify-step-detail">
          {step.distanceMeters !== null ? `${step.distanceMeters}m` : '—'}
          {step.thresholdMeters ? ` (threshold: ${step.thresholdMeters}m)` : ''}
        </div>
      </div>
    </div>
  );
}

export default function OperatorPortal({ equipment, token, user, onUnlocked }) {
  const [equipmentId, setEquipmentId] = useState('');
  const [scanMsg, setScanMsg] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [shiftSeconds, setShiftSeconds] = useState(0);
  const timerRef = useRef(null);

  const unlocked = result?.success === true;

  useEffect(() => {
    if (unlocked) {
      timerRef.current = setInterval(() => setShiftSeconds(s => s + 1), 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [unlocked]);

  const formatShift = (s) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  async function submitScan(lat, lng) {
    setLoading(true);
    setError(null);
    setResult(null);
    setShiftSeconds(0);
    try {
      const data = await apiFetch('/operator/verify-scan', {
        method: 'POST',
        token,
        body: { equipmentId, operatorLat: lat, operatorLng: lng },
      });
      setResult({ success: true, ...data });
      onUnlocked?.();
    } catch (err) {
      if (err.data?.steps) {
        setResult({ success: false, ...err.data });
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }

  function handleRealGps() {
    if (!equipmentId) return setError('Scan or enter an Equipment ID first.');
    if (!navigator.geolocation) return setError('Geolocation not supported on this device.');
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => submitScan(pos.coords.latitude, pos.coords.longitude),
      (err) => { setLoading(false); setError('GPS error: ' + err.message); }
    );
  }

  function handleSimulate(withinRange) {
    if (!equipmentId) return setError('Scan or enter an Equipment ID first.');
    const machine = equipment.find(eq => eq.equipment_id === equipmentId.toUpperCase());
    if (!machine || !machine.current_latitude) {
      return setError('No live GPS telemetry found for that Equipment ID yet.');
    }
    const meters = withinRange ? 8 : 200;
    const { lat, lng } = offsetCoords(Number(machine.current_latitude), Number(machine.current_longitude), meters);
    submitScan(lat, lng);
  }

  return (
    <div className="operator-portal">
      <div className="section-header" style={{ padding: '16px 20px 0' }}>
        <h2>📱 Operator Mobile Portal</h2>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Logged in as {user.displayName}</span>
      </div>

      <div className="operator-body">
        <QrScanner
          onScan={(id) => { setEquipmentId(id); setScanMsg(`Scanned: ${id}`); }}
          onError={setError}
        />
        {scanMsg && <div className="operator-status">{scanMsg}</div>}

        <div className="form-group" style={{ marginTop: '12px' }}>
          <label>Equipment ID</label>
          <input type="text" placeholder="Scan above or type manually e.g. EQX1001" value={equipmentId}
            onChange={e => setEquipmentId(e.target.value.toUpperCase())} />
        </div>

        <div className="operator-actions">
          <button className="btn btn-secondary btn-full" disabled={loading} onClick={handleRealGps}>
            📍 Use My Real GPS
          </button>
          <button className="btn btn-primary btn-full" disabled={loading} onClick={() => handleSimulate(true)}>
            ✅ Simulate Near Machine
          </button>
          <button className="btn btn-danger btn-full" disabled={loading} onClick={() => handleSimulate(false)}>
            ❌ Simulate Far Away
          </button>
        </div>

        {loading && <div className="operator-status">Verifying proximity &amp; geofence…</div>}
        {error && <div className="operator-status status-error">{error}</div>}

        {result && (
          <div className={`verify-panel ${unlocked ? 'verify-unlocked' : 'verify-locked'}`}>
            <StepRow label="Operator ↔ Machine Proximity" step={result.steps?.proximityCheck} />
            <StepRow label="Machine ↔ Site Geofence" step={result.steps?.geofenceCheck} />
            <div className={`ignition-banner ${unlocked ? 'ignition-on' : 'ignition-off'}`}>
              {unlocked ? '🟢 IGNITION UNLOCKED' : '🔒 IGNITION LOCKED'}
            </div>
            {unlocked && (
              <div className="shift-timer">
                Shift Duration: <span>{formatShift(shiftSeconds)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
