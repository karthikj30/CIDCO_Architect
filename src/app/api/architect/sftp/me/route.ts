import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { handleError, ok } from '@/lib/api';
import { requireArchitect } from '@/lib/guards';
import { sftpEndpoint } from '@/lib/sftp';

export const dynamic = 'force-dynamic';

/**
 * GET /api/architect/sftp/me
 *
 * Everything the architect's SFTP workspace needs: their SFTP account and where
 * the handshake stands, the connection details, and what CIDCO made of every
 * workbook they have uploaded.
 */
export async function GET(req: NextRequest) {
  try {
    const guard = await requireArchitect(req);
    if ('error' in guard) return guard.error;
    const me = guard.user;
    const now = Date.now();

    const accounts = await prisma.architectHandshake.findMany({
      where: { architectId: me.id, channel: 'SFTP' },
      orderBy: { createdAt: 'desc' },
      include: {
        commLogs: { orderBy: { createdAt: 'desc' }, take: 30 },
        validationRequests: { orderBy: { createdAt: 'desc' }, take: 5 },
        sftpUploads: {
          orderBy: { receivedAt: 'desc' },
          take: 25,
          select: {
            id: true,
            fileName: true,
            sizeBytes: true,
            status: true,
            sheetName: true,
            rowCount: true,
            importedCount: true,
            failedCount: true,
            errors: true,
            receivedAt: true,
            parsedAt: true,
          },
        },
      },
    });

    return ok({
      architect: { id: me.id, name: me.name, email: me.email, firmName: me.firmName },
      endpoint: sftpEndpoint(req.headers.get('host')?.split(':')[0]),
      accounts: accounts.map((a) => ({
        id: a.id,
        username: a.clientId,
        passwordPrefix: a.secretPrefix,
        status: a.credentialExpiresAt.getTime() < now && a.status !== 'REVOKED' ? 'EXPIRED' : a.status,
        credentialExpiresAt: a.credentialExpiresAt,
        establishedAt: a.establishedAt,
        whitelistedIp: a.whitelistedIp,
        deviceInfo: a.deviceInfo,
        enforceWhitelist: a.enforceWhitelist,
        uploads: a.sftpUploads,
        commLogs: a.commLogs,
        validationRequests: a.validationRequests.map((v) => ({
          id: v.id,
          status: v.status,
          presentedIp: v.presentedIp,
          deviceInfo: v.deviceInfo,
          reviewNote: v.reviewNote,
          createdAt: v.createdAt,
          reviewedAt: v.reviewedAt,
        })),
      })),
    });
  } catch (error) {
    return handleError(error);
  }
}
