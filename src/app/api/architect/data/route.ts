import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok } from '@/lib/api';
import { withLogging } from '@/lib/logger';
import { normaliseReadingFields, reportSchema } from '@/lib/validation';
import { createReport, type PendingAttachment } from '@/lib/reports';
import { ALLOWED_DOCUMENT_TYPES, ALLOWED_IMAGE_TYPES, assertFileAllowed } from '@/lib/storage';
import { authenticateToken, clientIp, logComm } from '@/lib/handshake';

export const dynamic = 'force-dynamic';

const DOCUMENT_FIELDS = ['document', 'documents', 'report', 'file'];
const PHOTO_FIELDS = ['boardPhoto', 'boardPhotos', 'aqiBoardPhoto', 'aqiBoardPhotos', 'photo', 'photos', 'images'];

/**
 * POST /api/architect/data
 *
 * The established data channel. Authenticated with the Bearer integration token
 * the admin minted. Accepts multipart/form-data (report fields + signed
 * document + AQI board photos) or application/json. The reading is written to
 * PostgreSQL automatically and the transfer is recorded in the comm log.
 */
export async function POST(req: NextRequest) {
  return withLogging(req, async (req) => {
    try {
      const ip = clientIp(req);
      const check = await authenticateToken(req);
      if (!check.ok) {
        // 401 for auth problems; expired tokens carry a hint to renew.
        return fail(check.reason, check.expired ? 401 : 401);
      }
      const { token, handshake } = check;

      const contentType = req.headers.get('content-type') || '';
      let fields: Record<string, unknown> = {};
      const attachments: PendingAttachment[] = [];

      if (contentType.includes('multipart/form-data')) {
        const form = await req.formData();
        for (const [key, value] of form.entries()) {
          if (typeof value === 'string') {
            fields[key] = value;
            continue;
          }
          const file = value as File;
          if (DOCUMENT_FIELDS.includes(key)) {
            assertFileAllowed(file, [...ALLOWED_DOCUMENT_TYPES, ...ALLOWED_IMAGE_TYPES], 'Document');
            attachments.push({ file, kind: 'DOCUMENT' });
          } else if (PHOTO_FIELDS.includes(key)) {
            assertFileAllowed(file, ALLOWED_IMAGE_TYPES, 'AQI board photo');
            attachments.push({ file, kind: 'AQI_BOARD_PHOTO' });
          } else {
            assertFileAllowed(file, [...ALLOWED_DOCUMENT_TYPES, ...ALLOWED_IMAGE_TYPES], 'Attachment');
            attachments.push({ file, kind: 'OTHER' });
          }
        }
      } else if (contentType.includes('application/json')) {
        fields = await req.json();
      } else {
        return fail('Send multipart/form-data (with document and boardPhotos) or application/json.', 415);
      }

      // Accept human-readable / aliased keys, then fill in what an unattended
      // station feed usually omits so a bare device payload still validates.
      const raw = normaliseReadingFields(fields);
      if (!raw.siteName) raw.siteName = raw.projectSiteId || raw.monitoringStationId || 'Automated station';
      if (!raw.location) raw.location = raw.projectSiteId ? String(raw.projectSiteId) : 'N/A';
      if (!raw.integrationMethod) raw.integrationMethod = 'Automated API';

      const input = reportSchema.parse(raw);

      if (contentType.includes('multipart') && !attachments.some((a) => a.kind === 'AQI_BOARD_PHOTO')) {
        return fail('At least one AQI board photograph is required (field name: boardPhotos)', 422);
      }

      const report = await createReport({
        userId: handshake.architectId,
        source: 'API',
        input,
        attachments,
      });

      await logComm({
        handshakeId: handshake.id,
        direction: 'ARCHITECT_TO_ADMIN',
        event: 'DATA_RECEIVED',
        statusCode: 201,
        detail: `Report ${report.referenceNo} received (AQI ${report.aqiValue} at ${report.siteName}) via token ${token.prefix}…`,
        ip,
      });

      return ok(
        {
          message: 'AQI data received by CIDCO and stored.',
          report: {
            id: report.id,
            referenceNo: report.referenceNo,
            status: report.status,
            source: report.source,
            integrationMethod: report.integrationMethod,
            projectSiteId: report.projectSiteId,
            monitoringStationId: report.monitoringStationId,
            oem: report.oem,
            deviceModel: report.deviceModel,
            siteName: report.siteName,
            measuredAt: report.measuredAt,
            aqiValue: report.aqiValue,
            pm25: report.pm25,
            pm10: report.pm10,
            no2: report.no2,
            so2: report.so2,
            co: report.co,
            ozone: report.ozone,
            temperature: report.temperature,
            humidity: report.humidity,
            otherParams: report.otherParams,
            receivedAt: report.receivedAt,
            attachments: report.attachments.map((a) => ({
              id: a.id,
              kind: a.kind,
              fileName: a.fileName,
              sizeBytes: a.sizeBytes,
            })),
          },
        },
        201,
      );
    } catch (error) {
      if (error instanceof Error && /exceeds|unsupported type|is empty|Invalid file/.test(error.message)) {
        return fail(error.message, 422);
      }
      return handleError(error);
    }
  });
}
