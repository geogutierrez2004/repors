/**
 * Root application component.
 *
 * Manages global state: authentication session, current page, dark mode theme,
 * and the toast notification queue. Renders the sidebar navigation and the
 * active page content. Login is shown when no session is active.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { SafeUser } from '../shared/types';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { FileBrowser } from './pages/FileBrowser';
import { ActivityLog } from './pages/ActivityLog';
import { StorageBackup } from './pages/StorageBackup';
import { SecurityDashboard } from './pages/SecurityDashboard';

// ────────────────────────────────────────
// Types
// ────────────────────────────────────────

type Page = 'dashboard' | 'files' | 'activity' | 'storage' | 'security';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
}

export type AddToast = (type: Toast['type'], message: string) => void;

const SESSION_WARN_MS = 5 * 60 * 1000; // warn 5 min before inactivity timeout
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

// ────────────────────────────────────────
// Helpers
// ────────────────────────────────────────

function getInitialTheme(): 'light' | 'dark' {
  try {
    return (localStorage.getItem('sccfs-theme') as 'light' | 'dark') ?? 'light';
  } catch {
    return 'light';
  }
}

function applyTheme(theme: 'light' | 'dark') {
  document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : '');
  try {
    localStorage.setItem('sccfs-theme', theme);
  } catch {
    // ignore
  }
}

const NAV_ITEMS: Array<{ id: Page; label: string; icon: string; adminOnly?: boolean }> = [
  { id: 'dashboard', label: 'Overview', icon: '🏠' },
  { id: 'files', label: 'Files', icon: '📁' },
  { id: 'activity', label: 'Activity Log', icon: '📊' },
  { id: 'storage', label: 'Storage & Backup', icon: '💾', adminOnly: true },
  { id: 'security', label: 'Security', icon: '🔒', adminOnly: true },
];

// ────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────

function ToastList({ toasts, remove }: { toasts: Toast[]; remove: (id: string) => void }) {
  return (
    <div
      className="no-print"
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 360,
      }}
    >
      {toasts.map((t) => {
        const colors: Record<Toast['type'], string> = {
          success: '#16a34a',
          error: '#dc2626',
          warning: '#d97706',
          info: '#0284c7',
        };
        const icons: Record<Toast['type'], string> = {
          success: '✓',
          error: '✕',
          warning: '⚠',
          info: 'ℹ',
        };
        return (
          <div
            key={t.id}
            style={{
              background: colors[t.type],
              color: '#fff',
              padding: '10px 14px',
              borderRadius: 8,
              boxShadow: '0 4px 12px rgba(0,0,0,.2)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              animation: 'fadeIn 200ms ease',
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 16 }}>{icons[t.type]}</span>
            <span style={{ flex: 1, fontSize: 13, lineHeight: 1.4 }}>{t.message}</span>
            <button
              onClick={() => remove(t.id)}
              style={{
                background: 'none',
                border: 'none',
                color: 'rgba(255,255,255,.8)',
                cursor: 'pointer',
                fontSize: 16,
                lineHeight: 1,
                padding: 0,
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

function SessionWarning({ onExtend, onLogout }: { onExtend: () => void; onLogout: () => void }) {
  return (
    <div
      className="no-print"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
      }}
    >
      <div
        style={{
          background: 'var(--bg-surface)',
          borderRadius: 12,
          padding: 32,
          maxWidth: 400,
          textAlign: 'center',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 12 }}>⏱️</div>
        <h2 style={{ fontSize: 18, marginBottom: 8, color: 'var(--text-primary)' }}>
          Session Expiring Soon
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: 14 }}>
          Your session will expire in less than 5 minutes due to inactivity. Would you like to
          continue?
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button onClick={onLogout} style={btnStyle('secondary')}>
            Log Out
          </button>
          <button onClick={onExtend} style={btnStyle('primary')}>
            Stay Logged In
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────
// Style helpers (shared across pages via props)
// ────────────────────────────────────────

export function btnStyle(
  variant: 'primary' | 'secondary' | 'danger' | 'ghost',
  small = false,
): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: small ? '5px 12px' : '8px 16px',
    borderRadius: 6,
    fontSize: small ? 12 : 13,
    fontWeight: 500,
    cursor: 'pointer',
    border: 'none',
    transition: '150ms',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  };
  if (variant === 'primary')
    return { ...base, background: 'var(--accent)', color: '#fff' };
  if (variant === 'danger')
    return { ...base, background: 'var(--danger)', color: '#fff' };
  if (variant === 'secondary')
    return { ...base, background: 'var(--bg-hover)', color: 'var(--text-primary)', border: '1px solid var(--border)' };
  return { ...base, background: 'transparent', color: 'var(--text-secondary)' };
}

export function cardStyle(): React.CSSProperties {
  return {
    background: 'var(--bg-surface)',
    borderRadius: 'var(--radius-lg)',
    padding: '20px 24px',
    boxShadow: 'var(--shadow-sm)',
    border: '1px solid var(--border)',
  };
}

// ────────────────────────────────────────
// App
// ────────────────────────────────────────

export function App(): React.JSX.Element {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [user, setUser] = useState<SafeUser | null>(null);
  const [page, setPage] = useState<Page>('dashboard');
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showSessionWarning, setShowSessionWarning] = useState(false);

  const lastActivityRef = useRef(Date.now());
  const sessionCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Apply theme on mount and change
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Reset activity timestamp on user interaction
  useEffect(() => {
    if (!sessionId) return;
    const reset = () => {
      lastActivityRef.current = Date.now();
      setShowSessionWarning(false);
    };
    window.addEventListener('mousemove', reset);
    window.addEventListener('keydown', reset);
    window.addEventListener('click', reset);
    return () => {
      window.removeEventListener('mousemove', reset);
      window.removeEventListener('keydown', reset);
      window.removeEventListener('click', reset);
    };
  }, [sessionId]);

  // Session expiry check (every 30s)
  useEffect(() => {
    if (!sessionId) return;
    sessionCheckRef.current = setInterval(async () => {
      const idle = Date.now() - lastActivityRef.current;
      if (idle >= INACTIVITY_TIMEOUT_MS) {
        void handleLogout();
        return;
      }
      if (idle >= INACTIVITY_TIMEOUT_MS - SESSION_WARN_MS) {
        setShowSessionWarning(true);
      }
      // Also validate with server
      const res = await window.sccfs.auth.validateSession(sessionId);
      if (!res.ok || !res.data?.valid) {
        void handleLogout();
      }
    }, 30_000);
    return () => {
      if (sessionCheckRef.current) clearInterval(sessionCheckRef.current);
    };
  }, [sessionId]);

  const addToast = useCallback<AddToast>((type, message) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleLogin = useCallback((sid: string, u: SafeUser) => {
    setSessionId(sid);
    setUser(u);
    setPage('dashboard');
    lastActivityRef.current = Date.now();
  }, []);

  const handleLogout = useCallback(async () => {
    if (sessionId) {
      await window.sccfs.auth.logout(sessionId).catch(() => null);
    }
    setSessionId(null);
    setUser(null);
    setPage('dashboard');
    setShowSessionWarning(false);
    if (sessionCheckRef.current) clearInterval(sessionCheckRef.current);
  }, [sessionId]);

  useEffect(() => {
    const unsubscribe = window.sccfs.app.onRestored(({ sessionInvalidated }) => {
      if (sessionInvalidated) {
        setSessionId(null);
        setUser(null);
        setPage('dashboard');
        setShowSessionWarning(false);
        if (sessionCheckRef.current) clearInterval(sessionCheckRef.current);
        addToast('info', 'Backup restored. Please log in again.');
        return;
      }

      addToast('success', 'Backup restored successfully.');
      setPage('dashboard');
    });

    return () => {
      unsubscribe();
    };
  }, [addToast]);

  // ── Not logged in ──
  if (!sessionId || !user) {
    return (
      <>
        <Login onLogin={handleLogin} />
        <ToastList toasts={toasts} remove={removeToast} />
        <style>{keyframeStyles}</style>
      </>
    );
  }

  const isAdmin = user.role === 'admin';
  const visibleNav = NAV_ITEMS.filter((n) => !n.adminOnly || isAdmin);

  const sharedProps = { sessionId, user, addToast };

  return (
    <>
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        {/* ── Sidebar ── */}
        <aside
          className="no-print"
          style={{
            width: 220,
            minWidth: 220,
            background: 'var(--bg-sidebar)',
            display: 'flex',
            flexDirection: 'column',
            padding: '0 0 16px',
            overflowY: 'auto',
          }}
        >
          {/* Logo */}
          <div
            style={{
              padding: '20px 20px 16px',
              borderBottom: '1px solid rgba(255,255,255,.08)',
              marginBottom: 8,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', letterSpacing: .5 }}>
              SCCFS
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-sidebar)', marginTop: 2 }}>
              St. Clare College
            </div>
          </div>

          {/* Nav items */}
          <nav style={{ flex: 1, padding: '0 10px' }}>
            {visibleNav.map((item) => {
              const active = page === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setPage(item.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 6,
                    border: 'none',
                    background: active ? 'var(--accent)' : 'transparent',
                    color: active ? '#fff' : 'var(--text-sidebar)',
                    fontSize: 13,
                    fontWeight: active ? 600 : 400,
                    cursor: 'pointer',
                    marginBottom: 2,
                    textAlign: 'left',
                    transition: 'background var(--transition)',
                  }}
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Bottom: user + theme toggle */}
          <div style={{ padding: '12px 14px 0', borderTop: '1px solid rgba(255,255,255,.08)', marginTop: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--text-sidebar)', marginBottom: 8, padding: '0 2px' }}>
              <span style={{ fontWeight: 600, color: '#e2e8f0' }}>{user.username}</span>
              {' '}
              <span
                style={{
                  fontSize: 10,
                  background: isAdmin ? 'var(--accent)' : '#334155',
                  color: '#fff',
                  borderRadius: 10,
                  padding: '1px 6px',
                  textTransform: 'uppercase',
                }}
              >
                {user.role}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
                title="Toggle dark mode"
                style={{
                  flex: 1,
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: '1px solid rgba(255,255,255,.12)',
                  background: 'transparent',
                  color: 'var(--text-sidebar)',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
              </button>
              <button
                onClick={handleLogout}
                title="Log out"
                style={{
                  flex: 1,
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: '1px solid rgba(255,255,255,.12)',
                  background: 'transparent',
                  color: 'var(--text-sidebar)',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                🚪 Logout
              </button>
            </div>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main
          style={{
            flex: 1,
            overflowY: 'auto',
            background: 'var(--bg-base)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {page === 'dashboard' && <Dashboard {...sharedProps} />}
          {page === 'files' && <FileBrowser {...sharedProps} />}
          {page === 'activity' && <ActivityLog {...sharedProps} />}
          {page === 'storage' && isAdmin && <StorageBackup {...sharedProps} />}
          {page === 'security' && isAdmin && <SecurityDashboard {...sharedProps} />}
        </main>
      </div>

      {/* ── Overlays ── */}
      {showSessionWarning && (
        <SessionWarning
          onExtend={() => {
            lastActivityRef.current = Date.now();
            setShowSessionWarning(false);
          }}
          onLogout={handleLogout}
        />
      )}
      <ToastList toasts={toasts} remove={removeToast} />
      <style>{keyframeStyles}</style>
    </>
  );
}

const keyframeStyles = `
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
`;
