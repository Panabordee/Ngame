export interface AuthUser {
  readonly id: string;
  readonly display_name: string;
  readonly email: string | null;
  readonly email_verified: boolean;
}

export interface AuthResponse {
  readonly access_token: string;
  readonly token_type: "bearer";
  readonly expires_in: number;
  readonly user: AuthUser;
}

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

async function authRequest(path: string, init: RequestInit): Promise<AuthResponse> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail ?? `Authentication request failed (${response.status}).`);
  }
  return (await response.json()) as AuthResponse;
}

export function register(
  email: string,
  password: string,
  displayName: string,
): Promise<AuthResponse> {
  return authRequest("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, display_name: displayName }),
  });
}

export function login(email: string, password: string): Promise<AuthResponse> {
  return authRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function refresh(): Promise<AuthResponse> {
  return authRequest("/auth/refresh", { method: "POST" });
}

export async function logout(): Promise<void> {
  const response = await fetch(`${API_URL}/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Sign out failed (${response.status}).`);
  }
}

export function startGoogleLogin(): void {
  window.location.assign(`${API_URL}/auth/google/start`);
}
