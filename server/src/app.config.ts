import {
  defineRoom,
  defineServer,
  matchMaker,
  type IRoomCache,
} from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";

import { createJwtAuthenticator, type Authenticator } from "./auth.ts";
import { CipherDeckRoom, type RoomMetadata } from "./CipherDeckRoom.ts";
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

  const room = defineRoom(CipherDeckRoom).filterBy(["desiredPlayers", "lobbyMode"]);
  return defineServer({
    transport: new WebSocketTransport(),
    rooms: { cipher_deck: room },
    express: (app) => {
      app.get("/healthz", (_request, response) => {
        response.json({ status: "ok" });
      });
      app.get("/rooms/by-code/:roomCode", async (request, response) => {
        const roomCode = request.params.roomCode;
        if (!/^\d{6}$/.test(roomCode)) {
          response.status(400).json({ detail: "Room code must contain exactly six digits." });
          return;
        }
        const lookupConditions: Partial<IRoomCache> & Partial<RoomMetadata> = {
          name: "cipher_deck",
          roomCode,
          lobbyMode: "code",
          status: "waiting",
          locked: false,
        };
        const rooms = await matchMaker.query(lookupConditions);
        const available = rooms.find((candidate) => candidate.clients < candidate.maxClients);
        if (available === undefined) {
          response.status(404).json({ detail: "Room code not found or room is unavailable." });
          return;
        }
        response.json({ roomId: available.roomId });
      });
    },
  });
}

export const server = createGameServer();
