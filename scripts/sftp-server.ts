/**
 * CIDCO's SFTP intake server.
 *
 * This is the SFTP half of the portal, and it is deliberately separate from the
 * API half: different credentials, different dashboard, different transport.
 *
 *   1. A CIDCO officer registers the company by hand first — company name,
 *      company id, the architect's server address, and the file path their CSV
 *      is taken from.
 *   2. CIDCO issues an SFTP user id and password against that record and emails
 *      it, along with the designated address to send to.
 *   3. The architect sends automatically, taking the CSV from the registered
 *      path and writing it to the same path here.
 *   4. EVERY transfer is validated against the company record: company id, the
 *      address it arrived from, and the path it was written to. Only when all
 *      three match is the file parsed and its readings stored.
 *
 * Run it with:  npm run sftp
 */
import { constants as fsConstants } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { generateKeyPairSync, randomUUID } from 'crypto';
import { Server, utils } from 'ssh2';
import type { Connection, FileEntry } from 'ssh2';
import type { ArchitectHandshake, Company } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import {
  hashesEqual,
  homeDirFor,
  ingestTransfer,
  isAcceptedFile,
  normaliseIp,
  normalisePath,
  sha256,
  storageRoot,
  SFTP_PORT,
} from '../src/lib/sftp';

const { STATUS_CODE, OPEN_MODE } = utils.sftp;

const HOST = process.env.SFTP_HOST || '0.0.0.0';

/** An authenticated session: the credentials and the company behind them. */
type Account = { handshake: ArchitectHandshake; company: Company | null };

/** Where this account is expected to write — the registered file path. */
function expectedDir(account: Account) {
  return normalisePath(account.company?.filePath) || '/upload';
}

function log(...parts: unknown[]) {
  console.log(`[sftp ${new Date().toISOString()}]`, ...parts);
}

/** Writes a CommunicationLog row; never throws into the SSH layer. */
async function logComm(entry: {
  handshakeId: string | null;
  direction: 'ADMIN_TO_ARCHITECT' | 'ARCHITECT_TO_ADMIN';
  event: string;
  statusCode?: number;
  detail?: string;
  ip?: string | null;
}) {
  try {
    await prisma.communicationLog.create({
      data: {
        handshakeId: entry.handshakeId,
        direction: entry.direction,
        event: entry.event,
        statusCode: entry.statusCode ?? null,
        detail: entry.detail ?? null,
        ip: entry.ip ?? null,
      },
    });
  } catch (error) {
    log('could not write comm log:', error);
  }
}

/**
 * The server's SSH host key. Generated once and kept on disk so an architect's
 * client does not warn about a changed key on every restart.
 */
async function hostKey(): Promise<string> {
  const file = path.join(storageRoot(), 'ssh_host_rsa_key');
  await fs.mkdir(storageRoot(), { recursive: true });
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    log('generating a new SSH host key…');
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 3072,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    await fs.writeFile(file, privateKey, { mode: 0o600 });
    return privateKey;
  }
}

type AuthOutcome =
  | { ok: true; account: Account }
  | { ok: false; reason: string; handshakeId: string | null; event: string };

/**
 * Run on every connection. The credentials must verify and must belong to a
 * company CIDCO registered beforehand — that registration is the manual gate,
 * so there is no separate per-connection approval step.
 *
 * The address is checked here as an early refusal, and checked again against
 * the company record on each transfer.
 */
