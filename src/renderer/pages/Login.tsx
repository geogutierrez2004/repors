/**
 * Login page component.
 *
 * The renderer is UX-only; real validation happens in the main process (spec §4.1).
 */
import React, { useState } from 'react';

type AuthApi = {
  login: (
    username: string,
    password: string,
  ) => Promise<
    | {
        ok: true;
        data: { sessionId: string; user: { username: string; role?: string } };
        error?: undefined;
      }
    | {
        ok: false;
        data?: undefined;
        error?: { message: string };
      }
  >;
  logout: (sessionId: string) => Promise<
    | { ok: true; data: unknown; error?: undefined }
    | { ok: false; data?: undefined; error?: { message: string } }
  >;
};

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
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [signedInUser, setSignedInUser] = useState<string | null>(null);
  const [signedInRole, setSignedInRole] = useState<string | null>(null);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const browserWindow = globalThis as typeof globalThis & {
    window: Window & {
      sccfs: {
        auth: AuthApi;
      };
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const api = browserWindow.window?.sccfs;
      if (!api?.auth?.login) {
        setError('App bridge is unavailable. Restart the app and try again.');
        return;
      }

      const result = await api.auth.login(username, password);
      if (!result.ok) {
        setError(result.error?.message ?? 'Login failed');
        return;
      }

      const data = result.data as { sessionId: string; user: { username: string; role?: string } };

      setSessionId(data.sessionId);
      setSignedInUser(data.user.username);
      setSignedInRole(data.user.role ?? null);
      setPassword('');
      setError(null);
    } catch (error: any) {
      const message =
        error && typeof error.message === 'string'
          ? error.message
          : 'An unexpected error occurred';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async (): Promise<void> => {
    if (!sessionId) return;
    setError(null);
    setLogoutLoading(true);

    try {
      const api = browserWindow.window?.sccfs;
      if (!api?.auth?.logout) {
        setError('Logout bridge is unavailable. Restart the app and try again.');
        return;
      }

      const result = await api.auth.logout(sessionId);
      if (!result.ok) {
        setError(result.error?.message ?? 'Logout failed');
        return;
      }

      setSessionId(null);
      setSignedInUser(null);
      setSignedInRole(null);
      setUsername('');
      setPassword('');
    } catch (error: any) {
      const message =
        error && typeof error.message === 'string'
          ? error.message
          : 'An unexpected error occurred during logout';
      setError(message);
    } finally {
      setLogoutLoading(false);
    }
  };

  if (sessionId && signedInUser) {
    return React.createElement(
      'div',
      {
        style: {
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          position: 'relative',
          zIndex: 1,
        },
      },
      React.createElement(
        'div',
        {
          style: {
            width: '100%',
            maxWidth: 900,
            padding: 36,
            borderRadius: 28,
            background: 'rgba(255, 255, 255, 0.98)',
            border: '1px solid rgba(226, 232, 240, 0.92)',
            boxShadow: '0 30px 80px rgba(15, 23, 42, 0.35)',
            color: '#0f172a',
          },
        },
        React.createElement('div', {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            gap: 16,
            alignItems: 'center',
            flexWrap: 'wrap',
            marginBottom: 16,
          },
        },
          React.createElement('div', null,
            React.createElement(
              'div',
              { style: { fontSize: 13, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#2563eb' } },
              'Dashboard',
            ),
            React.createElement('h2', { style: { marginTop: 8, fontSize: 30, lineHeight: 1.1, letterSpacing: '-0.04em' } }, `Welcome, ${signedInUser}`),
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              onClick: () => {
                void handleLogout();
              },
              disabled: logoutLoading,
              style: {
                padding: '12px 16px',
                borderRadius: 12,
                border: '1px solid rgba(148, 163, 184, 0.38)',
                background: logoutLoading ? '#e2e8f0' : '#fff',
                color: '#0f172a',
                fontWeight: 700,
                cursor: logoutLoading ? 'not-allowed' : 'pointer',
              },
            },
            logoutLoading ? 'Signing Out...' : 'Sign Out',
          ),
        ),
        React.createElement(
          'p',
          { style: { marginTop: 12, marginBottom: 18, fontSize: 15, lineHeight: 1.6, color: '#475569' } },
          'You are signed in. This is the starter dashboard shell while file modules are being wired.',
        ),
        React.createElement(
          'div',
          {
            style: {
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 14,
              marginBottom: 18,
            },
          },
          React.createElement(
            'div',
            { style: { border: '1px solid rgba(148, 163, 184, 0.24)', borderRadius: 14, padding: 16, background: '#fff' } },
            React.createElement('strong', { style: { display: 'block', marginBottom: 8 } }, 'User'),
            React.createElement('div', { style: { color: '#334155', fontSize: 14 } }, signedInUser),
          ),
          React.createElement(
            'div',
            { style: { border: '1px solid rgba(148, 163, 184, 0.24)', borderRadius: 14, padding: 16, background: '#fff' } },
            React.createElement('strong', { style: { display: 'block', marginBottom: 8 } }, 'Role'),
            React.createElement('div', { style: { color: '#334155', fontSize: 14, textTransform: 'capitalize' } }, signedInRole ?? 'unknown'),
          ),
          React.createElement(
            'div',
            { style: { border: '1px solid rgba(148, 163, 184, 0.24)', borderRadius: 14, padding: 16, background: '#fff' } },
            React.createElement('strong', { style: { display: 'block', marginBottom: 8 } }, 'Status'),
            React.createElement('div', { style: { color: '#166534', fontSize: 14 } }, 'Authenticated'),
          ),
        ),
        error &&
          React.createElement(
            'div',
            {
              role: 'alert',
              style: {
                marginBottom: 12,
                padding: '12px 14px',
                borderRadius: 14,
                background: 'rgba(185, 28, 28, 0.08)',
                border: '1px solid rgba(185, 28, 28, 0.16)',
                color: '#991b1b',
                fontSize: 14,
                lineHeight: 1.5,
              },
            },
            error,
          ),
        React.createElement(
          'div',
          { style: { fontSize: 12, color: '#64748b', wordBreak: 'break-all' } },
          `Session ID: ${sessionId}`,
        ),
      ),
    );
  }

  return React.createElement(
    'div',
    {
      style: {
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        position: 'relative',
        zIndex: 1,
      },
    },
    React.createElement(
      'form',
      {
        onSubmit: handleSubmit,
        style: {
          width: '100%',
          maxWidth: 520,
          padding: 36,
          borderRadius: 28,
          background: 'rgba(255, 255, 255, 0.98)',
          border: '1px solid rgba(226, 232, 240, 0.92)',
          boxShadow: '0 30px 80px rgba(15, 23, 42, 0.35)',
          color: '#0f172a',
        },
      },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 } },
        React.createElement('div', {
          style: {
            width: 54,
            height: 54,
            borderRadius: 18,
            display: 'grid',
            placeItems: 'center',
            background: 'linear-gradient(135deg, #60a5fa, #2563eb)',
            color: '#fff',
            fontWeight: 800,
            letterSpacing: '0.08em',
            boxShadow: '0 16px 32px rgba(37, 99, 235, 0.35)',
          },
        }, 'SC'),
        React.createElement('div', null,
          React.createElement('div', { style: { fontSize: 13, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#2563eb' } }, 'St. Clare College'),
          React.createElement('h1', { style: { marginTop: 4, fontSize: 28, lineHeight: 1.1, letterSpacing: '-0.04em' } }, 'Sign in to the filing system'),
        ),
      ),
      React.createElement('p', { style: { marginBottom: 24, fontSize: 15, lineHeight: 1.6, color: '#475569' } }, 'Enter your registrar credentials to access accounts, records, and file operations.'),
      error &&
        React.createElement(
          'div',
          {
            role: 'alert',
            style: {
              marginBottom: 18,
              padding: '12px 14px',
              borderRadius: 14,
              background: 'rgba(185, 28, 28, 0.08)',
              border: '1px solid rgba(185, 28, 28, 0.16)',
              color: '#991b1b',
              fontSize: 14,
              lineHeight: 1.5,
            },
          },
          error,
        ),
      React.createElement(
        'label',
        { style: { display: 'block', marginBottom: 14 } },
        React.createElement('div', { style: { fontSize: 14, fontWeight: 700, marginBottom: 8, color: '#334155' } }, 'Username'),
        React.createElement('input', {
          type: 'text',
          placeholder: 'admin',
          value: username,
          onChange: (e: any) => setUsername(e.target.value),
          disabled: loading,
          style: {
            width: '100%',
            padding: '15px 16px',
            border: '1px solid rgba(148, 163, 184, 0.45)',
            borderRadius: 16,
            fontSize: 16,
            color: '#0f172a',
            background: '#fff',
            outline: 'none',
            boxShadow: 'inset 0 1px 2px rgba(15, 23, 42, 0.04)',
          },
        }),
      ),
      React.createElement(
        'label',
        { style: { display: 'block', marginBottom: 20 } },
        React.createElement('div', { style: { fontSize: 14, fontWeight: 700, marginBottom: 8, color: '#334155' } }, 'Password'),
        React.createElement('input', {
          type: 'password',
          placeholder: 'password',
          value: password,
          onChange: (e: any) => setPassword(e.target.value),
          disabled: loading,
          style: {
            width: '100%',
            padding: '15px 16px',
            border: '1px solid rgba(148, 163, 184, 0.45)',
            borderRadius: 16,
            fontSize: 16,
            color: '#0f172a',
            background: '#fff',
            outline: 'none',
            boxShadow: 'inset 0 1px 2px rgba(15, 23, 42, 0.04)',
          },
        }),
      ),
      React.createElement(
        'button',
        {
          type: 'submit',
          disabled: loading || !username || !password,
          style: {
            width: '100%',
            padding: '15px 16px',
            background: loading || !username || !password ? 'rgba(37, 99, 235, 0.55)' : 'linear-gradient(135deg, #2563eb, #1d4ed8)',
            color: '#fff',
            border: 'none',
            borderRadius: 16,
            fontSize: 16,
            fontWeight: 800,
            cursor: loading || !username || !password ? 'not-allowed' : 'pointer',
            boxShadow: '0 16px 30px rgba(37, 99, 235, 0.28)',
          },
        },
        loading ? 'Signing in…' : 'Sign In',
      ),
    ),
  );
}
