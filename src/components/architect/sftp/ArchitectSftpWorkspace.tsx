'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ArchitectSignIn, { type Architect } from '../ArchitectSignIn';
import FileTransferPanes from './FileTransferPanes';

/**
 * The architect's SFTP workspace.
 *
 * Their registration as CIDCO holds it, a WinSCP-style pair of panes for
 * sending by hand, and CIDCO's validation result for every transfer so far.
 */
type Upload = {
  id: string;
  fileName: string;
  sizeBytes: number;
  status: string;
  mode: string;
  rowCount: number;
  importedCount: number;
  failedCount: number;
  errors: Array<{ row: number; error: string }> | null;
  receivedAt: string;
  parsedAt: string | null;
  presentedCompanyId: string | null;
  presentedIp: string | null;
  presentedPath: string | null;
  companyIdMatch: boolean;
  ipMatch: boolean;
  pathMatch: boolean;
  validationPassed: boolean;
  rejectionReason: string | null;
};

type Account = {
  id: string;
  username: string;
  status: string;
  credentialExpiresAt: string;
  establishedAt: string | null;
  company: {
    companyId: string;
    companyName: string;
    architectServerIp: string;
    filePath: string;
    active: boolean;
  } | null;
  uploads: Upload[];
  commLogs: Array<{
    id: string; direction: string; event: string; statusCode: number | null;
    detail: string | null; ip: string | null; createdAt: string;
  }>;
};

type MeData = {
  architect: { id: string; name: string; email: string; firmName: string | null };
  endpoint: { designatedIp: string; host: string; port: number; fileTypes: string; protocol: string };
  accounts: Account[];
};

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('en-IN') : '—');

