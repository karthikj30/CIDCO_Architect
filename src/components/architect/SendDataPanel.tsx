'use client';

import { useState } from 'react';
import type { StoredTokens } from './useTokens';

const BLANK = {
  projectSiteId: 'CIDCO-KHR-012',
  monitoringStationId: 'STN-KHR-07',
  oem: 'Aeroqual',
  deviceModel: 'AQY-1',
  aqiValue: '168',
  pm25: '72.1',
  pm10: '150.4',
  no2: '41.2',
  so2: '12.7',
  co: '0.9',
  ozone: '48.6',
  temperature: '33.4',
  humidity: '62.1',
};

export default function SendDataPanel({
  tokens,
  reload,
}: {
  tokens: StoredTokens;
  reload: () => Promise<void>;
}) {
  const [form, setForm] = useState({ ...BLANK });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; status: number; body: unknown } | null>(null);

  function set(k: keyof typeof BLANK) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, [k]: e.target.value }));
  }

  function payload() {
    const body: Record<string, unknown> = { measuredAt: new Date().toISOString() };
    for (const [k, v] of Object.entries(form)) if (v !== '') body[k] = v;
    body.integrationMethod = 'Architect portal';
    return body;
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/architect/data', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${tokens.accessToken ?? ''}`,
        },
        body: JSON.stringify(payload()),
      });
      const body = await res.json();
      setResult({ ok: res.ok, status: res.status, body });
      if (res.ok) await reload();
    } catch (err) {
      setResult({ ok: false, status: 0, body: { error: (err as Error).message } });
    } finally {
      setBusy(false);
    }
  }

  const detail = (result?.body as { details?: { reason?: string; action?: string } })?.details;

  return (
    <div className="w-full space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Send AQI data</h2>
        <p className="mt-1 text-sm text-slate-500">
          Posts one reading to <code className="rounded bg-slate-100 px-1 text-xs">POST /api/architect/data</code> with
          your access token — the same call your station makes every 3 hours.
        </p>
      </div>

      {!tokens.accessToken && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You have no access token yet. Validate on the <strong>Connection</strong> tab first.
        </div>
      )}

      <form onSubmit={send} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {(
            [
              ['projectSiteId', 'Project / Site ID'],
              ['monitoringStationId', 'Station / Device ID'],
              ['oem', 'OEM'],
              ['deviceModel', 'Model'],
              ['aqiValue', 'AQI value *'],
              ['pm25', 'PM2.5'],
              ['pm10', 'PM10'],
              ['no2', 'NO₂'],
              ['so2', 'SO₂'],
              ['co', 'CO'],
              ['ozone', 'O₃'],
              ['temperature', 'Temperature °C'],
              ['humidity', 'Humidity %'],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <label htmlFor={`sd-${key}`} className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
              <input
                id={`sd-${key}`}
                value={form[key]}
                onChange={set(key)}
                required={key === 'aqiValue'}
                className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              />
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          <strong>Date &amp; time of reading</strong> is stamped as &ldquo;now&rdquo; on send; CIDCO adds the data-receipt timestamp.
        </p>
        <button type="submit" disabled={busy || !tokens.accessToken}
          className="mt-4 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
          {busy ? 'Sending…' : 'Send reading'}
        </button>
      </form>

      {result && (
        <div className={`rounded-xl border p-5 shadow-sm ${result.ok ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
          <div className="flex items-center gap-2">
            <span className={`rounded px-2 py-0.5 font-mono text-xs font-bold ${result.ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
              {result.status}
            </span>
            <span className={`text-sm font-semibold ${result.ok ? 'text-emerald-900' : 'text-red-900'}`}>
              {result.ok ? 'Stored by CIDCO' : (result.body as { error?: string })?.error ?? 'Rejected'}
            </span>
          </div>

          {/* CASE 2 / CASE 3 guidance straight from the API */}
          {detail?.action && (
            <p className="mt-2 text-sm text-red-900">
              <strong>{detail.reason}</strong> — next step: {detail.action}
              {detail.reason === 'ACCESS_EXPIRED' && ' (use “Renew access token” on the Connection tab)'}
              {detail.reason === 'BOTH_EXPIRED' && ' (re-validate on the Connection tab)'}
            </p>
          )}

          <pre className="mt-3 max-h-56 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
            {JSON.stringify(result.body, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
