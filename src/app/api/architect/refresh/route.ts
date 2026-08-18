import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { withLogging } from '@/lib/logger';
import {
  clientIp,
  logComm,
  generateToken,
  generateRefreshToken,
  sha256,
  addDays,
  DEFAULT_TOKEN_TTL_DAYS,
  DEFAULT_REFRESH_TOKEN_TTL_DAYS,
  REFRESH_TOKEN_PREFIX
} from '@/lib/handshake';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export async function POST(req: NextRequest) {
  return withLogging(
    req,
    async (req) => {
      try {
        const ip = clientIp(req);
        
        let body;
        try {
          body = await req.json();
        } catch {
          return fail('Invalid JSON body', 400);
        }

        const parsed = refreshSchema.safeParse(body);
        if (!parsed.success) {
          return fail('Missing or invalid refreshToken', 400);
        }
        const { refreshToken } = parsed.data;

        if (!refreshToken.startsWith(REFRESH_TOKEN_PREFIX)) {
          return fail('Invalid refresh token format', 401);
        }

        const tokenHash = sha256(refreshToken);

        const tokenRecord = await prisma.integrationToken.findUnique({
          where: { refreshTokenHash: tokenHash },
          include: { handshake: true },
        });

        if (!tokenRecord) {
          return fail('Invalid refresh token', 401);
        }

        if (tokenRecord.revokedAt) {
          return fail('Token has been revoked', 401);
        }

        if (!tokenRecord.refreshExpiresAt || tokenRecord.refreshExpiresAt.getTime() < Date.now()) {
          return fail('Refresh token has expired. Please re-authenticate using /api/architect/validate', 401);
        }

        if (tokenRecord.handshake.status !== 'ESTABLISHED') {
          return fail('Handshake is not established', 401);
        }

        // Generate new tokens
        const { token: newAccessToken, tokenHash: newAccessHash, prefix: newAccessPrefix } = generateToken();
        const { token: newRefreshToken, tokenHash: newRefreshHash, prefix: newRefreshPrefix } = generateRefreshToken();
        const now = new Date();

        // Transaction to revoke old and create new
        await prisma.$transaction([
          prisma.integrationToken.update({
            where: { id: tokenRecord.id },
            data: { revokedAt: now },
          }),
          prisma.integrationToken.create({
            data: {
              handshakeId: tokenRecord.handshakeId,
              tokenHash: newAccessHash,
              prefix: newAccessPrefix,
              expiresAt: addDays(now, DEFAULT_TOKEN_TTL_DAYS),
              refreshTokenHash: newRefreshHash,
              refreshTokenPrefix: newRefreshPrefix,
              refreshExpiresAt: addDays(now, DEFAULT_REFRESH_TOKEN_TTL_DAYS),
            },
          }),
        ]);

        await logComm({
          handshakeId: tokenRecord.handshakeId,
          direction: 'ARCHITECT_TO_ADMIN',
          event: 'TOKEN_REQUESTED',
          statusCode: 200,
          detail: 'Refresh token used to request new tokens',
          ip,
        });

        await logComm({
          handshakeId: tokenRecord.handshakeId,
          direction: 'ADMIN_TO_ARCHITECT',
          event: 'TOKEN_GENERATED',
          statusCode: 200,
          detail: 'Auto-generated new access and refresh tokens via rotation',
          ip,
        });

        return ok({
          message: 'Tokens refreshed successfully.',
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          expiresInDays: DEFAULT_TOKEN_TTL_DAYS,
          refreshExpiresInDays: DEFAULT_REFRESH_TOKEN_TTL_DAYS,
        });
      } catch (error) {
        return handleError(error);
      }
    },
    { captureBody: false }
  );
}
