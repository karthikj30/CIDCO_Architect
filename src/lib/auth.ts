import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { prisma } from './prisma';
import type { Role, User } from '@prisma/client';

export const SESSION_COOKIE = 'cidco_session';
const TOKEN_TTL_SECONDS = 60 * 60 * 12; // 12 hours

function secretKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return new TextEncoder().encode(secret);
}

export type SessionPayload = {
  sub: string;
  email: string;
  role: Role;
  name: string;
};

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

export async function signToken(payload: SessionPayload) {
  return new SignJWT({ email: payload.email, role: payload.role, name: payload.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setIssuer('cidco-aqi-portal')
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { issuer: 'cidco-aqi-portal' });
    if (!payload.sub) return null;
    return {
      sub: payload.sub,
      email: String(payload.email ?? ''),
      role: payload.role as Role,
      name: String(payload.name ?? ''),
    };
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: TOKEN_TTL_SECONDS,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}

/** Reads the session for server components / pages. */
export async function getSessionUser(): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload) return null;
  return prisma.user.findUnique({ where: { id: payload.sub } });
}

// ---------------------------------------------------------------------------
// API keys — machine-to-machine auth for the "architect hits the CIDCO API"
// flow. The plaintext key is only ever returned at creation time.
// ---------------------------------------------------------------------------

export const API_KEY_PREFIX = 'cidco_live_';

export function generateApiKey() {
  const raw = randomBytes(24).toString('hex');
  const key = `${API_KEY_PREFIX}${raw}`;
  return { key, keyHash: hashApiKey(key), prefix: key.slice(0, 18) };
}

export function hashApiKey(key: string) {
  return createHash('sha256').update(key).digest('hex');
}

function readApiKey(req: NextRequest): string | null {
  const header = req.headers.get('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) {
    const value = header.slice(7).trim();
    if (value.startsWith(API_KEY_PREFIX)) return value;
  }
  const direct = req.headers.get('x-api-key');
  return direct?.trim() || null;
}

export type AuthedUser = { user: User; via: 'session' | 'api-key' };

/**
 * Resolves the caller from either a browser session cookie, a Bearer JWT
 * (handy from Postman after /api/auth/login) or an API key.
 */
export async function authenticate(req: NextRequest): Promise<AuthedUser | null> {
  const apiKey = readApiKey(req);
  if (apiKey) {
    const record = await prisma.apiKey.findUnique({
      where: { keyHash: hashApiKey(apiKey) },
      include: { user: true },
    });
    if (!record || record.revokedAt) return null;
    await prisma.apiKey.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
    });
    return { user: record.user, via: 'api-key' };
  }

  const header = req.headers.get('authorization');
  const bearer = header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null;
  const token = bearer ?? req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const payload = await verifyToken(token);
  if (!payload) return null;
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  return user ? { user, via: 'session' } : null;
}
