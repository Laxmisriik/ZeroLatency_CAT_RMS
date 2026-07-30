import { useState } from 'react';
import { apiFetch } from '../api.js';

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch('/auth/login', { method: 'POST', body: { username, password } });
      onLogin(data.token, data.user);
    } catch (err) {
      setError(err.message || 'Login failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <div className="logo-icon">▲</div>
          <h1>Zero<span>Latency</span> RMS</h1>
        </div>
        <p className="login-sub">Sign in to your fleet workspace</p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Username</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)}
              placeholder="e.g. dealer1" required autoFocus />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" required />
          </div>
          {error && <div className="operator-status status-error">{error}</div>}
          <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
            {loading ? 'Signing in...' : '🔐 Sign In'}
          </button>
        </form>

        <div className="login-demo-hint">
          <strong>Demo accounts</strong> — password for all: <code>password123</code>
          <ul>
            <li><code>dealer1</code> — Dealer / HQ Fleet Admin (full fleet)</li>
            <li><code>manager1</code> — Site Manager (EQX1001, EQX1002)</li>
            <li><code>manager2</code> — Site Manager (EQX1003, EQX1004)</li>
            <li><code>OP101</code> / <code>OP203</code> — Field Operator</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
