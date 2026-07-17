import { RuleViolation } from "./errors.ts";
import { insertCard, sortRackKeepingJokers, validInsertionIndexes } from "./rack.ts";
import type {
  Card,
  GameState,
  GuessAction,
  GuessResolution,
  PlayerState,
  RandomSource,
  StartingCardAssignment,
} from "./types.ts";

export function computeInitialHandSizes(
  deckSize: number,
  playerCount: number,
  drawRounds = 4,
): number[] {
  if (!Number.isInteger(playerCount) || playerCount < 3 || playerCount > 6) {
    throw new RuleViolation(
      "INVALID_PLAYER_COUNT",
      "CipherDeck currently supports between three and six players.",
    );
  }
  if (!Number.isInteger(drawRounds) || drawRounds < 1 || drawRounds > 8) {
    throw new RuleViolation("INVALID_DRAW_ROUNDS", "Draw rounds must be between one and eight.");
  }
  if (!Number.isInteger(deckSize) || deckSize < 24 || deckSize > 56) {
    throw new RuleViolation("INVALID_DECK", "The deck must contain 24 to 56 cards.");
  }

  const base = Math.min(
    8,
    Math.floor((deckSize - drawRounds * playerCount) / playerCount),
  );
  if (base < 2) {
    throw new RuleViolation(
      "INVALID_DECK",
      "The deck is too small for the player count and draw-round reserve.",
    );
  }
  return Array.from({ length: playerCount }, (_, index) => {
    if (index === 0) {
      return base + 1;
    }
    if (index === playerCount - 1) {
      return base - 1;
    }
    return base;
  });
}

function assertUniqueCards(deck: readonly Card[]): void {
  if (new Set(deck.map((card) => card.id)).size !== deck.length) {
    throw new RuleViolation("INVALID_CARD_ID", "Every card must have a unique opaque ID.");
  }
}

interface InitialGameOptions {
  readonly drawRounds: number;
  readonly startingCards: readonly StartingCardAssignment[];
  readonly startingPlayerId: string | null;
}

function createGame(
  playerIds: readonly string[],
  shuffledDeck: readonly Card[],
  options: InitialGameOptions,
): GameState {
  const totalDeckSize = shuffledDeck.length + options.startingCards.length;
  const turnOrderHandSizes = computeInitialHandSizes(
    totalDeckSize,
    playerIds.length,
    options.drawRounds,
  );
  if (new Set(playerIds).size !== playerIds.length) {
    throw new RuleViolation("DUPLICATE_PLAYER", "Player IDs must be unique.");
  }
  if (playerIds.some((playerId) => playerId.length === 0)) {
    throw new RuleViolation("INVALID_PLAYER_COUNT", "Player IDs cannot be empty.");
  }
  const startingPlayerIndex = options.startingPlayerId === null
    ? 0
    : playerIds.indexOf(options.startingPlayerId);
  if (startingPlayerIndex < 0) {
    throw new RuleViolation("INVALID_STARTING_PLAYER", "The starting player is not in this match.");
  }
  const handSizes = playerIds.map((_, playerIndex) => {
    const turnOffset =
      (playerIndex - startingPlayerIndex + playerIds.length) % playerIds.length;
    const handSize = turnOrderHandSizes[turnOffset];
    if (handSize === undefined) {
      throw new RuleViolation("INVALID_PLAYER_COUNT", "A player has no initial hand size.");
    }
    return handSize;
  });
  assertUniqueCards([
    ...shuffledDeck,
    ...options.startingCards.map((assignment) => assignment.card),
  ]);
  if (
    options.startingCards.length !== 0 &&
    (options.startingCards.length !== playerIds.length ||
      new Set(options.startingCards.map((assignment) => assignment.playerId)).size !==
        playerIds.length ||
      options.startingCards.some((assignment) => !playerIds.includes(assignment.playerId)))
  ) {
    throw new RuleViolation(
      "INVALID_STARTING_CARDS",
      "Starting-card assignments must contain exactly one card for every player.",
    );
  }

  const racks = playerIds.map((): Card[] => []);
  let deckIndex = 0;
  let cardsRemainingToDeal = handSizes.reduce((total, handSize) => total + handSize, 0) -
    options.startingCards.length;

  while (cardsRemainingToDeal > 0) {
    for (let playerIndex = 0; playerIndex < playerIds.length; playerIndex += 1) {
      const rack = racks[playerIndex];
      const handSize = handSizes[playerIndex];
      const reservedStartingCard = options.startingCards.some(
        (assignment) => assignment.playerId === playerIds[playerIndex],
      );
      const dealtHandSize = handSize === undefined ? undefined : handSize - (reservedStartingCard ? 1 : 0);
      if (rack === undefined || dealtHandSize === undefined || rack.length >= dealtHandSize) {
        continue;
      }
      const card = shuffledDeck[deckIndex];
      if (card === undefined) {
        throw new RuleViolation("INVALID_DECK", "The deck ran out while dealing.");
      }
      rack.push(structuredClone(card) as Card);
      deckIndex += 1;
      cardsRemainingToDeal -= 1;
    }
  }

  const startingCardIds: Record<string, string> = {};
  const pendingStartingJokerCardIdsByPlayer: Record<string, string[]> = {};
  const players: PlayerState[] = playerIds.map((id, index) => {
    let rack = sortRackKeepingJokers(racks[index] ?? []);
    const assignment = options.startingCards.find((candidate) => candidate.playerId === id);
    if (assignment !== undefined) {
      const startingCard = structuredClone(assignment.card) as Card;
      startingCard.revealed = true;
      startingCardIds[id] = startingCard.id;
      if (startingCard.kind === "joker") {
        rack = insertCard(rack, startingCard, rack.length);
      } else {
        const insertionIndex = validInsertionIndexes(rack, startingCard)[0];
        if (insertionIndex === undefined) {
          throw new RuleViolation("INVALID_STARTING_CARDS", "A starting card has no legal rack slot.");
        }
        rack = insertCard(rack, startingCard, insertionIndex);
      }
    }
    const jokerCardIds = rack
      .filter((card) => card.kind === "joker")
      .map((card) => card.id);
    if (jokerCardIds.length > 0) {
      pendingStartingJokerCardIdsByPlayer[id] = jokerCardIds;
    }
    return { id, rack, eliminated: false };
  });
  const drawPile = structuredClone(shuffledDeck.slice(deckIndex)) as Card[];

  if (drawPile.length < playerIds.length * options.drawRounds) {
    throw new RuleViolation("INVALID_DECK", "The initial deal does not preserve the draw reserve.");
  }

  return {
    version: 1,
    players,
    drawPile,
    currentPlayerIndex: startingPlayerIndex,
    phase: Object.values(pendingStartingJokerCardIdsByPlayer).some(
      (cardIds) => cardIds.length > 0,
    )
      ? "starter-place"
      : "draw",
    pendingDraw: null,
    drawnCardId: null,
    correctGuessesThisTurn: 0,
    startingCardIds,
    pendingStartingJokerCardIdsByPlayer,
    winnerId: null,
    turn: 1,
  };
}

