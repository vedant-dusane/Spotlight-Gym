// Pure business rules (no database, no clock). Easy to unit test.
import { addDays, addMonths } from './time.js';

/** Booking statuses that take up one of the class's spots. */
export const OCCUPYING = ['booked', 'attended', 'no_show'];

/** End date (inclusive) of a membership that starts on `startYmd`. monthly = 1 month, quarterly = 3. */
export function membershipEndDate(startYmd, planType) {
  const months = planType === 'quarterly' ? 3 : 1;
  return addDays(addMonths(startYmd, months), -1);
}

/** Membership state relative to `today` ('YYYY-MM-DD'). */
export function membershipState(m, today) {
  if (m.status === 'cancelled') return 'cancelled';
  if (m.end_date < today) return 'expired';
  if (m.start_date > today) return 'upcoming';
  return 'active';
}

/** True while members may still book / cancel (i.e. now is at least `cutoffMinutes` before start). */
export function isWithinChangeWindow(startsAt, now, cutoffMinutes) {
  return now.getTime() <= startsAt.getTime() - cutoffMinutes * 60_000;
}

export function bookingClosesAt(startsAt, cutoffMinutes) {
  return new Date(startsAt.getTime() - cutoffMinutes * 60_000);
}

/**
 * Can this member take a spot in a class on `classDate`?
 * Rule: they must hold an active membership TODAY and some membership must also cover the class date
 * (so a renewal that starts before the class counts, but a membership that ends before it does not).
 */
export function evaluateEligibility(memberships, { today, classDate }) {
  const live = memberships.filter((m) => m.status === 'active');
  const activeToday = live.some((m) => m.start_date <= today && today <= m.end_date);
  if (!activeToday) {
    return { ok: false, code: 'MEMBERSHIP_INACTIVE', message: 'You need an active membership to book classes.' };
  }
  const covers = live.some((m) => m.start_date <= classDate && classDate <= m.end_date);
  if (!covers) {
    return {
      ok: false,
      code: 'MEMBERSHIP_EXPIRES_BEFORE_CLASS',
      message: 'Your membership ends before this class. Renew it to book this class.',
    };
  }
  return { ok: true };
}

/** Attendance can only be recorded once the class has started. */
export const canMarkAttendance = (startsAt, now) => now.getTime() >= startsAt.getTime();
