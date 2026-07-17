export interface AuthUser {
  readonly id: string;
  readonly display_name: string;
  readonly username: string | null;
  readonly avatar_url: string | null;
  readonly email: string | null;
  readonly email_verified: boolean;
  readonly account_type: "registered" | "guest";
}

export interface AuthResponse {
  readonly access_token: string;
  readonly token_type: "bearer";
  readonly expires_in: number;
  readonly user: AuthUser;
}

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const GUEST_SESSION_KEY = "ngame.guest-session.v1";

interface StoredGuestSession {
  readonly auth: AuthResponse;
  readonly expiresAtMs: number;
  readonly reconnectionToken?: string;
}

function readStoredGuestSession(): StoredGuestSession | null {
  try {
    const raw = window.sessionStorage.getItem(GUEST_SESSION_KEY);
    if (raw === null) return null;
    const stored = JSON.parse(raw) as Partial<StoredGuestSession>;
    if (
      stored.auth?.user?.account_type !== "guest" ||
      typeof stored.auth.access_token !== "string" ||
      typeof stored.expiresAtMs !== "number" ||
      stored.expiresAtMs <= Date.now()
    ) {
      window.sessionStorage.removeItem(GUEST_SESSION_KEY);
      return null;
    }
    return stored as StoredGuestSession;
  } catch {
    try {
      window.sessionStorage.removeItem(GUEST_SESSION_KEY);
    } catch {
      // Ignore storage cleanup failures and fall back to a fresh login.
    }
    return null;
  }
}

function writeStoredGuestSession(stored: StoredGuestSession): void {
  try {
    window.sessionStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(stored));
  } catch {
    // A guest can still play while the page remains open if storage is unavailable.
  }
}

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

export function refresh(): Promise<AuthResponse> {
  return authRequest("/auth/refresh", { method: "POST" });
}

export async function createGuestSession(displayName: string): Promise<AuthResponse> {
  const session = await authRequest("/auth/guest", {
    method: "POST",
    body: JSON.stringify({ display_name: displayName }),
  });
  writeStoredGuestSession({
    auth: session,
    expiresAtMs: Date.now() + session.expires_in * 1_000,
  });
  return session;
}

export function restoreGuestSession(): AuthResponse | null {
  return readStoredGuestSession()?.auth ?? null;
}

export function guestReconnectionToken(): string | null {
  return readStoredGuestSession()?.reconnectionToken ?? null;
}

export function saveGuestReconnectionToken(token: string): void {
  const stored = readStoredGuestSession();
  if (stored === null || token.length === 0) return;
  writeStoredGuestSession({ ...stored, reconnectionToken: token });
}

export function clearGuestReconnectionToken(): void {
  const stored = readStoredGuestSession();
  if (stored === null || stored.reconnectionToken === undefined) return;
  const { reconnectionToken: _removed, ...withoutToken } = stored;
  writeStoredGuestSession(withoutToken);
}

export function clearGuestSession(): void {
  try {
    window.sessionStorage.removeItem(GUEST_SESSION_KEY);
  } catch {
    // There is nothing else to clear when browser storage is unavailable.
  }
}

export async function updateProfile(
  accessToken: string,
  profile: { readonly display_name: string; readonly username: string },
): Promise<AuthUser> {
  const response = await fetch(`${API_URL}/auth/me`, {
    method: "PATCH",
    credentials: "include",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(profile),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail ?? `Profile update failed (${response.status}).`);
  }
  return (await response.json()) as AuthUser;
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
