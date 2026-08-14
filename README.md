# CIDCO AQI Compliance Portal

A Next.js 15 dashboard where empanelled architects submit Air Quality Index (AQI) reports to
CIDCO (City and Industrial Development Corporation of Maharashtra), backed by PostgreSQL.

Reports reach CIDCO through **two channels**:

1. **API push** — the architect's own system authenticates with a CIDCO-issued API key and
   `POST`s the report document together with photographs of the on-site AQI display board to
   `POST /api/reports`.
2. **CSV upload** — the architect uploads a CSV of readings through the dashboard (or
   `POST /api/reports/csv`). Every row is validated on its own, so one bad row does not sink
   the file — the response names each rejected row and why.

Both channels land in the same table and are reviewed by CIDCO officers in the same workflow.

The web UI is a **single-screen CIDCO admin portal** at `/` with two groups of tabs:

- **Tools** — an in-browser API Tester and a live API request log.
- **CIDCO Admin** (officer sign-in) — Architect Handshakes, Token Requests, and Communication Logs
  for the handshake integration described next.

---

## Architect ⇄ CIDCO handshake & token integration

A mutual-validation, token-based channel between an architect's system and CIDCO. The **admin
manages it from the dashboard**; the **architect drives it from Postman** — there is no architect UI.

**The flow**

1. **CIDCO issues a credential** — the officer issues `{ clientId, clientSecret, expiryDate }` for an
   architect from the *Architect Handshakes* tab. The secret is shown once.