export function createInitialGame(
  playerIds: readonly string[],
  shuffledDeck: readonly Card[],
): GameState {
  return createGame(playerIds, shuffledDeck, {
    drawRounds: 4,
    startingCards: [],
    startingPlayerId: null,
  });
}

export function createInitialGameWithStartingCards(
  playerIds: readonly string[],
  shuffledDeckWithoutStartingCards: readonly Card[],
  startingCards: readonly StartingCardAssignment[],
  startingPlayerId: string,
  drawRounds: number,
): GameState {
  return createGame(playerIds, shuffledDeckWithoutStartingCards, {
    drawRounds,
    startingCards,
    startingPlayerId,
  });
}

function cloneState(state: GameState): GameState {
  return structuredClone(state) as GameState;
}

function currentPlayer(state: GameState): PlayerState {
  const player = state.players[state.currentPlayerIndex];
  if (player === undefined) {
    throw new RuleViolation("INVALID_TURN", "The current player index is invalid.");
  }
  return player;
}

function assertActor(state: GameState, actorId: string): PlayerState {
  if (state.phase === "game-over") {
    throw new RuleViolation("GAME_OVER", "The game has already ended.");
  }
  const actor = currentPlayer(state);
  if (actor.id !== actorId || actor.eliminated) {
    throw new RuleViolation("INVALID_TURN", "Only the active player may act.");
  }
  return actor;
}

export function hasPendingStartingJokerPlacements(
  state: GameState,
): boolean {
  return Object.values(state.pendingStartingJokerCardIdsByPlayer).some(
    (cardIds) => cardIds.length > 0,
  );
}

