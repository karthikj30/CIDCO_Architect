import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';
import type {
  ArchitectHandshake,
  CommDirection,
  IntegrationToken,
} from '@prisma/client';
import { prisma } from './prisma';

// ---------------------------------------------------------------------------
// Credential + token generation
//
// The clientId is the "userid" the admin hands to the architect; the secret is
// the "password". Tokens are separate bearer credentials minted once the
// handshake is established. All three are high-entropy random strings, so a
// SHA-256 hash (same approach as the existing ApiKey model) is the right store
// — we never keep the plaintext of the secret or a token.
// ---------------------------------------------------------------------------

export const CLIENT_ID_PREFIX = 'ARCH-';
export const SECRET_PREFIX = 'hs_sec_';
export const TOKEN_PREFIX = 'cidco_tok_';

export const DEFAULT_TOKEN_TTL_DAYS = 7;

export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

/** Constant-time compare of two hex digests. */
export function hashesEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function generateClientId() {
  return `${CLIENT_ID_PREFIX}${randomBytes(6).toString('hex').toUpperCase()}`;
}

export function generateSecret() {
  const secret = `${SECRET_PREFIX}${randomBytes(24).toString('hex')}`;
  return { secret, secretHash: sha256(secret), secretPrefix: secret.slice(0, 14) };
}

export function generateToken() {
  const token = `${TOKEN_PREFIX}${randomBytes(24).toString('hex')}`;
  return { token, tokenHash: sha256(token), prefix: token.slice(0, 16) };
}

export const REFRESH_TOKEN_PREFIX = 'cidco_ref_';
export const DEFAULT_REFRESH_TOKEN_TTL_DAYS = 30;

export function generateRefreshToken() {
  const token = `${REFRESH_TOKEN_PREFIX}${randomBytes(24).toString('hex')}`;
  return { token, tokenHash: sha256(token), prefix: token.slice(0, 16) };
}

export function addDays(from: Date, days: number) {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Communication log — the human-readable, timestamped trail both sides audit.
// Never pass secrets in `detail`.
// ---------------------------------------------------------------------------

export type CommEvent =
  | 'HANDSHAKE_ISSUED'
  | 'ARCHITECT_VALIDATED'
  | 'CHANNEL_ESTABLISHED'
  | 'VALIDATION_FAILED'
  | 'TOKEN_REQUESTED'
  | 'TOKEN_GENERATED'
  | 'TOKEN_REQUEST_REJECTED'
  | 'DATA_RECEIVED'
  | 'DATA_REJECTED'
  | 'HANDSHAKE_REVOKED';

export async function logComm(params: {
  handshakeId: string | null;
  direction: CommDirection;
  event: CommEvent;
  statusCode?: number;
  detail?: string;
  ip?: string | null;
}) {
  try {
    await prisma.communicationLog.create({
      data: {
        handshakeId: params.handshakeId,
        direction: params.direction,
        event: params.event,
        statusCode: params.statusCode ?? null,
        detail: params.detail ?? null,
        ip: params.ip ?? null,
      },
    });
  } catch (error) {
    // Logging must never break the exchange it is describing.
    console.error('[comm-log] failed to record', params.event, error);
  }
}

export function clientIp(req: NextRequest) {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null
  );
}

// ---------------------------------------------------------------------------
// Handshake + token verification
// ---------------------------------------------------------------------------

/** Marks a handshake EXPIRED in the background if its credential window closed. */
export async function effectiveStatus(h: ArchitectHandshake): Promise<ArchitectHandshake['status']> {
  if (h.status === 'REVOKED') return 'REVOKED';
  if (h.credentialExpiresAt.getTime() < Date.now()) {
    if (h.status !== 'EXPIRED') {
      await prisma.architectHandshake.update({ where: { id: h.id }, data: { status: 'EXPIRED' } }).catch(() => {});
    }
    return 'EXPIRED';
  }
  return h.status;
}

export type CredentialCheck =
  | { ok: true; handshake: ArchitectHandshake }
  | { ok: false; reason: string; handshakeId: string | null };

/**
 * Verifies a clientId + secret pair against a stored handshake. Used both by
 * the architect's validate call and by the admin when minting a token "using
 * its user id and password".
 */
