'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Sign in failed');
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cidco-700 font-bold text-white">
            C
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">CIDCO</p>
            <p className="text-xs text-slate-500">AQI Compliance Portal</p>
          </div>
        </Link>

        <div className="card p-6">
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-slate-500">Use your registered architect credentials.</p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            {error && <div className="alert-error">{error}</div>}

            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-600">
            No account yet?{' '}
            <Link href="/register" className="font-semibold text-cidco-700 hover:underline">
              Register as an architect
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
