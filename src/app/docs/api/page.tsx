import Link from 'next/link';

export const metadata = { title: 'API documentation · CIDCO AQI Portal' };

type Endpoint = {
  method: string;
  path: string;
  auth: string;
  description: string;
  body?: string;
};

const ENDPOINTS: Endpoint[] = [
  {
    method: 'GET',
    path: '/api/health',
    auth: 'None',
    description: 'Liveness probe; also verifies the PostgreSQL connection.',
  },
  {
    method: 'POST',
    path: '/api/auth/register',
    auth: 'None',
    description: 'Create an architect or CIDCO officer account. Returns a JWT and sets a session cookie.',
    body: `{
  "name": "Anita Deshmukh",
  "email": "anita@studio.example",
  "password": "SecurePass123",
  "firmName": "Deshmukh Associates",
  "councilRegNo": "CA/2019/12345",
  "phone": "+91 98200 11223",
  "role": "ARCHITECT"
}`,
  },
  {
    method: 'POST',
    path: '/api/auth/login',
    auth: 'None',
    description: 'Sign in. Returns a JWT you can send as a Bearer token from Postman.',
    body: `{ "email": "anita@studio.example", "password": "SecurePass123" }`,
  },
  { method: 'GET', path: '/api/auth/me', auth: 'Session · JWT · API key', description: 'Returns the caller identity and which credential was used.' },
  { method: 'POST', path: '/api/auth/logout', auth: 'Session', description: 'Clears the session cookie.' },
  {
    method: 'POST',
    path: '/api/api-keys',
    auth: 'Session · JWT',
    description: 'Issues an API key for machine-to-machine submissions. The plaintext key is returned once.',
    body: `{ "label": "Site monitoring server" }`,
  },
  { method: 'GET', path: '/api/api-keys', auth: 'Session · JWT', description: 'Lists your keys (prefix only).' },
  { method: 'DELETE', path: '/api/api-keys/:id', auth: 'Session · JWT', description: 'Revokes a key.' },
  {
    method: 'POST',
    path: '/api/reports',
    auth: 'API key · Session · JWT',
    description:
      'Method 1 — submit an AQI report. multipart/form-data with fields plus "document" and one or more "boardPhotos" files, or application/json with no attachments.',
    body: `# multipart/form-data fields
siteName      = Kharghar Sector 12 Site
location      = Kharghar, Navi Mumbai
measuredAt    = 2026-08-01T09:30:00Z
aqiValue      = 148
pm25          = 62.4          (optional)
pm10          = 120.5         (optional)
so2, no2, co, ozone           (optional)
latitude, longitude           (optional)
projectCode   = CIDCO-KHR-012 (optional)
remarks       = Morning reading (optional)
document      = <file>        AQI report PDF
boardPhotos   = <file>        photo of the AQI display board (repeatable)`,
  },
  {
    method: 'POST',
    path: '/api/reports/csv',
    auth: 'API key · Session · JWT',
    description:
      'Method 2 — bulk upload. multipart/form-data with a single "file" field. Each row is validated independently; the response lists created rows and per-row errors.',
  },
  { method: 'GET', path: '/api/reports/csv', auth: 'None', description: 'Downloads a CSV template with the expected headers.' },
  {
    method: 'GET',
    path: '/api/reports',
    auth: 'API key · Session · JWT',
    description: 'Lists reports. Query params: page, pageSize, status, source, q. Architects see only their own.',
  },
  { method: 'GET', path: '/api/reports/:id', auth: 'API key · Session · JWT', description: 'Full report with attachment download URLs.' },
  { method: 'DELETE', path: '/api/reports/:id', auth: 'API key · Session · JWT', description: 'Withdraw a report while it is still SUBMITTED.' },
  {
    method: 'PATCH',
    path: '/api/reports/:id/review',
    auth: 'CIDCO officer',
    description: 'Move a report through its review workflow.',
    body: `{ "status": "APPROVED", "reviewNote": "Verified against site board photo" }`,
  },
  { method: 'GET', path: '/api/files/:attachmentId', auth: 'Owner · CIDCO officer', description: 'Streams an attachment.' },
  { method: 'GET', path: '/api/stats', auth: 'API key · Session · JWT', description: 'Dashboard totals, status/source breakdown and AQI aggregates.' },
];

const METHOD_STYLES: Record<string, string> = {
  GET: 'bg-emerald-100 text-emerald-800',
  POST: 'bg-blue-100 text-blue-800',
  PATCH: 'bg-amber-100 text-amber-800',
  DELETE: 'bg-red-100 text-red-800',
};

export default function ApiDocsPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Link href="/dashboard" className="text-sm text-cidco-700 hover:underline">
        ← Back to dashboard
      </Link>
      <h1 className="mt-3 text-3xl font-bold text-slate-900">CIDCO AQI Portal API</h1>
      <p className="mt-2 text-slate-600">
        Every endpoint returns{' '}
        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-sm">
          {'{ success: boolean, data | error }'}
        </code>
        . Authenticate with an API key (<code className="rounded bg-slate-100 px-1 text-sm">X-API-Key</code>{' '}
        header) or a JWT from <code className="rounded bg-slate-100 px-1 text-sm">/api/auth/login</code>.
      </p>

      <div className="mt-6 rounded-xl border border-cidco-200 bg-cidco-50 p-5 text-sm text-cidco-900">
        <p className="font-semibold">Testing with Postman</p>
        <p className="mt-1">
          Import <code className="rounded bg-white px-1">postman/CIDCO-AQI-Portal.postman_collection.json</code>{' '}
          from the repository. Run <em>Register</em> or <em>Login</em> first — the collection saves the JWT and
          any generated API key into collection variables automatically.
        </p>
      </div>

      <div className="mt-8 space-y-4">
        {ENDPOINTS.map((endpoint) => (
          <div key={`${endpoint.method} ${endpoint.path}`} className="card p-5">
            <div className="flex flex-wrap items-center gap-3">
              <span className={`badge border-transparent ${METHOD_STYLES[endpoint.method]}`}>
                {endpoint.method}
              </span>
              <code className="font-mono text-sm font-semibold text-slate-900">{endpoint.path}</code>
              <span className="ml-auto text-xs text-slate-500">Auth: {endpoint.auth}</span>
            </div>
            <p className="mt-3 text-sm text-slate-600">{endpoint.description}</p>
            {endpoint.body && (
              <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100">
                {endpoint.body}
              </pre>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
