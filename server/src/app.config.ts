import { defineRoom, defineServer } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";

import { createJwtAuthenticator, type Authenticator } from "./auth.ts";
import { CipherDeckRoom } from "./CipherDeckRoom.ts";
import { loadServerConfig, type ServerConfig } from "./config.ts";

export function createGameServer(
  config: ServerConfig = loadServerConfig(),
  authenticator: Authenticator = createJwtAuthenticator(config),
) {
  CipherDeckRoom.authenticator = authenticator;
  CipherDeckRoom.runtimeConfig = {
    reconnectSeconds: config.reconnectSeconds,
    maxMessagesPerSecond: config.maxMessagesPerSecond,
  };

  const room = defineRoom(CipherDeckRoom).filterBy(["desiredPlayers"]);
  return defineServer({
    transport: new WebSocketTransport(),
    rooms: { cipher_deck: room },
    express: (app) => {
      app.get("/healthz", (_request, response) => {
        response.json({ status: "ok" });
      });
    },
  });
}

export const server = createGameServer();
