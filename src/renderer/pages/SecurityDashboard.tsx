/**
 * Security Dashboard page (admin only).
 *
 * Shows: active sessions table with terminate button, failed login analysis
 * (last 24 h bar chart), locked accounts quick-unlock panel, and a
 * read-only permission matrix showing what each role can do.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import type { SessionInfo, SafeUser } from '../../shared/types';
import type { AddToast } from '../App';
import { cardStyle, btnStyle } from '../App';

// Permission matrix mirrored from src/main/services/rbac.service.ts.
// These values are intentionally duplicated here so the renderer can render
// the matrix without an IPC round-trip.  If ROLE_PERMISSIONS in rbac.service.ts
// changes, this list must be updated to stay in sync.
const ALL_PERMISSIONS = [
  'change_own_password',
  'user_create', 'user_list', 'user_update', 'user_delete',
  'user_reset_password', 'user_unlock',
  'file_upload', 'file_download', 'file_delete',
  'shelf_create', 'shelf_delete', 'shelf_list',
  'storage_view_quota', 'storage_backup', 'storage_restore',
] as const;

const ADMIN_PERMISSIONS = new Set<string>(ALL_PERMISSIONS);
const STAFF_PERMISSIONS = new Set<string>([
  'change_own_password',
  'file_upload', 'file_download',
  'shelf_list',
  'storage_view_quota',
]);

const PERM_LABELS: Record<string, string> = {
  change_own_password: 'Change Own Password',
  user_create: 'Create Users',
  user_list: 'List Users',
  user_update: 'Update Users',
  user_delete: 'Delete Users',
  user_reset_password: 'Reset Passwords',
  user_unlock: 'Unlock Accounts',
  file_upload: 'Upload Files',
  file_download: 'Download Files',
  file_delete: 'Delete Files',
  shelf_create: 'Create Shelves',
  shelf_delete: 'Delete Shelves',
  shelf_list: 'List Shelves',
  storage_view_quota: 'View Storage Quota',
  storage_backup: 'Backup Database',
  storage_restore: 'Restore Database',
};

function fmtDuration(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface Props {
  sessionId: string;
  user: SafeUser;
  addToast: AddToast;
}

export function SecurityDashboard({ sessionId, addToast }: Props): React.JSX.Element {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [lockedUsers, setLockedUsers] = useState<SafeUser[]>([]);
  const [failedLogins, setFailedLogins] = useState<Array<{ hour: string; count: number }>>([]);
  const [loading, setLoading] = useState(true);

  const loadSessions = useCallback(async () => {
    const res = await window.sccfs.sessions.list(sessionId);
    if (res.ok) setSessions(res.data);
    else addToast('error', res.error?.message ?? 'Failed to load sessions');
  }, [sessionId, addToast]);

  const loadLockedUsers = useCallback(async () => {
    const res = await window.sccfs.users.list(sessionId);
    if (res.ok) {
      setLockedUsers(res.data.filter((u) => !u.is_active));
    }
  }, [sessionId]);

  const loadFailedLogins = useCallback(async () => {
    // Load last 50 activity records filtered by LOGIN_FAILED / ACCOUNT_LOCKED
    const res = await window.sccfs.activity.list(sessionId, {
      action: 'ACCOUNT_LOCKED',
      page: 1,
      pageSize: 100,
    });
    if (res.ok) {
      // Bucket by hour (0–23)
      const buckets = new Array<number>(24).fill(0);
      for (const a of res.data.items) {
        const hour = new Date(a.created_at).getHours();
        buckets[hour]++;
      }
      setFailedLogins(
        buckets.map((count, h) => ({ hour: `${h}:00`, count })),
      );
    }
  }, [sessionId]);

  const load = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadSessions(), loadLockedUsers(), loadFailedLogins()]);
    setLoading(false);
  }, [loadSessions, loadLockedUsers, loadFailedLogins]);

  useEffect(() => {
    load();
    const id = setInterval(loadSessions, 15_000);
    return () => clearInterval(id);
  }, [load, loadSessions]);

  const handleTerminate = async (targetId: string, username: string) => {
    if (!confirm(`Terminate session for "${username}"?`)) return;
    const res = await window.sccfs.sessions.terminate(sessionId, targetId);
    if (res.ok) {
      addToast('success', `Session for "${username}" terminated`);
      loadSessions();
    } else {
      addToast('error', res.error?.message ?? 'Failed');
    }
  };

  const handleUnlock = async (userId: string, username: string) => {
    const res = await window.sccfs.users.unlock(sessionId, userId);
    if (res.ok) {
      addToast('success', `"${username}" unlocked`);
      loadLockedUsers();
    } else {
      addToast('error', res.error?.message ?? 'Failed');
    }
  };

  const now = Date.now();

  return (
    <div style={{ padding: 28 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Security</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
            {sessions.length} active session{sessions.length !== 1 ? 's' : ''} ·{' '}
            {lockedUsers.length} locked account{lockedUsers.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={load} style={btnStyle('secondary', true)}>↺ Refresh</button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
          <div
            style={{
              width: 32, height: 32,
              border: '3px solid var(--border)', borderTopColor: 'var(--accent)',
              borderRadius: '50%', animation: 'spin 0.8s linear infinite',
            }}
          />
        </div>
      ) : (
        <>
          {/* Active sessions */}
          <div style={{ ...cardStyle(), marginBottom: 20, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
                🟢 Active Sessions
              </h2>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Auto-refreshes every 15s
              </span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-hover)', borderBottom: '1px solid var(--border)' }}>
                  {['User', 'Role', 'Started', 'Last Activity', 'Duration', 'Session ID', 'Action'].map((h) => (
                    <th key={h} style={thStyle()}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessions.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)' }}>
                      No active sessions
                    </td>
                  </tr>
                ) : (
                  sessions.map((s) => {
                    const isSelf = s.sessionId === sessionId;
                    return (
                      <tr key={s.sessionId} style={{ borderBottom: '1px solid var(--border)', background: isSelf ? 'var(--bg-active)' : undefined }}>
                        <td style={{ ...tdStyle(), fontWeight: 600 }}>
                          {s.username}
                          {isSelf && (
                            <span style={{ fontSize: 10, background: 'var(--accent)', color: '#fff', borderRadius: 10, padding: '1px 6px', marginLeft: 6 }}>
                              You
                            </span>
                          )}
                        </td>
                        <td style={{ ...tdStyle(), textTransform: 'capitalize', color: 'var(--text-secondary)', fontSize: 12 }}>
                          {s.role}
                        </td>
                        <td style={{ ...tdStyle(), color: 'var(--text-secondary)', fontSize: 12 }}>
                          {fmtTime(s.createdAt)}
                        </td>
                        <td style={{ ...tdStyle(), color: 'var(--text-secondary)', fontSize: 12 }}>
                          {fmtTime(s.lastActivity)}
                        </td>
                        <td style={{ ...tdStyle(), color: 'var(--text-secondary)', fontSize: 12 }}>
                          {fmtDuration(now - s.createdAt)}
                        </td>
                        <td style={{ ...tdStyle(), fontFamily: 'monospace', fontSize: 11, color: 'var(--text-secondary)' }}>
                          {s.sessionId.slice(0, 8)}…
                        </td>
                        <td style={tdStyle()}>
                          {!isSelf && (
                            <button
                              onClick={() => handleTerminate(s.sessionId, s.username)}
                              style={{ ...btnStyle('danger', true), fontSize: 11 }}
                            >
                              Terminate
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Locked accounts + failed logins */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
            {/* Locked accounts */}
            <div style={cardStyle()}>
              <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 14, color: 'var(--text-primary)' }}>
                🔒 Inactive / Locked Accounts
              </h2>
              {lockedUsers.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                  ✓ No locked accounts
                </p>
              ) : (
                lockedUsers.map((u) => (
                  <div
                    key={u.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 0',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <div>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{u.username}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 8 }}>
                        {u.role}
                      </span>
                    </div>
                    <button
                      onClick={() => handleUnlock(u.id, u.username)}
                      style={btnStyle('secondary', true)}
                    >
                      🔓 Unlock
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Failed logins chart */}
            <div style={cardStyle()}>
              <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 14, color: 'var(--text-primary)' }}>
                🚨 Account Lockouts by Hour
              </h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={failedLogins} margin={{ top: 0, right: 0, bottom: 0, left: -25 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    dataKey="hour"
                    tick={{ fontSize: 9, fill: 'var(--text-secondary)' }}
                    tickLine={false}
                    interval={3}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="count" fill="#dc2626" radius={[3, 3, 0, 0]} name="Lockouts" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Permission matrix */}
          <div style={{ ...cardStyle(), padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
                🛡 Permission Matrix
              </h2>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-hover)', borderBottom: '1px solid var(--border)' }}>
                  <th style={thStyle()}>Permission</th>
                  <th style={{ ...thStyle(), textAlign: 'center' }}>Admin</th>
                  <th style={{ ...thStyle(), textAlign: 'center' }}>Staff</th>
                </tr>
              </thead>
              <tbody>
                {ALL_PERMISSIONS.map((perm) => (
                  <tr key={perm} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={tdStyle()}>
                      <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-secondary)' }}>
                        {perm}
                      </span>
                      {PERM_LABELS[perm] && (
                        <span style={{ marginLeft: 8, color: 'var(--text-primary)', fontSize: 12 }}>
                          — {PERM_LABELS[perm]}
                        </span>
                      )}
                    </td>
                    <td style={{ ...tdStyle(), textAlign: 'center' }}>
                      {ADMIN_PERMISSIONS.has(perm)
                        ? <span style={{ color: '#16a34a', fontWeight: 700 }}>✓</span>
                        : <span style={{ color: 'var(--border)' }}>—</span>}
                    </td>
                    <td style={{ ...tdStyle(), textAlign: 'center' }}>
                      {STAFF_PERMISSIONS.has(perm)
                        ? <span style={{ color: '#16a34a', fontWeight: 700 }}>✓</span>
                        : <span style={{ color: 'var(--border)' }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function thStyle(): React.CSSProperties {
  return {
    padding: '10px 16px', textAlign: 'left', fontSize: 11,
    fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
    color: 'var(--text-secondary)',
  };
}

function tdStyle(): React.CSSProperties {
  return { padding: '10px 16px', fontSize: 13 };
}
