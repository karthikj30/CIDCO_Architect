import type { NextRequest } from 'next/server';
import type { User } from '@prisma/client';
import { authenticate } from './auth';
import { forbidden, unauthorized } from './api';
import { NextResponse } from 'next/server';

export type GuardResult = { user: User } | { error: NextResponse };

/**
 * Admin-side endpoints (issuing credentials, minting tokens, reading the
 * exchange) require a signed-in CIDCO officer or admin. Architects — who only
 * ever hold handshake credentials or tokens — are refused here.
 */
export async function requireCidco(req: NextRequest): Promise<GuardResult> {
  const auth = await authenticate(req);
  if (!auth) return { error: unauthorized('CIDCO officer sign-in required.') };
  if (auth.user.role === 'ARCHITECT') {
    return { error: forbidden('This endpoint is for CIDCO officers only.') };
  }
  return { user: auth.user };
}
