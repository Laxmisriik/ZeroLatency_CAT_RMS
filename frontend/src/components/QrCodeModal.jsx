import { useEffect, useState } from 'react';
import { apiFetch } from '../api.js';

export default function QrCodeModal({ equipmentId, token, onClose }) {
  const [qrUrl, setQrUrl] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    let objectUrl = null;
    apiFetch(`/equipment/${equipmentId}/qrcode`, { token, isBlob: true })
      .then(blob => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setQrUrl(objectUrl);
      })
      .catch(err => { if (active) setError(err.message); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [equipmentId, token]);

  function download() {
    const a = document.createElement('a');
    a.href = qrUrl;
    a.download = `${equipmentId}_QR.png`;
    a.click();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3>📎 QR Label — {equipmentId}</h3>
        <p className="modal-sub">Attach this to the physical machine before delivery</p>
        {error && <div className="operator-status status-error">{error}</div>}
        {qrUrl && <img src={qrUrl} alt={`${equipmentId} QR code`} className="qr-image" />}
        <div className="modal-actions">
          <button className="btn btn-secondary btn-full" onClick={onClose}>Close</button>
          <button className="btn btn-primary btn-full" onClick={download} disabled={!qrUrl}>⬇️ Download</button>
        </div>
      </div>
    </div>
  );
}
