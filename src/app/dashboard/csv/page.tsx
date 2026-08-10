'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type CsvResult = {
  fileName: string;
  totalRows: number;
  createdCount: number;
  failedCount: number;
  created: Array<{ row: number; id: string; referenceNo: string; siteName: string; aqiValue: number }>;
  errors: Array<{ row: number; message: string; details?: Record<string, string[]> }>;
};

export default function CsvUploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<CsvResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/reports/csv', { method: 'POST', body });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? 'Upload failed');
      setResult(json.data);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">CSV upload</h1>
        <p className="mt-1 text-sm text-slate-500">
          Bulk-submit AQI readings. Each row becomes its own report; invalid rows are reported back
          with the exact reason and the rest still go through.
        </p>
      </div>

      {error && <div className="alert-error">{error}</div>}

      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Expected format</h2>
            <p className="mt-1 text-sm text-slate-500">
              Required columns: <code className="rounded bg-slate-100 px-1 text-xs">siteName</code>,{' '}
              <code className="rounded bg-slate-100 px-1 text-xs">location</code>,{' '}
              <code className="rounded bg-slate-100 px-1 text-xs">measuredAt</code>,{' '}
              <code className="rounded bg-slate-100 px-1 text-xs">aqiValue</code>. Optional: pm25, pm10,
              so2, no2, co, ozone, latitude, longitude, remarks, projectCode.
            </p>
          </div>
          <a href="/api/reports/csv" className="btn-secondary shrink-0">
            Download template
          </a>
        </div>
      </div>

      <form onSubmit={onSubmit} className="card space-y-4 p-5">
        <div>
          <label className="label" htmlFor="csvFile">
            CSV file *
          </label>
          <input
            id="csvFile"
            name="file"
            type="file"
            accept=".csv,text/csv"
            className="input py-1.5"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            required
          />
        </div>
        <button type="submit" className="btn-primary" disabled={loading || !file}>
          {loading ? 'Uploading…' : 'Upload CSV'}
        </button>
      </form>

      {result && (
        <div className="space-y-4">
          <div className={result.failedCount ? 'alert-error' : 'alert-success'}>
            <p className="font-semibold">
              {result.fileName}: {result.createdCount} of {result.totalRows} row(s) accepted
              {result.failedCount ? `, ${result.failedCount} rejected` : ''}.
            </p>
          </div>

          {result.created.length > 0 && (
            <div className="card">
              <h2 className="border-b border-slate-200 px-5 py-3 text-sm font-semibold">Accepted rows</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-2">Row</th>
                      <th className="px-5 py-2">Reference</th>
                      <th className="px-5 py-2">Site</th>
                      <th className="px-5 py-2">AQI</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {result.created.map((row) => (
                      <tr key={row.id}>
                        <td className="px-5 py-2 text-slate-500">{row.row}</td>
                        <td className="px-5 py-2">
                          <Link href={`/dashboard/reports/${row.id}`} className="font-medium text-cidco-700 hover:underline">
                            {row.referenceNo}
                          </Link>
                        </td>
                        <td className="px-5 py-2">{row.siteName}</td>
                        <td className="px-5 py-2 font-semibold">{row.aqiValue}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result.errors.length > 0 && (
            <div className="card">
              <h2 className="border-b border-slate-200 px-5 py-3 text-sm font-semibold text-red-700">
                Rejected rows
              </h2>
              <ul className="divide-y divide-slate-100">
                {result.errors.map((row) => (
                  <li key={row.row} className="px-5 py-3 text-sm">
                    <span className="font-semibold">Row {row.row}:</span> {row.message}
                    {row.details && (
                      <ul className="mt-1 list-disc pl-6 text-xs text-slate-600">
                        {Object.entries(row.details).map(([field, messages]) => (
                          <li key={field}>
                            <span className="font-mono">{field}</span> — {messages.join(', ')}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
