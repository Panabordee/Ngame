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
