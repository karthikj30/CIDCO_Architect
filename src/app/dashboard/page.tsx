import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { requireUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { AQI_BANDS, bandFor, STATUS_STYLES } from '@/lib/aqi';

export const dynamic = 'force-dynamic';

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-bold text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  const scope: Prisma.ReportWhereInput = user.role === 'ARCHITECT' ? { userId: user.id } : {};

  const [total, pending, approved, aggregate, recent, bySource] = await Promise.all([
    prisma.report.count({ where: scope }),
    prisma.report.count({ where: { ...scope, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } } }),
    prisma.report.count({ where: { ...scope, status: 'APPROVED' } }),
    prisma.report.aggregate({ where: scope, _avg: { aqiValue: true } }),
    prisma.report.findMany({
      where: scope,
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: { user: { select: { name: true } } },
    }),
    prisma.report.groupBy({ by: ['source'], where: scope, _count: { _all: true } }),
  ]);

  const average = aggregate._avg.aqiValue ? Math.round(aggregate._avg.aqiValue) : null;
  const sourceCounts = Object.fromEntries(bySource.map((s) => [s.source, s._count._all]));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Welcome, {user.name.split(' ')[0]}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {user.role === 'ARCHITECT'
            ? 'Your AQI submissions to CIDCO at a glance.'
            : 'All architect AQI submissions across CIDCO nodes.'}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Total reports" value={total} />
        <Tile label="Awaiting review" value={pending} hint="Submitted or under review" />
        <Tile label="Approved" value={approved} />
        <Tile
          label="Average AQI"
          value={average ?? '—'}
          hint={average !== null ? bandFor(average).label : 'No readings yet'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-slate-900">Submission channels</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-slate-600">API (machine-to-machine)</dt>
              <dd className="font-semibold">{sourceCounts.API ?? 0}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-600">CSV upload</dt>
              <dd className="font-semibold">{sourceCounts.CSV ?? 0}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-600">Web form</dt>
              <dd className="font-semibold">{sourceCounts.WEB ?? 0}</dd>
            </div>
          </dl>
          <div className="mt-5 flex flex-col gap-2">
            <Link href="/dashboard/upload" className="btn-primary">
              Submit a report
            </Link>
            <Link href="/dashboard/csv" className="btn-secondary">
              Upload a CSV
            </Link>
          </div>
        </div>

        <div className="card p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-900">CPCB AQI bands</h2>
          <div className="mt-4 space-y-2">
            {AQI_BANDS.map((band) => (
              <div key={band.label} className="flex items-center gap-3 text-sm">
                <span className={`badge w-28 justify-center ${band.className}`}>{band.label}</span>
                <span className="w-24 text-slate-500">
                  {band.min}–{band.max === 10000 ? '500+' : band.max}
                </span>
                <span className="text-slate-600">{band.advisory}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Recent submissions</h2>
          <Link href="/dashboard/reports" className="text-sm font-semibold text-cidco-700 hover:underline">
            View all
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">
            No reports yet. Submit your first AQI report to get started.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Reference</th>
                  <th className="px-5 py-3">Site</th>
                  <th className="px-5 py-3">AQI</th>
                  <th className="px-5 py-3">Source</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Submitted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recent.map((report) => {
                  const band = bandFor(report.aqiValue);
                  return (
                    <tr key={report.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <Link
                          href={`/dashboard/reports/${report.id}`}
                          className="font-medium text-cidco-700 hover:underline"
                        >
                          {report.referenceNo}
                        </Link>
                      </td>
                      <td className="px-5 py-3">
                        <p className="font-medium text-slate-900">{report.siteName}</p>
                        <p className="text-xs text-slate-500">{report.location}</p>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`badge ${band.className}`}>
                          {report.aqiValue} · {band.label}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-600">{report.source}</td>
                      <td className="px-5 py-3">
                        <span className={`badge ${STATUS_STYLES[report.status]}`}>{report.status}</span>
                      </td>
                      <td className="px-5 py-3 text-slate-500">
                        {new Date(report.createdAt).toLocaleDateString('en-IN')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
