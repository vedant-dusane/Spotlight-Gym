import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateEligibility, isWithinChangeWindow, membershipEndDate, membershipState, canMarkAttendance } from '../../src/lib/policy.js';
import { addDays, addMonths, dateInTz, isValidYmd } from '../../src/lib/time.js';

test('monthly and quarterly membership end dates are inclusive calendar ranges', () => {
  assert.equal(membershipEndDate('2026-10-28', 'monthly'), '2026-11-27');
  assert.equal(membershipEndDate('2026-10-28', 'quarterly'), '2027-01-27');
  assert.equal(membershipEndDate('2026-01-31', 'monthly'), '2026-02-27'); // month-end clamping
  assert.equal(membershipEndDate('2027-12-01', 'monthly'), '2027-12-31');
});

test('date helpers handle month/year rollover and validate input', () => {
  assert.equal(addMonths('2026-11-30', 3), '2027-02-28');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(isValidYmd('2026-02-30'), false);
  assert.equal(isValidYmd('2026-02-28'), true);
  assert.equal(dateInTz(new Date('2026-10-28T20:00:00Z'), 'Asia/Kolkata'), '2026-10-29'); // already tomorrow in IST
});

test('membership state: active / upcoming / expired / cancelled', () => {
  const today = '2026-10-29';
  assert.equal(membershipState({ status: 'active', start_date: '2026-10-01', end_date: '2026-10-29' }, today), 'active'); // end date inclusive
  assert.equal(membershipState({ status: 'active', start_date: '2026-10-30', end_date: '2026-11-29' }, today), 'upcoming');
  assert.equal(membershipState({ status: 'active', start_date: '2026-09-01', end_date: '2026-09-30' }, today), 'expired');
  assert.equal(membershipState({ status: 'cancelled', start_date: '2026-10-01', end_date: '2026-11-01' }, today), 'cancelled');
});

test('2-hour booking/cancel window is inclusive at exactly 120 minutes', () => {
  const start = new Date('2026-11-01T10:00:00Z');
  assert.equal(isWithinChangeWindow(start, new Date('2026-11-01T08:00:00Z'), 120), true);   // exactly 2h before
  assert.equal(isWithinChangeWindow(start, new Date('2026-11-01T08:00:01Z'), 120), false);  // 1s too late
  assert.equal(isWithinChangeWindow(start, new Date('2026-10-31T10:00:00Z'), 120), true);
});

test('eligibility: needs an active membership today that also covers the class date', () => {
  const ctx = { today: '2026-10-29', classDate: '2026-10-30' };
  assert.equal(evaluateEligibility([], ctx).code, 'MEMBERSHIP_INACTIVE');
  assert.equal(evaluateEligibility([{ status: 'active', start_date: '2026-09-01', end_date: '2026-09-30' }], ctx).code, 'MEMBERSHIP_INACTIVE');
  assert.equal(evaluateEligibility([{ status: 'cancelled', start_date: '2026-10-01', end_date: '2026-12-01' }], ctx).code, 'MEMBERSHIP_INACTIVE');
  assert.equal(evaluateEligibility([{ status: 'active', start_date: '2026-10-01', end_date: '2026-10-29' }], ctx).code, 'MEMBERSHIP_EXPIRES_BEFORE_CLASS');
  assert.equal(evaluateEligibility([{ status: 'active', start_date: '2026-10-01', end_date: '2026-10-30' }], ctx).ok, true);
  // a renewal that starts before the class date covers it
  assert.equal(evaluateEligibility([
    { status: 'active', start_date: '2026-10-01', end_date: '2026-10-29' },
    { status: 'active', start_date: '2026-10-30', end_date: '2026-11-29' },
  ], ctx).ok, true);
});

test('attendance can only be marked once the class has started', () => {
  const start = new Date('2026-11-01T10:00:00Z');
  assert.equal(canMarkAttendance(start, new Date('2026-11-01T09:59:59Z')), false);
  assert.equal(canMarkAttendance(start, new Date('2026-11-01T10:00:00Z')), true);
});
