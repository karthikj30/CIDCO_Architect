import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { withLogging } from '@/lib/logger';
import { validateHandshakeSchema } from '@/lib/validation';
import {
  checkWhitelist,
  clientIp,
  fingerprintDevice,
  issueTokenPair,
  logComm,
  normaliseIp,
  verifyCredentials,
} from '@/lib/handshake';

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
        const { clientId, clientSecret, ipAddress, deviceInfo } = validateHandshakeSchema.parse(
          await req.json(),
        );

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

        // The IP the architect declares wins; otherwise use the socket IP.
        const presentedIp = normaliseIp(ipAddress) ?? normaliseIp(ip);

        // If this handshake is already whitelisted, the caller must match it.
        const gate = checkWhitelist(handshake, presentedIp);
        if (!gate.ok) {
          await logComm({
            handshakeId: handshake.id,
            direction: 'ARCHITECT_TO_ADMIN',
            event: 'VALIDATION_FAILED',
            statusCode: 504,
            detail: gate.reason,
            ip,
          });
          return fail(`Validation failed: ${gate.reason}`, 504);
        }

        const firstWhitelist = !handshake.whitelistedIp;
        const updated = await prisma.architectHandshake.update({
          where: { id: handshake.id },
          data: {
            status: 'ESTABLISHED',
            architectValidatedAt: now,
            establishedAt: handshake.establishedAt ?? now,
            lastValidatedIp: ip,
            // Whitelist the architect's IP + device on first successful validate.
            whitelistedIp: handshake.whitelistedIp ?? presentedIp,
            deviceInfo: deviceInfo ?? handshake.deviceInfo,
            deviceFingerprint: deviceInfo ? fingerprintDevice(deviceInfo) : handshake.deviceFingerprint,
            whitelistedAt: handshake.whitelistedAt ?? (presentedIp ? now : null),
          },
          include: { architect: { select: { id: true, name: true, email: true } } },
        });

        if (firstWhitelist && presentedIp) {
          await logComm({
            handshakeId: handshake.id,
            direction: 'ADMIN_TO_ARCHITECT',
            event: 'IP_WHITELISTED',
            statusCode: 200,
            detail: `Whitelisted IP ${presentedIp}${deviceInfo ? ` · device: ${deviceInfo}` : ''}`,
            ip,
          });
        }

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
        // Expiry windows come from the handshake's policy, which CIDCO edits
        // from the dashboard — so a dashboard change takes effect on the API.
        const issued = await issueTokenPair({
          handshakeId: handshake.id,
          accessTtlDays: updated.accessTokenTtlDays,
          refreshTtlDays: updated.refreshTokenTtlDays,
        });

        await logComm({
          handshakeId: handshake.id,
          direction: 'ADMIN_TO_ARCHITECT',
          event: 'TOKEN_GENERATED',
          statusCode: 200,
          detail: `Access token (${issued.accessTtlDays}d) and refresh token (${issued.refreshTtlDays}d) issued after validation`,
          ip,
        });

        return ok({
          message: 'Validated. Two-way communication established with CIDCO.',
          established: true,
          accessToken: issued.accessToken,
          refreshToken: issued.refreshToken,
          expiresInDays: issued.accessTtlDays,
          refreshExpiresInDays: issued.refreshTtlDays,
          accessTokenExpiresAt: issued.accessExpiresAt,
          refreshTokenExpiresAt: issued.refreshExpiresAt,
          whitelistedIp: updated.whitelistedIp,
          deviceInfo: updated.deviceInfo,
          handshake: {
            id: updated.id,
            clientId: updated.clientId,
            status: updated.status,
            establishedAt: updated.establishedAt,
            architect: updated.architect,
          },
          nextSteps: [
            'Send AQI data to POST /api/architect/data with header: Authorization: Bearer <accessToken>.',
            'If the access token expires (503), POST /api/architect/refresh with your refresh token.',
            'If both tokens expire (503), validate again with your clientId and clientSecret.',
          ],
        });
      } catch (error) {
        return handleError(error);
      }
    },
    { captureBody: false },
  );
}