export function placeStartingJoker(
  state: GameState,
  playerId: string,
  rackIndex: number,
): GameState {
  if (
    state.phase !== "starter-place" ||
    (state.pendingStartingJokerCardIdsByPlayer[playerId]?.length ?? 0) === 0
  ) {
    throw new RuleViolation(
      "WRONG_PHASE",
      "This player does not have an opening-hand Joker awaiting placement.",
    );
  }
  const next = cloneState(state);
  const player = next.players.find((candidate) => candidate.id === playerId);
  const pendingCardIds = next.pendingStartingJokerCardIdsByPlayer[playerId] ?? [];
  const jokerCardId = pendingCardIds[0];
  if (player === undefined || jokerCardId === undefined) {
    throw new RuleViolation("INVALID_TARGET", "The opening-hand Joker could not be found.");
  }
  const currentIndex = player.rack.findIndex((card) => card.id === jokerCardId);
  const joker = player.rack[currentIndex];
  if (currentIndex < 0 || joker?.kind !== "joker") {
    throw new RuleViolation("INVALID_TARGET", "The pending opening-hand card is not a Joker.");
  }
  const pendingIdSet = new Set(pendingCardIds);
  const placedRack = player.rack.filter((card) => !pendingIdSet.has(card.id));
  const remainingPendingCards = player.rack.filter(
    (card) => pendingIdSet.has(card.id) && card.id !== jokerCardId,
  );
  player.rack = [
    ...insertCard(placedRack, joker, rackIndex),
    ...remainingPendingCards,
  ];
  const remainingCardIds = pendingCardIds.slice(1);
  if (remainingCardIds.length === 0) {
    delete next.pendingStartingJokerCardIdsByPlayer[playerId];
  } else {
    next.pendingStartingJokerCardIdsByPlayer[playerId] = remainingCardIds;
  }
  if (!hasPendingStartingJokerPlacements(next)) {
    next.phase = "draw";
  }
  return next;
}

export function resolveTurnTimeout(state: GameState, _random: RandomSource): GameState {
  if (state.phase === "game-over") {
    throw new RuleViolation("WRONG_PHASE", "A turn timer is not active after the game ends.");
  }
  if (state.phase === "starter-place") {
    let next = cloneState(state);
    const timedOutPlayerIds = Object.entries(next.pendingStartingJokerCardIdsByPlayer)
      .filter(([, cardIds]) => cardIds.length > 0)
      .map(([playerId]) => playerId);
    for (const playerId of timedOutPlayerIds) {
      if (next.phase === "game-over") break;
      const player = next.players.find((candidate) => candidate.id === playerId);
      if (player !== undefined && !player.eliminated) {
        next = forfeitPlayer(next, playerId);
      }
    }
    return next;
  }
  return forfeitPlayer(state, currentPlayer(state).id);
}

export function drawCard(state: GameState, actorId: string): GameState {
  assertActor(state, actorId);
  if (state.phase !== "draw") {
    throw new RuleViolation("WRONG_PHASE", "A card can only be drawn during the draw phase.");
  }

  const next = cloneState(state);
  const drawn = next.drawPile.shift();
  if (drawn === undefined) {
    throw new RuleViolation("INVALID_DECK", "The draw pile is empty.");
  }
  next.pendingDraw = drawn;
  next.drawnCardId = drawn.id;
  next.correctGuessesThisTurn = 0;
  next.phase = "guess";
  return next;
}

export function stopGuessingAndPlace(state: GameState, actorId: string): GameState {
  assertActor(state, actorId);
  if (
    state.phase !== "guess" ||
    state.pendingDraw === null ||
    state.correctGuessesThisTurn < 1
  ) {
    throw new RuleViolation(
      "WRONG_PHASE",
      "A player may stop and place only after a correct guess with a pending card.",
    );
  }

  const next = cloneState(state);
  next.phase = "place";
  return next;
}

export function insertDrawnCard(
  state: GameState,
  actorId: string,
  rackIndex: number,
): GameState {
  assertActor(state, actorId);
  if (
    (state.phase !== "place" && state.phase !== "penalty-place") ||
    state.pendingDraw === null
  ) {
    throw new RuleViolation(
      "WRONG_PHASE",
      "A drawn card can only be inserted during a placement phase.",
    );
  }

  const drawn = state.pendingDraw;
  const next = cloneState(state);
  const actor = currentPlayer(next);
  actor.rack = insertCard(actor.rack, drawn, rackIndex);
  next.pendingDraw = null;
  next.drawnCardId = drawn.id;
  updateEndGame(next);
  if (next.phase !== "game-over") {
    advanceTurn(next);
  }
  return next;
}

function updateEndGame(state: GameState): void {
  for (const player of state.players) {
    player.eliminated = player.rack.length > 0 && player.rack.every((card) => card.revealed);
  }
  const activePlayers = state.players.filter((player) => !player.eliminated);
  if (activePlayers.length <= 1) {
    state.phase = "game-over";
    state.winnerId = activePlayers[0]?.id ?? null;
  }
}

function advanceTurn(state: GameState): void {
  for (let offset = 1; offset <= state.players.length; offset += 1) {
    const candidateIndex = (state.currentPlayerIndex + offset) % state.players.length;
    const candidate = state.players[candidateIndex];
    if (candidate !== undefined && !candidate.eliminated) {
      state.currentPlayerIndex = candidateIndex;
      state.phase = state.drawPile.length > 0 ? "draw" : "guess";
      state.drawnCardId = null;
      state.pendingDraw = null;
      state.correctGuessesThisTurn = 0;
      state.turn += 1;
      return;
    }
  }
  updateEndGame(state);
}

