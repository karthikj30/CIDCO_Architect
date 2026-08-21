import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';
import { generateTokenSchema } from '@/lib/validation';
import { clientIp, issueTokenPair, logComm, verifyCredentials } from '@/lib/handshake';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/handshakes/:id/tokens
 *
 * Once a handshake is ESTABLISHED, the admin mints an API token for it "using
 * its user id and password" — the clientId + clientSecret must be supplied and
 * must match. Tokens expire (default 7 days). The plaintext token is returned
 * once; the architect sends data with it.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;
    const { id } = await params;

    const body = generateTokenSchema.parse(await req.json());

    const handshake = await prisma.architectHandshake.findUnique({ where: { id } });
    if (!handshake) return fail('Handshake not found', 404);
    if (handshake.clientId !== body.clientId) {
      return fail('clientId does not match this handshake', 422);
    }

    const check = await verifyCredentials(body.clientId, body.clientSecret);
    if (!check.ok) return fail(check.reason, 422);
    if (check.handshake.status !== 'ESTABLISHED') {
      return fail('Handshake must be ESTABLISHED before a token can be generated. The architect must validate first.', 409);
    }

    // Always issue a full pair so a dashboard-issued token can be refreshed
    // exactly like an auto-issued one. Any earlier pair is revoked.
    const accessTtl = body.expiresInDays ?? handshake.accessTokenTtlDays;
    const refreshTtl = body.refreshExpiresInDays ?? handshake.refreshTokenTtlDays;

    const issued = await issueTokenPair({
      handshakeId: handshake.id,
      accessTtlDays: accessTtl,
      refreshTtlDays: refreshTtl,
      createdById: guard.user.id,
    });

    await logComm({
      handshakeId: handshake.id,
      direction: 'ADMIN_TO_ARCHITECT',
      event: 'TOKEN_GENERATED',
      statusCode: 201,
      detail: `Access token ${issued.record.prefix}… (${accessTtl}d) and refresh token (${refreshTtl}d) issued from the dashboard; previous tokens revoked`,
      ip: clientIp(req),
    });

    return ok(
      {
        message: 'Access and refresh tokens generated. Give both to the architect — shown only once.',
        token: {
          id: issued.record.id,
          token: issued.accessToken, // plaintext, once
          accessToken: issued.accessToken,
          refreshToken: issued.refreshToken,
          prefix: issued.record.prefix,
          expiresAt: issued.accessExpiresAt,
          refreshExpiresAt: issued.refreshExpiresAt,
          expiresInDays: accessTtl,
          refreshExpiresInDays: refreshTtl,
          usage: 'Authorization: Bearer <accessToken> to POST /api/architect/data',
        },
      },
      201,
    );
  } catch (error) {
    return handleError(error);
  }
}