export async function verifyCredentials(clientId: string, secret: string): Promise<CredentialCheck> {
  const handshake = await prisma.architectHandshake.findUnique({ where: { clientId } });
  if (!handshake) return { ok: false, reason: 'Unknown clientId', handshakeId: null };
  if (handshake.status === 'REVOKED' || handshake.revokedAt) {
    return { ok: false, reason: 'Handshake has been revoked', handshakeId: handshake.id };
  }
  if (handshake.credentialExpiresAt.getTime() < Date.now()) {
    await prisma.architectHandshake.update({ where: { id: handshake.id }, data: { status: 'EXPIRED' } }).catch(() => {});
    return { ok: false, reason: 'Credential has expired', handshakeId: handshake.id };
  }
  if (!hashesEqual(sha256(secret), handshake.secretHash)) {
    return { ok: false, reason: 'Invalid clientSecret', handshakeId: handshake.id };
  }
  return { ok: true, handshake };
}

export type TokenCheck =
  | { ok: true; token: IntegrationToken; handshake: ArchitectHandshake }
  | { ok: false; reason: string; expired: boolean };

/** Reads and validates the Bearer integration token on a data request. */
export async function authenticateToken(req: NextRequest): Promise<TokenCheck> {
  const header = req.headers.get('authorization') || '';
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  const raw = bearer || req.headers.get('x-integration-token')?.trim() || '';
  if (!raw || !raw.startsWith(TOKEN_PREFIX)) {
    return { ok: false, reason: 'Missing integration token. Send Authorization: Bearer <token>.', expired: false };
  }

  const token = await prisma.integrationToken.findUnique({
    where: { tokenHash: sha256(raw) },
    include: { handshake: true },
  });
  if (!token) return { ok: false, reason: 'Unknown integration token', expired: false };
  if (token.revokedAt) return { ok: false, reason: 'Integration token was revoked', expired: false };
  if (token.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: 'Integration token has expired — call POST /api/architect/refresh with your refresh token to get a new one', expired: true };
  }
  if (token.handshake.status !== 'ESTABLISHED') {
    return { ok: false, reason: 'Handshake is not established', expired: false };
  }

  await prisma.integrationToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return { ok: true, token, handshake: token.handshake };
}

/**
 * Resolves the architect's handshake for read-only endpoints (status, logs).
 * Accepts either the Bearer integration token, or the handshake credentials via
 * x-client-id / x-client-secret headers (or ?clientId=&clientSecret= query) so
 * the architect can inspect the exchange even before a token is issued.
 */
export async function resolveHandshakeForRead(
  req: NextRequest,
): Promise<{ ok: true; handshake: ArchitectHandshake } | { ok: false; reason: string }> {
  const tokenCheck = await authenticateToken(req);
  if (tokenCheck.ok) return { ok: true, handshake: tokenCheck.handshake };

  const url = new URL(req.url);
  const clientId = req.headers.get('x-client-id') || url.searchParams.get('clientId') || '';
  const clientSecret = req.headers.get('x-client-secret') || url.searchParams.get('clientSecret') || '';
  if (clientId && clientSecret) {
    const check = await verifyCredentials(clientId, clientSecret);
    if (check.ok) return { ok: true, handshake: check.handshake };
    return { ok: false, reason: check.reason };
  }
  return { ok: false, reason: 'Provide a Bearer token, or x-client-id and x-client-secret headers.' };
}

/** Shape of the credential bundle the admin hands to the architect (point 2). */
export function credentialPayload(params: {
  handshake: ArchitectHandshake;
  secret: string;
  baseUrl: string;
}) {
  const { handshake, secret, baseUrl } = params;
  return {
    clientId: handshake.clientId,
    clientSecret: secret,
    expiryDate: handshake.credentialExpiresAt.toISOString(),
    validateUrl: `${baseUrl}/api/architect/validate`,
    tokenRequestUrl: `${baseUrl}/api/architect/token-requests`,
    dataUrl: `${baseUrl}/api/architect/data`,
    logsUrl: `${baseUrl}/api/architect/logs`,
  };
}
