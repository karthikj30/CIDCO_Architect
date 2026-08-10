import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { requireUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { bandFor, STATUS_STYLES } from '@/lib/aqi';

export const dynamic = 'force-dynamic';

const STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'] as const;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1));
  const pageSize = 20;

  const where: Prisma.ReportWhereInput = {};
  if (user.role === 'ARCHITECT') where.userId = user.id;
  if (params.status && STATUSES.includes(params.status as (typeof STATUSES)[number])) {
    where.status = params.status as (typeof STATUSES)[number];
  }
  if (params.q) {
    where.OR = [
      { siteName: { contains: params.q, mode: 'insensitive' } },
      { location: { contains: params.q, mode: 'insensitive' } },
      { referenceNo: { contains: params.q, mode: 'insensitive' } },
    ];
  }

  const [total, reports] = await Promise.all([
    prisma.report.count({ where }),
    prisma.report.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: { select: { name: true, firmName: true } },
        attachments: { select: { id: true } },
      },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
          <p className="mt-1 text-sm text-slate-500">{total} report(s) found.</p>
        </div>
        <Link href="/dashboard/upload" className="btn-primary">
          Submit report
        </Link>
      </div>

      <form className="card flex flex-wrap items-end gap-3 p-4" method="get">
        <div className="min-w-56 flex-1">
          <label className="label" htmlFor="q">
            Search
          </label>
          <input
            id="q"
            name="q"
            defaultValue={params.q ?? ''}
            className="input"
            placeholder="Reference, site or location"
          />
        </div>
        <div>
          <label className="label" htmlFor="status">
            Status
          </label>
          <select id="status" name="status" defaultValue={params.status ?? ''} className="input">
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-secondary">
          Filter
        </button>
      </form>

      <div className="card overflow-hidden">
        {reports.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-slate-500">No reports match this filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Reference</th>
                  <th className="px-5 py-3">Site</th>
                  {user.role !== 'ARCHITECT' && <th className="px-5 py-3">Architect</th>}
                  <th className="px-5 py-3">Measured</th>
                  <th className="px-5 py-3">AQI</th>
                  <th className="px-5 py-3">Source</th>
                  <th className="px-5 py-3">Files</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reports.map((report) => {
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
                      {user.role !== 'ARCHITECT' && (
                        <td className="px-5 py-3">
                          <p className="text-slate-900">{report.user.name}</p>
                          <p className="text-xs text-slate-500">{report.user.firmName}</p>
                        </td>
                      )}
                      <td className="px-5 py-3 text-slate-600">
                        {new Date(report.measuredAt).toLocaleString('en-IN')}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`badge ${band.className}`}>
                          {report.aqiValue} · {band.label}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-600">{report.source}</td>
                      <td className="px-5 py-3 text-slate-600">{report.attachments.length}</td>
                      <td className="px-5 py-3">
                        <span className={`badge ${STATUS_STYLES[report.status]}`}>{report.status}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={`/dashboard/reports?page=${page - 1}`} className="btn-secondary">
                Previous
              </Link>
            )}
            {page < totalPages && (
              <Link href={`/dashboard/reports?page=${page + 1}`} className="btn-secondary">
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
