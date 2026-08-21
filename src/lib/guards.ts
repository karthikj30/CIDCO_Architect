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

/**
 * The architect's own dashboard. Read-only views of their handshakes, tokens
 * and readings — the protocol calls (validate / refresh / data) still go
 * through the token-authenticated endpoints, exactly as an external system's
 * would, so the dashboard never becomes a back door around the handshake.
 */
export async function requireArchitect(req: NextRequest): Promise<GuardResult> {
  const auth = await authenticate(req);
  if (!auth) return { error: unauthorized('Architect sign-in required.') };
  if (auth.user.role !== 'ARCHITECT') {
    return { error: forbidden('This endpoint is for architects only.') };
  }
  return { user: auth.user };
}
