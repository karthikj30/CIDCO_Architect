import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { withLogging } from '@/lib/logger';
import { tokenRequestSchema } from '@/lib/validation';
import { clientIp, logComm, verifyCredentials } from '@/lib/handshake';

export const dynamic = 'force-dynamic';

/**
 * POST /api/architect/token-requests
 *
 * Because tokens expire, the architect raises a renewal request here. The
 * admin later fulfils it (POST /api/admin/token-requests/:id/approve) by
 * minting a fresh token. Authenticated with the handshake credentials.
 */
export async function POST(req: NextRequest) {
  return withLogging(
    req,
    async (req) => {
      try {
        const ip = clientIp(req);
        const { clientId, clientSecret, reason } = tokenRequestSchema.parse(await req.json());

        const check = await verifyCredentials(clientId, clientSecret);
        if (!check.ok) return fail(`Cannot raise request: ${check.reason}`, 504);
        if (check.handshake.status !== 'ESTABLISHED') {
          return fail('Validate the handshake first (POST /api/architect/validate).', 409);
        }

        const request = await prisma.tokenRequest.create({
          data: { handshakeId: check.handshake.id, reason: reason ?? null, requestedIp: ip },
        });

        await logComm({
          handshakeId: check.handshake.id,
          direction: 'ARCHITECT_TO_ADMIN',
          event: 'TOKEN_REQUESTED',
          statusCode: 201,
          detail: reason ? `Token requested: ${reason}` : 'Token renewal requested',
          ip,
        });

        return ok(
          {
            message: 'Token request raised. CIDCO will review and issue a new token.',
            request: { id: request.id, status: request.status, requestedAt: request.requestedAt },
          },
          201,
        );
      } catch (error) {
        return handleError(error);
      }
    },
    { captureBody: false },
  );
}
