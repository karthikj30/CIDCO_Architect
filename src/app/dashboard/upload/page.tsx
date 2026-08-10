'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Result = {
  referenceNo: string;
  id: string;
  status: string;
  attachments: Array<{ id: string; kind: string; fileName: string }>;
};

const EMPTY = {
  siteName: '',
  location: '',
  measuredAt: '',
  aqiValue: '',
  pm25: '',
  pm10: '',
  so2: '',
  no2: '',
  co: '',
  ozone: '',
  latitude: '',
  longitude: '',
  projectCode: '',
  remarks: '',
};

/** Keeps every label bound to its input so the form stays accessible. */
function TextField({
  id,
  label,
  value,
  onChange,
  required,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
        {required && ' *'}
      </label>
      <input
        id={id}
        name={id}
        className="input"
        value={value}
        onChange={onChange}
        required={required}
        placeholder={placeholder}
      />
    </div>
  );
}

export default function UploadPage() {
  const router = useRouter();
  const [form, setForm] = useState({ ...EMPTY });
  const [document, setDocument] = useState<File | null>(null);
  const [photos, setPhotos] = useState<FileList | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function update(key: keyof typeof EMPTY) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const body = new FormData();
      for (const [key, value] of Object.entries(form)) {
        if (value !== '') body.append(key, value);
      }
      // The browser sends a datetime-local value without a zone; normalise it.
      if (form.measuredAt) body.set('measuredAt', new Date(form.measuredAt).toISOString());
      if (document) body.append('document', document);
      if (photos) Array.from(photos).forEach((file) => body.append('boardPhotos', file));

      const res = await fetch('/api/reports', { method: 'POST', body });
      const json = await res.json();
      if (!res.ok) {
        const fieldError = json.details && Object.values(json.details as Record<string, string[]>)[0]?.[0];
        throw new Error(fieldError ?? json.error ?? 'Submission failed');
      }
      setResult(json.data.report);
      setForm({ ...EMPTY });
      setDocument(null);
      setPhotos(null);
      (event.target as HTMLFormElement).reset();
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
        <h1 className="text-2xl font-bold text-slate-900">Submit AQI report</h1>
        <p className="mt-1 text-sm text-slate-500">
          This form posts to the same endpoint your own system would call —{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">POST /api/reports</code>.
        </p>
      </div>

      {error && <div className="alert-error">{error}</div>}
      {result && (
        <div className="alert-success">
          <p className="font-semibold">Report received by CIDCO.</p>
          <p className="mt-1">
            Reference <span className="font-mono">{result.referenceNo}</span> · status {result.status} ·{' '}
            {result.attachments.length} attachment(s).{' '}
            <Link href={`/dashboard/reports/${result.id}`} className="font-semibold underline">
              View report
            </Link>
          </p>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-6">
        <section className="card p-5">
          <h2 className="text-sm font-semibold text-slate-900">Site details</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <TextField id="siteName" label="Site name" value={form.siteName} onChange={update('siteName')} required />
            <TextField
              id="location"
              label="Location"
              value={form.location}
              onChange={update('location')}
              placeholder="Kharghar, Navi Mumbai"
              required
            />
            <div>
              <label className="label" htmlFor="measuredAt">
                Measured at *
              </label>
              <input
                id="measuredAt"
                name="measuredAt"
                type="datetime-local"
                className="input"
                value={form.measuredAt}
                onChange={update('measuredAt')}
                required
              />
            </div>
            <TextField
              id="projectCode"
              label="CIDCO project code"
              value={form.projectCode}
              onChange={update('projectCode')}
              placeholder="CIDCO-KHR-012"
            />
            <TextField id="latitude" label="Latitude" value={form.latitude} onChange={update('latitude')} placeholder="19.0330" />
            <TextField id="longitude" label="Longitude" value={form.longitude} onChange={update('longitude')} placeholder="73.0630" />
          </div>
        </section>

        <section className="card p-5">
          <h2 className="text-sm font-semibold text-slate-900">Readings</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <TextField id="aqiValue" label="AQI value" value={form.aqiValue} onChange={update('aqiValue')} placeholder="148" required />
            <TextField id="pm25" label="PM2.5 (µg/m³)" value={form.pm25} onChange={update('pm25')} />
            <TextField id="pm10" label="PM10 (µg/m³)" value={form.pm10} onChange={update('pm10')} />
            <TextField id="so2" label="SO₂ (µg/m³)" value={form.so2} onChange={update('so2')} />
            <TextField id="no2" label="NO₂ (µg/m³)" value={form.no2} onChange={update('no2')} />
            <TextField id="co" label="CO (mg/m³)" value={form.co} onChange={update('co')} />
            <TextField id="ozone" label="Ozone (µg/m³)" value={form.ozone} onChange={update('ozone')} />
          </div>
          <div className="mt-4">
            <label className="label" htmlFor="remarks">
              Remarks
            </label>
            <textarea id="remarks" name="remarks" className="input" rows={3} value={form.remarks} onChange={update('remarks')} />
          </div>
        </section>

        <section className="card p-5">
          <h2 className="text-sm font-semibold text-slate-900">Attachments</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="document">
                Signed AQI report document
              </label>
              <input
                id="document"
                name="document"
                type="file"
                className="input py-1.5"
                accept=".pdf,.doc,.docx,.txt,image/*"
                onChange={(e) => setDocument(e.target.files?.[0] ?? null)}
              />
              <p className="mt-1 text-xs text-slate-500">PDF, Word or text. Max 15 MB.</p>
            </div>
            <div>
              <label className="label" htmlFor="boardPhotos">
                Photographs of the AQI display board *
              </label>
              <input
                id="boardPhotos"
                name="boardPhotos"
                type="file"
                className="input py-1.5"
                accept="image/*"
                multiple
                onChange={(e) => setPhotos(e.target.files)}
                required
              />
              <p className="mt-1 text-xs text-slate-500">JPEG, PNG or WebP. Multiple files allowed.</p>
            </div>
          </div>
        </section>

        <div className="flex gap-3">
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Submitting…' : 'Submit to CIDCO'}
          </button>
          <Link href="/dashboard/reports" className="btn-secondary">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