2. **Architect validates** — `POST /api/architect/validate` with the credential. Correct → **200 OK**
   and the two-way channel is `ESTABLISHED`; wrong/expired → **504** (CIDCO's "not validated" code).
3. **CIDCO generates a token** — for the established handshake, using the `clientId` + `clientSecret`.
   Tokens expire, **7 days by default**.
4. **Architect sends data** — `POST /api/architect/data` with `Authorization: Bearer <token>`. The
   reading is written to PostgreSQL automatically.
5. **Renewal** — the architect raises `POST /api/architect/token-requests`; the officer approves it
   from the *Token Requests* tab and a fresh 7-day token is issued.
6. **Logs** — every step is recorded with a timestamp and shown to the officer as a chronological
   **activity timeline** — on each handshake's *Manage* panel and in the *Communication Logs* tab
   (filter by handshake, Timeline/Table views, live refresh; `GET /api/admin/comm-logs`) — and to
   the architect (`GET /api/architect/logs`).

**Admin endpoints** (CIDCO officer session):

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/api/admin/handshakes` | Issue credentials for an architect (returns the credential JSON once) |
| `GET` | `/api/admin/handshakes` | List handshakes and their state |
| `GET` | `/api/admin/handshakes/:id` | Handshake detail: tokens, requests, comm log |
| `POST` | `/api/admin/handshakes/:id/tokens` | Generate an API token (needs `clientId` + `clientSecret`, default 7-day expiry) |
| `POST` | `/api/admin/handshakes/:id/revoke` | Revoke the handshake and all its tokens |
| `GET` | `/api/admin/token-requests` | List renewal requests |
| `POST` | `/api/admin/token-requests/:id/approve` | Approve a request, issue a fresh token |
| `GET` | `/api/admin/comm-logs` | Timestamped communication trail |

**Architect endpoints** (credentials / token, from Postman):

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| `POST` | `/api/architect/validate` | clientId + secret | Validate → 200 established / 504 rejected |
| `POST` | `/api/architect/data` | Bearer token | Send an AQI reading (JSON or multipart) → stored |
| `POST` | `/api/architect/token-requests` | clientId + secret | Raise a token renewal request |
| `GET` | `/api/architect/status` | token or clientId+secret headers | Handshake / token status |
| `GET` | `/api/architect/logs` | token or clientId+secret headers | Timestamped exchange log |

Full architect guide: **`/docs/architect`** (in-app) and **`docs/ARCHITECT_API.md`**. Postman
collection: **`postman/CIDCO-Architect-Handshake.postman_collection.json`** — it chains the whole
flow and saves the clientId, secret and token into collection variables automatically.

> **Note on 504.** The spec calls for `504` when handshake validation fails (normally you'd use 401).
> This convention is honoured deliberately and documented for the architect.

---

## Stack

| Layer     | Choice                                            |
| --------- | ------------------------------------------------- |
| Framework | Next.js 15 (App Router, React 19, TypeScript)     |
| Database  | PostgreSQL via Prisma ORM                         |
| Auth      | bcrypt passwords, JWT (`jose`) in an httpOnly cookie, plus API keys for machine-to-machine |
| Styling   | Tailwind CSS                                      |
| CSV       | PapaParse                                         |

---

## Setup

### 1. Requirements

- Node.js 18.18+ (developed on 22.x)
- PostgreSQL 14+

### 2. Install

```bash
npm install
```

### 3. Create the database

```bash
createdb cidco_aqi
# or:
psql -c "CREATE DATABASE cidco_aqi;"
```

### 4. Configure the environment

```bash
cp .env.example .env
```

Then edit `.env`:

```env
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/cidco_aqi?schema=public"
JWT_SECRET="a-long-random-string"
UPLOAD_DIR="./uploads"
```

### 5. Create the tables and seed demo data

```bash
npx prisma migrate deploy   # applies prisma/migrations
npm run db:seed
```

Seeded accounts (password `Password123` for both):

| Role          | Email                  |
| ------------- | ---------------------- |
| Architect     | architect@example.com  |
| CIDCO officer | officer@cidco.example  |

### 6. Run

```bash
npm run dev        # http://localhost:3000
```

Production:

```bash
npm run build && npm start
```

---

## Pages

The UI is a single-screen portal at `/` (tabs), plus the architect docs page:

| Route              | Purpose                                                                 |
| ------------------ | ----------------------------------------------------------------------- |
| `/`                | CIDCO admin portal — API Tester, API Logs, and the CIDCO Admin tabs (Architect Handshakes, Token Requests, Communication Logs) |
| `/docs/architect`  | Architect integration guide (validation, tokens, sending data)          |

The **CIDCO Admin** tabs require a CIDCO officer sign-in (seeded: `officer@cidco.example` /
`Password123`); the sign-in reuses the existing `/api/auth/*` session. Architects have no UI —
they use the `/api/architect/*` endpoints from Postman.

---

## API

Every response uses the same envelope:

```jsonc
{ "success": true,  "data":  { /* ... */ } }
{ "success": false, "error": "message", "details": { /* field errors */ } }
```

### Authentication

Three interchangeable credentials are accepted on the data endpoints:

| Credential          | Header                              | Best for                       |
| ------------------- | ----------------------------------- | ------------------------------ |
| API key             | `X-API-Key: cidco_live_...`         | The architect's server         |
| API key (bearer)    | `Authorization: Bearer cidco_live_…`| Same, if a client prefers it   |
| JWT                 | `Authorization: Bearer eyJ...`      | Postman after `/api/auth/login`|
| Session cookie      | set automatically                   | The browser dashboard          |

API keys are stored only as a SHA-256 hash — the plaintext value is shown exactly once, at
creation.

### Endpoints

| Method   | Path                       | Auth                  | Description                                        |
| -------- | -------------------------- | --------------------- | -------------------------------------------------- |
| `GET`    | `/api/health`              | none                  | Liveness + database check                           |
| `POST`   | `/api/auth/register`       | none                  | Create an account, returns a JWT                    |
| `POST`   | `/api/auth/login`          | none                  | Sign in, returns a JWT                              |
| `POST`   | `/api/auth/logout`         | session               | Clear the session cookie                            |
| `GET`    | `/api/auth/me`             | any                   | Caller identity + which credential was used         |
| `GET`    | `/api/api-keys`            | session / JWT         | List your keys (prefix only)                        |
| `POST`   | `/api/api-keys`            | session / JWT         | Issue a key (plaintext returned once)               |
| `DELETE` | `/api/api-keys/:id`        | session / JWT         | Revoke a key                                        |
| `POST`   | `/api/reports`             | any                   | **Method 1** — submit a report (multipart or JSON)  |
| `GET`    | `/api/reports`             | any                   | List reports (`page`, `pageSize`, `status`, `source`, `q`) |
| `GET`    | `/api/reports/:id`         | any                   | Full report with attachment download URLs           |
| `DELETE` | `/api/reports/:id`         | any                   | Withdraw a report while still `SUBMITTED`           |
| `POST`   | `/api/reports/csv`         | any                   | **Method 2** — bulk CSV upload                      |
| `GET`    | `/api/reports/csv`         | none                  | Download a CSV template                             |
| `PATCH`  | `/api/reports/:id/review`  | CIDCO officer         | Change a report's status                            |
| `GET`    | `/api/files/:id`           | owner / officer       | Stream an attachment                                |
| `GET`    | `/api/stats`               | any                   | Dashboard aggregates                                |

### Method 1 — API push

`POST /api/reports` as `multipart/form-data`:

| Field         | Required | Notes                                                        |
| ------------- | -------- | ------------------------------------------------------------ |
| `siteName`    | yes      |                                                              |
| `location`    | yes      |                                                              |
| `measuredAt`  | yes      | ISO 8601, e.g. `2026-08-01T09:30:00Z`                        |
| `aqiValue`    | yes      | Integer 0–1000                                               |
| `pm25`, `pm10`, `so2`, `no2`, `co`, `ozone` | no | Numeric                            |
| `latitude`, `longitude`                     | no | Numeric                            |
| `projectCode` | no       | Links the report to a CIDCO project (e.g. `CIDCO-KHR-012`)   |
| `remarks`     | no       |                                                              |
| `document`    | no       | PDF / DOC / DOCX / TXT / image, max 15 MB                    |
| `boardPhotos` | yes\*    | Photo of the AQI display board; repeat the field for several |

\* Required for multipart submissions. A pure `application/json` body (no attachments at all) is
also accepted for readings-only integrations.

```bash
curl -X POST http://localhost:3000/api/reports \
  -H "X-API-Key: cidco_live_xxxxxxxx" \
  -F 'siteName=Kharghar Sector 12 Site' \
  -F 'location=Kharghar, Navi Mumbai' \
  -F 'measuredAt=2026-08-01T09:30:00Z' \
  -F 'aqiValue=148' \
  -F 'pm25=62.4' \
  -F 'projectCode=CIDCO-KHR-012' \
  -F 'document=@aqi-report.pdf' \
  -F 'boardPhotos=@board-front.jpg' \
  -F 'boardPhotos=@board-side.jpg'
