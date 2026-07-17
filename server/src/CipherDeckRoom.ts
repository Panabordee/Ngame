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
  revealSelfPenalty,
  resolveGuess,
  resolveTurnTimeout,
  serializeGameState,
  shuffleDeck,
  stopGuessingAndPlace,
  type Card,
  type ClientGameView,
  type GameState,
  type LobbyMode,
  type RoomSettings,
  type RoomSettingsAppliedMessage,
  type RoomErrorMessage,
  type RoomStatus,
  type StartingSelectionView,
  type StateEnvelope,
} from "@ngame/shared";

import type { AuthenticatedUser, Authenticator } from "./auth.ts";
import type { ServerConfig } from "./config.ts";
import {
  parseGuessMessage,
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

type CipherClient = Client<{
  auth: AuthenticatedUser;
  messages: {
    state: StateEnvelope;
    error: RoomErrorMessage;
    "settings-applied": RoomSettingsAppliedMessage;
  };
}>;

interface RoomOptions {
  readonly desiredPlayers?: unknown;
  readonly lobbyMode?: unknown;
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

  static runtimeConfig: Pick<
    ServerConfig,
    "reconnectSeconds" | "maxMessagesPerSecond"
  > = {
    reconnectSeconds: 30,
    maxMessagesPerSecond: 20,
  };

  static startingRevealMilliseconds = 1_800;
  static turnTimerMillisecondsOverride: number | null = null;

  private static readonly activeRoomCodes = new Set<string>();

  state = new PublicRoomState();
  private desiredPlayers = 0;
  private lobbyMode: LobbyMode = "public";
  private roomCode: string | null = null;
  private hostPlayerId: string | null = null;
  private settings: RoomSettings = { ...DEFAULT_SETTINGS };
  private startingSelection: StartingSelection | null = null;
  private game: GameState | null = null;
  private readonly droppedPlayerIds = new Set<string>();
  private readonly readyPlayerIds = new Set<string>();
  private startingRevealTimer: ReturnType<typeof setTimeout> | null = null;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private turnDeadlineMs: number | null = null;
  private pausedTurnRemainingMs: number | null = null;

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
    this.onMessage("ready", (client, payload: unknown) => {
      if (typeof payload !== "boolean") {
        this.sendError(client, "INVALID_MESSAGE", "Ready state must be a boolean.");
        return;
      }
      this.setPlayerReady(client, payload);
    });
    this.onMessage("start-game", (client) => {
      void this.requestStartGame(client);
    });
    this.onMessage("update-settings", (client, payload: unknown) => {
      const settings = parseRoomSettings(payload);
      if (settings === null) {
        this.sendError(client, "INVALID_MESSAGE", "Invalid room settings.");
        return;
      }
      this.updateRoomSettings(client, settings);
    });
    this.onMessage("select-starting-card", (client, payload: unknown) => {
      const message = parseSelectStartingCard(payload);
      if (message === null) {
        this.sendError(client, "INVALID_MESSAGE", "Invalid starting-card selection.");
        return;
      }
      this.selectStartingCard(client, message.cardId);
    });
    this.onMessage("place-starting-joker", (client, payload: unknown) => {
      const message = parseInsertMessage(payload);
      if (message === null) {
        this.sendError(client, "INVALID_MESSAGE", "Invalid starting-Joker placement.");
        return;
      }
      this.applyStartingJokerPlacement(client, message.rackIndex);
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
    this.clearStartingRevealTimer();
    this.clearTurnTimer();
    if (this.roomCode !== null) {
      CipherDeckRoom.activeRoomCodes.delete(this.roomCode);
    }
  }

  async onJoin(client: CipherClient): Promise<void> {
    const userId = this.userId(client);
    const duplicate = this.clients.some(
      (connected) => connected !== client && connected.auth?.userId === userId,
    );
    if (duplicate || this.game !== null || this.startingSelection !== null) {
      client.error(409, duplicate ? "User is already in this room." : "Match already started.");
      client.leave(4003);
      return;
    }
    if (this.hostPlayerId === null) {
      this.hostPlayerId = userId;
    }
    await this.updateStatus();
    this.broadcastState();
  }

  async onDrop(client: CipherClient): Promise<void> {
    if (this.startingSelection !== null && this.game === null) {
      const userId = this.userId(client);
      this.droppedPlayerIds.add(userId);
      await this.updateStatus();
      this.broadcastState();
      try {
        await this.allowReconnection(client, CipherDeckRoom.runtimeConfig.reconnectSeconds);
      } catch {
        await this.abortStartingSelection(userId);
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
    this.pauseTurnTimer();
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
    if (this.droppedPlayerIds.size === 0) {
      this.resumeTurnTimer();
    }
    this.broadcastState();
  }

  async onLeave(client: CipherClient): Promise<void> {
    if (this.game === null || this.game.phase === "game-over") {
      const userId = this.userId(client);
      if (this.startingSelection !== null) {
        await this.abortStartingSelection(userId);
      }
      this.readyPlayerIds.delete(userId);
      if (this.hostPlayerId === userId) {
        const nextHost = this.clients.find(
          (connected) => this.userId(connected) !== userId,
        );
        this.hostPlayerId = nextHost === undefined ? null : this.userId(nextHost);
      }
      await this.updateStatus();
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
    const previousTurn = this.game.turn;
    this.game = forfeitPlayer(this.game, userId);
    this.droppedPlayerIds.delete(userId);
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
    const playerIds = this.clients.map((client) => this.userId(client));
    const deck = this.buildMatchDeck();
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
    await this.lock();
    await this.updateStatus();
    this.broadcastState();
  }

  private selectStartingCard(client: CipherClient, cardId: string): void {
    const selection = this.startingSelection;
    const playerId = this.userId(client);
    if (
      selection === null ||
      selection.phase !== "choosing" ||
      !selection.eligiblePlayerIds.includes(playerId)
    ) {
      this.sendError(client, "WRONG_PHASE", "This player cannot select a starting card now.");
      return;
    }
    if (selection.options.some((option) => option.selectedByPlayerId === playerId)) {
      this.sendError(client, "ALREADY_SELECTED", "A starting card has already been selected.");
      return;
    }
    const option = selection.options.find((candidate) => candidate.card.id === cardId);
    if (option === undefined || option.selectedByPlayerId !== null) {
      this.sendError(client, "INVALID_TARGET", "That starting card is unavailable.");
      return;
    }
    option.selectedByPlayerId = playerId;
    if (
      selection.eligiblePlayerIds.every((eligibleId) =>
        selection.options.some((candidate) => candidate.selectedByPlayerId === eligibleId),
      )
    ) {
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
  }

  private finalizeStartingSelection(selection: StartingSelection): void {
    const playerIds = this.clients.map((client) => this.userId(client));
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
  }

  private setPlayerReady(client: CipherClient, ready: boolean): void {
    if (this.game !== null || this.startingSelection !== null) {
      this.sendError(client, "MATCH_ALREADY_STARTED", "Ready state is locked after the match starts.");
      return;
    }
    const userId = this.userId(client);
    if (ready) {
      this.readyPlayerIds.add(userId);
    } else {
      this.readyPlayerIds.delete(userId);
    }
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
    if (this.clients.length < 3) {
      this.sendError(client, "NOT_ENOUGH_PLAYERS", "At least three players are required.");
      return;
    }
    if (this.clients.some((connected) => !this.readyPlayerIds.has(this.userId(connected)))) {
      this.sendError(client, "PLAYERS_NOT_READY", "Every connected player must be ready.");
      return;
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
    this.startingSelection = null;
    this.game = null;
    this.readyPlayerIds.clear();
    this.droppedPlayerIds.delete(droppedPlayerId);
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

  private clearTurnTimer(): void {
    if (this.turnTimer !== null) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    this.turnDeadlineMs = null;
    this.pausedTurnRemainingMs = null;
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
      this.game = transition(this.game, this.userId(client));
      if (this.game.phase === "game-over") {
        this.clearTurnTimer();
      } else {
        this.armTurnTimer();
      }
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
      settings: { ...this.settings },
      startingSelection: this.startingSelectionView(),
      hostPlayerId: this.hostPlayerId,
      connectedPlayers: this.clients.length,
      players: this.clients.map((connected) => ({
        id: this.userId(connected),
        displayName: this.displayName(connected),
        connected: !this.droppedPlayerIds.has(this.userId(connected)),
        isHost: this.userId(connected) === this.hostPlayerId,
        ready: this.readyPlayerIds.has(this.userId(connected)),
      })),
      droppedPlayerIds: [...this.droppedPlayerIds],
      serverTimeMs: Date.now(),
      turnDeadlineMs: this.turnDeadlineMs,
      game: this.game === null ? null : projectStateForPlayer(this.game, userId),
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
    const displayName = client.auth?.displayName;
    if (typeof displayName !== "string" || displayName.trim().length === 0) {
      return `Player · ${this.userId(client).slice(0, 4).toUpperCase()}`;
    }
    return displayName.trim().slice(0, 32);
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
