import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { requireCidco } from '@/lib/guards';
import { hashPassword } from '@/lib/auth';
import { generateArchitectPassword } from '@/lib/architectAccounts';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/sftp/companies/:id/reset-login
 *
 * The architect did not keep the portal password CIDCO created for them. This
 * mints a new one and shows it once, so the officer can send it again.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;
    const { id } = await params;

    const company = await prisma.company.findUnique({
      where: { id },
      include: { architect: true },
    });
    if (!company) return fail('Company not found', 404);
    if (!company.architect) {
      return fail('No architect account is linked to this company yet', 422);
    }

    const temporaryPassword = generateArchitectPassword();
    await prisma.user.update({
      where: { id: company.architect.id },
      data: { passwordHash: await hashPassword(temporaryPassword) },
    });

    return ok({
      message: 'New portal password set. Send it to the architect — it is shown only once.',
      architectAccount: {
        email: company.architect.email,
        name: company.architect.name,
        temporaryPassword,
        created: false,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
