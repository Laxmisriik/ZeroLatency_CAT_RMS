/**
 * Small fetch wrapper that attaches the Bearer session token and
 * normalizes error handling for the whole app.
 */
// Relative path — proxied to the backend by Vite (see vite.config.js). Using a
// relative path (instead of hardcoding http://localhost:5000/api) means this
// works from any origin the frontend is served from: localhost, a LAN IP, or
// a tunnel like ngrok — all of which matter for testing the camera-based QR
// scanner on an actual mobile device.
export const API_BASE = '/api';

export async function apiFetch(path, { method = 'GET', body, token, isBlob = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    const err = new Error('Session expired. Please log in again.');
    err.sessionExpired = true;
    throw err;
  }

  if (isBlob) {
    if (!res.ok) throw new Error('Request failed.');
    return res.blob();
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.data = data;
    throw err;
  }
  return data;
}
