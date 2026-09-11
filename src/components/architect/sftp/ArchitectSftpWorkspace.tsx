'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ArchitectSignIn, { type Architect } from '../ArchitectSignIn';

/**
 * The architect's SFTP workspace: where to connect, what the sheet must look
 * like, and what CIDCO made of everything they have uploaded.
 *
 * Uploading itself happens over SFTP from their own machine — that is the point
 * of the channel — so this page equips and reports, it does not transfer.
 */
type Upload = {
  id: string;
  fileName: string;
  sizeBytes: number;
  status: string;
  sheetName: string | null;
  rowCount: number;
  importedCount: number;
  failedCount: number;
  errors: Array<{ row: number; error: string }> | null;
  receivedAt: string;
  parsedAt: string | null;
};

type Account = {
  id: string;
  username: string;
  passwordPrefix: string;
  status: string;
  credentialExpiresAt: string;
  establishedAt: string | null;
  whitelistedIp: string | null;
  deviceInfo: string | null;
  uploads: Upload[];
  commLogs: Array<{
    id: string; direction: string; event: string; statusCode: number | null;
    detail: string | null; ip: string | null; createdAt: string;
  }>;
  validationRequests: Array<{
    id: string; status: string; presentedIp: string | null; deviceInfo: string | null;
    reviewNote: string | null; createdAt: string; reviewedAt: string | null;
  }>;
};

type MeData = {
  architect: { id: string; name: string; email: string; firmName: string | null };
  endpoint: { host: string; port: number; uploadDir: string; fileTypes: string; protocol: string };
  accounts: Account[];
};

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('en-IN') : '—');
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

const STATUS_NOTE: Record<string, { tone: string; text: string }> = {
  PENDING: {
    tone: 'border-amber-200 bg-amber-50 text-amber-900',
    text: 'Connect to the SFTP server once with the user id and password CIDCO emailed you. That first connection is your handshake request — it will be refused, and CIDCO will see it for approval.',
  },
  AWAITING_APPROVAL: {
    tone: 'border-amber-200 bg-amber-50 text-amber-900',
    text: 'Your handshake request is with CIDCO. Once an officer approves the address you connected from, your uploads will be accepted.',
  },
  ESTABLISHED: {
    tone: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    text: 'Your channel is open. Upload your filled-in workbook to the upload directory and CIDCO will parse it into readings.',
  },
  REJECTED: {
    tone: 'border-red-200 bg-red-50 text-red-900',
    text: 'CIDCO did not approve this handshake request. Check the note below and confirm your details with CIDCO before trying again.',
  },
  EXPIRED: {
    tone: 'border-red-200 bg-red-50 text-red-900',
    text: 'These SFTP credentials have expired. Ask CIDCO to issue a new user id and password.',
  },
  REVOKED: {
    tone: 'border-red-200 bg-red-50 text-red-900',
    text: 'CIDCO has revoked these SFTP credentials.',
  },
};

const UPLOAD_TONE: Record<string, string> = {
  RECEIVED: 'bg-slate-100 text-slate-700',
  PARSED: 'bg-emerald-100 text-emerald-800',
  PARTIAL: 'bg-amber-100 text-amber-800',
  FAILED: 'bg-red-100 text-red-800',
};

function Copyable({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 flex-none text-xs text-slate-500">{label}</span>
      <code className="min-w-0 flex-1 truncate rounded bg-slate-50 px-2 py-1 font-mono text-xs text-slate-800">{value}</code>
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            setCopied(false);
          }
        }}
        className="text-xs font-semibold text-violet-700 hover:underline"
      >
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
    </div>
  );
}

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

  // Approval and uploads both happen off-browser, so keep the page current.
  useEffect(() => {
    if (!me) return;
    timer.current = setInterval(() => void reload(), 6000);
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
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">SFTP file transfer</h1>
            <p className="mt-1 text-sm text-slate-500">
              Upload a filled-in Excel workbook of AQI readings to CIDCO over SFTP.
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
            <p className="text-sm font-medium text-slate-900">No SFTP account yet</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
              CIDCO issues an SFTP user id and password and emails it to you. Once you have it, connect
              to the server below — that first connection is your handshake request.
            </p>
          </div>
        ) : (
          <>
            {/* Where the handshake stands */}
            {(() => {
              const note = STATUS_NOTE[account.status] ?? STATUS_NOTE.PENDING;
              const rejected = account.validationRequests.find((v) => v.status === 'REJECTED');
              return (
                <div className={`rounded-xl border p-5 ${note.tone}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-white/70 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide">
                      {account.status}
                    </span>
                    <span className="font-mono text-xs opacity-75">{account.username}</span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed">{note.text}</p>
                  {account.status === 'REJECTED' && rejected?.reviewNote && (
                    <p className="mt-2 text-sm font-medium">CIDCO’s note: {rejected.reviewNote}</p>
                  )}
                  {account.whitelistedIp && (
                    <p className="mt-2 text-xs opacity-75">
                      Approved for connections from {account.whitelistedIp}
                      {account.establishedAt ? ` · open since ${fmt(account.establishedAt)}` : ''}
                    </p>
                  )}
                </div>
              );
            })()}

            {/* How to connect */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Connection details</h2>
              <p className="mt-1 text-xs text-slate-500">
                Use any SFTP client — FileZilla, WinSCP, or the <code className="font-mono">sftp</code> command.
                Your password is the one CIDCO emailed you.
              </p>
              <div className="mt-4 space-y-2">
                <Copyable label="Protocol" value={ep.protocol} />
                <Copyable label="Host" value={ep.host} />
                <Copyable label="Port" value={String(ep.port)} />
                <Copyable label="User id" value={account.username} />
                <Copyable label="Upload to" value={ep.uploadDir} />
                <Copyable
                  label="Command"
                  value={`sftp -P ${ep.port} ${account.username}@${ep.host}`}
                />
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Once connected: <code className="font-mono">put your-readings.xlsx {ep.uploadDir}/</code>. Only{' '}
                {ep.fileTypes} are accepted.{' '}
                <a href="/docs/sftp" target="_blank" rel="noreferrer" className="font-semibold text-violet-700 hover:underline">
                  Full SFTP guide →
                </a>
              </p>
            </div>

            {/* The sheet */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">The workbook</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Row 1 is the header, every row after it is one reading. Start from the template and the
                    columns will always line up.
                  </p>
                </div>
                <a
                  href="/api/architect/sftp/template"
                  className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700"
                >
                  Download the template
                </a>
              </div>
            </div>

            {/* What CIDCO made of each upload */}
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Your uploads</h2>
              {account.uploads.length === 0 ? (
                <div className="mt-3 rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
                  Nothing uploaded yet. Once you put a workbook on the server it appears here with CIDCO’s
                  result for every row.
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  {account.uploads.map((u) => (
                    <div key={u.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900">{u.fileName}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${UPLOAD_TONE[u.status] ?? 'bg-slate-100 text-slate-700'}`}>
                          {u.status}
                        </span>
                        <span className="ml-auto text-xs text-slate-400">{fmt(u.receivedAt)}</span>
                      </div>
                      <p className="mt-1.5 text-xs text-slate-600">
                        {kb(u.sizeBytes)} · <span className="font-semibold text-slate-900">{u.importedCount}</span> of{' '}
                        {u.rowCount} rows stored as readings
                        {u.failedCount > 0 ? ` · ${u.failedCount} rejected` : ''}
                      </p>
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

            {/* The exchange, as CIDCO recorded it */}
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
