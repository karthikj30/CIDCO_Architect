import { randomBytes } from 'crypto';
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';
import { createHandshakeSchema } from '@/lib/validation';
import { addDays, clientIp, logComm } from '@/lib/handshake';
import { sftpEndpoint, sha256 } from '@/lib/sftp';

export const dynamic = 'force-dynamic';

/** SFTP user ids read better than the API's opaque client ids. */
function generateSftpUsername() {
  return `sftp_${randomBytes(5).toString('hex')}`;
}

function generateSftpPassword() {
  const secret = randomBytes(18).toString('base64url');
  return { secret, secretHash: sha256(secret), secretPrefix: secret.slice(0, 8) };
}

/** GET /api/admin/sftp/accounts — every SFTP account and what it has delivered. */
export async function GET(req: NextRequest) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;

    const rows = await prisma.architectHandshake.findMany({
      where: { channel: 'SFTP' },
      orderBy: { createdAt: 'desc' },
      include: {
        architect: { select: { id: true, name: true, email: true, firmName: true } },
        _count: { select: { sftpUploads: true } },
        sftpUploads: { orderBy: { receivedAt: 'desc' }, take: 1, select: { receivedAt: true, status: true } },
      },
    });

    const now = Date.now();
    return ok({
      endpoint: sftpEndpoint(req.headers.get('host')?.split(':')[0]),
      accounts: rows.map((h) => ({
        id: h.id,
        username: h.clientId,
        passwordPrefix: h.secretPrefix,
        status: h.credentialExpiresAt.getTime() < now && h.status !== 'REVOKED' ? 'EXPIRED' : h.status,
        credentialExpiresAt: h.credentialExpiresAt,
        establishedAt: h.establishedAt,
        whitelistedIp: h.whitelistedIp,
        deviceInfo: h.deviceInfo,
        enforceWhitelist: h.enforceWhitelist,
        architect: h.architect,
        uploadCount: h._count.sftpUploads,
        lastUpload: h.sftpUploads[0] ?? null,
        createdAt: h.createdAt,
      })),
    });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * POST /api/admin/sftp/accounts
 *
 * CIDCO issues an architect an SFTP user id and password. The password is
 * returned exactly once — this is what the officer emails over.
 */
export async function POST(req: NextRequest) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;

    const data = createHandshakeSchema.parse(await req.json());

    const architect = data.architectId
      ? await prisma.user.findUnique({ where: { id: data.architectId } })
      : await prisma.user.findUnique({ where: { email: data.architectEmail!.toLowerCase() } });

    if (!architect) return fail('Architect not found', 404);
    if (architect.role !== 'ARCHITECT') return fail('That user is not an architect', 422);

    const credentialExpiresAt = data.expiryDate ?? addDays(new Date(), data.expiresInDays ?? 30);
    if (credentialExpiresAt.getTime() <= Date.now()) {
      return fail('Credential expiry must be in the future', 422);
    }

    const username = generateSftpUsername();
    const { secret, secretHash, secretPrefix } = generateSftpPassword();

    const handshake = await prisma.architectHandshake.create({
      data: {
        architectId: architect.id,
        channel: 'SFTP',
        clientId: username,
        secretHash,
        secretPrefix,
        credentialExpiresAt,
        createdById: guard.user.id,
        status: 'PENDING',
      },
    });

    await logComm({
      handshakeId: handshake.id,
      direction: 'ADMIN_TO_ARCHITECT',
      event: 'SFTP_CREDENTIALS_ISSUED',
      statusCode: 201,
      detail: `SFTP user id issued to ${architect.email}; valid until ${credentialExpiresAt.toISOString()}`,
      ip: clientIp(req),
    });

    return ok(
      {
        message:
          'SFTP credentials issued. Email this user id and password to the architect — the password is shown only once.',
        account: {
          id: handshake.id,
          status: handshake.status,
          architect: { id: architect.id, name: architect.name, email: architect.email },
          createdAt: handshake.createdAt,
        },
        // What the architect needs to connect. No secrets beyond the password.
        credential: {
          username,
          password: secret,
          expiryDate: credentialExpiresAt.toISOString(),
          ...sftpEndpoint(req.headers.get('host')?.split(':')[0]),
        },
      },
      201,
    );
  } catch (error) {
    return handleError(error);
  }
}