```

### Method 2 — CSV upload

`POST /api/reports/csv` as `multipart/form-data` with a single `file` field.

Required columns: `siteName`, `location`, `measuredAt`, `aqiValue`.
Optional: `pm25`, `pm10`, `so2`, `no2`, `co`, `ozone`, `latitude`, `longitude`, `remarks`,
`projectCode`.

Friendlier header spellings are accepted too — `Site Name`, `Date`, `AQI`, `PM2.5`, `lat`,
`lng`, `notes`, `project`.

```bash
curl -X POST http://localhost:3000/api/reports/csv \
  -H "X-API-Key: cidco_live_xxxxxxxx" \
  -F 'file=@samples/sample-aqi-readings.csv'
```

The response reports each row individually:

```json
{
  "success": true,
  "data": {
    "totalRows": 3,
    "createdCount": 2,
    "failedCount": 1,
    "created": [{ "row": 2, "referenceNo": "CIDCO/AQI/2026/00004", "aqiValue": 96 }],
    "errors": [{ "row": 4, "message": "Validation failed", "details": { "measuredAt": ["measuredAt must be a valid ISO date"] } }]
  }
}
```

Sample files live in `samples/` — `sample-aqi-readings.csv` (all valid) and
`sample-with-errors.csv` (alias headers plus two deliberately bad rows).

---

## Testing with Postman

Two collections are provided:

**`postman/CIDCO-Architect-Handshake.postman_collection.json`** — the handshake + token flow.

1. **Admin → Officer login** (sets the session cookie).
2. **Admin → Issue handshake credentials** — clientId + secret saved to variables.
3. **Architect → Validate** — 200 establishes the channel (a companion request shows the 504 case).
4. **Admin → Generate token** — 7-day token saved to `{{token}}`.
5. **Architect → Send AQI data** — posts a reading with the Bearer token.
6. **Architect → Raise token request** → **Admin → List / Approve token request** — the renewal loop.

**`postman/CIDCO-AQI-Portal.postman_collection.json`** — the original reports/API-key flow.

1. Check the `baseUrl` collection variable (`http://localhost:3000`).
2. **Auth → Login** with the seeded architect. The JWT is saved to `{{token}}` automatically.
3. **API Keys → Create API key**. The plaintext key is saved to `{{apiKey}}` automatically.
4. **Reports → Submit report (multipart)** — in the Body tab, pick a PDF for `document` and one
   or more images for `boardPhotos`, then send. The new report id is saved to `{{reportId}}`.
