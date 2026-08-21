import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';
import { approveRequestSchema } from '@/lib/validation';
import { clientIp, issueTokenPair, logComm } from '@/lib/handshake';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/token-requests/:id/approve
 *
 * The admin fulfils an architect's renewal request by minting a fresh token
 * (default 7-day expiry) and marking the request FULFILLED.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;
    const { id } = await params;

    const body = approveRequestSchema.parse(await req.json().catch(() => ({})));

    const request = await prisma.tokenRequest.findUnique({
      where: { id },
      include: { handshake: true },
    });
    if (!request) return fail('Token request not found', 404);
    if (request.status !== 'PENDING') return fail(`Request is already ${request.status}`, 409);
    if (request.handshake.status !== 'ESTABLISHED') {
      return fail('The handshake is not established; cannot issue a token', 409);
    }

    const accessTtl = body.expiresInDays ?? request.handshake.accessTokenTtlDays;
    const refreshTtl = request.handshake.refreshTokenTtlDays;

    const issued = await issueTokenPair({
      handshakeId: request.handshakeId,
      accessTtlDays: accessTtl,
      refreshTtlDays: refreshTtl,
      createdById: guard.user.id,
      fromRequestId: request.id,
    });

    await prisma.tokenRequest.update({
      where: { id: request.id },
      data: {
        status: 'FULFILLED',
        resolvedAt: new Date(),
        resolvedById: guard.user.id,
        issuedTokenId: issued.record.id,
      },
    });

    await logComm({
      handshakeId: request.handshakeId,
      direction: 'ADMIN_TO_ARCHITECT',
      event: 'TOKEN_GENERATED',
      statusCode: 201,
      detail: `Renewal fulfilled: access ${issued.record.prefix}… (${accessTtl}d) + refresh (${refreshTtl}d)`,
      ip: clientIp(req),
    });

    return ok(
      {
        message: 'Token request approved. New access and refresh tokens issued (shown once).',
        token: {
          id: issued.record.id,
          token: issued.accessToken,
          accessToken: issued.accessToken,
          refreshToken: issued.refreshToken,
          prefix: issued.record.prefix,
          expiresAt: issued.accessExpiresAt,
          refreshExpiresAt: issued.refreshExpiresAt,
          expiresInDays: accessTtl,
          refreshExpiresInDays: refreshTtl,
        },
      },
      201,
    );
  } catch (error) {
    return handleError(error);
  }
}
