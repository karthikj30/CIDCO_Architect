/**
 * CIDCO's SFTP intake server.
 *
 * This is the SFTP half of the portal, and it is deliberately separate from the
 * API half: different credentials, different dashboard, different transport.
 *
 *   1. CIDCO issues an architect an SFTP user id and password (emailed).
 *   2. The architect's FIRST connection is the handshake request. The server
 *      verifies the credentials, records the IP and SSH client it came from as
 *      a validation request, then refuses the session — nothing is established
 *      until a CIDCO officer says so.
 *   3. The officer approves on the CIDCO SFTP dashboard. That whitelists the IP
 *      and opens the channel.
 *   4. The architect connects again and uploads an .xlsx workbook into /upload.
 *      On close, CIDCO parses the sheet into readings and records a preview.
 *
 * Run it with:  npm run sftp
 */
import { constants as fsConstants } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { generateKeyPairSync, randomUUID } from 'crypto';
import { Server, utils } from 'ssh2';
import type { Connection, FileEntry } from 'ssh2';
import type { ArchitectHandshake } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { hashesEqual, homeDirFor, ingestWorkbook, sha256, storageRoot, SFTP_PORT } from '../src/lib/sftp';

const { STATUS_CODE, OPEN_MODE } = utils.sftp;

const UPLOAD_DIR = '/upload';
const HOST = process.env.SFTP_HOST || '0.0.0.0';

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

function normaliseIp(ip: string | null | undefined) {
  if (!ip) return null;
  const trimmed = ip.trim();
  if (trimmed === '::1') return '127.0.0.1';
  return trimmed.startsWith('::ffff:') ? trimmed.slice(7) : trimmed;
}

type AuthOutcome =
  | { ok: true; handshake: ArchitectHandshake }
  | { ok: false; reason: string; handshakeId: string | null; event: string };

/**
 * The handshake, run on every connection attempt. Only an architect whose SFTP
 * credentials verify AND whose channel a CIDCO officer has approved gets in.
 */
async function authorise(username: string, password: string, ip: string | null, client: string): Promise<AuthOutcome> {
  const handshake = await prisma.architectHandshake.findUnique({ where: { clientId: username } });

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

  // --- Not yet approved: this connection IS the handshake request -----------
  if (handshake.status !== 'ESTABLISHED') {
    const open = await prisma.validationRequest.findFirst({
      where: { handshakeId: handshake.id, status: 'PENDING' },
    });
    if (!open) {
      await prisma.validationRequest.create({
        data: {
          handshakeId: handshake.id,
          channel: 'SFTP',
          presentedIp: ip,
          deviceInfo: client,
        },
      });
      await prisma.architectHandshake.update({
        where: { id: handshake.id },
        data: { status: 'AWAITING_APPROVAL', architectValidatedAt: new Date(), lastValidatedIp: ip },
      });
      await logComm({
        handshakeId: handshake.id,
        direction: 'ARCHITECT_TO_ADMIN',
        event: 'SFTP_HANDSHAKE_REQUESTED',
        statusCode: 202,
        detail: `SFTP handshake request from IP ${ip ?? 'unknown'} · client: ${client} — awaiting CIDCO approval`,
        ip,
      });
    }
    return {
      ok: false,
      reason: 'Your SFTP handshake request is with CIDCO and is awaiting approval. Try again once CIDCO approves it.',
      handshakeId: handshake.id,
      event: 'SFTP_AWAITING_APPROVAL',
    };
  }

  // --- Established: the connection must come from the whitelisted IP --------
  if (handshake.enforceWhitelist && handshake.whitelistedIp && normaliseIp(handshake.whitelistedIp) !== ip) {
    return {
      ok: false,
      reason: `This channel is registered to ${handshake.whitelistedIp}; refusing a connection from ${ip ?? 'unknown'}`,
      handshakeId: handshake.id,
      event: 'SFTP_IP_REFUSED',
    };
  }

  return { ok: true, handshake };
}

// --- SFTP session ----------------------------------------------------------

/** An in-flight upload. Chunks are buffered and written out when the handle closes. */
type WriteHandle = {
  kind: 'file';
  fileName: string;
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

function startSession(conn: Connection, handshake: ArchitectHandshake, ip: string | null) {
  conn.on('session', (acceptSession) => {
    const session = acceptSession();

    session.on('sftp', (acceptSftp) => {
      const sftp = acceptSftp();
      log(`sftp session opened for ${handshake.clientId} from ${ip}`);

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

      // Everything the architect sends lands in /upload; the rest of the tree
      // is a stub so ordinary SFTP clients can navigate.
      sftp.on('REALPATH', (reqid, givenPath) => {
        const resolved = givenPath === '.' || givenPath === '' || givenPath === '/' ? UPLOAD_DIR : path.posix.normalize(givenPath);
        sftp.name(reqid, [{ filename: resolved, longname: resolved, attrs: attrsFor(0, true) } as FileEntry]);
      });

      const statLike = (reqid: number, givenPath: string) => {
        const clean = path.posix.normalize(givenPath || '/');
        if (clean === '/' || clean === UPLOAD_DIR || clean === '.') {
          return sftp.attrs(reqid, attrsFor(0, true));
        }
        return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
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

      sftp.on('OPENDIR', async (reqid, givenPath) => {
        const clean = path.posix.normalize(givenPath || '/');
        if (clean !== '/' && clean !== UPLOAD_DIR) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
        // List what this architect has already delivered.
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
        if (!/\.xlsx$/i.test(base)) {
          log(`refused ${base} from ${handshake.clientId}: not an .xlsx workbook`);
          return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
        }
        sftp.handle(reqid, newHandle({ kind: 'file', fileName: base, chunks: [], bytes: 0 }));
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
        void receiveFile(handshake, handle, ip);
      });
    });
  });
}

/** Persists a completed upload and turns its rows into readings. */
async function receiveFile(handshake: ArchitectHandshake, handle: WriteHandle, ip: string | null) {
  const buffer = Buffer.concat(handle.chunks);
  const home = homeDirFor(handshake.clientId);
  const storedName = `${new Date().toISOString().replace(/[:.]/g, '-')}_${randomUUID().slice(0, 8)}.xlsx`;

  try {
    await fs.mkdir(home, { recursive: true });
    await fs.writeFile(path.join(home, storedName), buffer);

    const upload = await ingestWorkbook({
      handshake,
      fileName: handle.fileName,
      storedName,
      buffer,
      sourceIp: ip,
    });

    log(
      `received ${handle.fileName} (${buffer.length} bytes) from ${handshake.clientId}: ` +
        `${upload.importedCount}/${upload.rowCount} rows imported, status ${upload.status}`,
    );

    await logComm({
      handshakeId: handshake.id,
      direction: 'ARCHITECT_TO_ADMIN',
      event: 'SFTP_FILE_RECEIVED',
      statusCode: upload.status === 'FAILED' ? 422 : 201,
      detail:
        `Workbook "${handle.fileName}" (${buffer.length} bytes) received over SFTP — ` +
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

            await prisma.architectHandshake.update({
              where: { id: outcome.handshake.id },
              data: { lastValidatedIp: ip },
            });
            await logComm({
              handshakeId: outcome.handshake.id,
              direction: 'ARCHITECT_TO_ADMIN',
              event: 'SFTP_CONNECTED',
              statusCode: 200,
              detail: `SFTP session opened from ${ip ?? 'unknown'} · client: ${client}`,
              ip,
            });

            startSession(conn, outcome.handshake, ip);
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
