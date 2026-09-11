import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';
import { normaliseIp, normalisePath } from '@/lib/sftp';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  companyName: z.string().min(2).max(160).optional(),
  architectServerIp: z.string().min(3).max(64).optional(),
  filePath: z.string().min(1).max(400).optional(),
  notes: z.string().max(300).nullable().optional(),
  active: z.boolean().optional(),
  architectEmail: z.string().email().nullable().optional(),
});

/**
 * PATCH /api/admin/sftp/companies/:id
 *
 * Correct a registration — the architect moved server, or their export path
 * changed. Takes effect on the very next transfer, since validation reads this
 * record every time.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;
    const { id } = await params;

    const body = patchSchema.parse(await req.json());
    const company = await prisma.company.findUnique({ where: { id } });
    if (!company) return fail('Company not found', 404);

    let architectId = company.architectId;
    if (body.architectEmail === null) {
      architectId = null;
    } else if (body.architectEmail) {
      const architect = await prisma.user.findUnique({ where: { email: body.architectEmail.toLowerCase() } });
      if (!architect) return fail('No architect account with that email', 404);
      if (architect.role !== 'ARCHITECT') return fail('That user is not an architect', 422);
      architectId = architect.id;
    }

    const updated = await prisma.company.update({
      where: { id },
      data: {
        companyName: body.companyName ?? undefined,
        architectServerIp: body.architectServerIp ? normaliseIp(body.architectServerIp) : undefined,
        filePath: body.filePath ? normalisePath(body.filePath) : undefined,
        notes: body.notes === undefined ? undefined : body.notes,
        active: body.active ?? undefined,
        architectId,
      },
      include: { architect: { select: { id: true, name: true, email: true } } },
    });

    return ok({ message: 'Registration updated. It applies to the next transfer.', company: updated });
  } catch (error) {
    return handleError(error);
  }
}