5. **Reports → Upload CSV** — pick `samples/sample-with-errors.csv` to see per-row validation.

Postman cannot store binary files inside a collection, so the file fields ship empty by design —
select your own files before sending.

---

## Data model

- **User** — architect or CIDCO officer; firm name and Council of Architecture number for architects.
- **ApiKey** — hashed key, prefix for display, last-used timestamp, revocation.
- **Project** — CIDCO project a report can be attached to via `projectCode`.
- **Report** — the reading itself: AQI, pollutants, coordinates, source channel, review state.
- **Attachment** — `DOCUMENT`, `AQI_BOARD_PHOTO`, `CSV_SOURCE` or `OTHER`, stored on disk under
  `UPLOAD_DIR` with a random name and served only through the authorised `/api/files/:id` route.
- **AuditLog** — registrations, logins, submissions, reviews and key lifecycle events.
- **ApiRequestLog** — method, endpoint, status, duration and IP of every logged API request (the
  *API Logs* tab). Bodies are omitted for endpoints that carry secrets.
- **ArchitectHandshake** — an issued credential: `clientId`, hashed secret, credential expiry, and
  status (`PENDING → ESTABLISHED → EXPIRED | REVOKED`).
- **IntegrationToken** — a hashed, expiring bearer token for an established handshake.
- **TokenRequest** — an architect's renewal request (`PENDING → FULFILLED | REJECTED`).
- **CommunicationLog** — the timestamped handshake / data-transfer trail (never stores secrets).

Report status flows `SUBMITTED → UNDER_REVIEW → APPROVED | REJECTED`.

---

## Notes for production

- Set a strong `JWT_SECRET`; cookies are marked `secure` automatically when `NODE_ENV=production`.
- `UPLOAD_DIR` is local disk. Point it at a mounted volume, or swap `src/lib/storage.ts` for S3
  if you deploy to a platform with an ephemeral filesystem.
- Uploads are capped at 15 MB per file and restricted by MIME type in `src/lib/storage.ts`.

## Scripts

| Command             | Description                          |
| ------------------- | ------------------------------------ |
| `npm run dev`       | Development server on port 3000      |
| `npm run build`     | Generate the Prisma client and build |
| `npm start`         | Production server                    |
| `npm run db:migrate`| Create/apply a migration             |
| `npm run db:push`   | Push the schema without a migration  |
| `npm run db:seed`   | Seed demo users, projects, reports   |
| `npm run db:studio` | Prisma Studio                        |
