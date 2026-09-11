import { randomBytes } from 'crypto';
import type { User } from '@prisma/client';
import { prisma } from './prisma';
import { hashPassword } from './auth';

/**
 * CIDCO creates the architect's portal account.
 *
 * An architect does not sign themselves up for the SFTP channel — CIDCO
 * registers their company and, in doing so, creates the login they will use.
 * So any email is accepted here: if no account exists for it, one is made and
 * the password is handed back exactly once for the officer to pass on.
 */
export type ResolvedArchitect =
  | { ok: true; architect: User; created: false }
  | { ok: true; architect: User; created: true; temporaryPassword: string }
  | { ok: false; reason: string };

/** Readable enough to type by hand, long enough not to be guessable. */
export function generateArchitectPassword() {
  return `cidco-${randomBytes(6).toString('hex')}`;
}

export async function resolveArchitectAccount(params: {
  email: string;
  /** Falls back to the email's local part when CIDCO does not give a name. */
  name?: string | null;
  companyName?: string | null;
}): Promise<ResolvedArchitect> {
  const email = params.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    if (existing.role !== 'ARCHITECT') {
      return {
        ok: false,
        reason: `${email} is already a CIDCO officer account — use a different email for the architect.`,
      };
    }
    return { ok: true, architect: existing, created: false };
  }

  const temporaryPassword = generateArchitectPassword();
  const architect = await prisma.user.create({
    data: {
      email,
      name: params.name?.trim() || email.split('@')[0],
      passwordHash: await hashPassword(temporaryPassword),
      role: 'ARCHITECT',
      firmName: params.companyName?.trim() || null,
    },
  });

  return { ok: true, architect, created: true, temporaryPassword };
}
