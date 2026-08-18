# CIDCO Architect Integration API

This is the reference for an **architect's system** integrating with the CIDCO AQI portal over the
handshake + token flow. Every call is testable from Postman — import
`postman/CIDCO-Architect-Handshake.postman_collection.json`.

The CIDCO officer manages the other side from the admin dashboard (`/`, the "CIDCO Admin" tabs):
issuing credentials, generating tokens, approving renewal requests, and watching the communication
log. **Architects do not get a dashboard — they use these endpoints from Postman.**

All responses share one envelope:

```jsonc
{ "success": true,  "data":  { /* ... */ } }
{ "success": false, "error": "message", "details": { /* field errors */ } }
```

Base URL below is written as `{{baseUrl}}` (e.g. `http://localhost:3000`).

---

## The flow

| # | Who | Action | Endpoint |
|---|-----|--------|----------|
| 1 | CIDCO | Issues you a credential `{clientId, clientSecret, expiryDate}` | (admin dashboard) |
| 2 | You | Validate the credential → channel established | `POST /api/architect/validate` |
| 3 | CIDCO | Generates a 7-day API token for the established handshake | (admin dashboard) |
| 4 | You | Send AQI data with the token | `POST /api/architect/data` |
| 5 | You | Raise a renewal request when the token nears expiry | `POST /api/architect/token-requests` |
| 6 | CIDCO | Approves the request, issues a fresh token | (admin dashboard) |
| — | You | Check status / read the log any time | `GET /api/architect/status`, `GET /api/architect/logs` |

---

## 0. The credential CIDCO sends you

CIDCO issues this JSON out of band. The `clientSecret` is shown only once — store it securely.

```json
{
  "clientId": "ARCH-582397C8A863",
  "clientSecret": "hs_sec_50fda6539cf711974dc4e983c86ae95a...",
  "expiryDate": "2026-09-13T07:00:39.540Z",
  "validateUrl": "{{baseUrl}}/api/architect/validate",
  "tokenRequestUrl": "{{baseUrl}}/api/architect/token-requests",
  "dataUrl": "{{baseUrl}}/api/architect/data",
  "logsUrl": "{{baseUrl}}/api/architect/logs"
}
```

---

## 1. Validate — establish the two-way channel

`POST /api/architect/validate`

```json
{ "clientId": "ARCH-582397C8A863", "clientSecret": "hs_sec_..." }
```

- **200 OK** — credentials correct, handshake is now `ESTABLISHED`, the two-way channel is open.
- **504 Gateway Timeout** — validation failed (unknown `clientId`, wrong secret, expired or revoked
  credential). In the CIDCO protocol, **504 specifically means "handshake not validated."**

```jsonc
// 200
{ "success": true, "data": { "established": true, "handshake": { "status": "ESTABLISHED", ... } } }
// 504
{ "success": false, "error": "Validation failed: Invalid clientSecret" }
```

---

## 2. Get your API token

Once the handshake is `ESTABLISHED`, the CIDCO officer generates an API token for it (using your
`clientId` + `clientSecret`) and sends it to you. Tokens are **`cidco_tok_…`** and expire — **7 days
by default**. You do not call this endpoint yourself.

---

## 3. Send AQI data

`POST /api/architect/data` — authenticate with `Authorization: Bearer <token>`. Each call inserts
one reading row, so a monitoring station can post on a schedule.

**Full monitoring-station payload (JSON):**

```
POST /api/architect/data
Authorization: Bearer cidco_tok_xxxxxxxxxxxxxxxx
Content-Type: application/json
```
```json
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
}
```

**Parameters** (only `measuredAt` and `aqiValue` are required):

| Field | Parameter | Also accepts |
|-------|-----------|--------------|
| `projectSiteId` | Project / Site ID | `siteId`, `Project/Site ID` |
| `monitoringStationId` | AQI Monitoring Station / Device ID | `stationId`, `deviceId` |
| `oem` | OEM | `manufacturer` |
| `deviceModel` | Model | `model` |
| `measuredAt` | Date & Time of Reading (ISO 8601) | `dateTime`, `timestamp` |
| `aqiValue` | AQI Value (0–1000) | `aqi` |
| `pm25` / `pm10` | PM2.5 / PM10 | `PM2.5`, `PM10` |
| `no2` / `so2` / `co` / `ozone` | NO₂ / SO₂ / CO / O₃ | `o3` |
| `temperature` | Temperature (°C) | `temp` |
| `humidity` | Humidity (% RH) | `rh` |
| `integrationMethod` | Data Source / Integration Method | `dataSource` |
| `otherParams` | Other environmental parameters (object) | — |

