import {
  defineRoom,
  defineServer,
  matchMaker,
  type IRoomCache,
} from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { RedisPresence } from "@colyseus/redis-presence";
import { RedisDriver } from "@colyseus/redis-driver";

import { createJwtAuthenticator, type Authenticator } from "./auth.ts";
import { CipherDeckRoom, type RoomMetadata } from "./CipherDeckRoom.ts";
import { loadServerConfig, type ServerConfig } from "./config.ts";
import {
  InMemoryGuestSessionRegistry,
  type GuestSessionRegistry,
} from "./guestSessions.ts";
import { InMemoryUserRoomRegistry, RedisUserRoomRegistry, type UserRoomRegistry } from "./userRoomRegistry.ts";

export function createGameServer(
  config: ServerConfig = loadServerConfig(),
  authenticator: Authenticator = createJwtAuthenticator(config),
  guestSessions: GuestSessionRegistry = new InMemoryGuestSessionRegistry(),
  userRooms: UserRoomRegistry = config.redisUrl === undefined ? new InMemoryUserRoomRegistry() : new RedisUserRoomRegistry(config.redisUrl),
) {
  const redisPresence = config.redisUrl === undefined ? undefined : new RedisPresence(config.redisUrl);
  const resultQueue = "ngame:match-result-outbox";
  const deliverResult = async (report: Parameters<typeof CipherDeckRoom.resultReporter>[0]): Promise<void> => {
    if (config.apiInternalUrl === undefined || config.matchResultSecret === undefined) return;
    const response = await fetch(`${config.apiInternalUrl.replace(/\/$/, "")}/matches/internal/results`, { method: "POST", headers: { "content-type": "application/json", "x-ngame-internal-secret": config.matchResultSecret }, body: JSON.stringify(report) });
    if (!response.ok) throw new Error(`Match result API returned ${response.status}.`);
  };
  const allowedOrigins = new Set(config.corsAllowedOrigins);
  matchMaker.controller.getCorsHeaders = (headers) => {
    const origin = headers.get("origin");
    return {
      "Access-Control-Allow-Origin":
        origin !== null && allowedOrigins.has(origin) ? origin : "",
    };
  };
  CipherDeckRoom.authenticator = authenticator;
  CipherDeckRoom.guestSessions = guestSessions;
  CipherDeckRoom.userRooms = userRooms;
  CipherDeckRoom.runtimeConfig = {
    reconnectSeconds: config.reconnectSeconds,
    maxMessagesPerSecond: config.maxMessagesPerSecond,
  };
  CipherDeckRoom.distributedRateLimiter = redisPresence ?? null;
  CipherDeckRoom.recoveryStore = redisPresence ?? null;
  CipherDeckRoom.resultReporter = async (report) => {
    try {
      await deliverResult(report);
    } catch (error) {
      if (redisPresence === undefined) throw error;
      await redisPresence.lpush(resultQueue, JSON.stringify(report));
    }
  };

  const room = defineRoom(CipherDeckRoom).filterBy(["desiredPlayers", "lobbyMode"]);
  return defineServer({
    transport: new WebSocketTransport(),
    ...(redisPresence === undefined ? {} : { presence: redisPresence, driver: new RedisDriver(config.redisUrl!) }),
    ...(redisPresence === undefined ? {} : { beforeListen: () => {
      const retryTimer = setInterval(() => { void (async () => {
        const raw = await redisPresence.rpop(resultQueue);
        if (raw === null) return;
        try { await deliverResult(JSON.parse(raw) as Parameters<typeof CipherDeckRoom.resultReporter>[0]); }
        catch { await redisPresence.lpush(resultQueue, raw); }
      })().catch((error) => console.error("Match result outbox retry failed.", error)); }, 5_000);
      retryTimer.unref();
    } }),
    rooms: { cipher_deck: room },
    express: (app) => {
      app.disable("x-powered-by");
      app.get("/healthz", (_request, response) => {
        response.json({ status: "ok" });
      });
      app.get("/rooms/by-code/:roomCode", async (request, response) => {
        const roomCode = request.params.roomCode;
        if (!/^\d{6}$/.test(roomCode)) {
          response.status(400).json({ detail: "Room code must contain exactly six digits." });
          return;
        }
        const spectating = request.query.spectator === "1";
        const lookupConditions: Partial<IRoomCache> & Partial<RoomMetadata> = {
          name: "cipher_deck",
          roomCode,
          lobbyMode: "code",
          ...(spectating ? {} : { status: "waiting", locked: false }),
        };
        const rooms = await matchMaker.query(lookupConditions);
        const available = rooms.find((candidate) => spectating ? (candidate as IRoomCache & RoomMetadata).status !== "waiting" : candidate.clients < candidate.maxClients);
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
