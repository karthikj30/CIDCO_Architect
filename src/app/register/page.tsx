'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    firmName: '',
    councilRegNo: '',
    phone: '',
    role: 'ARCHITECT',
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function update(key: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) {
        const fieldError = json.details && Object.values(json.details as Record<string, string[]>)[0]?.[0];
        throw new Error(fieldError ?? json.error ?? 'Registration failed');
      }
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
      <div className="w-full max-w-lg">
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
          <h1 className="text-xl font-semibold">Create an account</h1>
          <p className="mt-1 text-sm text-slate-500">
            Empanelled architects and CIDCO officers can register here.
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            {error && <div className="alert-error">{error}</div>}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="name">
                  Full name *
                </label>
                <input id="name" className="input" value={form.name} onChange={update('name')} required />
              </div>
              <div>
                <label className="label" htmlFor="role">
                  Account type *
                </label>
                <select id="role" className="input" value={form.role} onChange={update('role')}>
                  <option value="ARCHITECT">Architect</option>
                  <option value="CIDCO_OFFICER">CIDCO officer</option>
                </select>
              </div>
            </div>

            <div>
              <label className="label" htmlFor="email">
                Email *
              </label>
              <input id="email" type="email" className="input" value={form.email} onChange={update('email')} required />
            </div>

            <div>
              <label className="label" htmlFor="password">
                Password * <span className="font-normal text-slate-400">(min 8 characters)</span>
              </label>
              <input
                id="password"
                type="password"
                className="input"
                value={form.password}
                onChange={update('password')}
                minLength={8}
                required
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="firmName">
                  Firm name
                </label>
                <input id="firmName" className="input" value={form.firmName} onChange={update('firmName')} />
              </div>
              <div>
                <label className="label" htmlFor="councilRegNo">
                  Council of Architecture reg. no.
                </label>
                <input
                  id="councilRegNo"
                  className="input"
                  value={form.councilRegNo}
                  onChange={update('councilRegNo')}
                  placeholder="CA/2019/12345"
                />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="phone">
                Phone
              </label>
              <input id="phone" className="input" value={form.phone} onChange={update('phone')} />
            </div>

            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-600">
            Already registered?{' '}
            <Link href="/login" className="font-semibold text-cidco-700 hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
