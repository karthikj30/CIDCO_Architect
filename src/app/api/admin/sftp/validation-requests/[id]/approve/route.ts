import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';
import { clientIp, fingerprintDevice, logComm } from '@/lib/handshake';
import { sftpEndpoint } from '@/lib/sftp';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/sftp/validation-requests/:id/approve
 *
 * The officer has checked the architect and the address their SFTP connection
 * came from. Approving whitelists that IP and opens the channel — from here the
 * SFTP server accepts their sessions and their Excel uploads.
 *
 * No tokens are involved: this channel authenticates with the SFTP user id and
 * password on every connection.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;
    const { id } = await params;
    const ip = clientIp(req);

    const request = await prisma.validationRequest.findUnique({
      where: { id },
      include: { handshake: { include: { architect: { select: { email: true } } } } },
    });
    if (!request) return fail('Validation request not found', 404);
    if (request.channel !== 'SFTP') return fail('That request is on the API channel', 409);
    if (request.status !== 'PENDING') return fail(`This request is already ${request.status}`, 409);

    const hs = request.handshake;
    if (hs.revokedAt || hs.status === 'REVOKED') return fail('This SFTP account has been revoked', 409);
    if (hs.credentialExpiresAt.getTime() < Date.now()) {
      return fail('The SFTP credentials have expired — issue new ones instead', 409);
    }

    const now = new Date();

    await prisma.architectHandshake.update({
      where: { id: hs.id },
      data: {
        status: 'ESTABLISHED',
        establishedAt: hs.establishedAt ?? now,
        whitelistedIp: hs.whitelistedIp ?? request.presentedIp,
        deviceInfo: request.deviceInfo ?? hs.deviceInfo,
        deviceFingerprint: request.deviceInfo ? fingerprintDevice(request.deviceInfo) : hs.deviceFingerprint,
        whitelistedAt: hs.whitelistedAt ?? (request.presentedIp ? now : null),
      },
    });

    await prisma.validationRequest.update({
      where: { id },
      data: { status: 'APPROVED', reviewedById: guard.user.id, reviewedAt: now },
    });

    await logComm({
      handshakeId: hs.id,
      direction: 'ADMIN_TO_ARCHITECT',
      event: 'SFTP_HANDSHAKE_APPROVED',
      statusCode: 200,
      detail:
        `SFTP channel established for ${hs.architect.email} from IP ${request.presentedIp ?? 'unknown'}` +
        `${request.deviceInfo ? ` · ${request.deviceInfo}` : ''} — the architect can now upload workbooks`,
      ip,
    });

    return ok({
      message: 'Approved. The SFTP channel is open — the architect can connect and upload their Excel sheet.',
      account: { id: hs.id, username: hs.clientId, status: 'ESTABLISHED' },
      whitelistedIp: hs.whitelistedIp ?? request.presentedIp,
      deviceInfo: request.deviceInfo ?? hs.deviceInfo,
      endpoint: sftpEndpoint(req.headers.get('host')?.split(':')[0]),
    });
  } catch (error) {
    return handleError(error);
  }
}
