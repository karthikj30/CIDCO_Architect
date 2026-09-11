'use client';

import { useCallback, useEffect, useState } from 'react';
import CopyField, { StatusBadge } from '../CopyField';

type Account = {
  id: string;
  username: string;
  passwordPrefix: string;
  status: string;
  credentialExpiresAt: string;
  establishedAt: string | null;
  whitelistedIp: string | null;
  deviceInfo: string | null;
  architect: { id: string; name: string; email: string; firmName: string | null };
  uploadCount: number;
  lastUpload: { receivedAt: string; status: string } | null;
  createdAt: string;
};

type Endpoint = { host: string; port: number; uploadDir: string; fileTypes: string };

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('en-IN') : '—');

export default function SftpAccountsPanel() {
  const [rows, setRows] = useState<Account[]>([]);
  const [endpoint, setEndpoint] = useState<Endpoint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [credential, setCredential] = useState<string | null>(null);
  const [architectEmail, setArchitectEmail] = useState('architect@example.com');
  const [expiresInDays, setExpiresInDays] = useState('30');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/sftp/accounts');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to load');
      setRows(json.data.accounts);
      setEndpoint(json.data.endpoint);
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

  async function issue(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setCredential(null);
    try {
      const res = await fetch('/api/admin/sftp/accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ architectEmail, expiresInDays: Number(expiresInDays) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not issue credentials');
      setCredential(JSON.stringify(json.data.credential, null, 2));
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="w-full space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">SFTP accounts</h2>
        <p className="mt-1 text-sm text-slate-500">
          Issue an architect an SFTP user id and password, then email it to them. Their first connection
          arrives as a handshake request for you to approve — nothing is accepted until you do.
        </p>
      </div>

      {endpoint && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-900">
          <p className="font-semibold">Your SFTP intake</p>
          <p className="mt-1 font-mono text-xs">
            sftp -P {endpoint.port} &lt;user id&gt;@{endpoint.host} · upload {endpoint.fileTypes} into{' '}
            {endpoint.uploadDir}
          </p>
        </div>
      )}

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      <form onSubmit={issue} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">Issue SFTP credentials</h3>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem] flex-1">
            <label htmlFor="sftp-arch" className="mb-1 block text-xs font-medium text-slate-600">
              Architect email
            </label>
            <input
              id="sftp-arch"
              type="email"
              required
              value={architectEmail}
              onChange={(e) => setArchitectEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="sftp-exp" className="mb-1 block text-xs font-medium text-slate-600">
              Valid for (days)
            </label>
            <input
              id="sftp-exp"
              type="number"
              min={1}
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={creating}
            className="rounded-lg bg-violet-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
          >
            {creating ? 'Issuing…' : 'Issue credentials'}
          </button>
        </div>

        {credential && (
          <div className="mt-4 space-y-2">
            <p className="text-sm font-medium text-emerald-800">
              Email this to the architect — the password is shown only once.
            </p>
            <CopyField label="SFTP credentials" value={credential} />
          </div>
        )}
      </form>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">SFTP user id</th>
                <th className="px-5 py-3 font-medium">Architect</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Whitelisted IP</th>
                <th className="px-5 py-3 font-medium">Uploads</th>
                <th className="px-5 py-3 font-medium">Password expires</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                    No SFTP accounts yet. Issue one above.
                  </td>
                </tr>
              ) : (
                rows.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 font-mono text-xs text-slate-700">{a.username}</td>
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-900">{a.architect.name}</p>
                      <p className="text-xs text-slate-500">{a.architect.email}</p>
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={a.status} />
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-600">
                      {a.whitelistedIp ?? <span className="text-slate-400">not registered</span>}
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-600">
                      {a.uploadCount === 0 ? (
                        <span className="text-slate-400">none</span>
                      ) : (
                        <>
                          {a.uploadCount}
                          {a.lastUpload && <span className="text-slate-400"> · last {fmt(a.lastUpload.receivedAt)}</span>}
                        </>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-600">{fmt(a.credentialExpiresAt)}</td>
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
