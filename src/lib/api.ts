import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function fail(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ success: false, error: message, details }, { status });
}

export function unauthorized(message = 'Authentication required. Send a session cookie, Bearer JWT or X-API-Key header.') {
  return fail(message, 401);
}

export function forbidden(message = 'You do not have permission to perform this action.') {
  return fail(message, 403);
}

/** Turns thrown errors into a predictable JSON envelope. */
export function handleError(error: unknown) {
  if (error instanceof ZodError) {
    return fail('Validation failed', 422, error.flatten().fieldErrors);
  }
  console.error('[api]', error);
  const message = error instanceof Error ? error.message : 'Unexpected server error';
  return fail(message, 500);
}
