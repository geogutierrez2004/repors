/**
 * Login page component.
 *
 * The renderer is UX-only; real validation happens in the main process (spec §4.1).
 */
import React, { useState } from 'react';

declare global {
  interface Window {
    sccfs: {
      auth: {
        login: (
          username: string,
          password: string,
        ) => Promise<{ ok: boolean; data?: unknown; error?: { message: string } }>;
      };
    };
  }
}

export function Login(): React.JSX.Element {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await window.sccfs.auth.login(username, password);
      if (!result.ok) {
        setError(result.error?.message ?? 'Login failed');
      }
      // On success, session handling would redirect to the main app view
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return React.createElement(
    'div',
    { style: { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#f0f2f5' } },
    React.createElement(
      'form',
      { onSubmit: handleSubmit, style: { background: '#fff', padding: 32, borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.1)', width: 360 } },
      React.createElement('h1', { style: { fontSize: 20, marginBottom: 24, textAlign: 'center' as const } }, 'SCCFS Login'),
      error && React.createElement('div', { style: { color: '#d32f2f', marginBottom: 16, fontSize: 14 } }, error),
      React.createElement('input', {
        type: 'text',
        placeholder: 'Username',
        value: username,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setUsername(e.target.value),
        style: { width: '100%', padding: 10, marginBottom: 12, border: '1px solid #ccc', borderRadius: 4, fontSize: 14 },
        disabled: loading,
      }),
      React.createElement('input', {
        type: 'password',
        placeholder: 'Password',
        value: password,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value),
        style: { width: '100%', padding: 10, marginBottom: 16, border: '1px solid #ccc', borderRadius: 4, fontSize: 14 },
        disabled: loading,
      }),
      React.createElement(
        'button',
        {
          type: 'submit',
          disabled: loading || !username || !password,
          style: { width: '100%', padding: 10, background: '#1976d2', color: '#fff', border: 'none', borderRadius: 4, fontSize: 14, cursor: 'pointer' },
        },
        loading ? 'Signing in…' : 'Sign In',
      ),
    ),
  );
}
