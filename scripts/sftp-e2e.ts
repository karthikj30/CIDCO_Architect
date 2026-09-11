/**
 * End-to-end drive of the SFTP channel through the real portal routes:
 * CIDCO issues credentials -> the architect's first connection is refused and
 * queued -> a CIDCO officer approves it on the dashboard -> the architect
 * uploads an Excel workbook -> CIDCO previews the sheet and has the readings.
 *
 * Needs both servers running:  npm start  and  npm run sftp
 */
import { Client } from 'ssh2';
import ExcelJS from 'exceljs';
import { prisma } from '../src/lib/prisma';
import { SHEET_COLUMNS } from '../src/lib/sftp';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const SFTP_HOST = '127.0.0.1';
const SFTP_PORT = Number(process.env.SFTP_PORT || 2222);

const fails: string[] = [];
const check = (ok: boolean, label: string) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) fails.push(label);
};

let cookie = '';
async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) },
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

/** Resolves the open client, or null when the server refuses the session. */
function connect(username: string, password: string) {
  return new Promise<Client | null>((resolve) => {
    const conn = new Client();
    conn
      .on('ready', () => resolve(conn))
      .on('error', () => resolve(null))
      .connect({ host: SFTP_HOST, port: SFTP_PORT, username, password, readyTimeout: 15000 });
  });
}

function put(conn: Client, remote: string, buffer: Buffer) {
  return new Promise<void>((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      const stream = sftp.createWriteStream(remote);
      stream.on('close', () => resolve());
      stream.on('error', reject);
      stream.end(buffer);
    });
  });
}