export function resolveGuess(state: GameState, action: GuessAction): GuessResolution {
  assertActor(state, action.actorId);
  if (state.phase !== "guess") {
    throw new RuleViolation("WRONG_PHASE", "Guesses are only accepted during the guess phase.");
  }
  if (action.actorId === action.targetPlayerId) {
    throw new RuleViolation("INVALID_TARGET", "A player cannot guess their own card.");
  }

  const next = cloneState(state);
  const targetPlayer = next.players.find((player) => player.id === action.targetPlayerId);
  if (targetPlayer === undefined || targetPlayer.eliminated) {
    throw new RuleViolation("INVALID_TARGET", "The target player is not active.");
  }
  const targetCard = targetPlayer.rack.find((card) => card.id === action.targetCardId);
  if (targetCard === undefined || targetCard.revealed) {
    throw new RuleViolation("INVALID_TARGET", "The target card is unavailable.");
  }
  const correct =
    targetCard.kind === "joker"
      ? action.guess.kind === "joker"
      : action.guess.kind === "standard" &&
        targetCard.rank === action.guess.rank &&
        targetCard.color === action.guess.color;
  let revealedCardId: string | null = null;

  if (correct) {
    targetCard.revealed = true;
    revealedCardId = targetCard.id;
    updateEndGame(next);
    if (next.phase !== "game-over") {
      if (next.pendingDraw !== null) {
        next.correctGuessesThisTurn += 1;
      } else {
        advanceTurn(next);
      }
    }
  } else if (next.pendingDraw !== null) {
    next.pendingDraw.revealed = true;
    revealedCardId = next.pendingDraw.id;
    next.phase = "penalty-place";
  } else {
    next.phase = "self-penalty";
  }

  const nextPlayerId = next.phase === "game-over" ? null : currentPlayer(next).id;
  return {
    state: next,
    correct,
    revealedCardId,
    nextPlayerId,
    gameOver: next.phase === "game-over",
    winnerId: next.winnerId,
  };
}

export function revealSelfPenalty(
  state: GameState,
  actorId: string,
  cardId: string,
): GameState {
  assertActor(state, actorId);
  if (state.phase !== "self-penalty" || state.pendingDraw !== null) {
    throw new RuleViolation(
      "WRONG_PHASE",
      "A self-penalty card can only be revealed after a wrong empty-pile guess.",
    );
  }

  const next = cloneState(state);
  const actor = currentPlayer(next);
  const penaltyCard = actor.rack.find((card) => card.id === cardId && !card.revealed);
  if (penaltyCard === undefined) {
    throw new RuleViolation(
      "INVALID_TARGET",
      "The self-penalty must be one of the active player's unrevealed cards.",
    );
  }
  penaltyCard.revealed = true;
  updateEndGame(next);
  if (next.phase !== "game-over") {
    advanceTurn(next);
  }
  return next;
}

export function forfeitPlayer(state: GameState, playerId: string): GameState {
  if (state.phase === "game-over") {
    throw new RuleViolation("GAME_OVER", "The game has already ended.");
  }
  const next = cloneState(state);
  const playerIndex = next.players.findIndex((player) => player.id === playerId);
  const player = next.players[playerIndex];
  if (player === undefined || player.eliminated) {
    throw new RuleViolation("INVALID_TARGET", "The forfeiting player is not active.");
  }

  if (playerIndex === next.currentPlayerIndex && next.pendingDraw !== null) {
    const pendingDraw = next.pendingDraw;
    pendingDraw.revealed = true;
    player.rack = sortRackKeepingJokers([...player.rack, pendingDraw]);
    next.pendingDraw = null;
    next.drawnCardId = pendingDraw.id;
  }
  const wasStartingJokerPlacement = next.phase === "starter-place";
  if (wasStartingJokerPlacement) {
    delete next.pendingStartingJokerCardIdsByPlayer[playerId];
  }
  for (const card of player.rack) {
    card.revealed = true;
  }

  updateEndGame(next);
  if (next.phase !== "game-over" && wasStartingJokerPlacement) {
    if (playerIndex === next.currentPlayerIndex) {
      for (let offset = 1; offset <= next.players.length; offset += 1) {
        const candidateIndex = (playerIndex + offset) % next.players.length;
        if (next.players[candidateIndex]?.eliminated === false) {
          next.currentPlayerIndex = candidateIndex;
          break;
        }
      }
    }
    next.phase = hasPendingStartingJokerPlacements(next) ? "starter-place" : "draw";
    return next;
  }
  if (next.phase !== "game-over" && playerIndex === next.currentPlayerIndex) {
    advanceTurn(next);
  }
  return next;
}
