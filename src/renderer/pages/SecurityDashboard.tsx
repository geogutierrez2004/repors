/**
 * Security Dashboard page.
 *
 * Shows active sessions, account lockout activity, and password controls
 * relevant to the single-user security model.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import type { SessionInfo, SafeUser } from '../../shared/types';
import type { AddToast } from '../App';
import { cardStyle, btnStyle } from '../App';

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
  const [lockoutByHour, setLockoutByHour] = useState<Array<{ hour: string; count: number }>>([]);
  const [lockoutEvents, setLockoutEvents] = useState(0);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadSessions = useCallback(async () => {
    const res = await window.sccfs.sessions.list(sessionId);
    if (res.ok) setSessions(res.data);
    else addToast('error', res.error?.message ?? 'Failed to load sessions');
  }, [sessionId, addToast]);

  const loadLockoutActivity = useCallback(async () => {
    const res = await window.sccfs.activity.list(sessionId, {
      action: 'ACCOUNT_LOCKED',
      page: 1,
      pageSize: 100,
    });
    if (res.ok) {
      const buckets = new Array<number>(24).fill(0);
      for (const a of res.data.items) {
        const hour = new Date(a.created_at).getHours();
        buckets[hour]++;
      }
      setLockoutByHour(
        buckets.map((count, h) => ({ hour: `${h}:00`, count })),
      );
      setLockoutEvents(res.data.total);
    }
  }, [sessionId]);

  const load = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadSessions(), loadLockoutActivity()]);
    setLoading(false);
  }, [loadSessions, loadLockoutActivity]);

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

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      addToast('error', 'New password and confirmation do not match');
      return;
    }
    setPasswordLoading(true);
    const res = await window.sccfs.auth.changePassword(sessionId, currentPassword, newPassword);
    setPasswordLoading(false);
    if (res.ok) {
      addToast('success', 'Password updated');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } else {
      addToast('error', res.error?.message ?? 'Failed');
    }
  };

  const now = Date.now();
  const currentSession = sessions.find((s) => s.sessionId === sessionId);

  return (
    <div style={{ padding: 28 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Security</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
            {sessions.length} active session{sessions.length !== 1 ? 's' : ''} ·{' '}
            {lockoutEvents} lockout event{lockoutEvents !== 1 ? 's' : ''}
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
                  {['User', 'Started', 'Last Activity', 'Duration', 'Session ID', 'Action'].map((h) => (
                    <th key={h} style={thStyle()}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessions.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)' }}>
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

          {/* Password + lockout activity */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
            {/* Password change */}
            <div style={cardStyle()}>
              <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 14, color: 'var(--text-primary)' }}>
                🔑 Change Password
              </h2>
              <label style={labelStyle}>Current password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                style={inputStyle}
              />
              <label style={labelStyle}>New password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                style={inputStyle}
              />
              <label style={labelStyle}>Confirm new password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                style={{ ...inputStyle, marginBottom: 12 }}
              />
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 12 }}>
                Min 8 chars · uppercase · lowercase · digit · special character
              </p>
              <button
                onClick={handleChangePassword}
                disabled={passwordLoading}
                style={btnStyle('primary', true)}
              >
                {passwordLoading ? 'Saving…' : 'Update Password'}
              </button>
            </div>

            {/* Lockout chart */}
            <div style={cardStyle()}>
              <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 14, color: 'var(--text-primary)' }}>
                🚨 Account Lockouts by Hour
              </h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={lockoutByHour} margin={{ top: 0, right: 0, bottom: 0, left: -25 }}>
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

          <div style={cardStyle()}>
            <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 14, color: 'var(--text-primary)' }}>
              ✅ Current Security Status
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <StatusItem label="Session status" value={currentSession ? 'Active' : 'Expired'} />
              <StatusItem label="Session ID" value={currentSession ? `${currentSession.sessionId.slice(0, 8)}…` : 'N/A'} />
              <StatusItem label="Session started" value={currentSession ? fmtTime(currentSession.createdAt) : 'N/A'} />
              <StatusItem label="Last activity" value={currentSession ? fmtTime(currentSession.lastActivity) : 'N/A'} />
            </div>
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

function StatusItem({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>{value}</div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-secondary)',
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  fontSize: 13,
  marginBottom: 10,
};
