import { createHash, timingSafeEqual } from 'crypto';
import path from 'path';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import type { ArchitectHandshake, Company, Prisma, TransferMode } from '@prisma/client';
import { prisma } from './prisma';
import { createReport } from './reports';
import { normaliseReadingFields, reportSchema } from './validation';

/**
 * The SFTP delivery channel.
 *
 * CIDCO registers the company by hand first — company name, company id, the
 * architect's server address and the file path their CSV is taken from — and
 * only then issues an SFTP user id and password against that record, emailing
 * it with the designated address to send to.
 *
 * From then on the architect sends automatically. **Every single transfer is
 * validated on the CIDCO side**: the company id, the address it arrived from
 * and the path it was taken from are compared against what CIDCO registered.
 * Only when all three match is the file parsed and its readings stored.
 */

// --- Workbook shape --------------------------------------------------------

/** The columns CIDCO expects in the uploaded sheet, in order. */
export const SHEET_COLUMNS: Array<{ header: string; key: string; width: number; example: string | number }> = [
  { header: 'Project / Site ID', key: 'projectSiteId', width: 20, example: 'CIDCO-KHR-012' },
  { header: 'Monitoring Station / Device ID', key: 'monitoringStationId', width: 28, example: 'STN-KHR-07' },
  { header: 'OEM', key: 'oem', width: 16, example: 'Aeroqual' },
  { header: 'Model', key: 'deviceModel', width: 14, example: 'AQY-1' },
  { header: 'Site Name', key: 'siteName', width: 26, example: 'Kharghar Sector 12 Site' },
  { header: 'Location', key: 'location', width: 26, example: 'Kharghar, Navi Mumbai' },
  { header: 'Date & Time of Reading', key: 'measuredAt', width: 22, example: '2026-09-11T06:00:00Z' },
  { header: 'AQI Value', key: 'aqiValue', width: 11, example: 176 },
  { header: 'PM2.5', key: 'pm25', width: 10, example: 78.3 },
  { header: 'PM10', key: 'pm10', width: 10, example: 152.9 },
  { header: 'NO2', key: 'no2', width: 10, example: 41.2 },
  { header: 'SO2', key: 'so2', width: 10, example: 12.7 },
  { header: 'CO', key: 'co', width: 10, example: 0.9 },
  { header: 'O3', key: 'ozone', width: 10, example: 48.6 },
  { header: 'Temperature', key: 'temperature', width: 13, example: 33.4 },
  { header: 'Humidity', key: 'humidity', width: 11, example: 62.1 },
  { header: 'Other Parameters', key: 'otherParams', width: 26, example: 'noise=61 dB; wind=3.2 m/s' },
  { header: 'Data Source / Integration Method', key: 'integrationMethod', width: 30, example: 'SFTP Excel upload' },
];

/** Header spellings an architect might realistically type, mapped to our keys. */
const HEADER_ALIASES: Record<string, string> = {
  'project id': 'projectSiteId',
  'site id': 'projectSiteId',
  'project/site id': 'projectSiteId',
  'station id': 'monitoringStationId',
  'device id': 'monitoringStationId',
  'aqi monitoring station/device id': 'monitoringStationId',
  'oem / model': 'oem',
  'oem/model': 'oem',
  model: 'deviceModel',
  'device model': 'deviceModel',
  site: 'siteName',
  'site name': 'siteName',
  address: 'location',
  date: 'measuredAt',
  'date & time of reading': 'measuredAt',
  'date and time of reading': 'measuredAt',
  'reading time': 'measuredAt',
  timestamp: 'measuredAt',
  aqi: 'aqiValue',
  'aqi value': 'aqiValue',
  'pm2.5': 'pm25',
  'pm 2.5': 'pm25',
  'pm2_5': 'pm25',
  'pm10': 'pm10',
  'pm 10': 'pm10',
  'no2': 'no2',
  'no₂': 'no2',
  'so2': 'so2',
  'so₂': 'so2',
  'o3': 'ozone',
  'o₃': 'ozone',
  ozone: 'ozone',
  'temperature (°c)': 'temperature',
  'temp': 'temperature',
  'humidity (%)': 'humidity',
  'rh': 'humidity',
  'other parameters': 'otherParams',
  'other applicable environmental parameters': 'otherParams',
  'data source': 'integrationMethod',
  'integration method': 'integrationMethod',
  'data source / integration method': 'integrationMethod',
};

function canonicalHeader(raw: string) {
  const lower = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (HEADER_ALIASES[lower]) return HEADER_ALIASES[lower];
  const known = SHEET_COLUMNS.find((c) => c.header.toLowerCase() === lower || c.key.toLowerCase() === lower);
  return known?.key ?? raw.trim();
}

