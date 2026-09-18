import fs from 'fs/promises';
import path from 'path';
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fail, handleError } from '@/lib/api';
import { requireCidco } from '@/lib/guards';
import { dataRoot } from '@/lib/sftp';

export const dynamic = 'force-dynamic';

/** GET /api/admin/sftp/data/:id/download — the CSV exactly as it was filed. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireCidco(req);
    if ('error' in guard) return guard.error;
    const { id } = await params;

    const file = await prisma.dataFile.findUnique({ where: { id } });
    if (!file) return fail('File not found', 404);

    // Resolve inside the data root, so a stored path can never escape it.
    const absolute = path.resolve(dataRoot(), file.relativePath);
    if (!absolute.startsWith(path.resolve(dataRoot()) + path.sep)) {
      return fail('That file is outside the data directory', 400);
    }

    const body = await fs.readFile(absolute).catch(() => null);
    if (!body) return fail('The file is no longer on disk', 410);

    return new Response(new Uint8Array(body), {
      headers: {
        'content-type': file.fileName.toLowerCase().endsWith('.xlsx')
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${file.fileName.replace(/"/g, '')}"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
