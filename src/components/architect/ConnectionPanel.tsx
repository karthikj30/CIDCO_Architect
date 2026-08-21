'use client';

import { useState } from 'react';
import { fmt, relativeTime, type StoredTokens } from './useTokens';
import type { MeData } from './ArchitectWorkspace';

function Badge({ status }: { status: string }) {
  const style: Record<string, string> = {
    PENDING: 'bg-slate-100 text-slate-700 border-slate-200',
    ESTABLISHED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    EXPIRED: 'bg-amber-100 text-amber-800 border-amber-200',
    REVOKED: 'bg-red-100 text-red-800 border-red-200',
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${style[status] ?? style.PENDING}`}>
      {status}
    </span>
  );
}

export default function ConnectionPanel({
  me,
  tokens,
  saveTokens,
  clearTokens,
  reload,
}: {
  me: MeData;
  tokens: StoredTokens;
  saveTokens: (t: StoredTokens) => void;
  clearTokens: () => void;
  reload: () => Promise<void>;
}) {
  const [clientId, setClientId] = useState(tokens.clientId ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [ipAddress, setIpAddress] = useState('');
  const [deviceInfo, setDeviceInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paste, setPaste] = useState('');

  const hs = me.handshakes.find((h) => h.clientId === clientId) ?? me.handshakes[0] ?? null;

  /** Accepts the credential JSON CIDCO emailed and fills the form from it. */
  function applyPaste() {
    setError(null);
    try {
      const j = JSON.parse(paste);
      if (!j.clientId || !j.clientSecret) throw new Error('JSON must contain clientId and clientSecret');
      setClientId(j.clientId);
      setClientSecret(j.clientSecret);
      setNotice('Credential loaded from JSON — now click Validate.');
      setPaste('');
    } catch (err) {
      setError(`Could not read that JSON: ${(err as Error).message}`);
    }
  }

  async function validate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/architect/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId,
          clientSecret,
          ...(ipAddress ? { ipAddress } : {}),
          ...(deviceInfo ? { deviceInfo } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Validation failed');
      const d = json.data;
      saveTokens({
        clientId,
        accessToken: d.accessToken,
        refreshToken: d.refreshToken,
        accessExpiresAt: d.accessTokenExpiresAt,
        refreshExpiresAt: d.refreshTokenExpiresAt,
      });
      setClientSecret('');
      setNotice(
        `Established. Access token valid ${d.expiresInDays} day(s), refresh token ${d.refreshExpiresInDays} day(s). Whitelisted IP: ${d.whitelistedIp ?? 'n/a'}.`,
      );
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    if (!tokens.refreshToken) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/architect/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });
      const json = await res.json();
      if (!res.ok) {
        // 503 BOTH_EXPIRED → the pair is dead, re-validate with credentials.
        throw new Error(json.error ?? 'Refresh failed');
      }
      saveTokens({
        accessToken: json.data.accessToken,
        accessExpiresAt: json.data.accessTokenExpiresAt,
        refreshExpiresAt: json.data.refreshTokenExpiresAt,
      });
      setNotice(`New access token stored, valid ${json.data.expiresInDays} day(s). Your refresh token is unchanged.`);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const accessDead = tokens.accessExpiresAt ? new Date(tokens.accessExpiresAt).getTime() <= Date.now() : false;
  const refreshDead = tokens.refreshExpiresAt ? new Date(tokens.refreshExpiresAt).getTime() <= Date.now() : false;

  return (
    <div className="w-full space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Connection</h2>
        <p className="mt-1 text-sm text-slate-500">
          Validate with the credentials CIDCO sent you. On success CIDCO whitelists your IP/device and
          issues an access token and a refresh token, which this browser stores for you.
        </p>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}

      {/* Current token state */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">Your tokens (this browser)</h3>
          {tokens.accessToken || tokens.refreshToken ? (
            <>
              <dl className="mt-3 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">Access token</dt>
                  <dd className="font-mono text-slate-800">{tokens.accessToken?.slice(0, 18)}…</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">Access expires</dt>
                  <dd className={accessDead ? 'font-semibold text-red-600' : 'text-slate-800'}>
                    {relativeTime(tokens.accessExpiresAt)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">Refresh token</dt>
                  <dd className="font-mono text-slate-800">{tokens.refreshToken?.slice(0, 18)}…</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">Refresh expires</dt>
                  <dd className={refreshDead ? 'font-semibold text-red-600' : 'text-slate-800'}>
                    {relativeTime(tokens.refreshExpiresAt)}
                  </dd>
                </div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={refresh}
                  disabled={busy || !tokens.refreshToken}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  Renew access token
                </button>
                <button
                  onClick={() => { clearTokens(); setNotice('Tokens cleared from this browser.'); }}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Forget tokens
                </button>
              </div>
              {refreshDead && (
                <p className="mt-2 text-xs text-red-700">
                  Your refresh token has expired, so the access token is dead too — validate again with
                  your clientId and clientSecret below.
                </p>
              )}
            </>
          ) : (
            <p className="mt-3 text-sm text-slate-400">
              No tokens yet. Validate below to receive them.
            </p>
          )}
        </div>

        {/* Handshake as CIDCO sees it */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">Handshake status (from CIDCO)</h3>
          {hs ? (
            <dl className="mt-3 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-500">Client ID</dt>
                <dd className="font-mono text-slate-800">{hs.clientId}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-500">Status</dt>
                <dd><Badge status={hs.status} /></dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-500">Whitelisted IP</dt>
                <dd className="font-mono text-slate-800">{hs.whitelistedIp ?? '—'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-500">Device</dt>
                <dd className="max-w-[55%] truncate text-right text-slate-800" title={hs.deviceInfo ?? ''}>{hs.deviceInfo ?? '—'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-500">Credential expires</dt>
                <dd className="text-slate-800">{fmt(hs.credentialExpiresAt)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-500">Token policy</dt>
                <dd className="text-slate-800">{hs.accessTokenTtlDays}d access / {hs.refreshTokenTtlDays}d refresh</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-3 text-sm text-slate-400">CIDCO has not issued you any credentials yet.</p>
          )}
        </div>
      </div>

      {/* Validate */}
      <form onSubmit={validate} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">Validate with CIDCO</h3>
        <p className="mt-1 text-xs text-slate-500">
          Paste the credential JSON CIDCO sent, or type the values in. Your first validate registers
          the IP and device — later calls must come from the same IP.
        </p>

        <div className="mt-3 flex gap-2">
          <input
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder='Paste the credential JSON here, e.g. {"clientId":"ARCH-…","clientSecret":"hs_sec_…"}'
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
          />
          <button type="button" onClick={applyPaste} disabled={!paste.trim()}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Load
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="v-cid" className="mb-1 block text-xs font-medium text-slate-600">Client ID *</label>
            <input id="v-cid" value={clientId} onChange={(e) => setClientId(e.target.value)} required
              placeholder="ARCH-XXXXXXXXXXXX"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500" />
          </div>
          <div>
            <label htmlFor="v-sec" className="mb-1 block text-xs font-medium text-slate-600">Client secret *</label>
            <input id="v-sec" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} required
              placeholder="hs_sec_…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500" />
          </div>
          <div>
            <label htmlFor="v-ip" className="mb-1 block text-xs font-medium text-slate-600">
              IP address <span className="font-normal text-slate-400">(blank = this connection&rsquo;s IP)</span>
            </label>
            <input id="v-ip" value={ipAddress} onChange={(e) => setIpAddress(e.target.value)}
              placeholder="e.g. 203.0.113.9"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500" />
          </div>
          <div>
            <label htmlFor="v-dev" className="mb-1 block text-xs font-medium text-slate-600">
              Device info <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input id="v-dev" value={deviceInfo} onChange={(e) => setDeviceInfo(e.target.value)}
              placeholder="RaspberryPi-4 | station STN-KHR-07"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500" />
          </div>
        </div>

        <button type="submit" disabled={busy}
          className="mt-4 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
          {busy ? 'Validating…' : 'Validate'}
        </button>
      </form>
    </div>
  );
}
