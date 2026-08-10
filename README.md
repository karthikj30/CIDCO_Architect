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

| Route                      | Purpose                                                       |
| -------------------------- | ------------------------------------------------------------- |
| `/`                        | Public landing page                                            |
| `/register`                | Architect / CIDCO officer registration                         |
| `/login`                   | Sign in                                                        |
| `/dashboard`               | Totals, AQI averages, CPCB bands, recent submissions           |
| `/dashboard/reports`       | Searchable, filterable, paginated report list                  |
| `/dashboard/reports/[id]`  | Full report, board photographs, documents, review panel        |
| `/dashboard/upload`        | Method 1 — submit a report with document + board photos        |
| `/dashboard/csv`           | Method 2 — CSV upload with per-row results                     |
| `/dashboard/api-keys`      | Generate and revoke API keys                                   |
| `/docs/api`                | In-app API reference                                           |

Architects only ever see their own reports. CIDCO officers see every report and are the only
role that can change a report's status.

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

1. Import `postman/CIDCO-AQI-Portal.postman_collection.json`.
2. Check the `baseUrl` collection variable (`http://localhost:3000`).
3. **Auth → Login** with the seeded architect. The JWT is saved to `{{token}}` automatically.
4. **API Keys → Create API key**. The plaintext key is saved to `{{apiKey}}` automatically.
5. **Reports → Submit report (multipart)** — in the Body tab, pick a PDF for `document` and one
   or more images for `boardPhotos`, then send. The new report id is saved to `{{reportId}}`.
6. **Reports → Upload CSV** — pick `samples/sample-with-errors.csv` to see per-row validation.
7. **Auth → Login (CIDCO officer)** then **Reports → Review report** to approve it.

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