// --- Credentials -----------------------------------------------------------

export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

/** Constant-time compare of two hex digests. */
export function hashesEqual(a: string, b: string) {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Where a given architect's uploads land on CIDCO's disk. */
export function storageRoot() {
  return path.resolve(process.env.SFTP_STORAGE_DIR || './storage/sftp');
}

export function homeDirFor(clientId: string) {
  return path.join(storageRoot(), clientId.replace(/[^A-Za-z0-9_-]/g, '_'));
}

export const SFTP_PORT = Number(process.env.SFTP_PORT || 2222);

/**
 * The connection details CIDCO emails out. `designatedIp` is the address the
 * architect sends TO — not to be confused with the architect's own server
 * address, which CIDCO registers and validates every transfer against.
 */
export function sftpEndpoint(host?: string | null) {
  const designatedIp = process.env.SFTP_PUBLIC_HOST || host || 'localhost';
  return {
    designatedIp,
    host: designatedIp,
    port: SFTP_PORT,
    protocol: 'SFTP (SSH File Transfer Protocol)',
    fileTypes: '.csv (or .xlsx)',
  };
}

// --- Workbook parsing ------------------------------------------------------

/** A sheet column: the label as written, and the reading field it maps to. */
export type SheetColumn = { label: string; key: string };

export type ParsedSheet = {
  sheetName: string;
  /** In sheet order, so a preview table can line headers up with cells. */
  columns: SheetColumn[];
  rows: Array<Record<string, unknown>>;
};

function cellValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    // Formula cells, rich text and hyperlinks all carry their display value.
    const v = value as unknown as Record<string, unknown>;
    if ('result' in v) return cellValue(v.result as ExcelJS.CellValue);
    if ('text' in v) return v.text;
    if ('richText' in v) return (v.richText as Array<{ text: string }>).map((r) => r.text).join('');
    if ('hyperlink' in v) return v.hyperlink;
    return String(value);
  }
  return value;
}

/**
 * Reads the first worksheet: row 1 is the header, every later non-empty row is
 * a reading. Both the raw header labels (for the CIDCO preview) and the
 * canonical keys (for the import) are returned.
 */
export async function parseWorkbook(buffer: Buffer): Promise<ParsedSheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = wb.worksheets[0];
  if (!sheet) throw new Error('The workbook has no worksheets.');

  const headerRow = sheet.getRow(1);
  // Sparse by design: index i holds the column at spreadsheet position i+1.
  const byPosition: Array<SheetColumn | undefined> = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    const label = String(cellValue(cell.value) ?? '').trim();
    if (!label) return;
    byPosition[col - 1] = { label, key: canonicalHeader(label) };
  });
  const columns = byPosition.filter((c): c is SheetColumn => !!c);
  if (columns.length === 0) {
    throw new Error('The first row of the sheet must be the column headers.');
  }

  const rows: Array<Record<string, unknown>> = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Record<string, unknown> = {};
    let hasValue = false;
    for (let i = 0; i < byPosition.length; i++) {
      const column = byPosition[i];
      if (!column) continue;
      const value = cellValue(row.getCell(i + 1).value);
      if (value !== null && value !== '' && value !== undefined) hasValue = true;
      record[column.key] = value;
    }
    if (hasValue) rows.push(record);
  });

  return { sheetName: sheet.name, columns, rows };
}

/** Reads a CSV: row 1 is the header, every later row is a reading. */
export function parseCsv(buffer: Buffer): ParsedSheet {
  const text = buffer.toString('utf8').replace(/^﻿/, '');
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
  });

  const labels = (parsed.meta.fields ?? []).map((f) => f.trim()).filter(Boolean);
  if (labels.length === 0) throw new Error('The first line of the CSV must be the column headers.');
  const columns: SheetColumn[] = labels.map((label) => ({ label, key: canonicalHeader(label) }));

  const rows = parsed.data
    .map((raw) => {
      const record: Record<string, unknown> = {};
      let hasValue = false;
      for (const label of labels) {
        const value = raw[label];
        const trimmed = typeof value === 'string' ? value.trim() : value;
        if (trimmed !== undefined && trimmed !== null && trimmed !== '') hasValue = true;
        record[canonicalHeader(label)] = trimmed ?? null;
      }
      return hasValue ? record : null;
    })
    .filter((r): r is Record<string, unknown> => r !== null);

  return { sheetName: 'CSV', columns, rows };
}

/** The file types the architect may send. CSV is the everyday one. */
export const ACCEPTED_EXTENSIONS = ['.csv', '.xlsx'] as const;

