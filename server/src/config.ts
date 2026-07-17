import { fileURLToPath } from "node:url";

const DEFAULT_JWT_PUBLIC_KEY_FILE = fileURLToPath(
  new URL("../../secrets/jwt-public.pem", import.meta.url),
);

export interface ServerConfig {
  readonly port: number;
  readonly hostname: string;
  readonly jwtPublicKeyFile: string;
  readonly jwtIssuer: string;
  readonly jwtAudience: string;
  readonly corsAllowedOrigins: readonly string[];
  readonly reconnectSeconds: number;
  readonly maxMessagesPerSecond: number;
}

function integerValue(value: string | undefined, fallback: number, name: string): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function originList(value: string | undefined): string[] {
  const origins = (value ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  if (origins.length === 0 || origins.includes("*")) {
    throw new Error("CORS_ALLOWED_ORIGINS must contain at least one exact origin, not a wildcard.");
  }
  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`CORS_ALLOWED_ORIGINS contains an invalid origin: ${origin}`);
    }
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.origin !== origin
    ) {
      throw new Error(`CORS_ALLOWED_ORIGINS must use exact HTTP(S) origins: ${origin}`);
    }
  }
  return [...new Set(origins)];
}

export function loadServerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  return {
    port: integerValue(environment.REALTIME_PORT, 2567, "REALTIME_PORT"),
    hostname: environment.REALTIME_HOST ?? "0.0.0.0",
    jwtPublicKeyFile:
      environment.JWT_PUBLIC_KEY_FILE ?? DEFAULT_JWT_PUBLIC_KEY_FILE,
    jwtIssuer: environment.JWT_ISSUER ?? "http://localhost:8000",
    jwtAudience: environment.JWT_AUDIENCE ?? "ngame",
    corsAllowedOrigins: originList(environment.CORS_ALLOWED_ORIGINS),
    reconnectSeconds: integerValue(
      environment.RECONNECT_TIMEOUT_SECONDS,
      30,
      "RECONNECT_TIMEOUT_SECONDS",
    ),
    maxMessagesPerSecond: integerValue(
      environment.MAX_ROOM_MESSAGES_PER_SECOND,
      20,
      "MAX_ROOM_MESSAGES_PER_SECOND",
    ),
  };
}
