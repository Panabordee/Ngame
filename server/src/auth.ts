import { readFile } from "node:fs/promises";

import { importSPKI, jwtVerify } from "jose";

import type { ServerConfig } from "./config.ts";

export interface AuthenticatedUser {
  readonly userId: string;
  readonly displayName: string;
  readonly accountType: "registered" | "guest";
  readonly guestSessionId?: string;
  readonly expiresAtMs?: number;
}

export type Authenticator = (token: string) => Promise<AuthenticatedUser>;

export function createJwtAuthenticator(config: ServerConfig): Authenticator {
  let publicKey: Promise<CryptoKey> | null = null;

  return async (token: string): Promise<AuthenticatedUser> => {
    publicKey ??= readFile(config.jwtPublicKeyFile, "utf8").then((pem) =>
      importSPKI(pem, "RS256"),
    );
    const verified = await jwtVerify(token, await publicKey, {
      algorithms: ["RS256"],
      issuer: config.jwtIssuer,
      audience: config.jwtAudience,
      requiredClaims: ["sub", "iss", "aud", "iat", "exp", "jti", "typ"],
    });
    if (
      verified.payload.typ !== "access" ||
      typeof verified.payload.sub !== "string" ||
      typeof verified.payload.name !== "string" ||
      verified.payload.name.trim().length === 0
    ) {
      throw new Error("Invalid access token claims.");
    }
    const accountType = verified.payload.account_type ?? "registered";
    if (accountType !== "registered" && accountType !== "guest") {
      throw new Error("Invalid account type claim.");
    }
    if (
      accountType === "guest" &&
      (typeof verified.payload.guest_session_id !== "string" ||
        verified.payload.guest_session_id.length === 0 ||
        typeof verified.payload.exp !== "number")
    ) {
      throw new Error("Invalid guest session claims.");
    }
    return {
      userId: verified.payload.sub,
      displayName: verified.payload.name.trim().slice(0, 32),
      accountType,
      ...(accountType === "guest"
        ? {
            guestSessionId: verified.payload.guest_session_id as string,
            expiresAtMs: (verified.payload.exp as number) * 1_000,
          }
        : {}),
    };
  };
}