async function authorise(username: string, password: string, ip: string | null, client: string): Promise<AuthOutcome> {
  const handshake = await prisma.architectHandshake.findUnique({
    where: { clientId: username },
    include: { company: true },
  });

  if (!handshake || handshake.channel !== 'SFTP') {
    return { ok: false, reason: `Unknown SFTP user id "${username}"`, handshakeId: null, event: 'SFTP_AUTH_FAILED' };
  }
  if (!hashesEqual(sha256(password), handshake.secretHash)) {
    return { ok: false, reason: 'Incorrect SFTP password', handshakeId: handshake.id, event: 'SFTP_AUTH_FAILED' };
  }
  if (handshake.revokedAt || handshake.status === 'REVOKED') {
    return { ok: false, reason: 'These SFTP credentials have been revoked', handshakeId: handshake.id, event: 'SFTP_AUTH_FAILED' };
  }
  if (handshake.credentialExpiresAt.getTime() < Date.now()) {
    return { ok: false, reason: 'These SFTP credentials have expired', handshakeId: handshake.id, event: 'SFTP_AUTH_FAILED' };
  }

  const company = handshake.company;
  if (!company) {
    return {
      ok: false,
      reason: 'These credentials are not linked to a registered company',
      handshakeId: handshake.id,
      event: 'SFTP_AUTH_FAILED',
    };
  }
  if (!company.active) {
    return {
      ok: false,
      reason: `The registration for ${company.companyName} (${company.companyId}) is inactive`,
      handshakeId: handshake.id,
      event: 'SFTP_AUTH_FAILED',
    };
  }

  // The registered server address is the only one data may arrive from.
  if (normaliseIp(company.architectServerIp) !== normaliseIp(ip)) {
    return {
      ok: false,
      reason:
        `${company.companyId} is registered to ${company.architectServerIp}; ` +
        `refusing a connection from ${ip ?? 'unknown'}`,
      handshakeId: handshake.id,
      event: 'SFTP_IP_REFUSED',
    };
  }

  // Keep the channel record current so the dashboards read correctly.
  await prisma.architectHandshake.update({
    where: { id: handshake.id },
    data: {
      status: 'ESTABLISHED',
      establishedAt: handshake.establishedAt ?? new Date(),
      whitelistedIp: company.architectServerIp,
      whitelistedAt: handshake.whitelistedAt ?? new Date(),
      deviceInfo: client,
      lastValidatedIp: ip,
    },
  });

  return { ok: true, account: { handshake, company } };
}

// --- SFTP session ----------------------------------------------------------

/** An in-flight upload. Chunks are buffered and written out when the handle closes. */
type WriteHandle = {
  kind: 'file';
  fileName: string;
  /** The directory the client wrote to — validated against the company record. */
  dir: string;
  chunks: Buffer[];
  bytes: number;
};
type DirHandle = { kind: 'dir'; entries: FileEntry[]; sent: boolean };
type Handle = WriteHandle | DirHandle;

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function attrsFor(size: number, isDir: boolean) {
  const now = Math.floor(Date.now() / 1000);
  return {
    mode: isDir ? fsConstants.S_IFDIR | 0o755 : fsConstants.S_IFREG | 0o644,
    uid: 0,
    gid: 0,
    size,
    atime: now,
    mtime: now,
  };
}

