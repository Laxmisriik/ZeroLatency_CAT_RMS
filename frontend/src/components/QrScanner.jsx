import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, ImageUp } from 'lucide-react';

/**
 * Reusable QR scanner supporting both a live camera feed and a static
 * image upload — matches the "download from Dealer, scan/upload on
 * Manager/Operator side" workflow.
 */
export default function QrScanner({ onScan, onError }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const [scanning, setScanning] = useState(false);

  function stopCamera() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  }

  useEffect(() => () => stopCamera(), []);

  function handleDecoded(text) {
    try {
      const parsed = JSON.parse(text);
      if (parsed.equipmentId) return onScan(parsed.equipmentId);
    } catch {
      /* not JSON — fall through to raw text */
    }
    onScan(text.trim());
  }

  function tick() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code) {
        stopCamera();
        handleDecoded(code.data);
        return;
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setScanning(true);
      tick();
    } catch (err) {
      onError?.('Camera unavailable: ' + err.message);
    }
  }

  function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current;
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code) handleDecoded(code.data);
        else onError?.('No QR code detected in that image.');
      };
      img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  return (
    <div className="qr-scanner">
      <video ref={videoRef} className={`qr-video ${scanning ? 'qr-video-active' : ''}`} muted playsInline />
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <div className="qr-scanner-actions">
        {!scanning ? (
          <button type="button" className="btn btn-secondary btn-full" onClick={startCamera}>
            <Camera size={15} /> Scan with Camera
          </button>
        ) : (
          <button type="button" className="btn btn-danger btn-full" onClick={stopCamera}>
            Stop Camera
          </button>
        )}
        <label className="btn btn-secondary btn-full qr-upload-label">
          <ImageUp size={15} /> Upload QR Image
          <input type="file" accept="image/*" onChange={handleFileUpload} style={{ display: 'none' }} />
        </label>
      </div>
    </div>
  );
}
