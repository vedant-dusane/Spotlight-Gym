const BASE = import.meta.env.VITE_API_URL || '/api';

// The JWT lives in localStorage: simple and fine for this app. A production system would prefer an
// httpOnly cookie (see README "What I'd do with more time").
let token = localStorage.getItem('token');
let onUnauthorized = null;

export const setToken = (t) => {
  token = t;
  if (t) localStorage.setItem('token', t); else localStorage.removeItem('token');
};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status; this.code = code; this.details = details || [];
  }
  /** message for one form field, if the server flagged it */
  field(name) { return this.details.find((d) => d.field === name)?.message; }
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token && onUnauthorized) onUnauthorized();
    throw new ApiError(res.status, data?.error?.code, data?.error?.message || 'Something went wrong.', data?.error?.details);
  }
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b ?? {}),
  patch: (p, b) => request('PATCH', p, b),
  put: (p, b) => request('PUT', p, b),
  del: (p) => request('DELETE', p),
};
