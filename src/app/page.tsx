import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';

export default async function HomePage() {
  const user = await getSessionUser();
  if (user) redirect('/dashboard');

  return (
    <main className="min-h-screen bg-gradient-to-b from-cidco-900 via-cidco-800 to-slate-900 text-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white font-bold text-cidco-800">
            C
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">CIDCO</p>
            <p className="text-xs text-cidco-200">AQI Compliance Portal</p>
          </div>
        </div>
        <nav className="flex items-center gap-3">
          <Link href="/login" className="btn-secondary">
            Sign in
          </Link>
          <Link href="/register" className="btn bg-white text-cidco-800 hover:bg-cidco-50">
            Register
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-6 pb-16 pt-10">
        <h1 className="max-w-3xl text-4xl font-bold leading-tight sm:text-5xl">
          Air Quality Index reporting for empanelled architects
        </h1>
        <p className="mt-4 max-w-2xl text-cidco-100">
          Submit site AQI readings, signed reports and photographs of the on-site AQI display board
          to the City and Industrial Development Corporation of Maharashtra — over the API from your
          own system, or by uploading a CSV here.
        </p>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <div className="rounded-xl border border-white/15 bg-white/10 p-6 backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-wide text-cidco-200">Method 1</p>
            <h2 className="mt-2 text-xl font-semibold">Push to the CIDCO API</h2>
            <p className="mt-2 text-sm text-cidco-100">
              Generate an API key from your dashboard and have your own system POST the report
              document together with the AQI board photographs to{' '}
              <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">POST /api/reports</code>.
            </p>
          </div>
          <div className="rounded-xl border border-white/15 bg-white/10 p-6 backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-wide text-cidco-200">Method 2</p>
            <h2 className="mt-2 text-xl font-semibold">Upload a CSV</h2>
            <p className="mt-2 text-sm text-cidco-100">
              Bulk-submit readings by uploading a CSV. Every row is validated on its own, and the
              portal tells you precisely which rows were rejected and why.
            </p>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/register" className="btn bg-white text-cidco-800 hover:bg-cidco-50">
            Create an architect account
          </Link>
          <Link href="/docs/api" className="btn-secondary">
            API documentation
          </Link>
        </div>
      </section>
    </main>
  );
}
