import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Architect API — CIDCO AQI Portal',
  description: 'How an architect validates, requests tokens, and sends AQI data to CIDCO.',
};

const METHOD_STYLES: Record<string, string> = {
  GET: 'bg-emerald-100 text-emerald-800',
  POST: 'bg-blue-100 text-blue-800',
  PATCH: 'bg-amber-100 text-amber-800',
  DELETE: 'bg-red-100 text-red-800',
};

function Endpoint({ method, path }: { method: string; path: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`inline-flex rounded px-2 py-0.5 text-xs font-bold ${METHOD_STYLES[method]}`}>{method}</span>
      <code className="font-mono text-sm font-semibold text-slate-900">{path}</code>
    </div>
  );
}

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

export default function ArchitectApiDocs() {
  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-6 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cidco-700 font-bold text-white">C</div>
          <div>
            <p className="text-sm font-semibold leading-tight">CIDCO</p>
            <p className="text-xs text-slate-500">Architect Integration API</p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-3xl font-bold text-slate-900">Architect Integration API</h1>
        <p className="mt-2 text-slate-600">
          This guide is for an architect&rsquo;s system integrating with the CIDCO AQI portal. You will
          <strong> validate</strong> a credential CIDCO issues you, have CIDCO <strong>generate an API
          token</strong>, <strong>send AQI data</strong> with that token, and <strong>request a new
          token</strong> when it expires. Everything here is testable from Postman.
        </p>

        <div className="mt-6 rounded-xl border border-cidco-200 bg-cidco-50 p-5 text-sm text-cidco-900">
          <p className="font-semibold">Response envelope</p>
          <p className="mt-1">
            Every endpoint returns{' '}
            <code className="rounded bg-white px-1.5 py-0.5 text-xs">{'{ "success": boolean, "data" | "error" }'}</code>.
            A Postman collection (<code className="rounded bg-white px-1">postman/CIDCO-Architect-Handshake.postman_collection.json</code>)
            chains the whole flow and saves the clientId, secret and token into collection variables automatically.
          </p>
        </div>

        {/* Flow overview */}
        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-bold text-slate-900">The flow at a glance</h2>
          <ol className="mt-3 space-y-2 text-sm text-slate-700">
            <li><strong>1. CIDCO issues you a credential</strong> — a JSON bundle <code className="rounded bg-slate-100 px-1">{'{ clientId, clientSecret, expiryDate }'}</code>. (CIDCO does this from its dashboard and sends it to you.)</li>
            <li><strong>2. You validate</strong> — <code className="rounded bg-slate-100 px-1">POST /api/architect/validate</code>. Correct credentials → <strong>200 OK</strong> and the two-way channel is established. Wrong/expired → <strong>504</strong>.</li>
            <li><strong>3. CIDCO generates an API token</strong> for the established handshake (7-day expiry by default), and sends it to you.</li>
            <li><strong>4. You send AQI data</strong> — <code className="rounded bg-slate-100 px-1">POST /api/architect/data</code> with <code className="rounded bg-slate-100 px-1">Authorization: Bearer &lt;token&gt;</code>. It is stored in CIDCO&rsquo;s database.</li>
            <li><strong>5. When the token nears expiry, you raise a request</strong> — <code className="rounded bg-slate-100 px-1">POST /api/architect/token-requests</code>. CIDCO approves and issues a fresh token.</li>
            <li><strong>Anytime</strong> — check <code className="rounded bg-slate-100 px-1">/api/architect/status</code> and <code className="rounded bg-slate-100 px-1">/api/architect/logs</code>.</li>
          </ol>
        </div>

        <div className="mt-10 space-y-10">
          <Section id="credential" title="0. The credential CIDCO sends you">
            <p>CIDCO issues this JSON. Keep the <code className="rounded bg-slate-100 px-1">clientSecret</code> safe — it is shown only once.</p>
            <Code>{`{
  "clientId": "ARCH-582397C8A863",
  "clientSecret": "hs_sec_50fda6539cf711974dc4e983c86ae95a...",
  "expiryDate": "2026-09-13T07:00:39.540Z",
  "validateUrl": "https://<cidco-host>/api/architect/validate",
  "tokenRequestUrl": "https://<cidco-host>/api/architect/token-requests",
  "dataUrl": "https://<cidco-host>/api/architect/data",
  "logsUrl": "https://<cidco-host>/api/architect/logs"
}`}</Code>
          </Section>

          <Section id="validate" title="1. Validate — establish the two-way channel">
            <Endpoint method="POST" path="/api/architect/validate" />
            <p>Send the clientId and clientSecret CIDCO issued you.</p>
            <Code>{`POST /api/architect/validate
Content-Type: application/json

{
  "clientId": "ARCH-582397C8A863",
  "clientSecret": "hs_sec_50fda6539cf711974dc4e983c86ae95a..."
}`}</Code>
            <p><strong>200 OK</strong> — validated, channel established:</p>
            <Code>{`{
  "success": true,
  "data": {
    "message": "Validated. Two-way communication established with CIDCO.",
    "established": true,
    "handshake": { "clientId": "ARCH-582397C8A863", "status": "ESTABLISHED", ... }
  }
}`}</Code>
            <p>
              <strong>504</strong> — validation failed (unknown clientId, wrong secret, expired or
              revoked credential). In the CIDCO protocol, 504 specifically means &ldquo;handshake not
              validated&rdquo;:
            </p>
            <Code>{`HTTP/1.1 504 Gateway Timeout
{ "success": false, "error": "Validation failed: Invalid clientSecret" }`}</Code>
          </Section>

          <Section id="token" title="2. Get your API token">
            <p>
              Once your handshake is <strong>ESTABLISHED</strong>, CIDCO generates an API token for it
              (using your clientId + secret) and sends it to you. Tokens expire — 7 days by default.
              You do not call this endpoint yourself; CIDCO issues the token to you. The token looks
              like <code className="rounded bg-slate-100 px-1">cidco_tok_…</code>.
            </p>
          </Section>

          <Section id="data" title="3. Send AQI data">
            <Endpoint method="POST" path="/api/architect/data" />
            <p>Authenticate with the token. Two content types are accepted.</p>
            <p className="font-medium text-slate-900">a) JSON (readings only):</p>
            <Code>{`POST /api/architect/data
Authorization: Bearer cidco_tok_xxxxxxxxxxxxxxxx
Content-Type: application/json

{
  "siteName": "Kharghar Sector 12 Site",
  "location": "Kharghar, Navi Mumbai",
  "measuredAt": "2026-08-12T09:30:00Z",
  "aqiValue": 168,
  "pm25": 72.1, "pm10": 150.4,
  "latitude": 19.0330, "longitude": 73.0630,
  "projectCode": "CIDCO-KHR-012",
  "remarks": "Morning reading"
}`}</Code>
            <p className="font-medium text-slate-900">b) multipart/form-data (readings + signed document + AQI board photos):</p>
            <Code>{`POST /api/architect/data
Authorization: Bearer cidco_tok_xxxxxxxxxxxxxxxx
Content-Type: multipart/form-data

siteName=Kharghar Sector 12 Site
location=Kharghar, Navi Mumbai
measuredAt=2026-08-12T09:30:00Z
aqiValue=168
document=<file>        # signed AQI report (PDF/DOC/DOCX/TXT)
boardPhotos=<file>     # photo of the AQI display board (repeatable)`}</Code>
            <p><strong>201 Created</strong> — stored, with a CIDCO reference number:</p>
            <Code>{`{
  "success": true,
  "data": {
    "message": "AQI data received by CIDCO and stored.",
    "report": { "referenceNo": "CIDCO/AQI/2026/00020", "aqiValue": 168, "receivedAt": "..." }
  }
}`}</Code>
            <p>
              <strong>401</strong> — missing / invalid / <em>expired</em> token. An expired token
              returns a hint to raise a token request (next section). Required fields:{' '}
              <code className="rounded bg-slate-100 px-1">siteName</code>,{' '}
              <code className="rounded bg-slate-100 px-1">location</code>,{' '}
              <code className="rounded bg-slate-100 px-1">measuredAt</code> (ISO 8601),{' '}
              <code className="rounded bg-slate-100 px-1">aqiValue</code> (0–1000).
            </p>
          </Section>

          <Section id="renew" title="4. Request a new token (renewal)">
            <Endpoint method="POST" path="/api/architect/token-requests" />
            <p>Because tokens expire, raise a request when yours is close to expiry. Authenticate with your handshake credentials.</p>
            <Code>{`POST /api/architect/token-requests
Content-Type: application/json

{
  "clientId": "ARCH-582397C8A863",
  "clientSecret": "hs_sec_...",
  "reason": "Current token expiring soon"
}`}</Code>
            <Code>{`{
  "success": true,
  "data": { "request": { "id": "...", "status": "PENDING", "requestedAt": "..." } }
}`}</Code>
            <p>CIDCO reviews the request and issues a fresh token (7-day expiry), which it sends to you.</p>
          </Section>

          <Section id="status-logs" title="5. Status & logs">
            <Endpoint method="GET" path="/api/architect/status" />
            <Endpoint method="GET" path="/api/architect/logs" />
            <p>
              Both accept either <code className="rounded bg-slate-100 px-1">Authorization: Bearer &lt;token&gt;</code>{' '}
              or the headers <code className="rounded bg-slate-100 px-1">x-client-id</code> and{' '}
              <code className="rounded bg-slate-100 px-1">x-client-secret</code> (so you can check
              status before a token exists). Logs are timestamped and cover every validation, token
              event and data transfer for your handshake.
            </p>
            <Code>{`GET /api/architect/logs
x-client-id: ARCH-582397C8A863
x-client-secret: hs_sec_...

{ "success": true, "data": { "count": 6, "logs": [
  { "createdAt": "...", "direction": "ARCHITECT_TO_ADMIN", "event": "DATA_RECEIVED", "statusCode": 201 },
  ...
] } }`}</Code>
          </Section>

          <Section id="errors" title="Status codes">
            <ul className="list-disc space-y-1 pl-6">
              <li><code className="rounded bg-slate-100 px-1">200</code> — validation succeeded / read OK.</li>
              <li><code className="rounded bg-slate-100 px-1">201</code> — token request raised / data stored.</li>
              <li><code className="rounded bg-slate-100 px-1">401</code> — missing/invalid/expired token on the data endpoint.</li>
              <li><code className="rounded bg-slate-100 px-1">409</code> — handshake not yet established (validate first).</li>
              <li><code className="rounded bg-slate-100 px-1">422</code> — invalid body (validation errors are listed under <code className="rounded bg-slate-100 px-1">details</code>).</li>
              <li><code className="rounded bg-slate-100 px-1">504</code> — <strong>handshake validation failed</strong> (CIDCO protocol convention).</li>
            </ul>
          </Section>
        </div>
      </div>
    </main>
  );
}
