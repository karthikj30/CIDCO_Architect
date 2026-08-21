import { prisma } from '@/lib/prisma';
import PortalWorkspace from '@/components/PortalWorkspace';

// Ensure this page is dynamically rendered since logs change frequently
export const dynamic = 'force-dynamic';

export default async function ApiPortalPage() {
  const logs = await prisma.apiRequestLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 font-sans overflow-hidden">
      <header className="border-b border-slate-200 bg-white flex-none">
        <div className="mx-auto flex w-full items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cidco-700 font-bold text-white">
              C
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight">CIDCO</p>
              <p className="text-xs text-slate-500">API Portal</p>
            </div>
          </div>
          <a href="/architect" className="text-xs font-medium text-slate-500 hover:text-slate-900">
            Architect portal →
          </a>
        </div>
      </header>

      <PortalWorkspace initialLogs={logs} />
    </div>
  );
}