export function isAcceptedFile(fileName: string) {
  return ACCEPTED_EXTENSIONS.some((ext) => fileName.toLowerCase().endsWith(ext));
}

/** Parses whichever of the accepted formats arrived. */
export async function parseDataFile(buffer: Buffer, fileName: string): Promise<ParsedSheet> {
  if (fileName.toLowerCase().endsWith('.csv')) return parseCsv(buffer);
  return parseWorkbook(buffer);
}

// --- CIDCO-side transfer validation ----------------------------------------

/** What a transfer presented, to be checked against the company record. */
export type PresentedTransfer = {
  companyId: string | null;
  ip: string | null;
  filePath: string | null;
};

export type TransferValidation = {
  companyIdMatch: boolean;
  ipMatch: boolean;
  pathMatch: boolean;
  passed: boolean;
  reason: string | null;
  expected: { companyId: string; ip: string; filePath: string };
  presented: PresentedTransfer;
};

/** Trailing slashes and case should not decide whether a transfer is accepted. */
export function normalisePath(value: string | null | undefined) {
  if (!value) return '';
  const collapsed = value.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  return collapsed === '' ? '/' : collapsed;
}

export function normaliseIp(value: string | null | undefined) {
  if (!value) return '';
  const trimmed = value.trim();
  if (trimmed === '::1') return '127.0.0.1';
  return trimmed.startsWith('::ffff:') ? trimmed.slice(7) : trimmed;
}

/**
 * The check CIDCO runs on every transfer: does the company id, the address it
 * came from and the path it was taken from match what CIDCO registered for this
 * company? Nothing is stored unless all three do.
 */
export function validateTransfer(company: Company, presented: PresentedTransfer): TransferValidation {
  const companyIdMatch = (presented.companyId ?? '').trim() === company.companyId;
  const ipMatch = normaliseIp(presented.ip) === normaliseIp(company.architectServerIp);
  const pathMatch = normalisePath(presented.filePath) === normalisePath(company.filePath);
  const passed = companyIdMatch && ipMatch && pathMatch && company.active;

  const mismatches: string[] = [];
  if (!company.active) mismatches.push('the company registration is inactive');
  if (!companyIdMatch) {
    mismatches.push(`company id "${presented.companyId ?? '—'}" does not match the registered "${company.companyId}"`);
  }
  if (!ipMatch) {
    mismatches.push(`address ${presented.ip ?? '—'} is not the registered server address ${company.architectServerIp}`);
  }
  if (!pathMatch) {
    mismatches.push(`file path "${presented.filePath ?? '—'}" is not the registered path "${company.filePath}"`);
  }

  return {
    companyIdMatch,
    ipMatch,
    pathMatch,
    passed,
    reason: passed ? null : mismatches.join('; '),
    expected: {
      companyId: company.companyId,
      ip: company.architectServerIp,
      filePath: company.filePath,
    },
    presented,
  };
}

