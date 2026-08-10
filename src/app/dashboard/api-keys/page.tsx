'use client';

import { useCallback, useEffect, useState } from 'react';

type ApiKey = {
  id: string;
  label: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [label, setLabel] = useState('');
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/api-keys');
    const json = await res.json();
    if (json.success) setKeys(json.data.apiKeys);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setFreshKey(null);
    try {
      const res = await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not create key');
      setFreshKey(json.data.apiKey.key);
      setLabel('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function revoke(id: string) {
    await fetch(`/api/api-keys/${id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">API keys</h1>
        <p className="mt-1 text-sm text-slate-500">
          Issue a key so your own system can push AQI reports to CIDCO without a browser session.
          Send it as <code className="rounded bg-slate-100 px-1 text-xs">X-API-Key</code> or{' '}
          <code className="rounded bg-slate-100 px-1 text-xs">Authorization: Bearer &lt;key&gt;</code>.
        </p>
      </div>

      {error && <div className="alert-error">{error}</div>}

      {freshKey && (
        <div className="alert-success">
          <p className="font-semibold">Copy this key now — it will not be shown again.</p>
          <code className="mt-2 block break-all rounded bg-white/70 p-3 font-mono text-xs">{freshKey}</code>
        </div>
      )}

      <form onSubmit={create} className="card flex flex-wrap items-end gap-3 p-5">
        <div className="min-w-56 flex-1">
          <label className="label" htmlFor="keyLabel">
            Key label
          </label>
          <input
            id="keyLabel"
            name="label"
            className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Site monitoring server"
            required
            minLength={2}
          />
        </div>
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Generating…' : 'Generate key'}
        </button>
      </form>

      <div className="card overflow-hidden">
        {keys.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">No API keys yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Label</th>
                <th className="px-5 py-3">Key</th>
                <th className="px-5 py-3">Created</th>
                <th className="px-5 py-3">Last used</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {keys.map((key) => (
                <tr key={key.id} className={key.revokedAt ? 'opacity-50' : ''}>
                  <td className="px-5 py-3 font-medium text-slate-900">{key.label}</td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-600">{key.prefix}…</td>
                  <td className="px-5 py-3 text-slate-500">
                    {new Date(key.createdAt).toLocaleDateString('en-IN')}
                  </td>
                  <td className="px-5 py-3 text-slate-500">
                    {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString('en-IN') : 'Never'}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {key.revokedAt ? (
                      <span className="badge border-slate-200 bg-slate-100 text-slate-600">Revoked</span>
                    ) : (
                      <button onClick={() => revoke(key.id)} className="btn-danger">
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
