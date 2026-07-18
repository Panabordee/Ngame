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
export interface PlayerStats { readonly games: number; readonly wins: number; readonly guesses: number; readonly correct_guesses: number; readonly current_streak: number; readonly achievements: readonly string[]; readonly recent_matches: readonly { readonly match_id: string; readonly won: boolean; readonly guesses: number; readonly correct_guesses: number; readonly cards_revealed: number; readonly completed_at: string }[]; }
export interface Leaderboard { readonly season: string; readonly entries: readonly { readonly rank: number; readonly user_id: string; readonly display_name: string; readonly games: number; readonly wins: number; readonly rating: number }[]; }
export interface DailyPuzzle { readonly puzzle_id: string; readonly lower_rank: string; readonly upper_rank: string; readonly candidates: readonly string[]; }
export interface FriendItem { readonly connection_id: string; readonly user_id: string; readonly display_name: string; readonly username: string | null; readonly status: "incoming" | "outgoing" | "friend" | "blocked"; }

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

export function saveGuestDisplayName(displayName: string): AuthResponse | null {
  const stored = readStoredGuestSession();
  if (stored === null) return null;
  const auth: AuthResponse = {
    ...stored.auth,
    user: { ...stored.auth.user, display_name: displayName },
  };
  writeStoredGuestSession({ ...stored, auth });
  return auth;
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

export async function loadPlayerStats(accessToken: string): Promise<PlayerStats> {
  const response = await fetch(`${API_URL}/matches/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Match history request failed (${response.status}).`);
  return response.json() as Promise<PlayerStats>;
}

export async function loadLeaderboard(accessToken: string, season: "current" | "all-time" = "current"): Promise<Leaderboard> {
  const response = await fetch(`${API_URL}/matches/leaderboard?season=${season}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Leaderboard request failed (${response.status}).`);
  return response.json() as Promise<Leaderboard>;
}

export async function loadDailyPuzzle(): Promise<DailyPuzzle> {
  const response = await fetch(`${API_URL}/puzzles/daily`);
  if (!response.ok) throw new Error(`Daily puzzle request failed (${response.status}).`);
  return response.json() as Promise<DailyPuzzle>;
}

export async function guessDailyPuzzle(candidate: string): Promise<boolean> {
  const response = await fetch(`${API_URL}/puzzles/daily/guess`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidate }) });
  if (!response.ok) throw new Error(`Daily puzzle guess failed (${response.status}).`);
  return ((await response.json()) as { correct: boolean }).correct;
}

export async function loadFriends(accessToken: string): Promise<readonly FriendItem[]> {
  const response = await fetch(`${API_URL}/social/friends`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Friends request failed (${response.status}).`);
  return ((await response.json()) as { items: FriendItem[] }).items;
}

export async function socialAction(accessToken: string, path: string, method: "POST" | "PATCH" | "DELETE", body?: object): Promise<void> {
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${accessToken}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await fetch(`${API_URL}/social${path}`, init);
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `Social action failed (${response.status}).`);
  }
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
