import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { bandFor, STATUS_STYLES } from '@/lib/aqi';
import ReviewPanel from '@/components/ReviewPanel';

export const dynamic = 'force-dynamic';

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-900">{value ?? '—'}</dd>
    </div>
  );
}

export default async function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const report = await prisma.report.findUnique({
    where: { id },
    include: {
      attachments: true,
      project: true,
      user: { select: { name: true, email: true, firmName: true, councilRegNo: true, phone: true } },
    },
  });

  if (!report) notFound();
  if (user.role === 'ARCHITECT' && report.userId !== user.id) notFound();

  const band = bandFor(report.aqiValue);
  const photos = report.attachments.filter((a) => a.kind === 'AQI_BOARD_PHOTO');
  const others = report.attachments.filter((a) => a.kind !== 'AQI_BOARD_PHOTO');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/dashboard/reports" className="text-sm text-cidco-700 hover:underline">
            ← Back to reports
          </Link>
          <h1 className="mt-2 font-mono text-2xl font-bold text-slate-900">{report.referenceNo}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {report.siteName} · {report.location}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className={`badge ${STATUS_STYLES[report.status]}`}>{report.status}</span>
          <span className={`badge ${band.className}`}>
            AQI {report.aqiValue} · {band.label}
          </span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="card p-5">
            <h2 className="text-sm font-semibold text-slate-900">Measurement</h2>
            <dl className="mt-4 grid gap-4 sm:grid-cols-3">
              <Field label="Measured at" value={new Date(report.measuredAt).toLocaleString('en-IN')} />
              <Field label="AQI" value={`${report.aqiValue} (${band.label})`} />
              <Field label="Source channel" value={report.source} />
              <Field label="PM2.5" value={report.pm25 !== null ? `${report.pm25} µg/m³` : null} />
              <Field label="PM10" value={report.pm10 !== null ? `${report.pm10} µg/m³` : null} />
              <Field label="SO₂" value={report.so2 !== null ? `${report.so2} µg/m³` : null} />
              <Field label="NO₂" value={report.no2 !== null ? `${report.no2} µg/m³` : null} />
              <Field label="CO" value={report.co !== null ? `${report.co} mg/m³` : null} />
              <Field label="Ozone" value={report.ozone !== null ? `${report.ozone} µg/m³` : null} />
              <Field
                label="Coordinates"
                value={report.latitude !== null && report.longitude !== null ? `${report.latitude}, ${report.longitude}` : null}
              />
              <Field label="Project" value={report.project ? `${report.project.name} (${report.project.code})` : null} />
              <Field label="Advisory" value={band.advisory} />
            </dl>
            {report.remarks && (
              <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{report.remarks}</div>
            )}
          </section>

          <section className="card p-5">
            <h2 className="text-sm font-semibold text-slate-900">
              AQI board photographs ({photos.length})
            </h2>
            {photos.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No photographs attached.</p>
            ) : (
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                {photos.map((photo) => (
                  <a key={photo.id} href={`/api/files/${photo.id}`} target="_blank" rel="noreferrer" className="group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/files/${photo.id}`}
                      alt={photo.fileName}
                      className="h-36 w-full rounded-lg border border-slate-200 object-cover transition group-hover:opacity-90"
                    />
                    <p className="mt-1 truncate text-xs text-slate-500">{photo.fileName}</p>
                  </a>
                ))}
              </div>
            )}
          </section>

          {others.length > 0 && (
            <section className="card p-5">
              <h2 className="text-sm font-semibold text-slate-900">Documents</h2>
              <ul className="mt-3 divide-y divide-slate-100 text-sm">
                {others.map((file) => (
                  <li key={file.id} className="flex items-center justify-between py-2">
                    <div>
                      <p className="font-medium text-slate-900">{file.fileName}</p>
                      <p className="text-xs text-slate-500">
                        {file.kind} · {(file.sizeBytes / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    <a href={`/api/files/${file.id}`} target="_blank" rel="noreferrer" className="btn-secondary">
                      Download
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="text-sm font-semibold text-slate-900">Submitted by</h2>
            <dl className="mt-4 space-y-3">
              <Field label="Architect" value={report.user.name} />
              <Field label="Firm" value={report.user.firmName} />
              <Field label="COA reg. no." value={report.user.councilRegNo} />
              <Field label="Email" value={report.user.email} />
              <Field label="Phone" value={report.user.phone} />
              <Field label="Submitted at" value={new Date(report.createdAt).toLocaleString('en-IN')} />
            </dl>
          </section>

          {report.reviewedAt && (
            <section className="card p-5">
              <h2 className="text-sm font-semibold text-slate-900">Review</h2>
              <dl className="mt-4 space-y-3">
                <Field label="Reviewed by" value={report.reviewedBy} />
                <Field label="Reviewed at" value={new Date(report.reviewedAt).toLocaleString('en-IN')} />
                <Field label="Note" value={report.reviewNote} />
              </dl>
            </section>
          )}

          {user.role !== 'ARCHITECT' && <ReviewPanel reportId={report.id} currentStatus={report.status} />}
        </div>
      </div>
    </div>
  );
}
