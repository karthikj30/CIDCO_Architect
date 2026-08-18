import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';
import { createHandshakeSchema } from '@/lib/validation';
import {
  addDays,
  clientIp,
  credentialPayload,
  generateClientId,
  generateSecret,
  logComm,
} from '@/lib/handshake';

export const dynamic = 'force-dynamic';

/** GET /api/admin/handshakes — list every architect integration and its state. */
export async function GET(req: NextRequest) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;

    const handshakes = await prisma.architectHandshake.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        architect: { select: { id: true, name: true, email: true, firmName: true } },
        tokens: { orderBy: { createdAt: 'desc' } },
        _count: { select: { tokenRequests: true } },
      },
    });

    const now = Date.now();
    const rows = handshakes.map((h) => {
      const activeToken = h.tokens.find(
        (t) => !t.revokedAt && t.expiresAt.getTime() > now,
      );
      return {
        id: h.id,
        clientId: h.clientId,
        secretPrefix: h.secretPrefix,
        status: h.credentialExpiresAt.getTime() < now && h.status !== 'REVOKED' ? 'EXPIRED' : h.status,
        credentialExpiresAt: h.credentialExpiresAt,
        establishedAt: h.establishedAt,
        architect: h.architect,
        tokenCount: h.tokens.length,
        tokenRequestCount: h._count.tokenRequests,
        activeToken: activeToken
          ? { id: activeToken.id, prefix: activeToken.prefix, expiresAt: activeToken.expiresAt }
          : null,
        createdAt: h.createdAt,
      };
    });

    return ok({ handshakes: rows });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * POST /api/admin/handshakes
 *
 * The admin issues a credential bundle {clientId, clientSecret, expiryDate} for
 * an architect. The plaintext secret is returned exactly once — this is the
 * JSON the admin hands to the architect to validate with.
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

    const credentialExpiresAt =
      data.expiryDate ?? addDays(new Date(), data.expiresInDays ?? 30);
    if (credentialExpiresAt.getTime() <= Date.now()) {
      return fail('Credential expiry must be in the future', 422);
    }

    const clientId = generateClientId();
    const { secret, secretHash, secretPrefix } = generateSecret();

    const handshake = await prisma.architectHandshake.create({
      data: {
        architectId: architect.id,
        clientId,
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
      event: 'HANDSHAKE_ISSUED',
      statusCode: 201,
      detail: `Credentials issued to ${architect.email}; valid until ${credentialExpiresAt.toISOString()}`,
      ip: clientIp(req),
    });

    const baseUrl = new URL(req.url).origin;
    return ok(
      {
        message: 'Handshake credentials issued. Send this JSON to the architect — the secret is shown only once.',
        handshake: {
          id: handshake.id,
          status: handshake.status,
          architect: { id: architect.id, name: architect.name, email: architect.email },
          createdAt: handshake.createdAt,
        },
        // This is the exact payload the architect validates with (spec point 2).
        credential: credentialPayload({ handshake, secret, baseUrl }),
      },
      201,
    );
  } catch (error) {
    return handleError(error);
  }
}
