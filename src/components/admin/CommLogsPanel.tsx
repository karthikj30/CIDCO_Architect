'use client';

import { useCallback, useEffect, useState } from 'react';

type Log = {
  id: string;
  direction: string;
  event: string;
  statusCode: number | null;
  detail: string | null;
  createdAt: string;
  handshake: { clientId: string; architect: { name: string; email: string } } | null;
};

const EVENT_STYLE: Record<string, string> = {
  HANDSHAKE_ISSUED: 'bg-slate-100 text-slate-700',
  ARCHITECT_VALIDATED: 'bg-emerald-100 text-emerald-700',
  CHANNEL_ESTABLISHED: 'bg-emerald-100 text-emerald-700',
  VALIDATION_FAILED: 'bg-red-100 text-red-700',
  TOKEN_REQUESTED: 'bg-blue-100 text-blue-700',
  TOKEN_GENERATED: 'bg-cidco-100 text-cidco-700',
  DATA_RECEIVED: 'bg-green-100 text-green-700',
  DATA_REJECTED: 'bg-red-100 text-red-700',
  HANDSHAKE_REVOKED: 'bg-red-100 text-red-700',
};

export default function CommLogsPanel() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/comm-logs?limit=200');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to load');
      setLogs(json.data.logs);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="w-full space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Communication logs</h2>
          <p className="mt-1 text-sm text-slate-500">
            Timestamped trail of every handshake step and data transfer between CIDCO and architects.
          </p>
        </div>
        <button onClick={load} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          Refresh
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Timestamp</th>
                <th className="px-5 py-3 font-medium">Direction</th>
                <th className="px-5 py-3 font-medium">Event</th>
                <th className="px-5 py-3 font-medium">Code</th>
                <th className="px-5 py-3 font-medium">Client / Architect</th>
                <th className="px-5 py-3 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-500">Loading…</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-500">No communication yet.</td></tr>
              ) : (
                logs.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 whitespace-nowrap text-xs text-slate-500">{new Date(l.createdAt).toLocaleString('en-IN')}</td>
                    <td className="px-5 py-3 text-xs">
                      <span className={l.direction === 'ARCHITECT_TO_ADMIN' ? 'text-blue-700' : 'text-slate-600'}>
                        {l.direction === 'ARCHITECT_TO_ADMIN' ? 'Architect → CIDCO' : 'CIDCO → Architect'}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${EVENT_STYLE[l.event] ?? 'bg-slate-100 text-slate-700'}`}>
                        {l.event}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs font-mono text-slate-600">{l.statusCode ?? '—'}</td>
                    <td className="px-5 py-3 text-xs text-slate-600">
                      {l.handshake ? (
                        <>
                          <span className="font-mono">{l.handshake.clientId}</span>
                          <span className="block text-slate-400">{l.handshake.architect.email}</span>
                        </>
                      ) : '—'}
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-600 max-w-md truncate" title={l.detail ?? ''}>{l.detail}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
