import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setToken, setUnauthorizedHandler } from './api.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!localStorage.getItem('token'));

  const logout = useCallback(() => { setToken(null); setUser(null); }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!localStorage.getItem('token')) return;
    api.get('/auth/me').then((r) => setUser(r.user)).catch(() => setToken(null)).finally(() => setLoading(false));
  }, [logout]);

  const value = useMemo(() => ({
    user, loading, logout,
    async login(email, password) { const r = await api.post('/auth/login', { email, password }); setToken(r.token); setUser(r.user); return r.user; },
    async register(name, email, password) { const r = await api.post('/auth/register', { name, email, password }); setToken(r.token); setUser(r.user); return r.user; },
  }), [user, loading, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