/** The blank workbook CIDCO hands the architect to fill in. */
export async function buildTemplateWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CIDCO AQI Compliance Portal';
  wb.created = new Date();
  const sheet = wb.addWorksheet('AQI Data');

  sheet.columns = SHEET_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  sheet.getRow(1).border = { bottom: { style: 'thin', color: { argb: 'FF94A3B8' } } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  // One worked example row so the expected formats are unambiguous.
  sheet.addRow(Object.fromEntries(SHEET_COLUMNS.map((c) => [c.key, c.example])));

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

/** The same columns as a CSV — the format the automated feed normally sends. */
export function buildCsvTemplate(): string {
  const header = SHEET_COLUMNS.map((c) => c.header).join(',');
  const example = SHEET_COLUMNS.map((c) => {
    const value = String(c.example);
    return value.includes(',') ? `"${value}"` : value;
  }).join(',');
  return `${header}\n${example}\n`;
}

// --- Import ----------------------------------------------------------------

export type ImportOutcome = {
  rowCount: number;
  importedCount: number;
  failedCount: number;
  errors: Array<{ row: number; error: string }>;
};

/**
 * Turns parsed sheet rows into reports. Every row is independent: a bad row is
 * recorded against its sheet row number and the rest still import, so one typo
 * never costs an architect the whole upload.
 */
export async function importRows(params: {
  architectId: string;
  rows: Array<Record<string, unknown>>;
}): Promise<ImportOutcome> {
  const { architectId, rows } = params;
  const errors: Array<{ row: number; error: string }> = [];
  let importedCount = 0;

  for (let i = 0; i < rows.length; i++) {
    // +2: sheet rows are 1-based and row 1 is the header.
    const sheetRow = i + 2;
    try {
      const raw = normaliseReadingFields(rows[i]);
      if (!raw.siteName) raw.siteName = raw.projectSiteId || raw.monitoringStationId || 'Uploaded station';
      if (!raw.location) raw.location = raw.projectSiteId ? String(raw.projectSiteId) : 'N/A';
      if (!raw.integrationMethod) raw.integrationMethod = 'SFTP Excel upload';
      // A free-text "other parameters" cell is kept as a labelled note.
      if (typeof raw.otherParams === 'string' && raw.otherParams.trim()) {
        raw.otherParams = { note: raw.otherParams.trim() };
      }

      const input = reportSchema.parse(raw);
      await createReport({ userId: architectId, source: 'SFTP', input });
      importedCount++;
    } catch (error) {
      errors.push({ row: sheetRow, error: describeError(error) });
    }
  }

  return { rowCount: rows.length, importedCount, failedCount: errors.length, errors };
}

function describeError(error: unknown): string {
  if (error && typeof error === 'object' && 'issues' in error) {
    const issues = (error as { issues: Array<{ path: (string | number)[]; message: string }> }).issues;
    return issues.map((i) => `${i.path.join('.') || 'row'}: ${i.message}`).join('; ');
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Takes a delivered file: validates it against the company CIDCO registered,
 * and only if that passes parses it and stores the readings. Either way the
 * whole outcome — what was presented, what was expected, what matched — is
 * recorded for the CIDCO dashboard.
 *
 * Used by the SFTP server the moment a file handle closes, and by the portal
 * relay when an architect drags a file in.
 */
export async function ingestTransfer(params: {
  handshake: ArchitectHandshake;
  company: Company | null;
  fileName: string;
  storedName: string;
  buffer: Buffer;
  sourceIp: string | null;
  /** The path the file was taken from / written to, as presented. */
  presentedPath: string | null;
  mode: TransferMode;
}) {
  const { handshake, company, fileName, storedName, buffer, sourceIp, presentedPath, mode } = params;

  const presented: PresentedTransfer = {
    companyId: company?.companyId ?? null,
    ip: sourceIp,
    filePath: presentedPath,
  };

  // No company record means no reference to validate against — refuse it.
  const validation: TransferValidation = company
    ? validateTransfer(company, presented)
    : {
        companyIdMatch: false,
        ipMatch: false,
        pathMatch: false,
        passed: false,
        reason: 'These credentials are not linked to a registered company',
        expected: { companyId: '—', ip: '—', filePath: '—' },
        presented,
      };

  const upload = await prisma.sftpUpload.create({
    data: {
      handshakeId: handshake.id,
      fileName,
      storedName,
      sizeBytes: buffer.length,
      sourceIp,
      mode,
      presentedCompanyId: presented.companyId,
      presentedIp: presented.ip,
      presentedPath: presented.filePath,
      companyIdMatch: validation.companyIdMatch,
      ipMatch: validation.ipMatch,
      pathMatch: validation.pathMatch,
      validationPassed: validation.passed,
      status: 'RECEIVED',
    },
  });

  // Validation failed → nothing is parsed and nothing reaches the readings.
  if (!validation.passed) {
    return await prisma.sftpUpload.update({
      where: { id: upload.id },
      data: {
        status: 'REJECTED',
        rejectionReason: validation.reason,
        parsedAt: new Date(),
      },
    });
  }

  try {
    const sheet = await parseDataFile(buffer, fileName);
    const outcome = await importRows({ architectId: handshake.architectId, rows: sheet.rows });

    const status =
      outcome.importedCount === 0
        ? 'FAILED'
        : outcome.failedCount > 0
          ? 'PARTIAL'
          : 'PARSED';

    return await prisma.sftpUpload.update({
      where: { id: upload.id },
      data: {
        status,
        sheetName: sheet.sheetName,
        columns: sheet.columns as unknown as Prisma.InputJsonValue,
        // The sheet as delivered, so an officer can preview the original.
        rows: sheet.rows as unknown as Prisma.InputJsonValue,
        rowCount: outcome.rowCount,
        importedCount: outcome.importedCount,
        failedCount: outcome.failedCount,
        errors: outcome.errors as unknown as Prisma.InputJsonValue,
        parsedAt: new Date(),
      },
    });
  } catch (error) {
    return await prisma.sftpUpload.update({
      where: { id: upload.id },
      data: {
        status: 'FAILED',
        errors: [{ row: 0, error: describeError(error) }] as unknown as Prisma.InputJsonValue,
        parsedAt: new Date(),
      },
    });
  }
}
