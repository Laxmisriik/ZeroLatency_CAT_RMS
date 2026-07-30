import { useState } from 'react';
import { apiFetch } from '../api.js';
import QrCodeModal from './QrCodeModal.jsx';
import { HardHat, AlertCircle } from 'lucide-react';

const EQUIPMENT_TYPES = ['Excavator', 'Bulldozer', 'Crane', 'Grader', 'Loader'];

export default function CreateEquipmentModal({ token, onClose, onCreated }) {
  const [form, setForm] = useState({ equipmentId: '', type: EQUIPMENT_TYPES[0] });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const data = await apiFetch('/equipment', { method: 'POST', body: form, token });
      setCreated(data.machine);
      onCreated?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return <QrCodeModal equipmentId={created.equipment_id} token={token} onClose={onClose} />;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3><HardHat size={18} /> Register New Equipment</h3>
        <p className="modal-sub">Create a machine record, then download its QR label for delivery</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Equipment ID</label>
            <input type="text" placeholder="e.g. EQX1009" value={form.equipmentId}
              onChange={e => setForm({ ...form, equipmentId: e.target.value.toUpperCase() })} required />
          </div>
          <div className="form-group">
            <label>Type</label>
            <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
              {EQUIPMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {error && <div className="operator-status status-error"><AlertCircle size={13} /> {error}</div>}
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary btn-full" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-full" disabled={submitting}>
              {submitting ? 'Creating...' : 'Create & Generate QR'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
