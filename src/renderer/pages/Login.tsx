/**
 * Login page component.
 *
 * The renderer is UX-only; real validation happens in the main process (spec §4.1).
 */
import React, { useState } from 'react';
import type { SafeUser } from '../../shared/types';

interface LoginProps {
  onLogin: (sessionId: string, user: SafeUser) => void;
}

export function Login({ onLogin }: LoginProps): React.JSX.Element {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const api = globalThis.window?.sccfs;
      if (!api?.auth?.login) {
        setError('App bridge is unavailable. Restart the app and try again.');
        return;
      }

      const result = await api.auth.login(username, password);
      if (!result.ok) {
        setError(result.error?.message ?? 'Login failed');
        return;
      }

      onLogin(result.data.sessionId, result.data.user);
    } catch (err: any) {
      setError(err?.message ?? 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        background: 'var(--bg-base)',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: 'var(--bg-surface)',
          padding: 32,
          borderRadius: 12,
          boxShadow: 'var(--shadow-md)',
          width: 360,
          border: '1px solid var(--border)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>SCCFS</div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>Sign In</h1>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
            St. Clare College Filing System
          </p>
        </div>

        {error && (
          <div
            style={{
              color: '#dc2626',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 6,
              padding: '8px 12px',
              marginBottom: 16,
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        <input
          type="text"
          placeholder="Username"
          value={username}
          autoComplete="username"
          onChange={(e) => setUsername(e.target.value)}
          style={{
            width: '100%',
            padding: '10px 12px',
            marginBottom: 12,
            border: '1px solid var(--border)',
            borderRadius: 6,
            fontSize: 14,
            background: 'var(--bg-surface)',
            color: 'var(--text-primary)',
            outline: 'none',
          }}
          disabled={loading}
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
          style={{
            width: '100%',
            padding: '10px 12px',
            marginBottom: 20,
            border: '1px solid var(--border)',
            borderRadius: 6,
            fontSize: 14,
            background: 'var(--bg-surface)',
            color: 'var(--text-primary)',
            outline: 'none',
          }}
          disabled={loading}
        />

        <button
          type="submit"
          disabled={loading || !username || !password}
          style={{
            width: '100%',
            padding: '10px',
            background: loading || !username || !password ? '#a5b4fc' : 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 600,
            cursor: loading || !username || !password ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}
