import type { Metadata } from 'next';
import { SHEET_COLUMNS } from '@/lib/sftp';

export const metadata: Metadata = {
  title: 'SFTP Channel — CIDCO AQI Portal',
  description: 'How an architect uploads an Excel workbook of AQI readings to CIDCO over SFTP.',
};

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">
      {children}
    </pre>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6">
      <h2 className="text-xl font-bold text-slate-900">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-slate-700">{children}</div>
    </section>
  );
}

const K = 'rounded bg-slate-100 px-1 font-mono';

export default function SftpDocs() {
  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-600 font-bold text-white">C</div>
            <div>
              <p className="text-sm font-semibold leading-tight">CIDCO</p>
              <p className="text-xs text-slate-500">SFTP channel</p>
            </div>
          </div>
          <a href="/docs/architect" className="text-xs font-medium text-slate-500 hover:text-slate-900">
            API channel docs →
          </a>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-3xl font-bold text-slate-900">Sending AQI data over SFTP</h1>
        <p className="mt-2 text-slate-600">
          The second delivery channel: you fill in an Excel workbook and upload it to CIDCO over SFTP.
          It is entirely separate from the API channel — different credentials, a different dashboard.
          Your SFTP user id will not open the API.
        </p>

        <div className="mt-6 rounded-xl border border-violet-200 bg-violet-50 p-5 text-sm text-violet-900">
          <p className="font-semibold">Your first connection is the handshake</p>
          <p className="mt-1">
            The server checks your user id and password, notes the address you connected from, and then
            refuses the session. That request goes to a CIDCO officer. Once they approve it, the same
            command signs you in and your uploads are accepted.
          </p>
        </div>

        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-bold text-slate-900">The flow at a glance</h2>
          <ol className="mt-3 space-y-2 text-sm text-slate-700">
            <li><strong>1. CIDCO emails you an SFTP user id and password</strong> — with the host, the port and the upload directory.</li>
            <li><strong>2. You connect</strong> — the connection is refused, and your handshake request lands on CIDCO&rsquo;s dashboard with your IP address and SSH client.</li>
            <li><strong>3. A CIDCO officer approves you</strong> — that whitelists the address you connected from. Watch for it on <code className={K}>/architect/sftp</code>.</li>
            <li><strong>4. You upload your workbook</strong> — <code className={K}>put readings.xlsx /upload/</code>. CIDCO parses the sheet the moment the transfer closes.</li>
            <li><strong>5. Both sides see the result</strong> — how many rows became readings, and which rows were rejected and why.</li>
          </ol>
        </div>

        <div className="mt-10 space-y-10">
          <Section id="connect" title="1. Connecting">
            <p>Any SFTP client works — FileZilla, WinSCP, or the command line:</p>
            <Code>{`sftp -P 2222 <your user id>@<cidco host>
# password: the one CIDCO emailed you`}</Code>
            <p>
              Password is the only accepted authentication method. After CIDCO approves you, connections
              must come from the whitelisted address — a connection from anywhere else is refused, and
              CIDCO sees the attempt.
            </p>
            <p className="text-xs text-slate-500">
              Your exact host, port and user id are on your dashboard at <code className={K}>/architect/sftp</code>,
              each with a copy button.
            </p>
          </Section>

          <Section id="workbook" title="2. The workbook">
            <p>
              Download the template from your dashboard, or{' '}
              <a href="/api/architect/sftp/template" className="font-semibold text-violet-700 hover:underline">
                take it here
              </a>
              . <strong>Row 1 is the header; every row after it is one reading.</strong> These are the
              columns CIDCO reads:
            </p>
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Column</th>
                    <th className="px-3 py-2 font-medium">Example</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {SHEET_COLUMNS.map((c) => (
                    <tr key={c.key}>
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-800">
                        {c.header}
                        {c.key === 'aqiValue' && <span className="ml-2 text-[10px] font-bold uppercase text-red-600">required</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-600">{String(c.example)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Common alternative spellings are accepted — <code className={K}>PM 2.5</code>,{' '}
              <code className={K}>NO₂</code>, <code className={K}>AQI</code>, <code className={K}>Timestamp</code>,{' '}
              <code className={K}>Site</code> — so a sheet you already keep will usually import as-is. Dates
              can be ISO 8601 text or real Excel date cells.
            </p>
          </Section>

          <Section id="upload" title="3. Uploading">
            <Code>{`sftp> put september-readings.xlsx /upload/`}</Code>
            <p>
              Only <code className={K}>.xlsx</code> workbooks are accepted; anything else is refused at the
              open. Files up to 25 MB are taken.
            </p>
            <p>
              <strong>Rows are independent.</strong> If one row fails validation it is recorded with its
              sheet row number and the reason, and every other row still imports — one typo never costs
              you the whole upload. Your dashboard then shows the upload as:
            </p>
            <ul className="list-disc space-y-1 pl-6">
              <li><code className={K}>PARSED</code> — every row became a reading.</li>
              <li><code className={K}>PARTIAL</code> — some rows imported, some were rejected (each one named).</li>
              <li><code className={K}>FAILED</code> — nothing could be imported, or the workbook could not be read.</li>
            </ul>
          </Section>

          <Section id="status" title="4. Where your handshake stands">
            <ul className="list-disc space-y-1 pl-6">
              <li><code className={K}>PENDING</code> — credentials issued; you have not connected yet.</li>
              <li><code className={K}>AWAITING_APPROVAL</code> — you connected; CIDCO must approve. Connections are refused meanwhile.</li>
              <li><code className={K}>ESTABLISHED</code> — approved; your uploads are accepted.</li>
              <li><code className={K}>REJECTED</code> — CIDCO refused the request; their note is on your dashboard.</li>
              <li><code className={K}>EXPIRED</code> / <code className={K}>REVOKED</code> — ask CIDCO for new credentials.</li>
            </ul>
            <p>
              Every step — the handshake request, the approval, each connection and each file — is written
              to your activity log, which both you and CIDCO can read.
            </p>
          </Section>
        </div>
      </div>
    </main>
  );
}
