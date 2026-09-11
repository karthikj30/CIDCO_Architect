'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBadge } from '../CopyField';

type Req = {
  id: string;
  status: string;
  presentedIp: string | null;
  deviceInfo: string | null;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  handshake: {
    id: string;
    clientId: string;
    status: string;
    whitelistedIp: string | null;
    credentialExpiresAt: string;
    architect: { id: string; name: string; email: string; firmName: string | null; councilRegNo: string | null };
  };
};

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('en-IN') : '—');

export default function SftpRequestsPanel() {
  const [rows, setRows] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/sftp/validation-requests');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to load');
      setRows(json.data.requests);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A handshake request can arrive at any moment, so keep the queue live.
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (live) timer.current = setInterval(() => void load(), 5000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [live, load]);

  async function decide(id: string, action: 'approve' | 'reject') {
    const note = action === 'reject' ? prompt('Reason for rejection (kept on the record):') ?? undefined : undefined;
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/sftp/validation-requests/${id}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(note ? { reviewNote: note } : {}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Action failed');
      setNotice(json.data.message);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const pending = rows.filter((r) => r.status === 'PENDING');

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">SFTP handshake requests</h2>
          <p className="mt-1 text-sm text-slate-500">
            An architect connected to the SFTP server with the user id and password you emailed them.
            Their credentials verified — check who they are and where the connection came from, then
            approve to open the channel. Until you do, the server refuses every session.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} className="rounded border-slate-300" />
            Live
          </label>
          <button onClick={load} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}

      {pending.length > 0 && (
        <p className="text-sm font-medium text-violet-800">
          {pending.length} handshake request{pending.length === 1 ? '' : 's'} awaiting your approval.
        </p>
      )}

      {loading && rows.length === 0 ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          No handshake requests yet. One appears here the moment an architect first connects to the
          SFTP server with the credentials you issued.
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map((r) => {
            const isPending = r.status === 'PENDING';
            return (
              <div
                key={r.id}
                className={`rounded-xl border p-5 shadow-sm ${isPending ? 'border-violet-300 bg-violet-50' : 'border-slate-200 bg-white'}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={r.status} />
                  <span className="font-mono text-xs text-slate-600">{r.handshake.clientId}</span>
                  <span className="ml-auto text-xs text-slate-400">{fmt(r.createdAt)}</span>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Architect</p>
                    <p className="mt-1 text-sm font-medium text-slate-900">{r.handshake.architect.name}</p>
                    <p className="text-xs text-slate-500">{r.handshake.architect.email}</p>
                    {r.handshake.architect.firmName && <p className="text-xs text-slate-500">{r.handshake.architect.firmName}</p>}
                    {r.handshake.architect.councilRegNo && (
                      <p className="text-xs text-slate-400">COA {r.handshake.architect.councilRegNo}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Connected from</p>
                    <p className="mt-1 font-mono text-sm text-slate-900">{r.presentedIp ?? '—'}</p>
                    {r.handshake.whitelistedIp && r.handshake.whitelistedIp !== r.presentedIp && (
                      <p className="mt-0.5 text-xs text-amber-700">Already whitelisted: {r.handshake.whitelistedIp}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">SSH client</p>
                    <p className="mt-1 text-sm text-slate-900">{r.deviceInfo ?? '—'}</p>
                  </div>
                </div>

                {isPending ? (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => decide(r.id, 'approve')}
                      disabled={busyId === r.id}
                      className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                    >
                      {busyId === r.id ? 'Working…' : 'Approve & open the channel'}
                    </button>
                    <button
                      onClick={() => decide(r.id, 'reject')}
                      disabled={busyId === r.id}
                      className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                    >
                      Reject
                    </button>
                    <span className="text-xs text-slate-500">
                      Approving whitelists {r.presentedIp ?? 'this address'} for uploads
                    </span>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-slate-500">
                    {r.status === 'APPROVED' ? 'Approved' : 'Rejected'} {fmt(r.reviewedAt)}
                    {r.reviewNote ? ` — ${r.reviewNote}` : ''}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
