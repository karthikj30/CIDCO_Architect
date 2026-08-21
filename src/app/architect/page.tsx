import type { Metadata } from 'next';
import ArchitectWorkspace from '@/components/architect/ArchitectWorkspace';

export const metadata: Metadata = {
  title: 'Architect Portal — CIDCO AQI',
  description: 'Validate with CIDCO, manage your tokens and send AQI data.',
};

export const dynamic = 'force-dynamic';

export default function ArchitectPortalPage() {
  return (
    <div className="flex min-h-screen flex-col overflow-hidden bg-slate-50 font-sans text-slate-900">
      <header className="flex-none border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 font-bold text-white">
              A
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight">Architect Portal</p>
              <p className="text-xs text-slate-500">CIDCO AQI integration</p>
            </div>
          </div>
          <a href="/" className="text-xs font-medium text-slate-500 hover:text-slate-900">
            CIDCO admin portal →
          </a>
        </div>
      </header>

      <ArchitectWorkspace />
    </div>
  );
}
