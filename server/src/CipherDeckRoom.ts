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
  RANKS,
  chooseJokerCount,
  computeInitialHandSizes,
  createCustomDeck,
  createInitialGameWithStartingCards,
  createShuffledDeck,
  drawCard,
  drawFreshStartingCards,
  forfeitPlayer,
  hasPendingStartingJokerPlacements,
  highestStartingPlayerIds,
  insertDrawnCard,
  placeStartingJoker,
  projectStateForPlayer,
  projectStateForSpectator,
  revealSelfPenalty,
  resolveGuess,
  resolveTurnTimeout,
  serializeGameState,
  shuffleDeck,
  stopGuessingAndPlace,
  validInsertionIndexes,
  type Card,
  type CardGuess,
  type ClientGameView,
  type GameState,
  type GuessHistoryEntry,
  type GameEventEntry,
  type PlayerMatchStats,
  type GuestDisplayNameUpdatedMessage,
  type LobbyMode,
  type RoomSettings,
  type RoomSettingsAppliedMessage,
  type RoomErrorMessage,
  type RoomStatus,
  type StartingSelectionView,
  type StateEnvelope,
  type TableEmote,
  type TableEmoteMessage,
} from "@ngame/shared";

import type { AuthenticatedUser, Authenticator } from "./auth.ts";
import type { ServerConfig } from "./config.ts";
import {
  InMemoryGuestSessionRegistry,
  type GuestSessionRegistry,
} from "./guestSessions.ts";
import { InMemoryUserRoomRegistry, type UserRoomRegistry } from "./userRoomRegistry.ts";
import { InMemoryRoomCodeRegistry, type RoomCodeRegistry } from "./roomCodeRegistry.ts";
import {
  parseGuessMessage,
  parseGuestDisplayNameMessage,
  parseInsertMessage,
  parseRoomSettings,
  parseSelectStartingCard,
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
export interface AuthoritativeMatchReport { readonly match_id: string; readonly players: readonly { readonly user_id: string; readonly won: boolean; readonly guesses: number; readonly correct_guesses: number; readonly cards_revealed: number }[]; }

type CipherClient = Client<{
  auth: AuthenticatedUser;
  messages: {
    state: StateEnvelope;
    error: RoomErrorMessage;
    "settings-applied": RoomSettingsAppliedMessage;
    "guest-name-updated": GuestDisplayNameUpdatedMessage;
    emote: TableEmoteMessage;
  };
}>;

interface RoomOptions {
  readonly desiredPlayers?: unknown;
  readonly lobbyMode?: unknown;
  readonly spectator?: unknown;
}

interface StartingOption {
  readonly card: Card;
  selectedByPlayerId: string | null;
}

interface StartingSelection {
  phase: "choosing" | "revealed" | "joker-placement";
  round: number;
  eligiblePlayerIds: string[];
  tiedPlayerIds: string[];
  options: StartingOption[];
  resolvedCards: Map<string, Card>;
  remainingDeck: Card[];
  discardedCards: Card[];
  starterPlayerId: string | null;
}

const DEFAULT_SETTINGS: RoomSettings = {
  preset: "classic",
  turnSeconds: 120,
  totalCards: 0,
  drawRounds: 4,
  jokerCount: 0,
  botDifficulty: "normal",
};

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

  static guestSessions: GuestSessionRegistry = new InMemoryGuestSessionRegistry();
  static userRooms: UserRoomRegistry = new InMemoryUserRoomRegistry();
  static roomCodes: RoomCodeRegistry = new InMemoryRoomCodeRegistry();

  static runtimeConfig: Pick<
    ServerConfig,
    "reconnectSeconds" | "maxMessagesPerSecond"
  > = {
    reconnectSeconds: 30,
    maxMessagesPerSecond: 20,
  };

  static startingRevealMilliseconds = 1_800;
  static resultReporter: (report: AuthoritativeMatchReport) => Promise<void> = async () => undefined;
  static turnTimerMillisecondsOverride: number | null = null;
  static distributedRateLimiter: { hincrbyex(key: string, field: string, value: number, expireInSeconds: number): Promise<number> } | null = null;
  static recoveryStore: { setex(key: string, value: string, seconds: number): Promise<unknown> } | null = null;

  state = new PublicRoomState();
  private desiredPlayers = 0;
  private lobbyMode: LobbyMode = "public";
  private roomCode: string | null = null;
  private hostPlayerId: string | null = null;
  private settings: RoomSettings = { ...DEFAULT_SETTINGS };
  private startingSelection: StartingSelection | null = null;
  private game: GameState | null = null;
  private readonly droppedPlayerIds = new Set<string>();
  private readonly reconnectDeadlines = new Map<string, number>();
  private readonly readyPlayerIds = new Set<string>();
  private readonly botPlayerIds: string[] = [];
  private readonly spectatorSessionIds = new Set<string>();
  private readonly roomDisplayNames = new Map<string, string>();
  private readonly reservedGuestSessionIds = new Set<string>();
  private readonly reservedUserIds = new Set<string>();
  private readonly registeredPlayerIds = new Set<string>();
  private startingRevealTimer: ReturnType<typeof setTimeout> | null = null;
  private startingChoiceTimer: ReturnType<typeof setTimeout> | null = null;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private turnDeadlineMs: number | null = null;
  private pausedTurnRemainingMs: number | null = null;
  private readonly guessHistory: GuessHistoryEntry[] = [];
  private readonly deductionMisses = new Map<string, Map<string, CardGuess>>();
  private nextGuessHistoryId = 1;
  private readonly eventLog: GameEventEntry[] = [];
  private nextEventId = 1;
  private readonly matchStats = new Map<string, PlayerMatchStats>();
  private currentMatchId: string | null = null;
  private resultReported = false;
  private readonly loggedEliminatedIds = new Set<string>();
  private loggedWinnerId: string | null = null;
  private botTimer: ReturnType<typeof setTimeout> | null = null;

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
    try {
      this.roomCode = lobbyMode === "code" ? await CipherDeckRoom.roomCodes.allocate(this.roomId) : null;
    } catch {
      throw new ServerError(503, "Unable to allocate a room code. Please try again.");
    }
    this.maxClients = desiredPlayers + 20;
    this.maxMessagesPerSecond = CipherDeckRoom.runtimeConfig.maxMessagesPerSecond;
    await this.updateStatus();

    this.registerMessage("draw", (client) => {
      this.applyAction(client, (game, actorId) => drawCard(game, actorId));
    });
    this.registerMessage("sync", (client) => {
      this.sendState(client);
    });
    this.registerMessage("ready", (client, payload: unknown) => {
      if (typeof payload !== "boolean") {
        this.sendError(client, "INVALID_MESSAGE", "Ready state must be a boolean.");
        return;
      }
      this.setPlayerReady(client, payload);
    });
    this.registerMessage("start-game", (client) => {
      void this.requestStartGame(client);
    });
    this.registerMessage("rematch", (client) => {
      void this.requestRematch(client);
    });
    this.registerMessage("emote", (client, payload: unknown) => {
      const emote = typeof payload === "object" && payload !== null && "emote" in payload ? payload.emote : null;
      if (!(["thinking", "nice", "oops", "good-game"] as readonly unknown[]).includes(emote)) {
        this.sendError(client, "INVALID_MESSAGE", "Unknown table emote.");
        return;
      }
      this.broadcast("emote", { actorPlayerId: this.userId(client), emote: emote as TableEmote, sentAtMs: Date.now() });
    });
    this.registerMessage("kick-player", (client, payload: unknown) => {
      void this.kickPlayer(client, payload);
    });
    this.registerMessage("transfer-host", (client, payload: unknown) => {
      this.transferHost(client, payload);
    });
    this.registerMessage("update-settings", (client, payload: unknown) => {
      const settings = parseRoomSettings(payload);
      if (settings === null) {
        this.sendError(client, "INVALID_MESSAGE", "Invalid room settings.");
        return;
      }
      this.updateRoomSettings(client, settings);
    });
    this.registerMessage("update-guest-name", (client, payload: unknown) => {
      const message = parseGuestDisplayNameMessage(payload);
      if (message === null) {
        this.sendError(client, "INVALID_GUEST_NAME", "Guest name must be 1–32 characters.");
        return;
      }
      this.updateGuestDisplayName(client, message.displayName);
    });
    this.registerMessage("select-starting-card", (client, payload: unknown) => {
      const message = parseSelectStartingCard(payload);
      if (message === null) {
        this.sendError(client, "INVALID_MESSAGE", "Invalid starting-card selection.");
        return;
      }
      this.selectStartingCard(client, message.cardId);
    });
    this.registerMessage("place-starting-joker", (client, payload: unknown) => {
      const message = parseInsertMessage(payload);
      if (message === null) {
        this.sendError(client, "INVALID_MESSAGE", "Invalid starting-Joker placement.");
        return;
      }
      this.applyStartingJokerPlacement(client, message.rackIndex);
    });
    this.registerMessage("insert", (client, payload: unknown) => {
      const message = parseInsertMessage(payload);
      if (message === null) {
        this.sendError(client, "INVALID_MESSAGE", "Invalid insert message.");
        return;
      }
      this.applyAction(client, (game, actorId) =>
        insertDrawnCard(game, actorId, message.rackIndex),
      );
    });
    this.registerMessage("stop", (client) => {
      this.applyAction(client, (game, actorId) => stopGuessingAndPlace(game, actorId));
    });
    this.registerMessage("guess", (client, payload: unknown) => {
      const message = parseGuessMessage(payload);
      if (message === null) {
        this.sendError(client, "INVALID_MESSAGE", "Invalid guess message.");
        return;
      }
      this.applyGuess(client, toGuessAction(this.userId(client), message));
    });
    this.registerMessage("self-penalty", (client, payload: unknown) => {
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

  private registerMessage(type: string, handler: (client: CipherClient, payload: unknown) => void | Promise<void>): void {
    this.onMessage(type, async (client, payload: unknown) => {
      const limiter = CipherDeckRoom.distributedRateLimiter;
      if (limiter !== null) {
        try {
          const bucket = `ngame:rate:${Math.floor(Date.now() / 1_000)}`;
          const count = await limiter.hincrbyex(bucket, this.userId(client), 1, 2);
          if (count > CipherDeckRoom.runtimeConfig.maxMessagesPerSecond) {
            this.sendError(client, "RATE_LIMITED", "Too many messages. Please slow down.");
            return;
          }
        } catch (error) {
          console.error("Distributed rate limiter unavailable; using connection limit.", error);
        }
      }
      await handler(client, payload);
    });
  }

  async onDispose(): Promise<void> {
    this.clearStartingRevealTimer();
    this.clearStartingChoiceTimer();
    this.clearTurnTimer();
    this.clearBotTimer();
    if (this.roomCode !== null) await CipherDeckRoom.roomCodes.release(this.roomCode, this.roomId);
    await Promise.all([
      ...[...this.reservedGuestSessionIds].map((guestSessionId) => CipherDeckRoom.guestSessions.releaseReservation(guestSessionId, this.roomId)),
      ...[...this.reservedUserIds].map((userId) => CipherDeckRoom.userRooms.release(userId, this.roomId)),
    ]);
  }

  async onJoin(client: CipherClient, options: RoomOptions): Promise<void> {
    if (options.spectator === true) {
      if (this.game === null && this.startingSelection === null) {
        client.error(409, "Spectating is available after the match starts.");
        client.leave(4003);
        return;
      }
      this.spectatorSessionIds.add(client.sessionId);
      this.sendState(client);
      return;
    }
    const reservation = await this.reserveGuestSession(client);
    if (reservation === "conflict") {
      client.error(409, "This guest session is already assigned to another match.");
      client.leave(4003);
      return;
    }
    const userId = this.userId(client);
    const userReservation = await CipherDeckRoom.userRooms.reserve(userId, this.roomId);
    if (userReservation === "conflict") {
      if (reservation === "created") await this.releaseGuestReservation(client);
      client.error(409, "This account is already playing in another room.");
      client.leave(4003);
      return;
    }
    this.reservedUserIds.add(userId);
    if (client.auth?.accountType === "registered") this.registeredPlayerIds.add(userId);
    if (this.clients.filter((connected) => !this.spectatorSessionIds.has(connected.sessionId)).length > this.desiredPlayers) {
      if (reservation === "created") await this.releaseGuestReservation(client);
      if (userReservation === "created") await this.releaseUserRoom(userId);
      client.error(409, "Room is full.");
      client.leave(4003);
      return;
    }
    const duplicate = this.clients.some(
      (connected) => connected !== client && connected.auth?.userId === userId,
    );
    if (duplicate || this.game !== null || this.startingSelection !== null) {
      if (reservation === "created") await this.releaseGuestReservation(client);
      if (userReservation === "created") await this.releaseUserRoom(userId);
      client.error(409, duplicate ? "User is already in this room." : "Match already started.");
      client.leave(4003);
      return;
    }
    if (this.hostPlayerId === null) {
      this.hostPlayerId = userId;
    }
    this.roomDisplayNames.set(userId, this.authDisplayName(client));
    if (this.playerClients().length >= this.desiredPlayers) await this.lock();
    await this.updateStatus();
    this.broadcastState();
  }

  async onDrop(client: CipherClient): Promise<void> {
    if (this.spectatorSessionIds.has(client.sessionId)) return;
    if (this.startingSelection !== null && this.game === null) {
      const userId = this.userId(client);
      this.droppedPlayerIds.add(userId);
      this.reconnectDeadlines.set(userId, Date.now() + CipherDeckRoom.runtimeConfig.reconnectSeconds * 1_000);
      await this.updateStatus();
      this.broadcastState();
      try {
        await this.allowReconnection(client, CipherDeckRoom.runtimeConfig.reconnectSeconds);
      } catch {
        this.transferDepartedHost(userId);
        await this.abortStartingSelection(userId);
        await this.releaseUserRoom(userId);
      }
      return;
    }
    if (
      this.game === null ||
      this.game.phase === "game-over" ||
      this.isEliminated(this.userId(client))
    ) {
      return;
    }
    const userId = this.userId(client);
    this.droppedPlayerIds.add(userId);
    this.reconnectDeadlines.set(userId, Date.now() + CipherDeckRoom.runtimeConfig.reconnectSeconds * 1_000);
    this.pauseTurnTimer();
    await this.updateStatus();
    this.broadcastState();

    try {
      await this.allowReconnection(
        client,
        CipherDeckRoom.runtimeConfig.reconnectSeconds,
      );
    } catch {
      this.transferDepartedHost(userId);
      this.forfeitDisconnectedPlayer(userId);
      await this.releaseUserRoom(userId);
    }
  }

  async onReconnect(client: CipherClient): Promise<void> {
    if (this.spectatorSessionIds.has(client.sessionId)) {
      this.sendState(client);
      return;
    }
    this.droppedPlayerIds.delete(this.userId(client));
    this.reconnectDeadlines.delete(this.userId(client));
    await this.updateStatus();
    if (this.droppedPlayerIds.size === 0) {
      this.resumeTurnTimer();
    }
    this.broadcastState();
  }

  async onLeave(client: CipherClient): Promise<void> {
    if (this.spectatorSessionIds.delete(client.sessionId)) return;
    if (this.game === null || this.game.phase === "game-over") {
      const userId = this.userId(client);
      await this.releaseGuestReservation(client);
      await this.releaseUserRoom(userId);
      if (this.startingSelection === null) this.roomDisplayNames.delete(userId);
      if (this.startingSelection !== null) {
        await this.abortStartingSelection(userId);
      }
      this.readyPlayerIds.delete(userId);
      this.transferDepartedHost(userId);
      await this.unlock();
      await this.updateStatus();
      this.broadcastState();
      return;
    }
    const userId = this.userId(client);
    this.transferDepartedHost(userId);
    if (!this.isEliminated(userId)) {
      this.forfeitDisconnectedPlayer(userId);
    }
    await this.releaseUserRoom(userId);
    await this.updateStatus();
    this.broadcastState();
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
    const previousTurn = this.game.turn;
    this.game = forfeitPlayer(this.game, userId);
    this.droppedPlayerIds.delete(userId);
    this.reconnectDeadlines.delete(userId);
    if (
      this.startingSelection?.phase === "joker-placement" &&
      this.game.phase !== "starter-place"
    ) {
      this.startingSelection = null;
    }
    if (this.game.phase === "game-over") {
      this.clearTurnTimer();
    } else if (this.game.turn !== previousTurn) {
      this.armTurnTimer();
    } else if (this.droppedPlayerIds.size === 0) {
      this.resumeTurnTimer();
    }
    void this.updateStatus();
    this.broadcastState();
  }

  private buildMatchDeck(): Card[] {
    if (this.settings.preset === "classic") {
      return createShuffledDeck(secureRandom, () => randomUUID());
    }
    const jokerCount = this.settings.jokerCount === 0
      ? chooseJokerCount(secureRandom)
      : this.settings.jokerCount;
    return createCustomDeck(
      this.settings.totalCards,
      jokerCount,
      secureRandom,
      () => randomUUID(),
    );
  }

  private takeStartingOptions(
    selection: StartingSelection,
    precedingOptionIds: ReadonlySet<string> = new Set(),
  ): StartingOption[] {
    if (selection.remainingDeck.length < 6) {
      const pool = [...selection.remainingDeck, ...selection.discardedCards];
      const freshDraw = drawFreshStartingCards(
        pool,
        precedingOptionIds,
        secureRandom,
      );
      selection.remainingDeck = freshDraw.remaining;
      selection.discardedCards = [];
      return freshDraw.selected.map((card) => ({ card, selectedByPlayerId: null }));
    }
    const cards = selection.remainingDeck.splice(0, 6);
    if (cards.length !== 6) {
      throw new RuleViolation(
        "INVALID_DECK",
        "The deck cannot provide six fresh starting-player choices.",
      );
    }
    return cards.map((card) => ({ card, selectedByPlayerId: null }));
  }

  private async beginStartingSelection(): Promise<void> {
    const playerIds = this.allPlayerIds();
    const deck = this.buildMatchDeck();
    this.currentMatchId = randomUUID();
    this.resultReported = false;
    this.loggedEliminatedIds.clear();
    this.loggedWinnerId = null;
    this.matchStats.clear();
    for (const playerId of playerIds) this.matchStats.set(playerId, { playerId, guesses: 0, correctGuesses: 0, cardsRevealed: 0 });
    this.addEvent("match-started", null, null, null);
    computeInitialHandSizes(deck.length, playerIds.length, this.settings.drawRounds);
    const selection: StartingSelection = {
      phase: "choosing",
      round: 1,
      eligiblePlayerIds: [...playerIds],
      tiedPlayerIds: [],
      options: [],
      resolvedCards: new Map(),
      remainingDeck: [...deck],
      discardedCards: [],
      starterPlayerId: null,
    };
    selection.options = this.takeStartingOptions(selection);
    this.startingSelection = selection;
    await this.updateStatus();
    await this.unlock();
    this.broadcastState();
    this.armStartingChoiceTimer();
    this.scheduleBots();
  }

  private selectStartingCard(client: CipherClient, cardId: string): void {
    this.selectStartingCardForPlayer(this.userId(client), cardId, client);
  }

  private selectStartingCardForPlayer(
    playerId: string,
    cardId: string,
    client?: CipherClient,
  ): void {
    const selection = this.startingSelection;
    if (
      selection === null ||
      selection.phase !== "choosing" ||
      !selection.eligiblePlayerIds.includes(playerId)
    ) {
      if (client !== undefined) this.sendError(client, "WRONG_PHASE", "This player cannot select a starting card now.");
      return;
    }
    if (selection.options.some((option) => option.selectedByPlayerId === playerId)) {
      if (client !== undefined) this.sendError(client, "ALREADY_SELECTED", "A starting card has already been selected.");
      return;
    }
    const option = selection.options.find((candidate) => candidate.card.id === cardId);
    if (option === undefined || option.selectedByPlayerId !== null) {
      if (client !== undefined) this.sendError(client, "INVALID_TARGET", "That starting card is unavailable.");
      return;
    }
    option.selectedByPlayerId = playerId;
    if (
      selection.eligiblePlayerIds.every((eligibleId) =>
        selection.options.some((candidate) => candidate.selectedByPlayerId === eligibleId),
      )
    ) {
      this.clearStartingChoiceTimer();
      this.revealStartingChoices(selection);
    }
    this.broadcastState();
  }

  private revealStartingChoices(selection: StartingSelection): void {
    selection.phase = "revealed";
    const choices = selection.eligiblePlayerIds.map((playerId) => {
      const option = selection.options.find(
        (candidate) => candidate.selectedByPlayerId === playerId,
      );
      if (option === undefined) {
        throw new RuleViolation("INVALID_TARGET", "A starting-card choice is missing.");
      }
      return { playerId, card: option.card };
    });
    const tiedPlayerIds = highestStartingPlayerIds(choices);
    selection.tiedPlayerIds = tiedPlayerIds;

    if (tiedPlayerIds.length === 1) {
      for (const choice of choices) {
        selection.resolvedCards.set(choice.playerId, choice.card);
      }
      selection.starterPlayerId = tiedPlayerIds[0] ?? null;
    } else {
      for (const choice of choices) {
        if (!tiedPlayerIds.includes(choice.playerId)) {
          selection.resolvedCards.set(choice.playerId, choice.card);
        }
      }
    }

    this.clearStartingRevealTimer();
    this.startingRevealTimer = setTimeout(() => {
      this.startingRevealTimer = null;
      this.advanceStartingSelection();
    }, CipherDeckRoom.startingRevealMilliseconds);
  }

  private advanceStartingSelection(): void {
    const selection = this.startingSelection;
    if (selection === null || selection.phase !== "revealed") {
      return;
    }
    if (selection.starterPlayerId !== null) {
      this.finalizeStartingSelection(selection);
      return;
    }

    const resolvedCardIds = new Set(
      [...selection.resolvedCards.values()].map((card) => card.id),
    );
    const precedingOptionIds = new Set(selection.options.map((option) => option.card.id));
    selection.discardedCards.push(
      ...selection.options
        .map((option) => option.card)
        .filter((card) => !resolvedCardIds.has(card.id)),
    );
    selection.eligiblePlayerIds = [...selection.tiedPlayerIds];
    selection.tiedPlayerIds = [];
    selection.round += 1;
    selection.options = this.takeStartingOptions(selection, precedingOptionIds);
    selection.phase = "choosing";
    this.broadcastState();
    this.armStartingChoiceTimer();
    this.scheduleBots();
  }

  private finalizeStartingSelection(selection: StartingSelection): void {
    const playerIds = this.allPlayerIds();
    if (
      selection.starterPlayerId === null ||
      selection.resolvedCards.size !== playerIds.length
    ) {
      throw new RuleViolation("INVALID_STARTING_CARDS", "Starting-card results are incomplete.");
    }
    const selectedCardIds = new Set(
      [...selection.resolvedCards.values()].map((card) => card.id),
    );
    const deckWithoutStartingCards = shuffleDeck(
      [
        ...selection.remainingDeck,
        ...selection.discardedCards,
        ...selection.options
          .map((option) => option.card)
          .filter((card) => !selectedCardIds.has(card.id)),
      ],
      secureRandom,
    );
    this.game = createInitialGameWithStartingCards(
      playerIds,
      deckWithoutStartingCards,
      playerIds.map((playerId) => ({
        playerId,
        card: selection.resolvedCards.get(playerId)!,
      })),
      selection.starterPlayerId,
      this.settings.drawRounds,
    );
    if (hasPendingStartingJokerPlacements(this.game)) {
      selection.phase = "joker-placement";
      this.armTurnTimer();
    } else {
      this.startingSelection = null;
      this.armTurnTimer();
    }
    void this.updateStatus();
    this.broadcastState();
    this.scheduleBots();
  }

  private setPlayerReady(client: CipherClient, ready: boolean): void {
    if (this.game !== null || this.startingSelection !== null) {
      this.sendError(client, "MATCH_ALREADY_STARTED", "Ready state is locked after the match starts.");
      return;
    }
    const userId = this.userId(client);
    if (userId === this.hostPlayerId) {
      this.sendError(client, "HOST_ALREADY_READY", "The host starts the match and does not need to ready up.");
      return;
    }
    if (ready) {
      this.readyPlayerIds.add(userId);
    } else {
      this.readyPlayerIds.delete(userId);
    }
    this.broadcastState();
  }

  private lobbyTarget(client: CipherClient, payload: unknown): CipherClient | null {
    if (this.game !== null || this.startingSelection !== null) {
      this.sendError(client, "MATCH_ALREADY_STARTED", "Host controls are locked after the match starts.");
      return null;
    }
    if (this.userId(client) !== this.hostPlayerId) {
      this.sendError(client, "HOST_ONLY", "Only the room host may manage players.");
      return null;
    }
    if (typeof payload !== "object" || payload === null || !("playerId" in payload) || typeof payload.playerId !== "string") {
      this.sendError(client, "INVALID_MESSAGE", "A valid player is required.");
      return null;
    }
    const target = this.clients.find((connected) => this.userId(connected) === payload.playerId);
    if (target === undefined || target === client) {
      this.sendError(client, "INVALID_TARGET", "That player cannot be managed.");
      return null;
    }
    return target;
  }

  private async kickPlayer(client: CipherClient, payload: unknown): Promise<void> {
    const target = this.lobbyTarget(client, payload);
    if (target === null) return;
    target.send("error", { code: "KICKED_BY_HOST", message: "The host removed you from the room." });
    await target.leave(4004);
  }

  private transferHost(client: CipherClient, payload: unknown): void {
    const target = this.lobbyTarget(client, payload);
    if (target === null) return;
    this.hostPlayerId = this.userId(target);
    this.readyPlayerIds.delete(this.hostPlayerId);
    this.broadcastState();
  }

  private updateRoomSettings(client: CipherClient, settings: RoomSettings): void {
    if (this.game !== null || this.startingSelection !== null) {
      this.sendError(client, "SETTINGS_LOCKED", "Room settings are locked after starting.");
      return;
    }
    if (this.userId(client) !== this.hostPlayerId) {
      this.sendError(client, "HOST_ONLY", "Only the room host may change settings.");
      return;
    }
    if (this.lobbyMode === "public" && settings.preset !== "classic") {
      this.sendError(client, "PUBLIC_CLASSIC_ONLY", "Quick Match rooms use Classic rules.");
      return;
    }
    try {
      if (settings.preset === "classic") {
        this.settings = {
          preset: "classic",
          turnSeconds: settings.turnSeconds,
          totalCards: 0,
          drawRounds: 4,
          jokerCount: 0,
          botDifficulty: settings.botDifficulty,
        };
      } else {
        if (
          settings.jokerCount === 0 ||
          settings.totalCards > 52 + settings.jokerCount
        ) {
          throw new RuleViolation(
            "INVALID_DECK",
            "Custom rules require 2–4 Jokers and a compatible total card count.",
          );
        }
        computeInitialHandSizes(
          settings.totalCards,
          this.desiredPlayers,
          settings.drawRounds,
        );
        this.settings = { ...settings };
      }
      this.readyPlayerIds.clear();
      this.broadcastState();
      client.send("settings-applied", { settings: { ...this.settings } });
    } catch (error) {
      if (error instanceof RuleViolation) {
        this.sendError(client, error.code, error.message);
      } else {
        this.sendError(client, "INVALID_SETTINGS", "Room settings are not playable.");
      }
    }
  }

  private async requestStartGame(client: CipherClient): Promise<void> {
    if (this.game !== null || this.startingSelection !== null) {
      this.sendError(client, "MATCH_ALREADY_STARTED", "The match has already started.");
      return;
    }
    if (this.userId(client) !== this.hostPlayerId) {
      this.sendError(client, "HOST_ONLY", "Only the room host may start the match.");
      return;
    }
    const playerClients = this.playerClients();
    if (playerClients.length < 1) {
      this.sendError(client, "NOT_ENOUGH_PLAYERS", "At least one human player is required.");
      return;
    }
    if (playerClients.some((connected) => this.userId(connected) !== this.hostPlayerId && !this.readyPlayerIds.has(this.userId(connected)))) {
      this.sendError(client, "PLAYERS_NOT_READY", "Every non-host player must be ready.");
      return;
    }
    for (const guestSessionId of this.reservedGuestSessionIds) {
      await CipherDeckRoom.guestSessions.commit(guestSessionId, this.roomId);
    }
    this.botPlayerIds.splice(0, this.botPlayerIds.length);
    for (let index = playerClients.length; index < this.desiredPlayers; index += 1) {
      this.botPlayerIds.push(`bot-${this.roomId}-${index + 1}`);
    }
    await this.beginStartingSelection();
  }

  private applyStartingJokerPlacement(client: CipherClient, rackIndex: number): void {
    if (
      this.game === null ||
      this.startingSelection?.phase !== "joker-placement" ||
      this.droppedPlayerIds.size > 0
    ) {
      this.sendError(client, "WRONG_PHASE", "Starting Jokers cannot be placed now.");
      return;
    }
    try {
      this.game = placeStartingJoker(this.game, this.userId(client), rackIndex);
      if (!hasPendingStartingJokerPlacements(this.game)) {
        this.startingSelection = null;
      }
      this.armTurnTimer();
      void this.updateStatus();
      this.broadcastState();
      this.scheduleBots();
    } catch (error) {
      if (error instanceof RuleViolation) {
        this.sendError(client, error.code, error.message);
      } else {
        this.sendError(client, "INVALID_ACTION", "The Joker placement was rejected.");
      }
    }
  }

  private async abortStartingSelection(droppedPlayerId: string): Promise<void> {
    this.clearStartingRevealTimer();
    this.clearStartingChoiceTimer();
    this.startingSelection = null;
    this.game = null;
    this.readyPlayerIds.clear();
    this.droppedPlayerIds.delete(droppedPlayerId);
    this.reconnectDeadlines.delete(droppedPlayerId);
    await this.unlock();
    await this.updateStatus();
    this.broadcastState();
  }

  private clearStartingRevealTimer(): void {
    if (this.startingRevealTimer !== null) {
      clearTimeout(this.startingRevealTimer);
      this.startingRevealTimer = null;
    }
  }

  private clearStartingChoiceTimer(): void {
    if (this.startingChoiceTimer !== null) clearTimeout(this.startingChoiceTimer);
    this.startingChoiceTimer = null;
    if (this.game === null) this.turnDeadlineMs = null;
  }

  private armStartingChoiceTimer(): void {
    this.clearStartingChoiceTimer();
    const selection = this.startingSelection;
    if (selection === null || selection.phase !== "choosing") return;
    const durationMs = this.configuredTurnDurationMs() > 0 ? this.configuredTurnDurationMs() : 30_000;
    this.turnDeadlineMs = Date.now() + durationMs;
    this.startingChoiceTimer = setTimeout(() => {
      this.startingChoiceTimer = null;
      this.turnDeadlineMs = null;
      const current = this.startingSelection;
      if (current === null || current.phase !== "choosing") return;
      const available = current.options.filter((option) => option.selectedByPlayerId === null);
      for (const playerId of current.eligiblePlayerIds) {
        if (current.options.some((option) => option.selectedByPlayerId === playerId)) continue;
        const optionIndex = randomInt(0, available.length);
        const [option] = available.splice(optionIndex, 1);
        if (option !== undefined) option.selectedByPlayerId = playerId;
      }
      this.revealStartingChoices(current);
      this.broadcastState();
    }, durationMs);
  }

  private clearTurnTimer(): void {
    if (this.turnTimer !== null) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    this.turnDeadlineMs = null;
    this.pausedTurnRemainingMs = null;
  }

  private clearBotTimer(): void {
    if (this.botTimer !== null) {
      clearTimeout(this.botTimer);
      this.botTimer = null;
    }
  }

  private allPlayerIds(): string[] {
    return [...this.playerClients().map((client) => this.userId(client)), ...this.botPlayerIds];
  }

  private playerClients(): CipherClient[] {
    return this.clients.filter((client) => !this.spectatorSessionIds.has(client.sessionId));
  }

  private transferDepartedHost(departedUserId: string): void {
    if (this.hostPlayerId !== departedUserId) return;
    const nextHost = this.playerClients().find((connected) => this.userId(connected) !== departedUserId);
    this.hostPlayerId = nextHost === undefined ? null : this.userId(nextHost);
    if (this.hostPlayerId !== null) this.readyPlayerIds.delete(this.hostPlayerId);
  }

  private botPersonality(botId: string): "balanced" | "bold" | "cautious" {
    const index = this.botPlayerIds.indexOf(botId);
    return (["balanced", "bold", "cautious"] as const)[Math.max(0, index) % 3]!;
  }

  private scheduleBots(): void {
    this.clearBotTimer();
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      try {
        this.runBotStep();
      } catch (error) {
        console.error("CipherDeck bot action failed.", error);
      }
    }, 350);
  }

  private runBotStep(): void {
    const selection = this.startingSelection;
    if (selection?.phase === "choosing") {
      const botId = selection.eligiblePlayerIds.find(
        (id) => this.botPlayerIds.includes(id) &&
          !selection.options.some((option) => option.selectedByPlayerId === id),
      );
      const option = selection.options.find((candidate) => candidate.selectedByPlayerId === null);
      if (botId !== undefined && option !== undefined) {
        this.selectStartingCardForPlayer(botId, option.card.id);
        this.scheduleBots();
      }
      return;
    }
    if (this.game === null || this.game.phase === "game-over" || this.droppedPlayerIds.size > 0) return;

    if (this.game.phase === "starter-place") {
      const botId = this.botPlayerIds.find(
        (id) => (this.game?.pendingStartingJokerCardIdsByPlayer[id]?.length ?? 0) > 0,
      );
      if (botId !== undefined) {
        const player = this.game.players.find((candidate) => candidate.id === botId)!;
        const pendingCount = this.game.pendingStartingJokerCardIdsByPlayer[botId]?.length ?? 0;
        const placedRackLength = player.rack.length - pendingCount;
        this.game = placeStartingJoker(this.game, botId, randomInt(0, placedRackLength + 1));
        if (!hasPendingStartingJokerPlacements(this.game)) this.startingSelection = null;
        this.afterBotAction();
      }
      return;
    }

    const botId = this.game.players[this.game.currentPlayerIndex]?.id;
    if (botId === undefined || !this.botPlayerIds.includes(botId)) return;
    const botPhase = this.game.phase;
    if (this.game.phase === "draw") {
      this.game = drawCard(this.game, botId);
    } else if (this.game.phase === "guess") {
      const stopChance = this.botPersonality(botId) === "bold" ? 0.25 : this.botPersonality(botId) === "cautious" ? 0.8 : 0.55;
      if (this.game.correctGuessesThisTurn > 0 && this.game.pendingDraw !== null && secureRandom() < stopChance) {
        this.game = stopGuessingAndPlace(this.game, botId);
      } else {
        const targets = this.game.players
          .filter((player) => player.id !== botId && !player.eliminated)
          .flatMap((player) => player.rack.filter((card) => !card.revealed).map((card) => ({ player, card })));
        const target = targets[randomInt(0, targets.length)];
        if (target === undefined) return;
        const guess = this.chooseBotGuess(botId, target.player.id, target.card.id);
        const action = { actorId: botId, targetPlayerId: target.player.id, targetCardId: target.card.id, guess };
        const resolution = resolveGuess(this.game, action);
        this.game = resolution.state;
        this.recordGuess(action.actorId, action.targetPlayerId, action.targetCardId, action.guess, resolution.correct);
      }
    } else if (this.game.phase === "place" || this.game.phase === "penalty-place") {
      const player = this.game.players.find((candidate) => candidate.id === botId)!;
      const pending = this.game.pendingDraw!;
      const indexes = validInsertionIndexes(player.rack, pending);
      this.game = insertDrawnCard(this.game, botId, indexes[randomInt(0, indexes.length)]!);
    } else if (this.game.phase === "self-penalty") {
      const player = this.game.players.find((candidate) => candidate.id === botId)!;
      const cards = player.rack.filter((card) => !card.revealed);
      this.game = revealSelfPenalty(this.game, botId, cards[randomInt(0, cards.length)]!.id);
    }
    if (botPhase === "draw") this.addEvent("draw", botId, null, null);
    if (["place", "penalty-place", "self-penalty"].includes(botPhase)) this.addEvent("turn-ended", botId, null, null);
    this.afterBotAction();
  }

  private afterBotAction(): void {
    if (this.game?.phase === "game-over") this.clearTurnTimer();
    else this.armTurnTimer();
    void this.updateStatus();
    this.broadcastState();
    this.scheduleBots();
  }

  private configuredTurnDurationMs(): number {
    return CipherDeckRoom.turnTimerMillisecondsOverride ?? this.settings.turnSeconds * 1_000;
  }

  private armTurnTimer(durationMs = this.configuredTurnDurationMs()): void {
    this.clearTurnTimer();
    if (
      durationMs <= 0 ||
      this.game === null ||
      this.game.phase === "game-over" ||
      this.droppedPlayerIds.size > 0
    ) {
      return;
    }
    this.turnDeadlineMs = Date.now() + durationMs;
    this.turnTimer = setTimeout(() => {
      this.turnTimer = null;
      this.turnDeadlineMs = null;
      this.handleTurnTimeout();
    }, durationMs);
  }

  private pauseTurnTimer(): void {
    if (this.turnDeadlineMs !== null) {
      this.pausedTurnRemainingMs = Math.max(1, this.turnDeadlineMs - Date.now());
    }
    if (this.turnTimer !== null) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    this.turnDeadlineMs = null;
  }

  private resumeTurnTimer(): void {
    if (this.game === null || this.droppedPlayerIds.size > 0) {
      return;
    }
    const remaining = this.pausedTurnRemainingMs;
    this.armTurnTimer(remaining ?? this.configuredTurnDurationMs());
  }

  private handleTurnTimeout(): void {
    if (this.game === null || this.droppedPlayerIds.size > 0) {
      return;
    }
    try {
      this.game = resolveTurnTimeout(this.game, secureRandom);
      if (this.game.phase === "game-over") {
        this.clearTurnTimer();
      } else {
        this.armTurnTimer();
      }
      void this.updateStatus();
      this.broadcastState();
      this.scheduleBots();
    } catch (error) {
      console.error("CipherDeck turn timeout resolution failed.", error);
      this.clearTurnTimer();
      if (this.game.phase !== "game-over") {
        this.armTurnTimer();
        this.broadcastState();
      }
    }
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
      const beforePhase = this.game.phase;
      const actorId = this.userId(client);
      this.game = transition(this.game, this.userId(client));
      if (beforePhase === "draw") this.addEvent("draw", actorId, null, null);
      if (["place", "penalty-place", "self-penalty"].includes(beforePhase)) this.addEvent("turn-ended", actorId, null, null);
      if (this.game.phase === "game-over") {
        this.clearTurnTimer();
      } else {
        this.armTurnTimer();
      }
      void this.updateStatus();
      this.broadcastState();
      this.scheduleBots();
    } catch (error) {
      if (error instanceof RuleViolation) {
        this.sendError(client, error.code, error.message);
      } else {
        this.sendError(client, "INVALID_ACTION", "The action could not be applied.");
      }
    }
  }

  private applyGuess(client: CipherClient, action: ReturnType<typeof toGuessAction>): void {
    if (this.game === null) {
      this.sendError(client, "MATCH_NOT_STARTED", "The match has not started.");
      return;
    }
    if (this.droppedPlayerIds.size > 0) {
      this.sendError(client, "MATCH_PAUSED", "The match is paused for reconnection.");
      return;
    }
    try {
      const resolution = resolveGuess(this.game, action);
      this.game = resolution.state;
      this.recordGuess(action.actorId, action.targetPlayerId, action.targetCardId, action.guess, resolution.correct);
      if (this.game.phase === "game-over") this.clearTurnTimer();
      else this.armTurnTimer();
      void this.updateStatus();
      this.broadcastState();
      this.scheduleBots();
    } catch (error) {
      if (error instanceof RuleViolation) this.sendError(client, error.code, error.message);
      else this.sendError(client, "INVALID_ACTION", "The guess could not be applied.");
    }
  }

  private recordGuess(actorPlayerId: string, targetPlayerId: string, targetCardId: string, guess: GuessHistoryEntry["guess"], correct: boolean): void {
    this.guessHistory.push({ id: this.nextGuessHistoryId++, actorPlayerId, targetPlayerId, targetCardId, guess: structuredClone(guess), correct });
    if (this.guessHistory.length > 12) this.guessHistory.splice(0, this.guessHistory.length - 12);
    if (!correct) {
      const key = guess.kind === "joker" ? "JOKER" : `${guess.rank}-${guess.color}`;
      const misses = this.deductionMisses.get(targetCardId) ?? new Map<string, CardGuess>();
      misses.set(key, structuredClone(guess));
      this.deductionMisses.set(targetCardId, misses);
    }
    const stats = this.matchStats.get(actorPlayerId);
    if (stats !== undefined) this.matchStats.set(actorPlayerId, { ...stats, guesses: stats.guesses + 1, correctGuesses: stats.correctGuesses + (correct ? 1 : 0), cardsRevealed: stats.cardsRevealed + (correct ? 1 : 0) });
    this.addEvent("guess", actorPlayerId, targetPlayerId, `${guess.kind === "joker" ? "JOKER" : `${guess.rank}-${guess.color}`}:${correct ? "correct" : "wrong"}`);
  }

  private addEvent(kind: GameEventEntry["kind"], actorPlayerId: string | null, targetPlayerId: string | null, detail: string | null): void {
    this.eventLog.push({ id: this.nextEventId++, kind, actorPlayerId, targetPlayerId, detail });
    if (this.eventLog.length > 500) this.eventLog.splice(0, this.eventLog.length - 500);
  }

  private async requestRematch(client: CipherClient): Promise<void> {
    if (this.userId(client) !== this.hostPlayerId) {
      this.sendError(client, "HOST_ONLY", "Only the host may request a rematch.");
      return;
    }
    if (this.game?.phase !== "game-over") {
      this.sendError(client, "MATCH_NOT_FINISHED", "A rematch is available after the match ends.");
      return;
    }
    this.clearTurnTimer();
    this.clearBotTimer();
    this.game = null;
    this.startingSelection = null;
    this.botPlayerIds.splice(0);
    this.readyPlayerIds.clear();
    this.guessHistory.splice(0);
    this.deductionMisses.clear();
    this.eventLog.splice(0);
    this.matchStats.clear();
    await this.unlock();
    await this.updateStatus();
    this.broadcastState();
  }

  private chooseBotGuess(botId: string, targetPlayerId: string, targetCardId: string): CardGuess {
    let candidates: CardGuess[] = [
      { kind: "joker" },
      ...RANKS.flatMap((rank) => [
        { kind: "standard" as const, rank, color: "red" as const },
        { kind: "standard" as const, rank, color: "black" as const },
      ]),
    ];
    if (this.settings.botDifficulty !== "easy") {
      const misses = this.deductionMisses.get(targetCardId);
      candidates = candidates.filter((candidate) => {
        const key = candidate.kind === "joker" ? "JOKER" : `${candidate.rank}-${candidate.color}`;
        return !misses?.has(key);
      });
    }
    if (this.settings.botDifficulty === "hard" && this.game !== null) {
      const view = projectStateForPlayer(this.game, botId);
      const rack = view.players.find((player) => player.id === targetPlayerId)?.rack ?? [];
      const targetIndex = rack.findIndex((card) => card.id === targetCardId);
      const lower = rack.slice(0, targetIndex).reverse().find((card) => card.kind === "standard");
      const upper = rack.slice(targetIndex + 1).find((card) => card.kind === "standard");
      const lowerRank = lower?.kind === "standard" ? RANKS.indexOf(lower.rank) : 0;
      const upperRank = upper?.kind === "standard" ? RANKS.indexOf(upper.rank) : RANKS.length - 1;
      candidates = candidates.filter((candidate) => candidate.kind === "joker" || (
        RANKS.indexOf(candidate.rank) >= lowerRank && RANKS.indexOf(candidate.rank) <= upperRank
      ));
    }
    return candidates[randomInt(0, candidates.length)] ?? { kind: "joker" };
  }

  private broadcastState(): void {
    this.syncOutcomeEvents();
    this.maybeReportResult();
    this.persistRecoveryCheckpoint();
    for (const client of this.clients) {
      this.sendState(client);
    }
  }

  private persistRecoveryCheckpoint(): void {
    if (this.game === null || CipherDeckRoom.recoveryStore === null) return;
    const checkpoint = JSON.stringify({
      version: 1,
      roomId: this.roomId,
      savedAtMs: Date.now(),
      desiredPlayers: this.desiredPlayers,
      lobbyMode: this.lobbyMode,
      roomCode: this.roomCode,
      hostPlayerId: this.hostPlayerId,
      settings: this.settings,
      playerIds: this.game.players.map((player) => player.id),
      displayNames: Object.fromEntries(this.roomDisplayNames),
      game: serializeGameState(this.game),
    });
    void CipherDeckRoom.recoveryStore.setex(`ngame:room-recovery:${this.roomId}`, checkpoint, 3_600).catch((error) => console.error("Failed to persist room recovery checkpoint.", error));
  }

  private syncOutcomeEvents(): void {
    if (this.game === null) return;
    for (const player of this.game.players) {
      if (player.eliminated && !this.loggedEliminatedIds.has(player.id)) {
        this.loggedEliminatedIds.add(player.id);
        this.addEvent("eliminated", player.id, null, null);
      }
    }
    if (this.game.winnerId !== null && this.loggedWinnerId !== this.game.winnerId) {
      this.loggedWinnerId = this.game.winnerId;
      this.addEvent("winner", this.game.winnerId, null, null);
    }
  }

  private maybeReportResult(): void {
    if (this.resultReported || this.game?.phase !== "game-over" || this.currentMatchId === null) return;
    this.resultReported = true;
    const report: AuthoritativeMatchReport = { match_id: this.currentMatchId, players: [...this.matchStats.values()].filter((stats) => this.registeredPlayerIds.has(stats.playerId)).map((stats) => ({ user_id: stats.playerId, won: stats.playerId === this.game?.winnerId, guesses: stats.guesses, correct_guesses: stats.correctGuesses, cards_revealed: stats.cardsRevealed })) };
    void CipherDeckRoom.resultReporter(report).catch((error) => console.error("Failed to persist match result.", error));
  }

  private sendState(client: CipherClient): void {
    const userId = this.userId(client);
    const isSpectator = this.spectatorSessionIds.has(client.sessionId);
    client.send("state", {
      status: this.roomStatus(),
      desiredPlayers: this.desiredPlayers,
      lobbyMode: this.lobbyMode,
      roomCode: this.roomCode,
      settings: { ...this.settings },
      startingSelection: this.startingSelectionView(),
      hostPlayerId: this.hostPlayerId,
      connectedPlayers: this.clients.filter((connected) => !this.spectatorSessionIds.has(connected.sessionId)).length,
      players: [...this.clients.filter((connected) => !this.spectatorSessionIds.has(connected.sessionId)).map((connected) => ({
        id: this.userId(connected),
        displayName: this.displayName(connected),
        accountType: connected.auth?.accountType ?? "registered",
        connected: !this.droppedPlayerIds.has(this.userId(connected)),
        isHost: this.userId(connected) === this.hostPlayerId,
        ready: this.userId(connected) === this.hostPlayerId || this.readyPlayerIds.has(this.userId(connected)),
        isBot: false,
      })), ...this.botPlayerIds.map((id, index) => ({
        id,
        displayName: `Cipher Bot ${index + 1} · ${this.botPersonality(id)[0]!.toUpperCase()}${this.botPersonality(id).slice(1)}`,
        accountType: "registered" as const,
        connected: true,
        isHost: false,
        ready: true,
        isBot: true,
      }))],
      droppedPlayerIds: [...this.droppedPlayerIds],
      reconnectDeadlineMs: this.reconnectDeadlines.size === 0 ? null : Math.min(...this.reconnectDeadlines.values()),
      serverTimeMs: Date.now(),
      turnDeadlineMs: this.turnDeadlineMs,
      game: this.game === null ? null : isSpectator ? projectStateForSpectator(this.game) : projectStateForPlayer(this.game, userId),
      guessHistory: this.guessHistory.map((entry) => structuredClone(entry)),
      deductionMisses: [...this.deductionMisses].map(([targetCardId, guesses]) => ({ targetCardId, guesses: [...guesses.values()].map((guess) => structuredClone(guess)) })),
      eventLog: (this.game?.phase === "game-over" ? this.eventLog : this.eventLog.slice(-40)).map((entry) => structuredClone(entry)),
      matchResult: this.game?.phase === "game-over" ? { winnerPlayerId: this.game.winnerId, stats: [...this.matchStats.values()] } : null,
      isSpectator,
    });
  }

  private startingSelectionView(): StartingSelectionView | null {
    const selection = this.startingSelection;
    if (selection === null) {
      return null;
    }
    const revealCard = (card: Card): Card => {
      const visible = structuredClone(card) as Card;
      visible.revealed = true;
      return visible;
    };
    return {
      phase: selection.phase,
      round: selection.round,
      eligiblePlayerIds: [...selection.eligiblePlayerIds],
      options: selection.options.map((option) => ({
        id: option.card.id,
        selectedByPlayerId: option.selectedByPlayerId,
        card:
          selection.phase === "revealed" && option.selectedByPlayerId !== null
            ? revealCard(option.card)
            : null,
      })),
      resolvedCards: [...selection.resolvedCards.entries()].map(([playerId, card]) => ({
        playerId,
        card: revealCard(card),
      })),
      starterPlayerId: selection.starterPlayerId,
    };
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

  private displayName(client: CipherClient): string {
    return this.roomDisplayNames.get(this.userId(client)) ?? this.authDisplayName(client);
  }

  private authDisplayName(client: CipherClient): string {
    const displayName = client.auth?.displayName;
    if (typeof displayName !== "string" || displayName.trim().length === 0) {
      return `Player · ${this.userId(client).slice(0, 4).toUpperCase()}`;
    }
    return displayName.trim().slice(0, 32);
  }

  private updateGuestDisplayName(client: CipherClient, displayName: string): void {
    if (client.auth?.accountType !== "guest") {
      this.sendError(client, "GUEST_ONLY", "Only Guest players can change a room name.");
      return;
    }
    if (this.game !== null || this.startingSelection !== null) {
      this.sendError(client, "MATCH_ALREADY_STARTED", "Guest names lock when the match starts.");
      return;
    }
    const normalized = displayName.trim().replace(/\s+/gu, " ").slice(0, 32);
    const duplicate = this.clients.some(
      (connected) =>
        connected !== client &&
        this.displayName(connected).localeCompare(normalized, undefined, {
          sensitivity: "accent",
        }) === 0,
    );
    if (duplicate) {
      this.sendError(client, "NAME_TAKEN", "That display name is already used in this room.");
      return;
    }
    this.roomDisplayNames.set(this.userId(client), normalized);
    this.broadcastState();
    client.send("guest-name-updated", { displayName: normalized });
  }

  private async reserveGuestSession(
    client: CipherClient,
  ): Promise<"not-guest" | "created" | "same-room" | "conflict"> {
    const auth = client.auth;
    if (auth?.accountType !== "guest") return "not-guest";
    if (
      typeof auth.guestSessionId !== "string" ||
      typeof auth.expiresAtMs !== "number"
    ) {
      return "conflict";
    }
    const result = await CipherDeckRoom.guestSessions.reserve(
      auth.guestSessionId,
      this.roomId,
      auth.expiresAtMs,
    );
    if (result !== "conflict") this.reservedGuestSessionIds.add(auth.guestSessionId);
    return result;
  }

  private async releaseGuestReservation(client: CipherClient): Promise<void> {
    const guestSessionId = client.auth?.guestSessionId;
    if (client.auth?.accountType !== "guest" || guestSessionId === undefined) return;
    if (await CipherDeckRoom.guestSessions.releaseReservation(guestSessionId, this.roomId)) {
      this.reservedGuestSessionIds.delete(guestSessionId);
    }
  }

  private async releaseUserRoom(userId: string): Promise<void> {
    if (await CipherDeckRoom.userRooms.release(userId, this.roomId)) this.reservedUserIds.delete(userId);
  }

  private isEliminated(userId: string): boolean {
    return (
      this.game?.players.find((player) => player.id === userId)?.eliminated ?? true
    );
  }

  private roomStatus(): RoomStatus {
    if (this.droppedPlayerIds.size > 0 && (this.game !== null || this.startingSelection !== null)) {
      return "paused";
    }
    if (this.startingSelection !== null || this.game?.phase === "starter-place") {
      return "starting";
    }
    if (this.game === null) return "waiting";
    if (this.game.phase === "game-over") {
      return "finished";
    }
    return "playing";
  }

  private async updateStatus(): Promise<void> {
    await this.setMetadata({
      desiredPlayers: this.desiredPlayers,
      status: this.roomStatus(),
      lobbyMode: this.lobbyMode,
      roomCode: this.roomCode,
    });
  }

}
