import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { withLogging } from '@/lib/logger';
import { validateHandshakeSchema } from '@/lib/validation';
import { clientIp, logComm, verifyCredentials, generateToken, generateRefreshToken, DEFAULT_TOKEN_TTL_DAYS, DEFAULT_REFRESH_TOKEN_TTL_DAYS, addDays } from '@/lib/handshake';

export const dynamic = 'force-dynamic';

/**
 * POST /api/architect/validate
 *
 * The architect presents the {clientId, clientSecret} the admin issued. The
 * CIDCO backend confirms the credentials belong to a live handshake for the
 * right architect — that is both sides validating in one call. On success the
 * handshake becomes ESTABLISHED (the 2-way channel) and we return 200 OK. On
 * any validation failure we return 504, per the CIDCO protocol.
 *
 * Note: the request body carries the secret, so it is deliberately excluded
 * from raw request logging (captureBody:false); the exchange is still recorded
 * in the communication log without the secret.
 */
export async function POST(req: NextRequest) {
  return withLogging(
    req,
    async (req) => {
      try {
        const ip = clientIp(req);
        const { clientId, clientSecret } = validateHandshakeSchema.parse(await req.json());

        const check = await verifyCredentials(clientId, clientSecret);
        if (!check.ok) {
          await logComm({
            handshakeId: check.handshakeId,
            direction: 'ARCHITECT_TO_ADMIN',
            event: 'VALIDATION_FAILED',
            statusCode: 504,
            detail: `Validation failed for clientId "${clientId}": ${check.reason}`,
            ip,
          });
          // 504 signals "handshake not validated" in the CIDCO protocol.
          return fail(`Validation failed: ${check.reason}`, 504);
        }

        const handshake = check.handshake;
        const now = new Date();
        const updated = await prisma.architectHandshake.update({
          where: { id: handshake.id },
          data: {
            status: 'ESTABLISHED',
            architectValidatedAt: now,
            establishedAt: handshake.establishedAt ?? now,
            lastValidatedIp: ip,
          },
          include: { architect: { select: { id: true, name: true, email: true } } },
        });

        await logComm({
          handshakeId: handshake.id,
          direction: 'ARCHITECT_TO_ADMIN',
          event: 'ARCHITECT_VALIDATED',
          statusCode: 200,
          detail: `Architect ${updated.architect.email} validated successfully`,
          ip,
        });
        await logComm({
          handshakeId: handshake.id,
          direction: 'ADMIN_TO_ARCHITECT',
          event: 'CHANNEL_ESTABLISHED',
          statusCode: 200,
          detail: 'Two-way channel established',
          ip,
        });
        const { token, tokenHash, prefix } = generateToken();
        const { token: refreshToken, tokenHash: refreshHash, prefix: refreshPrefix } = generateRefreshToken();
        
        await prisma.integrationToken.create({
          data: {
            handshakeId: handshake.id,
            tokenHash: tokenHash,
            prefix: prefix,
            expiresAt: addDays(now, DEFAULT_TOKEN_TTL_DAYS),
            refreshTokenHash: refreshHash,
            refreshTokenPrefix: refreshPrefix,
            refreshExpiresAt: addDays(now, DEFAULT_REFRESH_TOKEN_TTL_DAYS),
          }
        });

        await logComm({
          handshakeId: handshake.id,
          direction: 'ADMIN_TO_ARCHITECT',
          event: 'TOKEN_GENERATED',
          statusCode: 200,
          detail: 'Auto-generated access and refresh tokens after validation',
          ip,
        });

        return ok({
          message: 'Validated. Two-way communication established with CIDCO.',
          established: true,
          accessToken: token,
          refreshToken: refreshToken,
          expiresInDays: DEFAULT_TOKEN_TTL_DAYS,
          refreshExpiresInDays: DEFAULT_REFRESH_TOKEN_TTL_DAYS,
          handshake: {
            id: updated.id,
            clientId: updated.clientId,
            status: updated.status,
            establishedAt: updated.establishedAt,
            architect: updated.architect,
          },
          nextSteps: [
            'Send AQI data to POST /api/architect/data with header: Authorization: Bearer <accessToken>.',
            'If the access token expires, send the refresh token to POST /api/architect/refresh to get a new one.',
          ],
        });
      } catch (error) {
        return handleError(error);
      }
    },
    { captureBody: false },
  );
}
