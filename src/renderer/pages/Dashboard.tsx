/**
 * Dashboard overview page.
 *
 * Shows KPI cards (active sessions, total files, pending uploads, locked accounts,
 * storage usage), a recent activity feed, and a 7-day stacked bar chart of
 * uploads/downloads/failures via Recharts.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
} from 'recharts';
import type { DashboardStats, ActivityRecord } from '../../shared/types';
import type { AddToast } from '../App';
import type { SafeUser } from '../../shared/types';
import { cardStyle } from '../App';

interface Props {
  sessionId: string;
  user: SafeUser;
  addToast: AddToast;
}

// ────────────────────────────────────────
// KPI card
// ────────────────────────────────────────

function KpiCard({
  icon,
  label,
  value,
  subtitle,
  alert,
}: {
  icon: string;
  label: string;
  value: string | number;
  subtitle?: string;
  alert?: boolean;
}) {
  return (
    <div
      style={{
        ...cardStyle(),
        flex: 1,
        minWidth: 160,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {alert && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#dc2626',
          }}
        />
      )}
      <div style={{ fontSize: 24, marginBottom: 8 }}>{icon}</div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: alert ? '#dc2626' : 'var(--text-primary)',
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{label}</div>
      {subtitle && (
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{subtitle}</div>
      )}
    </div>
  );
}

// ────────────────────────────────────────
// Storage bar
// ────────────────────────────────────────

function StorageBar({ used, quota }: { used: number; quota: number }) {
  const pct = quota > 0 ? Math.min(100, (used / quota) * 100) : 0;
  const color = pct >= 95 ? '#dc2626' : pct >= 80 ? '#d97706' : '#4f46e5';
  const fmt = (b: number) => {
    if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
    if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
    return `${(b / 1e3).toFixed(0)} KB`;
  };
  return (
    <div style={{ ...cardStyle(), flex: 1, minWidth: 160 }}>
      <div style={{ fontSize: 24, marginBottom: 8 }}>💾</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color }}>{pct.toFixed(1)}%</div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 10px' }}>
        Storage Used
      </div>
      <div
        style={{
          height: 6,
          background: 'var(--border)',
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: color,
            borderRadius: 3,
            transition: 'width .4s',
          }}
        />
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 }}>
        {fmt(used)} / {fmt(quota)}
      </div>
    </div>
  );
}

// ────────────────────────────────────────
// Helpers
// ────────────────────────────────────────

function fmtTime(ts: string) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(ts: string) {
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const ACTION_COLORS: Record<string, string> = {
  LOGIN: '#16a34a',
  LOGOUT: '#64748b',
  LOGIN_FAILED: '#dc2626',
  ACCOUNT_LOCKED: '#dc2626',
  CHANGE_PASSWORD: '#0284c7',
  FILE_UPLOAD: '#7c3aed',
  FILE_DOWNLOAD: '#0369a1',
  FILE_DELETE: '#b45309',
  USER_CREATE: '#15803d',
  USER_DELETE: '#dc2626',
  UPDATE_USER: '#d97706',
};

// ────────────────────────────────────────
// Dashboard
// ────────────────────────────────────────

export function Dashboard({ sessionId, addToast }: Props): React.JSX.Element {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [storageQuota, setStorageQuota] = useState(500 * 1024 * 1024 * 1024);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [statsRes, storageRes] = await Promise.all([
      window.sccfs.dashboard.stats(sessionId),
      window.sccfs.storage.stats(sessionId),
    ]);
    if (statsRes.ok) {
      setStats(statsRes.data);
    } else {
      addToast('error', statsRes.error?.message ?? 'Failed to load dashboard');
    }
    if (storageRes.ok) {
      setStorageQuota(storageRes.data.quota_bytes);
    }
    setLoading(false);
  }, [sessionId, addToast]);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div
          style={{
            width: 32,
            height: 32,
            border: '3px solid var(--border)',
            borderTopColor: 'var(--accent)',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
      </div>
    );
  }

  if (!stats) return <div />;

  const ops7dFormatted = stats.file_ops_7d.map((d: DashboardStats['file_ops_7d'][number]) => ({
    ...d,
    date: fmtDate(d.date),
  }));

  return (
    <div style={{ padding: 28 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Overview</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
            System health at a glance
          </p>
        </div>
        <button
          onClick={load}
          style={{
            padding: '7px 14px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--bg-surface)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          ↺ Refresh
        </button>
      </div>

      {/* KPI Row */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <KpiCard icon="🟢" label="Active Sessions" value={stats.active_sessions} />
        <KpiCard
          icon="📁"
          label="Total Files"
          value={stats.total_files.toLocaleString()}
          subtitle={fmtBytes(stats.total_size_bytes)}
        />
        <KpiCard
          icon="⏳"
          label="Pending Uploads"
          value={stats.pending_uploads}
          alert={stats.pending_uploads > 0}
        />
        <KpiCard
          icon="🚨"
          label="Failed (24h)"
          value={stats.failed_uploads_24h}
          alert={stats.failed_uploads_24h > 0}
        />
        <KpiCard
          icon="🔒"
          label="Locked Accounts"
          value={stats.locked_accounts}
          alert={stats.locked_accounts > 0}
        />
        <StorageBar used={stats.total_size_bytes} quota={storageQuota} />
      </div>

      {/* Charts + activity row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* 7-day chart */}
        <div style={cardStyle()}>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: 'var(--text-primary)' }}>
            File Operations — Last 7 Days
          </h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={ops7dFormatted} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                tickLine={false}
              />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} tickLine={false} />
              <Tooltip
                contentStyle={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="uploads" fill="#4f46e5" name="Uploads" radius={[3, 3, 0, 0]} />
              <Bar dataKey="downloads" fill="#0284c7" name="Downloads" radius={[3, 3, 0, 0]} />
              <Bar dataKey="failures" fill="#dc2626" name="Failures" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Recent activity */}
        <div style={cardStyle()}>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: 'var(--text-primary)' }}>
            Recent Activity
          </h2>
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            {stats.recent_activity.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: 13, textAlign: 'center', padding: 20 }}>
                No activity yet
              </p>
            ) : (
              stats.recent_activity.map((a: ActivityRecord) => (
                <div
                  key={a.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '8px 0',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: ACTION_COLORS[a.action] ?? 'var(--text-secondary)',
                      background: `${ACTION_COLORS[a.action] ?? '#64748b'}18`,
                      padding: '2px 6px',
                      borderRadius: 4,
                      whiteSpace: 'nowrap',
                      marginTop: 1,
                    }}
                  >
                    {a.action}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--text-primary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {a.detail ?? '—'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>
                      {a.username ?? 'system'} · {fmtTime(a.created_at)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function fmtBytes(b: number): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  return `${(b / 1e3).toFixed(0)} KB`;
}