export default function ArchitectSftpWorkspace() {
  const [me, setMe] = useState<MeData | null>(null);
  const [architect, setArchitect] = useState<Architect | null>(null);
  const [checking, setChecking] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch('/api/architect/sftp/me');
    if (res.ok) {
      const json = await res.json();
      setMe(json.data);
      setArchitect((prev) => prev ?? { ...json.data.architect, role: 'ARCHITECT' });
    }
  }, []);

  useEffect(() => {
    (async () => {
      await reload();
      setChecking(false);
    })();
  }, [reload]);

  // The automated feed delivers outside the browser, so keep this current.
  useEffect(() => {
    if (!me) return;
    timer.current = setInterval(() => void reload(), 8000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [me, reload]);

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setMe(null);
    setArchitect(null);
  }

  if (checking) {
    return <div className="flex flex-1 items-center justify-center text-sm text-slate-500">Loading…</div>;
  }

  if (!me || !architect) {
    return (
      <main className="flex-1 overflow-y-auto p-8">
        <ArchitectSignIn
          onSignedIn={async (a) => {
            setArchitect(a);
            await reload();
          }}
        />
      </main>
    );
  }

  const account = me.accounts[0] ?? null;
  const ep = me.endpoint;

  return (
    <main className="flex-1 overflow-y-auto bg-slate-50 p-8">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">SFTP file transfer</h1>
            <p className="mt-1 text-sm text-slate-500">
              Send your AQI readings to CIDCO as a CSV, by hand or automatically.
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium text-slate-900">{architect.name}</p>
            <button onClick={signOut} className="text-xs font-semibold text-slate-500 hover:text-slate-900">
              Sign out
            </button>
          </div>
        </div>

        {!account ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <p className="text-sm font-medium text-slate-900">No SFTP credentials yet</p>
            <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">
              CIDCO registers your company first — the company id, your server address and the path your
              CSV is exported to — and then emails you a user id, a password and the address to send to.
              Once that arrives, this page is where you send.
            </p>
          </div>
        ) : !account.company ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            These credentials are not linked to a company registration, so CIDCO will refuse every
            transfer. Ask CIDCO to link them before sending.
          </div>
        ) : (
          <>
            {/* What CIDCO holds — and therefore what every transfer must match */}
            <div className="rounded-xl border border-violet-200 bg-violet-50 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-violet-900">{account.company.companyName}</span>
                <span className="rounded bg-white/70 px-2 py-0.5 font-mono text-xs text-violet-800">
                  {account.company.companyId}
                </span>
                {!account.company.active && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">INACTIVE</span>
                )}
              </div>
              <p className="mt-2 text-sm text-violet-900">
                CIDCO validates every transfer against this registration. All three have to match or
                nothing is stored.
              </p>
              <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
                <div>
                  <dt className="font-semibold uppercase tracking-wide text-violet-700">Your server IP</dt>
                  <dd className="mt-0.5 font-mono text-sm text-violet-950">{account.company.architectServerIp}</dd>
                </div>
                <div>
                  <dt className="font-semibold uppercase tracking-wide text-violet-700">File path</dt>
                  <dd className="mt-0.5 break-all font-mono text-sm text-violet-950">{account.company.filePath}</dd>
                </div>
                <div>
                  <dt className="font-semibold uppercase tracking-wide text-violet-700">Send to</dt>
                  <dd className="mt-0.5 font-mono text-sm text-violet-950">
                    {ep.designatedIp}:{ep.port}
                  </dd>
                </div>
              </dl>
            </div>

            {/* WinSCP-style transfer */}
            <FileTransferPanes
              username={account.username}
              designatedIp={ep.designatedIp}
              port={ep.port}
              registeredPath={account.company.filePath}
              delivered={account.uploads}
              onTransferred={reload}
            />

            {/* The automated route */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-slate-900">Sending automatically</h2>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    On your own server, point any SFTP client at the designated address with your user
                    id and password, and put the CSV from{' '}
                    <code className="font-mono">{account.company.filePath}</code> on a schedule:
                  </p>
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-100">
{`sftp -P ${ep.port} ${account.username}@${ep.designatedIp}
sftp> put ${account.company.filePath}/readings.csv ${account.company.filePath}/`}
                  </pre>
                  <p className="mt-2 text-xs text-slate-500">
                    The repo ships a ready-made sender —{' '}
                    <code className="font-mono">npx tsx scripts/architect-sender.ts</code> — that reads
                    the newest CSV from that path and sends it on an interval.
                  </p>
                </div>
                <div className="flex flex-none flex-col gap-2">
                  <a
                    href="/api/architect/sftp/template"
                    className="rounded-lg bg-violet-600 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-violet-700"
                  >
                    CSV template
                  </a>
                  <a
                    href="/api/architect/sftp/template?format=xlsx"
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-center text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Excel template
                  </a>
                  <a
                    href="/docs/sftp"
                    target="_blank"
                    rel="noreferrer"
                    className="text-center text-xs font-semibold text-violet-700 hover:underline"
                  >
                    Full SFTP guide →
                  </a>
                </div>
              </div>
            </div>

            {/* Per-transfer validation, as CIDCO ran it */}
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Your transfers</h2>
              {account.uploads.length === 0 ? (
                <div className="mt-3 rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
                  Nothing sent yet. Every transfer will show here with CIDCO’s validation result.
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  {account.uploads.map((u) => (
                    <div
                      key={u.id}
                      className={`rounded-xl border p-4 shadow-sm ${
                        u.validationPassed ? 'border-slate-200 bg-white' : 'border-red-200 bg-red-50'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900">{u.fileName}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            u.validationPassed ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {u.status}
                        </span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          {u.mode === 'PORTAL' ? 'portal' : 'sftp'}
                        </span>
                        <span className="ml-auto text-xs text-slate-400">{fmt(u.receivedAt)}</span>
                      </div>

                      <p className="mt-2 flex flex-wrap gap-3 text-[11px]">
                        <span className={u.companyIdMatch ? 'text-emerald-700' : 'text-red-700'}>
                          {u.companyIdMatch ? '✓' : '✕'} company id {u.presentedCompanyId ?? '—'}
                        </span>
                        <span className={u.ipMatch ? 'text-emerald-700' : 'text-red-700'}>
                          {u.ipMatch ? '✓' : '✕'} from {u.presentedIp ?? '—'}
                        </span>
                        <span className={u.pathMatch ? 'text-emerald-700' : 'text-red-700'}>
                          {u.pathMatch ? '✓' : '✕'} path {u.presentedPath ?? '—'}
                        </span>
                      </p>

                      {u.validationPassed ? (
                        <p className="mt-1.5 text-xs text-slate-600">
                          <span className="font-semibold text-slate-900">{u.importedCount}</span> of {u.rowCount} rows
                          stored as readings{u.failedCount > 0 ? ` · ${u.failedCount} rejected` : ''}
                        </p>
                      ) : (
                        <p className="mt-1.5 text-xs font-medium text-red-800">
                          CIDCO refused this transfer — {u.rejectionReason}. Nothing was stored.
                        </p>
                      )}

                      {u.errors && u.errors.length > 0 && (
                        <ul className="mt-2 space-y-1 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                          {u.errors.map((e) => (
                            <li key={e.row}>
                              <span className="font-semibold">Row {e.row}</span> — {e.error}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {account.commLogs.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Activity</h2>
                <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <table className="w-full text-left text-xs">
                    <tbody className="divide-y divide-slate-100">
                      {account.commLogs.map((l) => (
                        <tr key={l.id}>
                          <td className="whitespace-nowrap px-4 py-2 text-slate-400">{fmt(l.createdAt)}</td>
                          <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-700">{l.event}</td>
                          <td className="px-4 py-2 text-slate-600">{l.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
