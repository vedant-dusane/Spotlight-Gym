// Date helpers. Instants are stored in UTC as 'YYYY-MM-DD HH:MM:SS'; calendar dates are 'YYYY-MM-DD'.

export const toSql = (date) => date.toISOString().slice(0, 19).replace('T', ' ');

export const fromSql = (value) => (value ? new Date(`${String(value).replace(' ', 'T').slice(0, 19)}Z`) : null);

/** Calendar date ('YYYY-MM-DD') of an instant in the given IANA timezone. */
export function dateInTz(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

const pad = (n) => String(n).padStart(2, '0');

export function addDays(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Adds calendar months, clamping the day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(ymd, months) {
  const [y, m, d] = ymd.split('-').map(Number);
  const total = m - 1 + months;
  const year = y + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${pad(month + 1)}-${pad(Math.min(d, daysInMonth))}`;
}

export function isValidYmd(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
