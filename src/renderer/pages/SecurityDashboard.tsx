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
import {
  type SessionInfo,
  type SafeUser,
  type SecurityIntegrityStats,
  type SecurityThresholdSettings,
  DEFAULT_SECURITY_THRESHOLD_SETTINGS,
} from '../../shared/types';
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

function fmtDateTime(ts: string): string {
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function backupFreshness(lastBackupAt: string | null): { label: string; color: string } {
  if (!lastBackupAt) return { label: 'No backup yet', color: '#dc2626' };
  const ageMs = Date.now() - new Date(lastBackupAt).getTime();
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  if (ageDays <= 1) return { label: 'Fresh (<24h)', color: '#16a34a' };
  if (ageDays <= 7) return { label: 'Recent (<7d)', color: '#d97706' };
  return { label: 'Stale (>7d)', color: '#dc2626' };
}

interface Props {
  sessionId: string;
  user: SafeUser;
  addToast: AddToast;
}

export function SecurityDashboard({ sessionId, user, addToast }: Props): React.JSX.Element {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [integrity, setIntegrity] = useState<SecurityIntegrityStats | null>(null);
  const [thresholds, setThresholds] = useState<SecurityThresholdSettings>(DEFAULT_SECURITY_THRESHOLD_SETTINGS);
  const [settingsDraft, setSettingsDraft] = useState<SecurityThresholdSettings>(DEFAULT_SECURITY_THRESHOLD_SETTINGS);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadSessions = useCallback(async () => {
    const res = await window.sccfs.sessions.list(sessionId);
    if (res.ok) setSessions(res.data);
    else addToast('error', res.error?.message ?? 'Failed to load sessions');
  }, [sessionId, addToast]);

  const loadIntegrity = useCallback(async () => {
    const res = await window.sccfs.dashboard.securityIntegrityStats(sessionId);
    if (res.ok) setIntegrity(res.data);
    else addToast('error', res.error?.message ?? 'Failed to load integrity metrics');
  }, [sessionId, addToast]);

  const loadThresholds = useCallback(async () => {
    setSettingsLoading(true);
    const res = await window.sccfs.dashboard.getSecurityThresholdSettings(sessionId);
    setSettingsLoading(false);
    if (!res.ok) {
      addToast('error', res.error?.message ?? 'Failed to load threshold settings');
      return;
    }
    setThresholds(res.data);
    setSettingsDraft(res.data);
  }, [sessionId, addToast]);

  const load = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadSessions(), loadIntegrity(), loadThresholds()]);
    setLoading(false);
  }, [loadSessions, loadIntegrity, loadThresholds]);

  useEffect(() => {
    load();
    const id = setInterval(() => {
      void Promise.all([loadSessions(), loadIntegrity()]);
    }, 20_000);
    return () => clearInterval(id);
  }, [load, loadSessions, loadIntegrity]);

  const handleSaveThresholds = async () => {
    if (settingsDraft.storage_warn_percent >= settingsDraft.storage_danger_percent) {
      addToast('error', 'Storage warning threshold must be lower than danger threshold.');
      return;
    }
    if (settingsDraft.upload_fail_warn_24h > settingsDraft.upload_fail_danger_24h) {
      addToast('error', 'Upload warning threshold must not exceed danger threshold.');
      return;
    }

    setSettingsSaving(true);
    const res = await window.sccfs.dashboard.setSecurityThresholdSettings(sessionId, settingsDraft);
    setSettingsSaving(false);
    if (!res.ok) {
      addToast('error', res.error?.message ?? 'Failed to save threshold settings');
      return;
    }
    setThresholds(res.data);
    setSettingsDraft(res.data);
    addToast('success', 'Security threshold settings saved.');
  };

  const handleResetThresholds = () => {
    setSettingsDraft(DEFAULT_SECURITY_THRESHOLD_SETTINGS);
  };

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

  const now = Date.now();
  const backupStatus = backupFreshness(integrity?.last_backup_at ?? null);

  const failedUploadTone: 'good' | 'warn' | 'danger' = !integrity
    ? 'good'
    : integrity.failed_uploads_24h >= thresholds.upload_fail_danger_24h
      ? 'danger'
      : integrity.failed_uploads_24h >= thresholds.upload_fail_warn_24h
        ? 'warn'
        : 'good';

  const storageTone: 'good' | 'warn' | 'danger' = !integrity
    ? 'good'
    : integrity.storage_used_percent >= thresholds.storage_danger_percent
      ? 'danger'
      : integrity.storage_used_percent >= thresholds.storage_warn_percent
        ? 'warn'
        : 'good';

  return (
    <div style={{ padding: 28 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Security</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
            {integrity ? `${integrity.failed_uploads_7d} failed uploads (7d)` : 'Loading integrity metrics...'}
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
          {/* Integrity overview */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 20 }}>
            <MetricCard
              label="Failed Uploads (24h)"
              value={integrity ? String(integrity.failed_uploads_24h) : '—'}
              subtitle={integrity ? `${integrity.failed_uploads_7d} in last 7 days` : 'Loading...'}
              tone={failedUploadTone}
            />
            <MetricCard
              label="Storage Risk"
              value={integrity ? `${integrity.storage_used_percent.toFixed(1)}%` : '—'}
              subtitle={integrity ? `${Math.round(integrity.storage_used_percent) >= thresholds.storage_danger_percent ? 'High utilization' : 'Within range'}` : 'Loading...'}
              tone={storageTone}
            />
            <MetricCard
              label="Backup Freshness"
              value={backupStatus.label}
              subtitle={integrity?.last_backup_at ? `Last backup: ${fmtDateTime(integrity.last_backup_at)}` : 'Create first backup'}
              tone={backupStatus.color === '#16a34a' ? 'good' : backupStatus.color === '#d97706' ? 'warn' : 'danger'}
            />
            {user.role === 'admin' && (
              <MetricCard
                label="Auth Threat Events"
                value={integrity ? String(integrity.lockout_events_24h) : '—'}
                subtitle="Account locked + login fails (24h)"
                tone={integrity && integrity.lockout_events_24h === 0 ? 'good' : 'danger'}
              />
            )}
          </div>

          {/* Threshold settings */}
          <div style={{ ...cardStyle(), marginBottom: 20 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 14, color: 'var(--text-primary)' }}>
              🎚 Security Severity Thresholds
            </h2>
              {settingsLoading ? (
                <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Loading settings...</p>
              ) : (
                <>
                  <label style={labelStyle}>Storage warning %</label>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={settingsDraft.storage_warn_percent}
                    onChange={(e) => setSettingsDraft((prev) => ({ ...prev, storage_warn_percent: Number(e.target.value) || 0 }))}
                    style={inputStyle}
                  />

                  <label style={labelStyle}>Storage danger %</label>
                  <input
                    type="number"
                    min={2}
                    max={100}
                    value={settingsDraft.storage_danger_percent}
                    onChange={(e) => setSettingsDraft((prev) => ({ ...prev, storage_danger_percent: Number(e.target.value) || 0 }))}
                    style={inputStyle}
                  />

                  <label style={labelStyle}>Upload failures warning (24h)</label>
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    value={settingsDraft.upload_fail_warn_24h}
                    onChange={(e) => setSettingsDraft((prev) => ({ ...prev, upload_fail_warn_24h: Number(e.target.value) || 0 }))}
                    style={inputStyle}
                  />

                  <label style={labelStyle}>Upload failures danger (24h)</label>
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    value={settingsDraft.upload_fail_danger_24h}
                    onChange={(e) => setSettingsDraft((prev) => ({ ...prev, upload_fail_danger_24h: Number(e.target.value) || 0 }))}
                    style={{ ...inputStyle, marginBottom: 12 }}
                  />

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={handleSaveThresholds} disabled={settingsSaving} style={btnStyle('primary', true)}>
                      {settingsSaving ? 'Saving…' : 'Save Thresholds'}
                    </button>
                    <button onClick={handleResetThresholds} style={btnStyle('secondary', true)}>
                      Reset Defaults
                    </button>
                  </div>
                </>
              )}
            </div>

          <div style={{ marginBottom: 20 }}>
            {/* Lockout chart */}
            <div style={cardStyle()}>
              <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 14, color: 'var(--text-primary)' }}>
                🚨 Auth Threat Activity by Hour (24h)
              </h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={integrity?.threat_activity_by_hour ?? []} margin={{ top: 0, right: 0, bottom: 0, left: -25 }}>
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
                  <Bar dataKey="count" fill="#dc2626" radius={[3, 3, 0, 0]} name="Threat events" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: integrity && integrity.upload_failures_by_reason.length > 0 ? '1fr 1fr' : '1fr', gap: 20 }}>
            {integrity && integrity.upload_failures_by_reason.length > 0 && (
              <div style={cardStyle()}>
                <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 14, color: 'var(--text-primary)' }}>
                  Upload Failure Breakdown (7d)
                </h2>
                <div style={{ display: 'grid', gap: 8 }}>
                  {integrity.upload_failures_by_reason.map((row) => (
                    <div key={row.reason} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{row.reason}</span>
                      <strong style={{ color: 'var(--text-primary)' }}>{row.count}</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={cardStyle()}>
              <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 14, color: 'var(--text-primary)' }}>
                Critical Security Events
              </h2>
              {integrity && integrity.critical_events.length > 0 ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  {integrity.critical_events.map((event) => (
                    <div key={event.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <strong style={{ fontSize: 12, color: 'var(--text-primary)' }}>{event.action}</strong>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{fmtDateTime(event.created_at)}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{event.detail ?? '—'}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>No recent critical security events.</p>
              )}
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

function MetricCard(
  {
    label,
    value,
    subtitle,
    tone,
  }: {
    label: string;
    value: string;
    subtitle: string;
    tone: 'good' | 'warn' | 'danger';
  },
): React.JSX.Element {
  const toneMap: Record<'good' | 'warn' | 'danger', { fg: string; bg: string }> = {
    good: { fg: '#15803d', bg: '#f0fdf4' },
    warn: { fg: '#b45309', bg: '#fffbeb' },
    danger: { fg: '#b91c1c', bg: '#fef2f2' },
  };
  return (
    <div style={{ ...cardStyle(), padding: 14 }}>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>{value}</div>
      <div style={{
        fontSize: 11,
        color: toneMap[tone].fg,
        background: toneMap[tone].bg,
        borderRadius: 6,
        padding: '4px 8px',
        display: 'inline-block',
      }}>
        {subtitle}
      </div>
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
