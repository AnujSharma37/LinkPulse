import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';

interface AppConfig { shortBaseUrl: string; threatIntelEnabled: boolean; emailVerificationRequired: boolean }
const Ctx = createContext<AppConfig>({ shortBaseUrl: window.location.origin, threatIntelEnabled: false, emailVerificationRequired: false });
export const useConfig = () => useContext(Ctx);
export function ConfigProvider({ children }: { children: ReactNode }) {
  const [cfg, setCfg] = useState<AppConfig>({ shortBaseUrl: window.location.origin, threatIntelEnabled: false, emailVerificationRequired: false });
  useEffect(() => { api.config().then(setCfg).catch(() => {}); }, []);
  return <Ctx.Provider value={cfg}>{children}</Ctx.Provider>;
}
