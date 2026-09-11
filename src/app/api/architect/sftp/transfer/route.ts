import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { clientIp } from '@/lib/handshake';
import {
  hashesEqual,
  homeDirFor,
  ingestTransfer,
  isAcceptedFile,
  normaliseIp,
  normalisePath,
  sftpEndpoint,
  sha256,
} from '@/lib/sftp';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * POST /api/architect/sftp/transfer
 *
 * The drag-and-drop half of the architect's SFTP workspace: the same intake the
 * SFTP server feeds, driven from the browser. The architect supplies the user
 * id, password and designated address CIDCO emailed them — exactly what they
 * would type into WinSCP — and drops a file in.
 *
 * The transfer is validated identically to a direct SFTP upload: company id,
 * the address it came from, and the file path it was taken from are all checked
 * against the company CIDCO registered. It is recorded as mode PORTAL so an
 * officer can tell the two routes apart.
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData().catch(() => null);
    if (!form) return fail('Send multipart/form-data with the file and your connection details', 415);

    const username = String(form.get('username') ?? '').trim();
    const password = String(form.get('password') ?? '');
    const designatedIp = String(form.get('designatedIp') ?? '').trim();
    const declaredPath = String(form.get('filePath') ?? '').trim();
    const file = form.get('file');

    if (!username || !password) return fail('Enter the user id and password CIDCO sent you', 422);
    if (!(file instanceof File)) return fail('Attach the file to send', 422);
    if (!isAcceptedFile(file.name)) return fail('Only .csv and .xlsx files are accepted', 422);
    if (file.size === 0) return fail('That file is empty', 422);
    if (file.size > MAX_BYTES) return fail('That file is larger than 25 MB', 422);

    // --- The credentials, checked exactly as the SFTP server checks them ----
    const handshake = await prisma.architectHandshake.findUnique({
      where: { clientId: username },
      include: { company: true },
    });
    if (!handshake || handshake.channel !== 'SFTP' || !hashesEqual(sha256(password), handshake.secretHash)) {
      return fail('That user id and password did not match. Check the credentials CIDCO emailed you.', 401);
    }
    if (handshake.revokedAt || handshake.status === 'REVOKED') return fail('These credentials have been revoked', 403);
    if (handshake.credentialExpiresAt.getTime() < Date.now()) {
      return fail('These credentials have expired — ask CIDCO to issue new ones', 403);
    }

    // The address they were told to send to has to be the one they used.
    const endpoint = sftpEndpoint(req.headers.get('host')?.split(':')[0]);
    if (designatedIp && normaliseIp(designatedIp) !== normaliseIp(endpoint.designatedIp)) {
      return fail(
        `${designatedIp} is not CIDCO's designated address for this channel. Use ${endpoint.designatedIp}.`,
        422,
      );
    }

    const company = handshake.company;
    // Falling back to the registered path keeps a plain drag-and-drop working;
    // a path typed in the connect form is taken at its word and validated.
    const presentedPath = normalisePath(declaredPath || company?.filePath || '');
    const sourceIp = normaliseIp(clientIp(req));

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = path.extname(file.name).toLowerCase() || '.csv';
    const storedName = `${new Date().toISOString().replace(/[:.]/g, '-')}_${randomUUID().slice(0, 8)}${ext}`;

    const home = homeDirFor(handshake.clientId);
    await fs.mkdir(home, { recursive: true });
    await fs.writeFile(path.join(home, storedName), buffer);

    const upload = await ingestTransfer({
      handshake,
      company,
      fileName: file.name,
      storedName,
      buffer,
      sourceIp,
      presentedPath,
      mode: 'PORTAL',
    });

    if (!upload.validationPassed) {
      return fail(`CIDCO refused the transfer — ${upload.rejectionReason}. Nothing was stored.`, 403, {
        uploadId: upload.id,
        validation: {
          companyId: { presented: upload.presentedCompanyId, match: upload.companyIdMatch },
          ip: { presented: upload.presentedIp, match: upload.ipMatch },
          filePath: { presented: upload.presentedPath, match: upload.pathMatch },
        },
      });
    }

    return ok(
      {
        message:
          upload.failedCount > 0
            ? `Validated and stored ${upload.importedCount} of ${upload.rowCount} rows; ${upload.failedCount} were rejected.`
            : `Validated and stored all ${upload.importedCount} rows.`,
        upload: {
          id: upload.id,
          fileName: upload.fileName,
          status: upload.status,
          rowCount: upload.rowCount,
          importedCount: upload.importedCount,
          failedCount: upload.failedCount,
          errors: upload.errors,
          receivedAt: upload.receivedAt,
        },
      },
      201,
    );
  } catch (error) {
    return handleError(error);
  }
}
