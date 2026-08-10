import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import NavLink from '@/components/NavLink';
import SignOutButton from '@/components/SignOutButton';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/dashboard" className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cidco-700 font-bold text-white">
              C
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight">CIDCO</p>
              <p className="text-xs text-slate-500">AQI Compliance Portal</p>
            </div>
          </Link>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-slate-900">{user.name}</p>
              <p className="text-xs text-slate-500">
                {user.role === 'ARCHITECT' ? user.firmName || 'Architect' : 'CIDCO Officer'}
              </p>
            </div>
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-8 px-6 py-8">
        <aside className="hidden w-56 shrink-0 md:block">
          <nav className="space-y-1">
            <NavLink href="/dashboard">Overview</NavLink>
            <NavLink href="/dashboard/reports">Reports</NavLink>
            <NavLink href="/dashboard/upload">Submit report</NavLink>
            <NavLink href="/dashboard/csv">CSV upload</NavLink>
            <NavLink href="/dashboard/api-keys">API keys</NavLink>
            <NavLink href="/docs/api">API docs</NavLink>
          </nav>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
