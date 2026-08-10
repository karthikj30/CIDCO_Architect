import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('A valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firmName: z.string().optional().nullable(),
  councilRegNo: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  role: z.enum(['ARCHITECT', 'CIDCO_OFFICER']).optional(),
});

export const loginSchema = z.object({
  email: z.string().email('A valid email is required'),
  password: z.string().min(1, 'Password is required'),
});

/** Coerces the loose strings that arrive in multipart form-data / CSV rows. */
const numberish = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? v : v.trim()))
  .refine((v) => v !== '' && !Number.isNaN(Number(v)), 'Must be a number')
  .transform((v) => Number(v));

const optionalNumberish = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const s = typeof v === 'number' ? v : v.trim();
    if (s === '') return null;
    return Number(s);
  })
  .refine((v) => v === null || !Number.isNaN(v), 'Must be a number');

const optionalText = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => {
    const s = (v ?? '').toString().trim();
    return s === '' ? null : s;
  });

export const reportSchema = z.object({
  siteName: z.string().min(2, 'Site name is required'),
  location: z.string().min(2, 'Location is required'),
  measuredAt: z
    .union([z.string(), z.date()])
    .transform((v) => (v instanceof Date ? v : new Date(v)))
    .refine((d) => !Number.isNaN(d.getTime()), 'measuredAt must be a valid ISO date'),
  aqiValue: numberish.refine((n) => n >= 0 && n <= 1000, 'aqiValue must be between 0 and 1000').transform((n) => Math.round(n)),
  latitude: optionalNumberish.refine((v) => v === null || (v >= -90 && v <= 90), 'latitude must be between -90 and 90'),
  longitude: optionalNumberish.refine((v) => v === null || (v >= -180 && v <= 180), 'longitude must be between -180 and 180'),
  pm25: optionalNumberish,
  pm10: optionalNumberish,
  so2: optionalNumberish,
  no2: optionalNumberish,
  co: optionalNumberish,
  ozone: optionalNumberish,
  remarks: optionalText,
  projectCode: optionalText,
});

export type ReportInput = z.infer<typeof reportSchema>;

export const reviewSchema = z.object({
  status: z.enum(['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED']),
  reviewNote: z.string().optional().nullable(),
});

export const apiKeySchema = z.object({
  label: z.string().min(2, 'Label is required').max(60),
});
