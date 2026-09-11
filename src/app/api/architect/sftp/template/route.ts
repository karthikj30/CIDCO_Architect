import { handleError } from '@/lib/api';
import { buildTemplateWorkbook } from '@/lib/sftp';

export const dynamic = 'force-dynamic';

/**
 * GET /api/architect/sftp/template
 *
 * The blank workbook an architect fills in and uploads. Its header row is the
 * exact set of columns CIDCO parses, so a sheet built from this always imports.
 */
export async function GET() {
  try {
    const buffer = await buildTemplateWorkbook();
    return new Response(new Uint8Array(buffer), {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': 'attachment; filename="cidco-aqi-template.xlsx"',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
