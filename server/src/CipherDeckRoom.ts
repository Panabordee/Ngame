import { randomInt, randomUUID } from "node:crypto";

import {
  Room,
  ServerError,
  type AuthContext,
  type Client,
} from "@colyseus/core";
import { Schema } from "@colyseus/schema";
import {
  RuleViolation,
  createInitialGame,
  createShuffledDeck,
  drawCard,
  forfeitPlayer,
  insertDrawnCard,
  projectStateForPlayer,
  revealSelfPenalty,
  resolveGuess,
  serializeGameState,
  stopGuessingAndPlace,
  type ClientGameView,
  type GameState,
  type LobbyMode,
  type RoomErrorMessage,
  type RoomStatus,
  type StateEnvelope,
} from "@ngame/shared";

import type { AuthenticatedUser, Authenticator } from "./auth.ts";
import type { ServerConfig } from "./config.ts";
import {
  parseGuessMessage,
  parseInsertMessage,
  parseSelfPenaltyMessage,
  toGuessAction,
} from "./messages.ts";

class PublicRoomState extends Schema {}

export interface RoomMetadata {
  readonly desiredPlayers: number;
  readonly status: RoomStatus;
  readonly lobbyMode: LobbyMode;
  readonly roomCode: string | null;
}

type CipherClient = Client<{
  auth: AuthenticatedUser;
  messages: {
    state: StateEnvelope;
    error: RoomErrorMessage;
  };
}>;

interface RoomOptions {
  readonly desiredPlayers?: unknown;
  readonly lobbyMode?: unknown;
}

function secureRandom(): number {
  return randomInt(0, 0x1_0000_0000) / 0x1_0000_0000;
}

