import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, ApiError, type User } from './api';
import { Spinner } from './components/ui';

interface AuthState {
  user: User | null; loading: boolean;
  login: (email: string, pw: string) => Promise<void>;
  /** `pending: true` means an email must be confirmed before the account can be used (no session yet). */
  signup: (email: string, pw: string, name?: string) => Promise<{ pending: boolean }>;
  logout: () => Promise<void>;
  /** Re-read the signed-in user (e.g. after confirming their email in another tab). */
  refresh: () => Promise<void>;
}
const Ctx = createContext<AuthState>(null as unknown as AuthState);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.me().then((r) => setUser(r.user)).catch((e) => { if (!(e instanceof ApiError && e.status === 401)) console.warn(e); })
      .finally(() => setLoading(false));
  }, []);
  const login = useCallback(async (email: string, pw: string) => setUser((await api.login(email, pw)).user), []);
  const signup = useCallback(async (email: string, pw: string, name?: string) => {
    const res = await api.signup(email, pw, name);
    if (res.user) setUser(res.user);
    return { pending: Boolean(res.pending) };
  }, []);
  const logout = useCallback(async () => { await api.logout().catch(() => {}); setUser(null); }, []);
  const refresh = useCallback(async () => { try { setUser((await api.me()).user); } catch { /* not signed in */ } }, []);
  return <Ctx.Provider value={{ user, loading, login, signup, logout, refresh }}>{children}</Ctx.Provider>;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}
