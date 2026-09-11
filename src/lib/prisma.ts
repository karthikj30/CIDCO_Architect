import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/**
 * The generated client is not in git — it is built from schema.prisma by
 * `prisma generate`. Pull a schema change without regenerating and every query
 * fails with something unhelpful ("Cannot read properties of undefined", or an
 * unknown-field error deep in a query). Catch that here and say what to do.
 *
 * The npm scripts regenerate automatically; this is the safety net for anyone
 * who starts the server another way.
 */
const REQUIRED_MODELS = ['user', 'company', 'architectHandshake', 'sftpUpload', 'report'] as const;

const missing = REQUIRED_MODELS.filter(
  (model) => typeof (prisma as unknown as Record<string, unknown>)[model] !== 'object',
);

if (missing.length > 0) {
  throw new Error(
    `Your generated Prisma client is out of date — it is missing: ${missing.join(', ')}.\n` +
      'Run `npx prisma generate` (and `npx prisma migrate deploy` if you have not applied the ' +
      'latest migrations), then restart the server.',
  );
}
