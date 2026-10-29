export const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const fmtDay = (iso) => new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
export const fmtDateTime = (iso) => `${fmtDay(iso)}, ${fmtTime(iso)}`;
export const fmtYmd = (ymd) => new Date(`${ymd}T00:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
export const money = (minor) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(minor / 100);

const pad = (n) => String(n).padStart(2, '0');
/** Local calendar day key, e.g. 2026-10-29 */
export const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
/** ISO string -> value for <input type="datetime-local"> */
export const toLocalInput = (iso) => { const d = new Date(iso); return `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
/** value of <input type="datetime-local"> (local time) -> ISO UTC string */
export const fromLocalInput = (v) => new Date(v).toISOString();
export const addDaysLocal = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
