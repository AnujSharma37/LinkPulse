/** Typed client for the LinkPulse REST API (see docs/API.md). */

export type SafetyStatus = 'format_valid' | 'no_known_issue' | 'suspicious' | 'blocked';
export interface SafetyReason { code: string; severity: 'info' | 'warning' | 'block'; message: string }
export interface SafetyResult { status: SafetyStatus; reasons: SafetyReason[]; providers?: string[]; threatIntel?: 'checked' | 'not_configured' | 'error' }
export type EffectiveStatus = 'active' | 'disabled' | 'expired' | 'limit_reached' | 'blocked';

export interface User { id: string; email: string; displayName: string | null; createdAt: string; emailVerified: boolean }
export interface Tag { id: string; name: string; color: string; linkCount?: number }
export interface Campaign {
  id: string; name: string; description: string | null; utmSource: string | null; utmMedium: string | null;
  utmCampaign: string | null; linkCount: number; totalClicks: number; createdAt: string;
}
export interface Link {
  id: string; code: string; shortUrl: string; destinationUrl: string; title: string | null; isCustomAlias: boolean;
  status: 'active' | 'disabled'; effectiveStatus: EffectiveStatus; expiresAt: string | null; hasPassword: boolean;
  maxClicks: number | null; clickCount: number; campaign: { id: string; name: string } | null; tags: Tag[];
  safety: { status: SafetyStatus; reasons: SafetyReason[]; checkedAt: string | null };
  lastClickedAt: string | null; createdAt: string; updatedAt: string;
}
export interface Bucket { label: string; clicks: number }
export interface Breakdown {
  range: { days: number; tz: string };
  totals: { allTimeClicks: number; clicksInRange: number; botClicksInRange: number; lastClickAt: string | null };
  daily: { date: string; clicks: number; human_clicks: number }[];
  devices: Bucket[]; referrers: Bucket[]; browsers: Bucket[]; operatingSystems: Bucket[];
  unavailable: { location: string; uniqueVisitors: string };
}
export interface Overview extends Breakdown {
  links: { total: number; active: number; suspicious: number };
  topLinks: { id: string; code: string; title: string | null; destination_url: string; clicks: number }[];
  campaigns: Bucket[];
}
export interface LinkAnalytics extends Breakdown {
  recentClicks: { clicked_at: string; device_type: string; browser: string | null; os: string | null; referrer: string }[];
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) { super(message); }
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (Array.isArray(this.details)) for (const d of this.details) if (d.field && !out[d.field]) out[d.field] = d.message;
    return out;
  }
}
const API_BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
     res = await fetch(`${API_BASE_URL}/api${path}`, {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', 'Could not reach the LinkPulse server. Check your connection and that the API is running.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(res.status, e?.code ?? 'error', e?.message ?? `Request failed (${res.status}).`, e?.details);
  }
  return data as T;
}

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export interface LinkInput {
  destinationUrl?: string; alias?: string | null; title?: string | null; expiresAt?: string | null; password?: string | null;
  maxClicks?: number | null; campaignId?: string | null; tagIds?: string[]; acknowledgeWarnings?: boolean; status?: 'active' | 'disabled';
}
export interface LinkQuery { search?: string; status?: string; safety?: string; campaignId?: string; tagId?: string; sort?: string; page?: number; pageSize?: number }

export const api = {
  config: () => request<{ shortBaseUrl: string; threatIntelEnabled: boolean; emailVerificationRequired: boolean }>('GET', '/config'),
  me: () => request<{ user: User }>('GET', '/auth/me'),
  signup: (email: string, password: string, displayName?: string) => request<{ user?: User; pending?: boolean; message?: string }>('POST', '/auth/signup', { email, password, displayName }),
  login: (email: string, password: string) => request<{ user: User }>('POST', '/auth/login', { email, password }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout', {}),
  forgotPassword: (email: string) => request<{ ok: true }>('POST', '/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) => request<{ ok: true }>('POST', '/auth/reset-password', { token, password }),
  verifyEmail: (token: string) => request<{ ok: true }>('POST', '/auth/verify-email', { token }),
  resendVerification: () => request<{ ok: true; alreadyVerified?: boolean }>('POST', '/auth/resend-verification', {}),

  listLinks: (q: LinkQuery) => request<{ links: Link[]; total: number; page: number; pageSize: number }>('GET', `/links${qs(q as any)}`),
  getLink: (id: string) => request<{ link: Link }>('GET', `/links/${id}`),
  createLink: (b: LinkInput) => request<{ link: Link }>('POST', '/links', b),
  updateLink: (id: string, b: LinkInput) => request<{ link: Link }>('PATCH', `/links/${id}`, b),
  deleteLink: (id: string) => request<void>('DELETE', `/links/${id}`),
  recheckSafety: (id: string) => request<{ link: Link; safety: SafetyResult }>('POST', `/links/${id}/recheck-safety`, {}),
  checkSafety: (url: string) => request<{ url: string; safety: SafetyResult }>('POST', '/safety/check', { url }),

  overview: (days: number) => request<Overview>('GET', `/analytics/overview${qs({ days, tz })}`),
  linkAnalytics: (id: string, days: number) => request<LinkAnalytics>('GET', `/analytics/links/${id}${qs({ days, tz })}`),

  campaigns: () => request<{ campaigns: Campaign[] }>('GET', '/campaigns'),
  createCampaign: (b: Partial<Campaign>) => request<{ campaign: Campaign }>('POST', '/campaigns', b),
  updateCampaign: (id: string, b: Partial<Campaign>) => request<{ campaign: Campaign }>('PATCH', `/campaigns/${id}`, b),
  deleteCampaign: (id: string) => request<void>('DELETE', `/campaigns/${id}`),

  tags: () => request<{ tags: Tag[] }>('GET', '/tags'),
  createTag: (b: { name: string; color?: string }) => request<{ tag: Tag }>('POST', '/tags', b),
  updateTag: (id: string, b: { name?: string; color?: string }) => request<{ tag: Tag }>('PATCH', `/tags/${id}`, b),
  deleteTag: (id: string) => request<void>('DELETE', `/tags/${id}`),
};
