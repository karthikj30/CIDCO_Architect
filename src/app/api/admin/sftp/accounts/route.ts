import { randomBytes } from 'crypto';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';
import { addDays, clientIp, logComm } from '@/lib/handshake';
import { sftpEndpoint, sha256 } from '@/lib/sftp';

export const dynamic = 'force-dynamic';

const issueSchema = z.object({
  /** The registered company these credentials belong to. */
  companyId: z.string().min(2, 'Pick the company to issue credentials for'),
  expiresInDays: z.coerce.number().int().positive().max(3650).optional(),
});

/** SFTP user ids read better than the API's opaque client ids. */
function generateSftpUsername() {
  return `sftp_${randomBytes(5).toString('hex')}`;
}

function generateSftpPassword() {
  const secret = randomBytes(18).toString('base64url');
  return { secret, secretHash: sha256(secret), secretPrefix: secret.slice(0, 8) };
}

/** GET /api/admin/sftp/accounts — every SFTP account and what it has delivered. */
export async function GET(req: NextRequest) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;

    const rows = await prisma.architectHandshake.findMany({
      where: { channel: 'SFTP' },
      orderBy: { createdAt: 'desc' },
      include: {
        architect: { select: { id: true, name: true, email: true, firmName: true } },
        company: true,
        _count: { select: { sftpUploads: true } },
        sftpUploads: {
          orderBy: { receivedAt: 'desc' },
          take: 1,
          select: { receivedAt: true, status: true, validationPassed: true },
        },
      },
    });

    const now = Date.now();
    return ok({
      endpoint: sftpEndpoint(req.headers.get('host')?.split(':')[0]),
      accounts: rows.map((h) => ({
        id: h.id,
        username: h.clientId,
        passwordPrefix: h.secretPrefix,
        status: h.credentialExpiresAt.getTime() < now && h.status !== 'REVOKED' ? 'EXPIRED' : h.status,
        credentialExpiresAt: h.credentialExpiresAt,
        establishedAt: h.establishedAt,
        architect: h.architect,
        // The registration every transfer on this account is checked against.
        company: h.company
          ? {
              id: h.company.id,
              companyId: h.company.companyId,
              companyName: h.company.companyName,
              architectServerIp: h.company.architectServerIp,
              filePath: h.company.filePath,
              active: h.company.active,
            }
          : null,
        uploadCount: h._count.sftpUploads,
        lastUpload: h.sftpUploads[0] ?? null,
        createdAt: h.createdAt,
      })),
    });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * POST /api/admin/sftp/accounts
 *
 * Step two: issue an SFTP user id and password against a company CIDCO has
 * already registered. The password is returned exactly once — this is the
 * bundle the officer emails over, including the designated IP to send to.
 */
export async function POST(req: NextRequest) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;

    const data = issueSchema.parse(await req.json());

    const company = await prisma.company.findUnique({
      where: { companyId: data.companyId },
      include: { architect: true },
    });
    if (!company) {
      return fail(`No company registered with id "${data.companyId}". Register the company first.`, 404);
    }
    if (!company.active) return fail('That company registration is inactive', 409);
    if (!company.architect) {
      return fail('Link an architect account to the company before issuing credentials', 422);
    }

    const credentialExpiresAt = addDays(new Date(), data.expiresInDays ?? 365);

    const username = generateSftpUsername();
    const { secret, secretHash, secretPrefix } = generateSftpPassword();

    const handshake = await prisma.architectHandshake.create({
      data: {
        architectId: company.architect.id,
        channel: 'SFTP',
        companyRecordId: company.id,
        clientId: username,
        secretHash,
        secretPrefix,
        credentialExpiresAt,
        createdById: guard.user.id,
        // The company registration is CIDCO's manual approval, so the channel
        // is open from here — every transfer is still validated individually.
        status: 'ESTABLISHED',
        establishedAt: new Date(),
        whitelistedIp: company.architectServerIp,
        whitelistedAt: new Date(),
      },
    });

    await logComm({
      handshakeId: handshake.id,
      direction: 'ADMIN_TO_ARCHITECT',
      event: 'SFTP_CREDENTIALS_ISSUED',
      statusCode: 201,
      detail:
        `SFTP user id issued to ${company.architect.email} for ${company.companyName} (${company.companyId}); ` +
        `data accepted from ${company.architectServerIp} at "${company.filePath}"; ` +
        `valid until ${credentialExpiresAt.toISOString()}`,
      ip: clientIp(req),
    });

    const endpoint = sftpEndpoint(req.headers.get('host')?.split(':')[0]);

    return ok(
      {
        message:
          'SFTP credentials issued. Email this to the architect — the password is shown only once.',
        account: {
          id: handshake.id,
          status: handshake.status,
          architect: { id: company.architect.id, name: company.architect.name, email: company.architect.email },
          createdAt: handshake.createdAt,
        },
        // Exactly what the officer sends: the login, the address to send to,
        // and the path the file is taken from.
        credential: {
          companyName: company.companyName,
          companyId: company.companyId,
          username,
          password: secret,
          designatedIp: endpoint.designatedIp,
          port: endpoint.port,
          protocol: endpoint.protocol,
          filePath: company.filePath,
          fileTypes: endpoint.fileTypes,
          expiryDate: credentialExpiresAt.toISOString(),
        },
      },
      201,
    );
  } catch (error) {
    return handleError(error);
  }
}