function startSession(conn: Connection, account: Account, ip: string | null) {
  const { handshake } = account;
  // The directory this account is expected to write to: the file path CIDCO
  // registered for the company. The path a client actually writes to is what
  // gets validated on every transfer.
  const home = expectedDir(account);

  conn.on('session', (acceptSession) => {
    const session = acceptSession();

    session.on('sftp', (acceptSftp) => {
      const sftp = acceptSftp();
      log(`sftp session opened for ${handshake.clientId} from ${ip} (home ${home})`);

      const handles = new Map<number, Handle>();
      let nextHandle = 0;
      const newHandle = (value: Handle) => {
        const id = nextHandle++;
        handles.set(id, value);
        const buf = Buffer.alloc(4);
        buf.writeUInt32BE(id, 0);
        return buf;
      };
      const readHandle = (buf: Buffer) => handles.get(buf.readUInt32BE(0));

      // A bare "." or "/" lands the client in the registered file path, so a
      // plain `put readings.csv` writes exactly where CIDCO expects it.
      sftp.on('REALPATH', (reqid, givenPath) => {
        const resolved =
          givenPath === '.' || givenPath === '' || givenPath === '/' ? home : path.posix.normalize(givenPath);
        sftp.name(reqid, [{ filename: resolved, longname: resolved, attrs: attrsFor(0, true) } as FileEntry]);
      });

      // Directories are virtual: any path stats as a directory so clients can
      // navigate to the registered path, wherever it is.
      const statLike = (reqid: number, givenPath: string) => {
        const clean = normalisePath(givenPath) || '/';
        if (isAcceptedFile(clean)) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
        return sftp.attrs(reqid, attrsFor(0, true));
      };
      sftp.on('STAT', statLike);
      sftp.on('LSTAT', statLike);

      sftp.on('FSTAT', (reqid, handleBuf) => {
        const handle = readHandle(handleBuf);
        if (!handle) return sftp.status(reqid, STATUS_CODE.FAILURE);
        return sftp.attrs(reqid, attrsFor(handle.kind === 'file' ? handle.bytes : 0, handle.kind === 'dir'));
      });

      // Clients set permissions/timestamps after a put; accept and ignore.
      sftp.on('SETSTAT', (reqid) => sftp.status(reqid, STATUS_CODE.OK));
      sftp.on('FSETSTAT', (reqid) => sftp.status(reqid, STATUS_CODE.OK));
      sftp.on('MKDIR', (reqid) => sftp.status(reqid, STATUS_CODE.OK));

      sftp.on('OPENDIR', async (reqid, _givenPath) => {
        // List what this company has already delivered.
        const uploads = await prisma.sftpUpload
          .findMany({ where: { handshakeId: handshake.id }, orderBy: { receivedAt: 'desc' }, take: 100 })
          .catch(() => []);
        const entries: FileEntry[] = uploads.map((u) => ({
          filename: u.storedName,
          longname: `-rw-r--r-- 1 cidco cidco ${String(u.sizeBytes).padStart(9)} ${u.receivedAt.toISOString().slice(0, 16)} ${u.storedName}`,
          attrs: attrsFor(u.sizeBytes, false),
        })) as FileEntry[];
        sftp.handle(reqid, newHandle({ kind: 'dir', entries, sent: false }));
      });

      sftp.on('READDIR', (reqid, handleBuf) => {
        const handle = readHandle(handleBuf);
        if (!handle || handle.kind !== 'dir') return sftp.status(reqid, STATUS_CODE.FAILURE);
        if (handle.sent) return sftp.status(reqid, STATUS_CODE.EOF);
        handle.sent = true;
        return sftp.name(reqid, handle.entries);
      });

      sftp.on('OPEN', (reqid, filename, flags) => {
        // Read-back is not offered: this is a one-way intake channel.
        if (!(flags & OPEN_MODE.WRITE)) {
          return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
        }
        const base = path.posix.basename(filename);
        if (!isAcceptedFile(base)) {
          log(`refused ${base} from ${handshake.clientId}: not a .csv or .xlsx file`);
          return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
        }
        // Remember the directory it is being written to — CIDCO validates it
        // against the registered file path when the handle closes. A bare
        // filename means the client's working directory, which is home.
        const dir = filename.includes('/') ? normalisePath(path.posix.dirname(filename)) : home;
        sftp.handle(reqid, newHandle({ kind: 'file', fileName: base, dir, chunks: [], bytes: 0 }));
      });

      sftp.on('WRITE', (reqid, handleBuf, _offset, data) => {
        const handle = readHandle(handleBuf);
        if (!handle || handle.kind !== 'file') return sftp.status(reqid, STATUS_CODE.FAILURE);
        handle.bytes += data.length;
        if (handle.bytes > MAX_UPLOAD_BYTES) {
          handle.chunks = [];
          return sftp.status(reqid, STATUS_CODE.FAILURE);
        }
        handle.chunks.push(Buffer.from(data));
        return sftp.status(reqid, STATUS_CODE.OK);
      });

      sftp.on('READ', (reqid) => sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED));
      sftp.on('REMOVE', (reqid) => sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED));
      sftp.on('RENAME', (reqid) => sftp.status(reqid, STATUS_CODE.OK));

      sftp.on('CLOSE', (reqid, handleBuf) => {
        const id = handleBuf.readUInt32BE(0);
        const handle = handles.get(id);
        handles.delete(id);
        if (!handle || handle.kind !== 'file') return sftp.status(reqid, STATUS_CODE.OK);

        // Answer the client first, then do the slow work.
        sftp.status(reqid, STATUS_CODE.OK);
        void receiveFile(account, handle, ip);
      });
    });
  });
}

/**
 * Persists a completed transfer, runs CIDCO's validation over it, and — only
 * if that passes — turns its rows into readings.
 */