The **Data Receipt Timestamp** (`receivedAt`) is stamped by CIDCO on arrival — you don't send it.
Field names are matched loosely, so you may send the human-readable labels (`"PM2.5"`, `"O₃"`,
`"Station/Device ID"`, `"Data Source / Integration Method"`) directly. If you omit
`siteName`/`location` (typical for a station feed), CIDCO fills them from the Project/Site and
Station IDs.

**multipart/form-data** is also accepted (readings + a signed `document` + repeatable `boardPhotos`
files) for the report-style submission.

**201 Created** — stored in CIDCO's database with a reference number:

```json
{ "success": true, "data": { "report": { "referenceNo": "CIDCO/AQI/2026/00025", "aqiValue": 176, "receivedAt": "..." } } }
```

**401** — missing / invalid / **expired** token. An expired token's message tells you to raise a
renewal request (next section).

### Automating the feed (every 3 hours)

Each POST is one reading, so schedule it and the database fills itself. In **Postman**: open the
*Send AQI data* request → **⋯ → Schedule run** (or create a **Monitor**), set the interval to
**every 3 hours**, keep `Authorization: Bearer {{token}}`, and use the dynamic variable
`{{$isoTimestamp}}` for `measuredAt` so each run stamps the current time:

```json
{
  "monitoringStationId": "STN-KHR-07",
  "projectSiteId": "CIDCO-KHR-012",
  "measuredAt": "{{$isoTimestamp}}",
  "aqiValue": 176,
  "pm25": 78.3, "pm10": 152.9, "no2": 41.2, "so2": 12.7, "co": 0.9, "ozone": 48.6,
  "temperature": 33.4, "humidity": 62.1,
  "integrationMethod": "Automated API (3h)"
}
```

Tokens last 7 days, so a 3-hourly monitor keeps running until then — raise a renewal before it
lapses. Any cron/scheduler that can send an HTTP POST works the same way.

---

## 4. Request a new token (renewal)

`POST /api/architect/token-requests` — authenticate with your handshake credentials.

```json
{ "clientId": "ARCH-582397C8A863", "clientSecret": "hs_sec_...", "reason": "Current token expiring soon" }
```

```json
{ "success": true, "data": { "request": { "id": "...", "status": "PENDING", "requestedAt": "..." } } }
```

CIDCO reviews and issues a fresh 7-day token, which it sends to you.

---

## 5. Status & logs

Both accept either `Authorization: Bearer <token>` **or** the headers `x-client-id` and
`x-client-secret` (so you can check status before a token exists).

- `GET /api/architect/status` — handshake state, credential expiry, whether a live token exists,
  pending renewal count.
- `GET /api/architect/logs` — your timestamped trail: every validation, token event and data
  transfer for your handshake.

```
GET /api/architect/logs
x-client-id: ARCH-582397C8A863
x-client-secret: hs_sec_...
```
```json
{ "success": true, "data": { "count": 6, "logs": [
  { "createdAt": "...", "direction": "ARCHITECT_TO_ADMIN", "event": "DATA_RECEIVED", "statusCode": 201 }
] } }
```

---

## Status codes

| Code | Meaning |
|------|---------|
| 200 | Validation succeeded / read OK |
| 201 | Token request raised / data stored |
| 401 | Missing, invalid, or **expired** token on the data endpoint |
| 409 | Handshake not established yet — validate first |
| 422 | Invalid body (see `details` for field errors) |
| 504 | **Handshake validation failed** (CIDCO protocol convention) |

---

## curl walk-through

```bash
BASE=http://localhost:3000
CID=ARCH-XXXX; SECRET=hs_sec_XXXX          # from the credential CIDCO sent you

# 1. validate  → 200 + established (or 504 if wrong)
curl -s -X POST $BASE/api/architect/validate -H 'content-type: application/json' \
  -d "{\"clientId\":\"$CID\",\"clientSecret\":\"$SECRET\"}"

# 2. CIDCO gives you a token; then send data
TOKEN=cidco_tok_XXXX
curl -s -X POST $BASE/api/architect/data -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"siteName":"Kharghar Sector 12 Site","location":"Kharghar, Navi Mumbai","measuredAt":"2026-08-12T09:30:00Z","aqiValue":168}'

# 3. renewal request when the token nears expiry
curl -s -X POST $BASE/api/architect/token-requests -H 'content-type: application/json' \
  -d "{\"clientId\":\"$CID\",\"clientSecret\":\"$SECRET\",\"reason\":\"expiring soon\"}"

# 4. your logs, any time
curl -s $BASE/api/architect/logs -H "x-client-id: $CID" -H "x-client-secret: $SECRET"
```
