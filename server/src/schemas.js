import { z } from 'zod';
import { isValidYmd } from './lib/time.js';

const id = z.coerce.number().int().positive();
export const idParam = z.object({ id });

const ymd = z.string().refine(isValidYmd, 'Use a valid date in YYYY-MM-DD format');
const instant = z.string().datetime({ offset: true, message: 'Use an ISO date-time, e.g. 2026-11-02T07:00:00Z' }).transform((s) => new Date(s));

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(190),
  password: z.string().min(8, 'Password must be at least 8 characters').max(72, 'Password is too long')
    .regex(/[A-Za-z]/, 'Password needs at least one letter').regex(/\d/, 'Password needs at least one number'),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required').max(72),
});

export const planCreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  type: z.enum(['monthly', 'quarterly']),
  priceMinor: z.coerce.number().int().min(0, 'Price cannot be negative').max(100_000_000),
});
export const planUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  priceMinor: z.coerce.number().int().min(0).max(100_000_000).optional(),
  isActive: z.boolean().optional(),
}).refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

export const membershipCreateSchema = z.object({
  planId: id,
  startDate: ymd.optional(),
  userId: id.optional(), // admin only: buy on behalf of a member
});

export const classCreateSchema = z.object({
  title: z.string().trim().min(2, 'Title must be at least 2 characters').max(80),
  description: z.string().trim().max(500).optional().nullable(),
  trainerId: id,
  startsAt: instant,
  durationMinutes: z.coerce.number().int().min(15, 'Minimum 15 minutes').max(240, 'Maximum 240 minutes').default(60),
  capacity: z.coerce.number().int().min(1, 'Capacity must be at least 1').max(200, 'Capacity cannot exceed 200'),
});
export const classUpdateSchema = z.object({
  title: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  trainerId: id.optional(),
  startsAt: instant.optional(),
  durationMinutes: z.coerce.number().int().min(15).max(240).optional(),
  capacity: z.coerce.number().int().min(1).max(200).optional(),
}).refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

export const classListQuery = z.object({
  from: instant.optional(),
  to: instant.optional(),
}).refine((v) => !v.from || !v.to || v.from < v.to, 'from must be before to');

export const attendanceSchema = z.object({
  records: z.array(z.object({
    bookingId: id,
    status: z.enum(['attended', 'no_show']),
  })).min(1, 'Send at least one attendance record').max(200),
});

export const bookingsQuery = z.object({ scope: z.enum(['upcoming', 'past']).default('upcoming') });
export const reportQuery = z.object({ from: ymd.optional(), to: ymd.optional() });
