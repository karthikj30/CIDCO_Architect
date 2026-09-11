import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';
import { clientIp, logComm } from '@/lib/handshake';

export const dynamic = 'force-dynamic';

const rejectSchema = z.object({ reviewNote: z.string().max(300).optional() });

/**
 * POST /api/admin/sftp/validation-requests/:id/reject
 *
 * The officer does not recognise the architect or the address the connection
 * came from. The channel stays shut and the SFTP server keeps refusing them.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;
    const { id } = await params;
    const body = rejectSchema.parse(await req.json().catch(() => ({})));

    const request = await prisma.validationRequest.findUnique({
      where: { id },
      include: { handshake: true },
    });
    if (!request) return fail('Validation request not found', 404);
    if (request.channel !== 'SFTP') return fail('That request is on the API channel', 409);
    if (request.status !== 'PENDING') return fail(`This request is already ${request.status}`, 409);

    const now = new Date();
    await prisma.validationRequest.update({
      where: { id },
      data: { status: 'REJECTED', reviewedById: guard.user.id, reviewedAt: now, reviewNote: body.reviewNote ?? null },
    });

    // Only drop the account back if the channel was never opened.
    if (request.handshake.status === 'AWAITING_APPROVAL') {
      await prisma.architectHandshake.update({
        where: { id: request.handshakeId },
        data: { status: 'REJECTED' },
      });
    }

    await logComm({
      handshakeId: request.handshakeId,
      direction: 'ADMIN_TO_ARCHITECT',
      event: 'SFTP_HANDSHAKE_REJECTED',
      statusCode: 403,
      detail: body.reviewNote ?? 'SFTP handshake request rejected by CIDCO',
      ip: clientIp(req),
    });

    return ok({ message: 'Rejected. The SFTP server will keep refusing connections for this account.' });
  } catch (error) {
    return handleError(error);
  }
}
