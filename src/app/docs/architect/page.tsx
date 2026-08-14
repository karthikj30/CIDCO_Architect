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
            <p>Authenticate with the token. Two content types are accepted. Each call inserts one
              reading row, so a monitoring station can post on a schedule (e.g. every 3 hours).</p>
            <p className="font-medium text-slate-900">a) JSON — full monitoring-station payload:</p>
            <Code>{`POST /api/architect/data
Authorization: Bearer cidco_tok_xxxxxxxxxxxxxxxx
Content-Type: application/json

{
  "projectSiteId": "CIDCO-KHR-012",
  "monitoringStationId": "STN-KHR-07",
  "oem": "Aeroqual",
  "deviceModel": "AQY-1",
  "measuredAt": "2026-08-14T06:00:00Z",
  "aqiValue": 176,
  "pm25": 78.3, "pm10": 152.9,
  "no2": 41.2, "so2": 12.7, "co": 0.9, "ozone": 48.6,
  "temperature": 33.4, "humidity": 62.1,
  "integrationMethod": "Automated API (3h)",
  "otherParams": { "windSpeed": 3.2, "windDir": "NW", "noise_dB": 58 }
}`}</Code>
            <p className="text-sm text-slate-600">
              Parameters (all optional except <code className="rounded bg-slate-100 px-1">measuredAt</code>
              {' '}and <code className="rounded bg-slate-100 px-1">aqiValue</code>):
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 text-slate-500">
                  <tr><th className="py-2 pr-4 font-medium">Field</th><th className="py-2 pr-4 font-medium">Parameter</th><th className="py-2 font-medium">Also accepts</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-slate-700">
                  <tr><td className="py-1.5 pr-4">projectSiteId</td><td className="py-1.5 pr-4 font-sans text-slate-600">Project / Site ID</td><td className="py-1.5 font-sans text-slate-400">siteId, Project/Site ID</td></tr>
                  <tr><td className="py-1.5 pr-4">monitoringStationId</td><td className="py-1.5 pr-4 font-sans text-slate-600">AQI Monitoring Station / Device ID</td><td className="py-1.5 font-sans text-slate-400">stationId, deviceId</td></tr>
                  <tr><td className="py-1.5 pr-4">oem</td><td className="py-1.5 pr-4 font-sans text-slate-600">OEM</td><td className="py-1.5 font-sans text-slate-400">manufacturer</td></tr>
                  <tr><td className="py-1.5 pr-4">deviceModel</td><td className="py-1.5 pr-4 font-sans text-slate-600">Model</td><td className="py-1.5 font-sans text-slate-400">model</td></tr>
                  <tr><td className="py-1.5 pr-4">measuredAt</td><td className="py-1.5 pr-4 font-sans text-slate-600">Date &amp; Time of Reading (ISO 8601)</td><td className="py-1.5 font-sans text-slate-400">dateTime, timestamp</td></tr>
                  <tr><td className="py-1.5 pr-4">aqiValue</td><td className="py-1.5 pr-4 font-sans text-slate-600">AQI Value (0–1000)</td><td className="py-1.5 font-sans text-slate-400">aqi</td></tr>
                  <tr><td className="py-1.5 pr-4">pm25 / pm10</td><td className="py-1.5 pr-4 font-sans text-slate-600">PM2.5 / PM10</td><td className="py-1.5 font-sans text-slate-400">PM2.5, PM10</td></tr>
                  <tr><td className="py-1.5 pr-4">no2 / so2 / co / ozone</td><td className="py-1.5 pr-4 font-sans text-slate-600">NO₂ / SO₂ / CO / O₃</td><td className="py-1.5 font-sans text-slate-400">o3</td></tr>
                  <tr><td className="py-1.5 pr-4">temperature</td><td className="py-1.5 pr-4 font-sans text-slate-600">Temperature (°C)</td><td className="py-1.5 font-sans text-slate-400">temp</td></tr>
                  <tr><td className="py-1.5 pr-4">humidity</td><td className="py-1.5 pr-4 font-sans text-slate-600">Humidity (% RH)</td><td className="py-1.5 font-sans text-slate-400">rh</td></tr>
                  <tr><td className="py-1.5 pr-4">integrationMethod</td><td className="py-1.5 pr-4 font-sans text-slate-600">Data Source / Integration Method</td><td className="py-1.5 font-sans text-slate-400">dataSource</td></tr>
                  <tr><td className="py-1.5 pr-4">otherParams</td><td className="py-1.5 pr-4 font-sans text-slate-600">Other environmental parameters (object)</td><td className="py-1.5 font-sans text-slate-400">—</td></tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500">
              CIDCO stamps the <strong>Data Receipt Timestamp</strong> (<code className="rounded bg-slate-100 px-1">receivedAt</code>)
              on arrival — you don&rsquo;t send it. If you omit <code className="rounded bg-slate-100 px-1">siteName</code>/
              <code className="rounded bg-slate-100 px-1">location</code> (typical for a station feed), CIDCO fills them from the
              Project/Site and Station IDs.
            </p>
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
              returns a hint to raise a token request (next section).
            </p>
          </Section>

          <Section id="automate" title="3a. Automating the feed (every 3 hours)">
            <p>
              Each POST inserts one reading, so schedule the request to run on your interval and the
              database fills itself. In <strong>Postman</strong>:
            </p>
            <ul className="list-disc space-y-1 pl-6">
              <li>Open the <em>Send AQI data</em> request → <strong>⋯ → Schedule run</strong> (or create a <strong>Monitor</strong>).</li>
              <li>Set the interval to <strong>every 3 hours</strong>.</li>
              <li>Keep <code className="rounded bg-slate-100 px-1">{'Authorization: Bearer {{token}}'}</code> in the headers.</li>
              <li>Use the dynamic variable <code className="rounded bg-slate-100 px-1">{'{{$isoTimestamp}}'}</code> for <code className="rounded bg-slate-100 px-1">measuredAt</code> so every run stamps the current time.</li>
            </ul>
            <Code>{`{
  "monitoringStationId": "STN-KHR-07",
  "projectSiteId": "CIDCO-KHR-012",
  "measuredAt": "{{$isoTimestamp}}",
  "aqiValue": 176,
  "pm25": 78.3, "pm10": 152.9, "no2": 41.2, "so2": 12.7, "co": 0.9, "ozone": 48.6,
  "temperature": 33.4, "humidity": 62.1,
  "integrationMethod": "Automated API (3h)"
}`}</Code>
            <p className="text-xs text-slate-500">
              A token expires after 7 days, so a 3-hourly monitor keeps running until then — raise a
              renewal (next section) before it lapses. Any cron/scheduler that can send an HTTP POST
              works the same way.
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
