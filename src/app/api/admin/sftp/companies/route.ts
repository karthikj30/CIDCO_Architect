import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';
import { normaliseIp, normalisePath } from '@/lib/sftp';

export const dynamic = 'force-dynamic';

const companySchema = z.object({
  companyId: z
    .string()
    .min(2, 'Company id is required')
    .max(60)
    .regex(/^[A-Za-z0-9._/-]+$/, 'Company id may use letters, digits, dot, dash, slash and underscore'),
  companyName: z.string().min(2, 'Company name is required').max(160),
  architectServerIp: z.string().min(3, "The architect's server IP is required").max(64),
  filePath: z.string().min(1, 'File path is required').max(400),
  architectEmail: z.string().email().optional(),
  notes: z.string().max(300).optional(),
});

/**
 * GET /api/admin/sftp/companies
 *
 * The register CIDCO builds by hand. Every SFTP transfer is validated against
 * one of these rows.
 */
export async function GET(req: NextRequest) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;

    const companies = await prisma.company.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        architect: { select: { id: true, name: true, email: true, firmName: true } },
        handshakes: {
          where: { channel: 'SFTP' },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            clientId: true,
            status: true,
            credentialExpiresAt: true,
            _count: { select: { sftpUploads: true } },
          },
        },
      },
    });

    return ok({
      companies: companies.map((c) => ({
        id: c.id,
        companyId: c.companyId,
        companyName: c.companyName,
        architectServerIp: c.architectServerIp,
        filePath: c.filePath,
        notes: c.notes,
        active: c.active,
        architect: c.architect,
        createdAt: c.createdAt,
        // Credentials issued against this registration, if any yet.
        credentials: c.handshakes.map((h) => ({
          id: h.id,
          username: h.clientId,
          status: h.status,
          credentialExpiresAt: h.credentialExpiresAt,
          uploadCount: h._count.sftpUploads,
        })),
      })),
    });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * POST /api/admin/sftp/companies
 *
 * Step one of the SFTP channel, done by hand by a CIDCO officer before any
 * credentials exist: register the company name, the company id, the
 * architect's own server address, and the file path their CSV is taken from.
 */
export async function POST(req: NextRequest) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;

    const data = companySchema.parse(await req.json());

    const existing = await prisma.company.findUnique({ where: { companyId: data.companyId } });
    if (existing) return fail(`Company id "${data.companyId}" is already registered`, 409);

    let architectId: string | null = null;
    if (data.architectEmail) {
      const architect = await prisma.user.findUnique({ where: { email: data.architectEmail.toLowerCase() } });
      if (!architect) return fail('No architect account with that email', 404);
      if (architect.role !== 'ARCHITECT') return fail('That user is not an architect', 422);
      architectId = architect.id;
    }

    const company = await prisma.company.create({
      data: {
        companyId: data.companyId.trim(),
        companyName: data.companyName.trim(),
        // Stored normalised so a trailing slash or an IPv6-mapped form cannot
        // make a legitimate transfer fail validation later.
        architectServerIp: normaliseIp(data.architectServerIp),
        filePath: normalisePath(data.filePath),
        architectId,
        notes: data.notes ?? null,
        createdById: guard.user.id,
      },
      include: { architect: { select: { id: true, name: true, email: true } } },
    });

    return ok(
      {
        message:
          'Company registered. Issue SFTP credentials against it, then email the user id, password and designated IP to the architect.',
        company,
      },
      201,
    );
  } catch (error) {
    return handleError(error);
  }
}