export class CipherDeckRoom extends Room<{
  state: PublicRoomState;
  metadata: RoomMetadata;
  client: CipherClient;
}> {
  static authenticator: Authenticator = async () => {
    throw new Error("CipherDeckRoom authentication is not configured.");
  };

  static runtimeConfig: Pick<
    ServerConfig,
    "reconnectSeconds" | "maxMessagesPerSecond"
  > = {
    reconnectSeconds: 30,
    maxMessagesPerSecond: 20,
  };

  private static readonly activeRoomCodes = new Set<string>();

  state = new PublicRoomState();
  private desiredPlayers = 0;
  private lobbyMode: LobbyMode = "public";
  private roomCode: string | null = null;
  private game: GameState | null = null;
  private readonly droppedPlayerIds = new Set<string>();

  static async onAuth(
    token: string,
    _options: RoomOptions,
    _context: AuthContext,
  ): Promise<AuthenticatedUser> {
    if (typeof token !== "string" || token.length === 0) {
      throw new ServerError(401, "Authentication required.");
    }
    try {
      return await CipherDeckRoom.authenticator(token);
    } catch {
      throw new ServerError(401, "Invalid or expired credentials.");
    }
  }

  async onCreate(options: RoomOptions): Promise<void> {
    const desiredPlayers = Number(options.desiredPlayers);
    if (!Number.isSafeInteger(desiredPlayers) || desiredPlayers < 3 || desiredPlayers > 6) {
      throw new ServerError(400, "desiredPlayers must be an integer from 3 to 6.");
    }
    const lobbyMode = options.lobbyMode ?? "public";
    if (lobbyMode !== "public" && lobbyMode !== "code") {
      throw new ServerError(400, "lobbyMode must be either public or code.");
    }
    this.desiredPlayers = desiredPlayers;
    this.lobbyMode = lobbyMode;
    this.roomCode = lobbyMode === "code" ? CipherDeckRoom.reserveRoomCode() : null;
    this.maxClients = desiredPlayers;
    this.maxMessagesPerSecond = CipherDeckRoom.runtimeConfig.maxMessagesPerSecond;
    await this.updateStatus();

    this.onMessage("draw", (client) => {
      this.applyAction(client, (game, actorId) => drawCard(game, actorId));
    });
    this.onMessage("sync", (client) => {
      this.sendState(client);
    });
    this.onMessage("insert", (client, payload: unknown) => {
      const message = parseInsertMessage(payload);
      if (message === null) {
        this.sendError(client, "INVALID_MESSAGE", "Invalid insert message.");
        return;
      }
      this.applyAction(client, (game, actorId) =>
        insertDrawnCard(game, actorId, message.rackIndex),
      );
    });
    this.onMessage("stop", (client) => {
      this.applyAction(client, (game, actorId) => stopGuessingAndPlace(game, actorId));
    });
    this.onMessage("guess", (client, payload: unknown) => {
      const message = parseGuessMessage(payload);
      if (message === null) {
        this.sendError(client, "INVALID_MESSAGE", "Invalid guess message.");
        return;
      }
      this.applyAction(
        client,
        (game, actorId) => resolveGuess(game, toGuessAction(actorId, message)).state,
      );
    });
    this.onMessage("self-penalty", (client, payload: unknown) => {
      const message = parseSelfPenaltyMessage(payload);
      if (message === null) {
        this.sendError(client, "INVALID_MESSAGE", "Invalid self-penalty message.");
        return;
      }
      this.applyAction(client, (game, actorId) =>
        revealSelfPenalty(game, actorId, message.cardId),
      );
    });
  }

  onDispose(): void {
    if (this.roomCode !== null) {
      CipherDeckRoom.activeRoomCodes.delete(this.roomCode);
    }
  }

  async onJoin(client: CipherClient): Promise<void> {
    const userId = this.userId(client);
    const duplicate = this.clients.some(
      (connected) => connected !== client && connected.auth?.userId === userId,
    );
    if (duplicate || this.game !== null) {
      client.error(409, duplicate ? "User is already in this room." : "Match already started.");
      client.leave(4003);
      return;
    }

    if (this.clients.length === this.desiredPlayers) {
      await this.startGame();
    } else {
      this.broadcastState();
    }
  }

  async onDrop(client: CipherClient): Promise<void> {
    if (
      this.game === null ||
      this.game.phase === "game-over" ||
      this.isEliminated(this.userId(client))
    ) {
      return;
    }
    const userId = this.userId(client);
    this.droppedPlayerIds.add(userId);
    await this.updateStatus();
    this.broadcastState();

    try {
      await this.allowReconnection(
        client,
        CipherDeckRoom.runtimeConfig.reconnectSeconds,
      );
    } catch {
      this.forfeitDisconnectedPlayer(userId);
    }
  }

  async onReconnect(client: CipherClient): Promise<void> {
    this.droppedPlayerIds.delete(this.userId(client));
    await this.updateStatus();
    this.broadcastState();
  }

  async onLeave(client: CipherClient): Promise<void> {
    if (this.game === null || this.game.phase === "game-over") {
      this.broadcastState();
      return;
    }
    const userId = this.userId(client);
    if (!this.isEliminated(userId)) {
      this.forfeitDisconnectedPlayer(userId);
    }
  }

  getSnapshot(): string | null {
    return this.game === null ? null : serializeGameState(this.game);
  }

  forfeitDisconnectedPlayer(userId: string): void {
    if (
      this.game === null ||
      this.game.phase === "game-over" ||
      this.isEliminated(userId)
    ) {
      return;
    }
    this.game = forfeitPlayer(this.game, userId);
    this.droppedPlayerIds.delete(userId);
    void this.updateStatus();
    this.broadcastState();
  }

  private async startGame(): Promise<void> {
    const playerIds = this.clients.map((client) => this.userId(client));
    this.game = createInitialGame(
      playerIds,
      createShuffledDeck(secureRandom, () => randomUUID()),
    );
    await this.lock();
    await this.updateStatus();
    this.broadcastState();
  }

  private applyAction(
    client: CipherClient,
    transition: (game: GameState, actorId: string) => GameState,
  ): void {
    if (this.game === null) {
      this.sendError(client, "MATCH_NOT_STARTED", "The match has not started.");
      return;
    }
    if (this.droppedPlayerIds.size > 0) {
      this.sendError(client, "MATCH_PAUSED", "The match is paused for reconnection.");
      return;
    }
    try {
      this.game = transition(this.game, this.userId(client));
      void this.updateStatus();
      this.broadcastState();
    } catch (error) {
      if (error instanceof RuleViolation) {
        this.sendError(client, error.code, error.message);
      } else {
        this.sendError(client, "INVALID_ACTION", "The action could not be applied.");
      }
    }
  }

  private broadcastState(): void {
    for (const client of this.clients) {
      this.sendState(client);
    }
  }

  private sendState(client: CipherClient): void {
    const userId = this.userId(client);
    client.send("state", {
      status: this.roomStatus(),
      desiredPlayers: this.desiredPlayers,
      lobbyMode: this.lobbyMode,
      roomCode: this.roomCode,
      connectedPlayers: this.clients.length,
      droppedPlayerIds: [...this.droppedPlayerIds],
      game: this.game === null ? null : projectStateForPlayer(this.game, userId),
    });
  }

  private sendError(client: CipherClient, code: string, message: string): void {
    client.send("error", { code, message });
  }

  private userId(client: CipherClient): string {
    const userId = client.auth?.userId;
    if (typeof userId !== "string" || userId.length === 0) {
      throw new ServerError(401, "Authenticated user is missing.");
    }
    return userId;
  }

  private isEliminated(userId: string): boolean {
    return (
      this.game?.players.find((player) => player.id === userId)?.eliminated ?? true
    );
  }

  private roomStatus(): RoomStatus {
    if (this.game === null) {
      return "waiting";
    }
    if (this.game.phase === "game-over") {
      return "finished";
    }
    return this.droppedPlayerIds.size > 0 ? "paused" : "playing";
  }

  private async updateStatus(): Promise<void> {
    await this.setMetadata({
      desiredPlayers: this.desiredPlayers,
      status: this.roomStatus(),
      lobbyMode: this.lobbyMode,
      roomCode: this.roomCode,
    });
  }

  private static reserveRoomCode(): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const roomCode = randomInt(100_000, 1_000_000).toString();
      if (!CipherDeckRoom.activeRoomCodes.has(roomCode)) {
        CipherDeckRoom.activeRoomCodes.add(roomCode);
        return roomCode;
      }
    }
    throw new ServerError(503, "Unable to allocate a room code. Please try again.");
  }
}
