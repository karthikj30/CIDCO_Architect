import type { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/sftp/validation-requests
 *
 * The SFTP approval queue: architects whose first SFTP connection verified but
 * who are waiting for CIDCO to confirm where the connection came from. The
 * SFTP server refuses every session until one of these is approved.
 */
export async function GET(req: NextRequest) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;

    const status = new URL(req.url).searchParams.get('status');
    const where: Prisma.ValidationRequestWhereInput = { channel: 'SFTP' };
    if (status) where.status = status as Prisma.ValidationRequestWhereInput['status'];

    const requests = await prisma.validationRequest.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: {
        handshake: {
          select: {
            id: true,
            clientId: true,
            status: true,
            whitelistedIp: true,
            deviceInfo: true,
            credentialExpiresAt: true,
            architect: { select: { id: true, name: true, email: true, firmName: true, councilRegNo: true } },
          },
        },
      },
    });

    return ok({ requests });
  } catch (error) {
    return handleError(error);
  }
}
