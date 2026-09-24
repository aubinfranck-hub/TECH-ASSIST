const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('tech_assist_token');
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const body = res.status === 204 ? null : await res.json().catch(() => null);

  if (!res.ok) {
    const message = body?.error ?? `Erreur ${res.status}`;
    throw new ApiError(message, res.status);
  }

  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PUT', body: data ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PATCH', body: data ? JSON.stringify(data) : undefined }),
};

export interface PricingPlan {
  id: string;
  name: string;
  segment: 'particulier' | 'pme';
  price_fcfa: number;
  duration_minutes: number | null;
  description: string;
}

export interface Order {
  id: string;
  status: 'pending_payment' | 'paid' | 'refunded' | 'cancelled';
  amount_fcfa: number;
  platform?: 'web' | 'windows' | 'android';
  created_at: string;
  paid_at?: string | null;
  plan_name?: string;
  duration_minutes?: number | null;
}

export interface SessionInfo {
  id: string;
  session_code: string;
  status: string;
  code_expires_at: string;
  duration_minutes: number;
  started_at?: string | null;
  ends_at?: string | null;
  consent_screen_at?: string | null;
  consent_control_at?: string | null;
}