async function receiveFile(account: Account, handle: WriteHandle, ip: string | null) {
  const { handshake, company } = account;
  const buffer = Buffer.concat(handle.chunks);
  const home = homeDirFor(handshake.clientId);
  const ext = path.posix.extname(handle.fileName).toLowerCase() || '.csv';
  const storedName = `${new Date().toISOString().replace(/[:.]/g, '-')}_${randomUUID().slice(0, 8)}${ext}`;

  try {
    await fs.mkdir(home, { recursive: true });
    await fs.writeFile(path.join(home, storedName), buffer);

    const upload = await ingestTransfer({
      handshake,
      company,
      fileName: handle.fileName,
      storedName,
      buffer,
      sourceIp: ip,
      presentedPath: handle.dir,
      mode: 'DIRECT_SFTP',
    });

    if (!upload.validationPassed) {
      log(`REJECTED ${handle.fileName} from ${handshake.clientId}: ${upload.rejectionReason}`);
      await logComm({
        handshakeId: handshake.id,
        direction: 'ADMIN_TO_ARCHITECT',
        event: 'SFTP_VALIDATION_FAILED',
        statusCode: 403,
        detail:
          `"${handle.fileName}" refused — ${upload.rejectionReason}. ` +
          `Presented company ${upload.presentedCompanyId ?? '—'} from ${ip ?? 'unknown'} at "${handle.dir}". ` +
          'Nothing was stored.',
        ip,
      });
      return;
    }

    log(
      `received ${handle.fileName} (${buffer.length} bytes) from ${handshake.clientId} at ${handle.dir}: ` +
        `${upload.importedCount}/${upload.rowCount} rows imported, status ${upload.status}`,
    );

    await logComm({
      handshakeId: handshake.id,
      direction: 'ARCHITECT_TO_ADMIN',
      event: 'SFTP_FILE_RECEIVED',
      statusCode: upload.status === 'FAILED' ? 422 : 201,
      detail:
        `"${handle.fileName}" (${buffer.length} bytes) validated for ${company?.companyId} ` +
        `from ${ip} at "${handle.dir}" — ` +
        `${upload.importedCount} of ${upload.rowCount} rows stored as readings` +
        (upload.failedCount ? `, ${upload.failedCount} rejected` : ''),
      ip,
    });
  } catch (error) {
    log('failed to receive file:', error);
    await logComm({
      handshakeId: handshake.id,
      direction: 'ADMIN_TO_ARCHITECT',
      event: 'SFTP_FILE_REJECTED',
      statusCode: 500,
      detail: `Could not store "${handle.fileName}": ${error instanceof Error ? error.message : String(error)}`,
      ip,
    });
  }
}

// --- Boot ------------------------------------------------------------------

async function main() {
  await fs.mkdir(storageRoot(), { recursive: true });
  const key = await hostKey();

  const server = new Server(
    { hostKeys: [key], banner: 'CIDCO AQI Compliance Portal — SFTP intake' },
    (conn: Connection, info) => {
      const ip = normaliseIp(info.ip);
      let client = 'unknown SSH client';
      if (info.header?.versions?.software) client = info.header.versions.software;

      conn.on('authentication', (ctx) => {
        if (ctx.method !== 'password') {
          // Tell the client password is the only method we take.
          return ctx.reject(['password'], false);
        }
        void (async () => {
          try {
            const outcome = await authorise(ctx.username, ctx.password, ip, client);
            if (!outcome.ok) {
              log(`rejected ${ctx.username} from ${ip}: ${outcome.reason}`);
              if (outcome.event === 'SFTP_AUTH_FAILED' || outcome.event === 'SFTP_IP_REFUSED') {
                await logComm({
                  handshakeId: outcome.handshakeId,
                  direction: 'ARCHITECT_TO_ADMIN',
                  event: outcome.event,
                  statusCode: outcome.event === 'SFTP_IP_REFUSED' ? 403 : 401,
                  detail: outcome.reason,
                  ip,
                });
              }
              return ctx.reject();
            }

            const { handshake, company } = outcome.account;
            await logComm({
              handshakeId: handshake.id,
              direction: 'ARCHITECT_TO_ADMIN',
              event: 'SFTP_CONNECTED',
              statusCode: 200,
              detail:
                `SFTP session opened for ${company?.companyName} (${company?.companyId}) ` +
                `from ${ip ?? 'unknown'} · client: ${client}`,
              ip,
            });

            startSession(conn, outcome.account, ip);
            ctx.accept();
          } catch (error) {
            log('authentication error:', error);
            ctx.reject();
          }
        })();
      });

      conn.on('error', (err) => log('connection error:', err.message));
    },
  );

  server.listen(SFTP_PORT, HOST, () => {
    log(`CIDCO SFTP intake listening on ${HOST}:${SFTP_PORT}`);
    log(`uploads are stored under ${storageRoot()}`);
  });
}

main().catch((error) => {
  console.error('SFTP server failed to start:', error);
  process.exit(1);
});
