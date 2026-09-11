# CIDCO SFTP Channel

The second way an architect delivers AQI data to CIDCO: an **Excel workbook uploaded over SFTP**.

It is deliberately separate from the [API channel](./ARCHITECT_API.md) — different credentials,
different dashboards, a different transport. An SFTP user id will not open the API, and an API
client id will not open the SFTP server.

Everyone starts at the portal's front door (`/`), signs in, and picks the channel they work in.
The SFTP dashboards are `/cidco/sftp` for officers and `/architect/sftp` for architects.

---

## The flow

| # | Who | Action | Where |
|---|-----|--------|-------|
| 1 | CIDCO | Issues an SFTP user id and password and emails it to the architect | `/cidco/sftp` → SFTP accounts |
| 2 | Architect | Connects to the SFTP server with that user id and password | their SFTP client |
| 3 | CIDCO | Sees the handshake request — who, from which IP, with which client — and approves it | `/cidco/sftp` → Handshake requests |
| 4 | Architect | Connects again and uploads the filled-in `.xlsx` workbook | their SFTP client |
| 5 | CIDCO | Previews the sheet and reads the imported readings | `/cidco/sftp` → Delivered workbooks |

**The architect's first connection is the handshake.** The server verifies the credentials, records
the address and SSH client it came from, and then *refuses the session*. Nothing is accepted until a
CIDCO officer approves it. That approval whitelists the address; later connections from anywhere
else are refused.

---

## 1. The credentials CIDCO sends

Issued from the dashboard, emailed out of band. The password is shown exactly once.

```json
{
  "username": "sftp_6d94ababfb",
  "password": "xQ8w…",
  "expiryDate": "2026-10-11T05:08:00.000Z",
  "protocol": "SFTP (SSH File Transfer Protocol)",
  "host": "cidco.example.gov.in",
  "port": 2222,
  "uploadDir": "/upload",
  "fileTypes": ".xlsx workbooks"
}
```

## 2. Connecting

Any SFTP client works — FileZilla, WinSCP, or the `sftp` command:

```bash
sftp -P 2222 sftp_6d94ababfb@cidco.example.gov.in
# password: the one CIDCO emailed you
```

- **First time** the server refuses you: `Permission denied`. That is expected — your request is now
  on CIDCO's dashboard. Check `/architect/sftp` to watch it.
- **After CIDCO approves**, the same command opens a session.

Password is the only accepted authentication method, and only `.xlsx` files are accepted.

## 3. The workbook

Download the template from `/architect/sftp` (or `GET /api/architect/sftp/template`). **Row 1 is the
header; every row after it is one reading.** The columns are the same AQI parameters the API channel
takes:

| Column | Notes |
|--------|-------|
| Project / Site ID | |
| Monitoring Station / Device ID | |
| OEM | |
| Model | |
| Site Name | falls back to the site/station id when blank |
| Location | |
| Date & Time of Reading | ISO 8601, or a real Excel date cell |
| AQI Value | **required**, whole number |
| PM2.5, PM10, NO2, SO2, CO, O3 | |
| Temperature, Humidity | |
| Other Parameters | free text, stored as a note |
| Data Source / Integration Method | defaults to "SFTP Excel upload" |

Common alternative spellings are accepted (`PM 2.5`, `NO₂`, `AQI`, `Timestamp`, `Site`, …), so a
sheet an architect already keeps will usually import as-is.

## 4. Uploading

```bash
sftp> put september-readings.xlsx /upload/
```

The moment the transfer closes, CIDCO stores the file, parses the sheet and imports the rows.

**Rows are independent.** A row that fails validation is recorded with its sheet row number and the
reason; every other row still imports. An upload is then marked:

| Status | Meaning |
|--------|---------|
| `PARSED` | every row became a reading |
| `PARTIAL` | some rows imported, some were rejected |
| `FAILED` | nothing could be imported (or the workbook could not be read) |
| `RECEIVED` | on disk, not parsed yet |

Both sides see the outcome row by row: the architect at `/architect/sftp`, CIDCO at `/cidco/sftp`.

---

## Running the server

The SFTP server is a separate process from the Next.js app:

```bash
npm run sftp      # listens on SFTP_PORT (default 2222)
```

| Variable | Default | Purpose |
|----------|---------|---------|
| `SFTP_PORT` | `2222` | port the SFTP server listens on |
| `SFTP_HOST` | `0.0.0.0` | interface it binds to |
| `SFTP_STORAGE_DIR` | `./storage/sftp` | uploaded workbooks and the SSH host key |
| `SFTP_PUBLIC_HOST` | request host | hostname shown to architects in the dashboards |

The SSH host key is generated on first boot and kept under `SFTP_STORAGE_DIR`, so architects' clients
do not warn about a changed key on every restart. That directory is gitignored — it holds the host
key and every workbook received.

---

## HTTP endpoints behind the dashboards

Officer-only, session-authenticated — the file transfer itself is SFTP, not HTTP.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/sftp/accounts` | Every SFTP account and what it has delivered |
| `POST` | `/api/admin/sftp/accounts` | Issue an SFTP user id + password (returned once) |
| `GET` | `/api/admin/sftp/validation-requests` | The handshake approval queue |
| `POST` | `/api/admin/sftp/validation-requests/:id/approve` | Whitelist the address and open the channel |
| `POST` | `/api/admin/sftp/validation-requests/:id/reject` | Refuse it; the server keeps blocking them |
| `GET` | `/api/admin/sftp/uploads` | Every delivered workbook |
| `GET` | `/api/admin/sftp/uploads/:id` | One workbook: the full sheet preview and per-row results |

Architect, session-authenticated:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/architect/sftp/me` | Their account, connection details and upload history |
| `GET` | `/api/architect/sftp/template` | The blank workbook to fill in |

---

## Status of a handshake

| Status | What it means |
|--------|---------------|
| `PENDING` | credentials issued; the architect has not connected yet |
| `AWAITING_APPROVAL` | they connected, CIDCO must approve — **connections are refused** |
| `ESTABLISHED` | approved; uploads from the whitelisted address are accepted |
| `REJECTED` | CIDCO refused the request |
| `EXPIRED` / `REVOKED` | the credentials are dead; CIDCO must issue new ones |

Every step — the handshake request, the approval, each connection, each file — is written to the
communication log against that account, and both sides can read it.

---

## End-to-end test

With both servers running (`npm start` and `npm run sftp`):

```bash
npx tsx scripts/sftp-e2e.ts
```

It issues credentials, proves the first connection is refused and queued, approves it as an officer,
uploads a workbook with one deliberately broken row, and checks CIDCO's preview and the stored
readings. `scripts/api-e2e.ts` does the same for the API channel.
