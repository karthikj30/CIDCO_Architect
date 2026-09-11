'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Row = {
  id: string;
  fileName: string;
  sizeBytes: number;
  status: string;
  sheetName: string | null;
  rowCount: number;
  importedCount: number;
  failedCount: number;
  sourceIp: string | null;
  receivedAt: string;
  parsedAt: string | null;
  handshake: {
    id: string;
    clientId: string;
    architect: { id: string; name: string; email: string; firmName: string | null };
  };
};

type Detail = Row & {
  storedName: string;
  columns: Array<{ label: string; key: string }>;
  rows: Array<Record<string, unknown>>;
  errors: Array<{ row: number; error: string }>;
  handshake: Row['handshake'] & { whitelistedIp: string | null };
};

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('en-IN') : '—');
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

const UPLOAD_STATUS: Record<string, string> = {
  RECEIVED: 'bg-slate-100 text-slate-700 border-slate-200',
  PARSED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  PARTIAL: 'bg-amber-100 text-amber-800 border-amber-200',
  FAILED: 'bg-red-100 text-red-800 border-red-200',
};

function UploadBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
        UPLOAD_STATUS[status] ?? 'bg-slate-100 text-slate-700 border-slate-200'
      }`}
    >
      {status}
    </span>
  );
}

/** Renders whatever a sheet cell held, without pretending to know its type. */
function cell(value: unknown) {
  if (value === null || value === undefined || value === '') return <span className="text-slate-300">—</span>;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function SftpUploadsPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/sftp/uploads');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to load');
      setRows(json.data.uploads);
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

  // Uploads arrive over SFTP, outside the browser, so poll for new ones.
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (live) timer.current = setInterval(() => void load(), 5000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [live, load]);

  const open = useCallback(async (id: string) => {
    if (openId === id) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(id);
    setDetail(null);
    try {
      const res = await fetch(`/api/admin/sftp/uploads/${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to load the sheet');
      setDetail(json.data.upload);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [openId]);

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Delivered workbooks</h2>
          <p className="mt-1 text-sm text-slate-500">
            Every Excel sheet architects have uploaded over SFTP. Open one to preview the sheet exactly
            as it arrived, alongside what CIDCO stored from it.
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

      {loading && rows.length === 0 ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          Nothing delivered yet. Workbooks appear here the moment an architect uploads one to the SFTP
          server.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((u) => (
            <div key={u.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center gap-3 p-5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{u.fileName}</span>
                    <UploadBadge status={u.status} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {u.handshake.architect.name} · <span className="font-mono">{u.handshake.clientId}</span> ·{' '}
                    {kb(u.sizeBytes)} · from {u.sourceIp ?? 'unknown'} · {fmt(u.receivedAt)}
                  </p>
                </div>
                <div className="text-right text-xs text-slate-600">
                  <p>
                    <span className="font-semibold text-slate-900">{u.importedCount}</span> of {u.rowCount} rows stored
                  </p>
                  {u.failedCount > 0 && <p className="text-amber-700">{u.failedCount} rejected</p>}
                </div>
                <button
                  onClick={() => open(u.id)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {openId === u.id ? 'Close' : 'Preview sheet'}
                </button>
              </div>

              {openId === u.id && (
                <div className="border-t border-slate-200 bg-slate-50 p-5">
                  {!detail ? (
                    <p className="text-sm text-slate-500">Loading the sheet…</p>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-600">
                        <span>
                          Sheet: <span className="font-medium text-slate-900">{detail.sheetName ?? '—'}</span>
                        </span>
                        <span>
                          Stored as <span className="font-mono">{detail.storedName}</span>
                        </span>
                        <span>Parsed {fmt(detail.parsedAt)}</span>
                      </div>

                      {detail.errors.length > 0 && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                            Rows CIDCO could not store
                          </p>
                          <ul className="mt-2 space-y-1 text-xs text-amber-900">
                            {detail.errors.map((e) => (
                              <li key={e.row}>
                                <span className="font-semibold">Row {e.row}</span> — {e.error}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {detail.rows.length === 0 ? (
                        <p className="text-sm text-slate-500">The sheet had no data rows.</p>
                      ) : (
                        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                          <table className="w-full text-left text-xs">
                            <thead className="border-b border-slate-200 bg-slate-50 uppercase tracking-wide text-slate-500">
                              <tr>
                                <th className="whitespace-nowrap px-3 py-2 font-medium">Row</th>
                                {detail.columns.map((c) => (
                                  <th key={c.key} className="whitespace-nowrap px-3 py-2 font-medium">
                                    {c.label}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {detail.rows.map((row, i) => {
                                const rowNo = i + 2;
                                const bad = detail.errors.some((e) => e.row === rowNo);
                                return (
                                  <tr key={rowNo} className={bad ? 'bg-amber-50' : 'hover:bg-slate-50'}>
                                    <td className="whitespace-nowrap px-3 py-2 text-slate-400">{rowNo}</td>
                                    {detail.columns.map((c) => (
                                      <td key={c.key} className="whitespace-nowrap px-3 py-2 text-slate-800">
                                        {cell(row[c.key])}
                                      </td>
                                    ))}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