async function workbook(rows: number) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('AQI Data');
  sheet.columns = SHEET_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  for (let i = 0; i < rows; i++) {
    sheet.addRow({
      projectSiteId: `CIDCO-SFTP-${i + 1}`,
      monitoringStationId: `STN-SFTP-0${i + 1}`,
      oem: 'Envirotech',
      deviceModel: 'AQ-900',
      siteName: `Belapur Node ${i + 1}`,
      location: 'CBD Belapur, Navi Mumbai',
      measuredAt: `2026-09-11T0${i}:00:00Z`,
      aqiValue: 90 + i,
      pm25: 38.2 + i,
      pm10: 72.4 + i,
      no2: 21.1,
      so2: 8.3,
      co: 0.6,
      ozone: 18.7,
      temperature: 29.4,
      humidity: 71,
      otherParams: 'noise=61 dB',
      integrationMethod: 'SFTP Excel upload',
    });
  }
  // One deliberately broken row, to prove a bad row never costs the good ones.
  sheet.addRow({ projectSiteId: 'CIDCO-BAD', siteName: 'Broken row', measuredAt: 'not-a-date' });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function main() {
  const stamp = Date.now();

  console.log('== 1. CIDCO officer signs in and issues SFTP credentials ==');
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'officer@cidco.example', password: 'Password123' }),
  });
  check(login.status === 200, 'officer signed in');

  const archEmail = `sftp-arch-${stamp}@studio.in`;
  await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email: archEmail, password: 'Placeholder123', name: 'SFTP architect', role: 'ARCHITECT' }),
  });
  // Registering signed us in as the architect; sign the officer back in.
  cookie = '';
  await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'officer@cidco.example', password: 'Password123' }),
  });

  const issued = await api('/api/admin/sftp/accounts', {
    method: 'POST',
    body: JSON.stringify({ architectEmail: archEmail, expiresInDays: 30 }),
  });
  check(issued.status === 201, 'SFTP credentials issued');
  const cred = issued.json.data.credential;
  check(
    ['username', 'password', 'expiryDate', 'host', 'port', 'protocol', 'uploadDir', 'fileTypes'].every((k) => k in cred),
    'credential carries the user id, password and connection details',
  );
  console.log(`   user id ${cred.username} · host ${cred.host}:${cred.port}`);

  console.log('== 2. the architect connects for the first time ==');
  check((await connect(cred.username, 'wrong-password')) === null, 'wrong password is refused');
  check((await connect(cred.username, cred.password)) === null, 'first connection refused, pending CIDCO approval');

  const queue = await api('/api/admin/sftp/validation-requests?status=PENDING');
  const mine = queue.json.data.requests.find(
    (r: { handshake: { clientId: string } }) => r.handshake.clientId === cred.username,
  );
  check(!!mine, 'handshake request is on the CIDCO SFTP queue');
  check(!!mine?.presentedIp, `CIDCO sees where it came from (${mine?.presentedIp})`);
  check(!!mine?.deviceInfo, `CIDCO sees the SSH client (${mine?.deviceInfo})`);

  const apiQueue = await api('/api/admin/validation-requests');
  check(
    !apiQueue.json.data.requests.some((r: { handshake: { clientId: string } }) => r.handshake.clientId === cred.username),
    'the SFTP request does NOT show on the API channel queue',
  );

  console.log('== 3. CIDCO approves ==');
  const approved = await api(`/api/admin/sftp/validation-requests/${mine.id}/approve`, { method: 'POST', body: '{}' });
  check(approved.status === 200, 'officer approved the handshake');
  check(approved.json.data.whitelistedIp === mine.presentedIp, 'the address the architect connected from is whitelisted');

  console.log('== 4. the architect uploads their workbook ==');
  const conn = await connect(cred.username, cred.password);
  check(!!conn, 'connection accepted after approval');
  if (!conn) throw new Error('cannot continue without a session');

  const architect = await prisma.user.findUniqueOrThrow({ where: { email: archEmail } });
  const before = await prisma.report.count({ where: { userId: architect.id } });

  await put(conn, '/upload/aqi-september.xlsx', await workbook(3));
  conn.end();
  await new Promise((r) => setTimeout(r, 3000)); // the server parses after acking the client

  console.log('== 5. CIDCO can see and preview it ==');
  const list = await api('/api/admin/sftp/uploads');
  const row = list.json.data.uploads.find((u: { handshake: { clientId: string } }) => u.handshake.clientId === cred.username);
  check(!!row, 'the upload is listed on the CIDCO dashboard');
  check(row?.fileName === 'aqi-september.xlsx', `the original file name is kept (${row?.fileName})`);
  check(row?.status === 'PARTIAL', `status reflects the partial import (${row?.status})`);
  check(row?.importedCount === 3 && row?.rowCount === 4, `3 of 4 rows stored (got ${row?.importedCount} of ${row?.rowCount})`);

  const detail = await api(`/api/admin/sftp/uploads/${row.id}`);
  const d = detail.json.data.upload;
  check(detail.status === 200, 'the sheet preview loads');
  check(d.columns.length === SHEET_COLUMNS.length, `every column is previewable (${d.columns.length})`);
  check(
    d.columns.every((c: { label: string; key: string }) => c.label && c.key),
    'each column carries its header label and the field behind it',
  );
  check(d.rows.length === 4, `every sheet row is previewable (${d.rows.length})`);
  check(d.rows[0].aqiValue === 90 && d.rows[0].pm25 === 38.2, 'the preview shows the AQI values as delivered');
  check(d.errors.length === 1 && d.errors[0].row === 5, `the bad row is named with its reason (row ${d.errors[0]?.row})`);

  const after = await prisma.report.count({ where: { userId: architect.id } });
  check(after - before === 3, `3 readings landed in the database (got ${after - before})`);
  const stored = await prisma.report.findFirst({ where: { userId: architect.id }, orderBy: { receivedAt: 'desc' } });
  check(stored?.source === 'SFTP', `readings are marked as arriving over SFTP (${stored?.source})`);
  check(stored?.temperature === 29.4 && stored?.humidity === 71, 'every AQI column carried through to the reading');

  console.log('== 6. the architect sees the result on their own dashboard ==');
  cookie = '';
  await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: archEmail, password: 'Placeholder123' }) });
  const mePage = await api('/api/architect/sftp/me');
  const account = mePage.json.data.accounts[0];
  check(mePage.status === 200, 'architect SFTP workspace loads');
  check(account?.status === 'ESTABLISHED', `the architect sees the channel is open (${account?.status})`);
  check(account?.uploads?.[0]?.importedCount === 3, 'the architect sees how many rows CIDCO stored');
  check(account?.uploads?.[0]?.errors?.length === 1, 'the architect sees which row was rejected and why');
  check(!!mePage.json.data.endpoint?.host, 'the architect is shown the connection details');

  const apiWorkspace = await api('/api/architect/me');
  check(
    apiWorkspace.json.data.handshakes.length === 0,
    'the SFTP account does NOT appear in the architect API workspace',
  );

  console.log(fails.length ? `\nFAILED: ${fails.join(' | ')}` : '\nALL SFTP CHANNEL CHECKS PASSED');
  await prisma.$disconnect();
  process.exit(fails.length ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
