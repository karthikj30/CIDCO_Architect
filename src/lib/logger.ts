import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { prisma } from './prisma';
import { authenticate } from './auth';

export async function withLogging(
  req: NextRequest,
  handler: (req: NextRequest) => Promise<NextResponse>
): Promise<NextResponse> {
  const start = Date.now();
  
  // Create a clone of the request to read its body without consuming the original
  let requestBody = null;
  const contentType = req.headers.get('content-type') || '';
  
  // Only try to parse JSON bodies for logs (multipart/form-data can be large/binary)
  if (contentType.includes('application/json')) {
    try {
      const clonedReq = req.clone();
      requestBody = await clonedReq.text();
    } catch (e) {
      console.error('[logger] Failed to parse request body', e);
    }
  }

  // Attempt to authenticate to get user ID (if present)
  let userId = null;
  try {
    const auth = await authenticate(req);
    if (auth) {
      userId = auth.user.id;
    }
  } catch (e) {
    // ignore auth errors for logging
  }

  // Run the actual handler
  const response = await handler(req);

  const durationMs = Date.now() - start;
  
  let responseBody = null;
  try {
    // Clone the response to read body
    const clonedRes = response.clone();
    responseBody = await clonedRes.text();
  } catch (e) {
    console.error('[logger] Failed to parse response body', e);
  }

  // Fire and forget logging to database
  prisma.apiRequestLog.create({
    data: {
      method: req.method,
      endpoint: req.nextUrl.pathname,
      statusCode: response.status,
      durationMs,
      ip: req.headers.get('x-forwarded-for') || undefined,
      userId,
      requestBody,
      responseBody,
    },
  }).catch((e) => {
    console.error('[logger] Failed to write ApiRequestLog to database', e);
  });

  return response;
}
