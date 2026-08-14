'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import CopyField, { StatusBadge } from './CopyField';
import HandshakeTimeline from './HandshakeTimeline';

type Handshake = {
  id: string;
  clientId: string;
  secretPrefix: string;
  status: string;
  credentialExpiresAt: string;
  establishedAt: string | null;
  architect: { name: string; email: string; firmName: string | null };
  tokenCount: number;
  tokenRequestCount: number;
  activeToken: { prefix: string; expiresAt: string } | null;
  createdAt: string;
};

function fmt(d: string | null) {
  return d ? new Date(d).toLocaleString('en-IN') : '—';
}

export default function HandshakesPanel() {
  const [rows, setRows] = useState<Handshake[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // create form
  const [architectEmail, setArchitectEmail] = useState('architect@example.com');
  const [expiresInDays, setExpiresInDays] = useState('30');
  const [creating, setCreating] = useState(false);
  const [credential, setCredential] = useState<string | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/handshakes');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to load');
      setRows(json.data.handshakes);
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

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setCredential(null);
    try {
      const res = await fetch('/api/admin/handshakes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ architectEmail, expiresInDays: Number(expiresInDays) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to issue credentials');
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
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Architect handshakes</h2>
        <p className="mt-1 text-sm text-slate-500">
          Issue credentials to an architect, then watch the handshake move to ESTABLISHED once they
          validate. Generate API tokens for established handshakes.
        </p>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      {/* Issue new credentials */}
      <form onSubmit={create} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">Issue new handshake credentials</h3>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <label htmlFor="hs-email" className="mb-1 block text-sm font-medium text-slate-700">Architect email</label>
            <input
              id="hs-email"
              type="email"
              value={architectEmail}
              onChange={(e) => setArchitectEmail(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cidco-500 focus:ring-1 focus:ring-cidco-500"
            />
          </div>
          <div className="w-40">
            <label htmlFor="hs-days" className="mb-1 block text-sm font-medium text-slate-700">Credential expiry (days)</label>
            <input
              id="hs-days"
              type="number"
              min={1}
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cidco-500 focus:ring-1 focus:ring-cidco-500"
            />
          </div>
          <button
            type="submit"
            disabled={creating}
            className="rounded-lg bg-cidco-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-cidco-700 disabled:opacity-50"
          >
            {creating ? 'Issuing…' : 'Issue credentials'}
          </button>
        </div>

        {credential && (
          <div className="mt-4 space-y-2">
            <p className="text-sm font-medium text-emerald-800">
              Send this JSON to the architect — the secret is shown only once.
            </p>
            <CopyField label="Credential payload" value={credential} />
          </div>
        )}
      </form>

      {/* Handshake list */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Client ID</th>
                <th className="px-5 py-3 font-medium">Architect</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Active token</th>
                <th className="px-5 py-3 font-medium">Credential expiry</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && rows.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-500">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-500">No handshakes yet. Issue one above.</td></tr>
              ) : (
                rows.map((h) => (
                  <Fragment key={h.id}>
                    <tr className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-mono text-xs text-slate-700">{h.clientId}</td>
                      <td className="px-5 py-3">
                        <p className="font-medium text-slate-900">{h.architect.name}</p>
                        <p className="text-xs text-slate-500">{h.architect.email}</p>
                      </td>
                      <td className="px-5 py-3"><StatusBadge status={h.status} /></td>
                      <td className="px-5 py-3 text-xs text-slate-600">
                        {h.activeToken ? (
                          <span className="font-mono">{h.activeToken.prefix}… <span className="text-slate-400">exp {fmt(h.activeToken.expiresAt)}</span></span>
                        ) : (
                          <span className="text-slate-400">none</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-600">{fmt(h.credentialExpiresAt)}</td>
                      <td className="px-5 py-3 text-right">
                        <button
                          onClick={() => setOpenId(openId === h.id ? null : h.id)}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          {openId === h.id ? 'Close' : 'Manage'}
                        </button>
                      </td>
                    </tr>
                    {openId === h.id && (
                      <tr>
                        <td colSpan={6} className="bg-slate-50 px-5 py-4">
                          <HandshakeDetail handshakeId={h.id} clientId={h.clientId} onChanged={load} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// --- Detail / management for one handshake ---------------------------------

type Detail = {
  status: string;
  establishedAt: string | null;
  architectValidatedAt: string | null;
  credentialExpiresAt: string;
  tokens: Array<{ id: string; prefix: string; expiresAt: string; revokedAt: string | null; lastUsedAt: string | null; active: boolean }>;
  tokenRequests: Array<{ id: string; status: string; reason: string | null; requestedAt: string }>;
  commLogs: Array<{ id: string; direction: string; event: string; statusCode: number | null; detail: string | null; ip: string | null; createdAt: string }>;
};

function HandshakeDetail({ handshakeId, clientId, onChanged }: { handshakeId: string; clientId: string; onChanged: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState('');
  const [tokenDays, setTokenDays] = useState('7');
  const [busy, setBusy] = useState(false);
  const [freshToken, setFreshToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/handshakes/${handshakeId}`);
    const json = await res.json();
    if (res.ok) setDetail(json.data.handshake);
  }, [handshakeId]);

  useEffect(() => { void load(); }, [load]);

  async function generateToken(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFreshToken(null);
    try {
      const res = await fetch(`/api/admin/handshakes/${handshakeId}/tokens`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret: secret, expiresInDays: Number(tokenDays) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Token generation failed');
      setFreshToken(json.data.token.token);
      setSecret('');
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!confirm('Revoke this handshake and invalidate all its tokens?')) return;
    setBusy(true);
    try {
      await fetch(`/api/admin/handshakes/${handshakeId}/revoke`, { method: 'POST' });
      await load();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  if (!detail) return <p className="text-sm text-slate-500">Loading detail…</p>;

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Generate token */}
        <form onSubmit={generateToken} className="rounded-lg border border-slate-200 bg-white p-4">
          <h4 className="text-sm font-semibold text-slate-900">Generate API token</h4>
          <p className="mt-1 text-xs text-slate-500">
            Requires the handshake to be ESTABLISHED. Paste the clientSecret you issued to mint a
            token (default 7-day expiry).
          </p>
          <div className="mt-3 space-y-2">
            <input value={clientId} readOnly className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600" />
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Paste clientSecret (hs_sec_…)"
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cidco-500 focus:ring-1 focus:ring-cidco-500"
            />
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={tokenDays}
                onChange={(e) => setTokenDays(e.target.value)}
                className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <span className="text-xs text-slate-500">days</span>
              <button
                type="submit"
                disabled={busy || detail.status !== 'ESTABLISHED'}
                className="ml-auto rounded-lg bg-cidco-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cidco-700 disabled:opacity-50"
              >
                Generate
              </button>
            </div>
            {detail.status !== 'ESTABLISHED' && (
              <p className="text-xs text-amber-700">Waiting for the architect to validate — status is {detail.status}.</p>
            )}
          </div>
          {freshToken && (
            <div className="mt-3">
              <CopyField label="API token (shown once)" value={freshToken} />
            </div>
          )}
        </form>

        {/* Summary + tokens */}
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-900">Tokens</h4>
            <button onClick={revoke} disabled={busy} className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">
              Revoke handshake
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500">Validated {fmt(detail.architectValidatedAt)} · established {fmt(detail.establishedAt)}</p>
          <div className="mt-2 space-y-1">
            {detail.tokens.length === 0 && <p className="text-xs text-slate-400">No tokens yet.</p>}
            {detail.tokens.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded border border-slate-100 px-2 py-1 text-xs">
                <span className="font-mono text-slate-700">{t.prefix}…</span>
                <span className={t.active ? 'text-emerald-700' : 'text-slate-400'}>
                  {t.revokedAt ? 'revoked' : t.active ? `active · exp ${fmt(t.expiresAt)}` : `expired ${fmt(t.expiresAt)}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Full activity timeline for this handshake */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold text-slate-900">Handshake activity</h4>
            <p className="text-xs text-slate-500">Everything that happened, oldest first.</p>
          </div>
          <button
            onClick={() => load()}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>
        <div className="max-h-96 overflow-auto pr-1">
          <HandshakeTimeline logs={detail.commLogs} />
        </div>
      </div>
    </div>
  );
}
