import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';
import { approveRequestSchema } from '@/lib/validation';
import { DEFAULT_TOKEN_TTL_DAYS, addDays, clientIp, generateToken, logComm } from '@/lib/handshake';

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

    const ttlDays = body.expiresInDays ?? DEFAULT_TOKEN_TTL_DAYS;
    const expiresAt = addDays(new Date(), ttlDays);
    const { token, tokenHash, prefix } = generateToken();

    const record = await prisma.$transaction(async (tx) => {
      const created = await tx.integrationToken.create({
        data: {
          handshakeId: request.handshakeId,
          tokenHash,
          prefix,
          expiresAt,
          createdById: guard.user.id,
          fromRequestId: request.id,
        },
      });
      await tx.tokenRequest.update({
        where: { id: request.id },
        data: { status: 'FULFILLED', resolvedAt: new Date(), resolvedById: guard.user.id, issuedTokenId: created.id },
      });
      return created;
    });

    await logComm({
      handshakeId: request.handshakeId,
      direction: 'ADMIN_TO_ARCHITECT',
      event: 'TOKEN_GENERATED',
      statusCode: 201,
      detail: `Renewal fulfilled: token ${prefix}… valid ${ttlDays} day(s) until ${expiresAt.toISOString()}`,
      ip: clientIp(req),
    });

    return ok(
      {
        message: 'Token request approved and new token issued (shown once).',
        token: { id: record.id, token, prefix, expiresAt, expiresInDays: ttlDays },
      },
      201,
    );
  } catch (error) {
    return handleError(error);
  }
}
