import { readFile } from "node:fs/promises";

import { importSPKI, jwtVerify } from "jose";

import type { ServerConfig } from "./config.ts";

export interface AuthenticatedUser {
  readonly userId: string;
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
    if (verified.payload.typ !== "access" || typeof verified.payload.sub !== "string") {
      throw new Error("Invalid access token claims.");
    }
    return { userId: verified.payload.sub };
  };
}
