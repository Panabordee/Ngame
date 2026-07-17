import { RuleViolation } from "./errors.ts";
import { insertCard, sortRackKeepingJokers } from "./rack.ts";
import type {
  Card,
  GameState,
  GuessAction,
  GuessResolution,
  PlayerState,
} from "./types.ts";

export function computeInitialHandSizes(deckSize: number, playerCount: number): number[] {
  if (!Number.isInteger(playerCount) || playerCount < 3 || playerCount > 6) {
    throw new RuleViolation(
      "INVALID_PLAYER_COUNT",
      "CipherDeck currently supports between three and six players.",
    );
  }
  if (!Number.isInteger(deckSize) || deckSize < 54 || deckSize > 56) {
    throw new RuleViolation("INVALID_DECK", "The deck must contain 54 to 56 cards.");
  }

  const base = Math.min(8, Math.floor((deckSize - 4 * playerCount) / playerCount));
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

export function createInitialGame(playerIds: readonly string[], shuffledDeck: readonly Card[]): GameState {
  const handSizes = computeInitialHandSizes(shuffledDeck.length, playerIds.length);
  if (new Set(playerIds).size !== playerIds.length) {
    throw new RuleViolation("DUPLICATE_PLAYER", "Player IDs must be unique.");
  }
  if (playerIds.some((playerId) => playerId.length === 0)) {
    throw new RuleViolation("INVALID_PLAYER_COUNT", "Player IDs cannot be empty.");
  }
  assertUniqueCards(shuffledDeck);

  const racks = playerIds.map((): Card[] => []);
  let deckIndex = 0;
  let cardsRemainingToDeal = handSizes.reduce((total, handSize) => total + handSize, 0);

  while (cardsRemainingToDeal > 0) {
    for (let playerIndex = 0; playerIndex < playerIds.length; playerIndex += 1) {
      const rack = racks[playerIndex];
      const handSize = handSizes[playerIndex];
      if (rack === undefined || handSize === undefined || rack.length >= handSize) {
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

  const players: PlayerState[] = playerIds.map((id, index) => ({
    id,
    rack: sortRackKeepingJokers(racks[index] ?? []),
    eliminated: false,
  }));
  const drawPile = structuredClone(shuffledDeck.slice(deckIndex)) as Card[];

  if (drawPile.length < playerIds.length * 4) {
    throw new RuleViolation("INVALID_DECK", "The initial deal must preserve four draw rounds.");
  }

  return {
    version: 1,
    players,
    drawPile,
    currentPlayerIndex: 0,
    phase: "draw",
    pendingDraw: null,
    drawnCardId: null,
    winnerId: null,
    turn: 1,
  };
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
  next.phase = "insert";
  return next;
}

export function insertDrawnCard(
  state: GameState,
  actorId: string,
  rackIndex: number,
): GameState {
  assertActor(state, actorId);
  if (state.phase !== "insert" || state.pendingDraw === null) {
    throw new RuleViolation(
      "WRONG_PHASE",
      "A drawn card can only be inserted during the insert phase.",
    );
  }

  const drawn = state.pendingDraw;
  const next = cloneState(state);
  const actor = currentPlayer(next);
  actor.rack = insertCard(actor.rack, drawn, rackIndex);
  next.pendingDraw = null;
  next.drawnCardId = drawn.id;
  next.phase = "guess";
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
  const actor = currentPlayer(next);
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
  let revealedCardId: string;

  if (correct) {
    targetCard.revealed = true;
    revealedCardId = targetCard.id;
    updateEndGame(next);
  } else if (next.drawnCardId !== null) {
    const penaltyCard = actor.rack.find((card) => card.id === next.drawnCardId);
    if (penaltyCard === undefined) {
      throw new RuleViolation("INVALID_CARD_ID", "The drawn penalty card is missing.");
    }
    penaltyCard.revealed = true;
    revealedCardId = penaltyCard.id;
    updateEndGame(next);
    if (next.phase !== "game-over") {
      advanceTurn(next);
    }
  } else {
    const penaltyCard = actor.rack.find(
      (card) => card.id === action.selfRevealCardId && !card.revealed,
    );
    if (penaltyCard === undefined) {
      throw new RuleViolation(
        "INVALID_TARGET",
        "An empty-pile wrong guess requires an unrevealed self-penalty card.",
      );
    }
    penaltyCard.revealed = true;
    revealedCardId = penaltyCard.id;
    updateEndGame(next);
    if (next.phase !== "game-over") {
      advanceTurn(next);
    }
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
  for (const card of player.rack) {
    card.revealed = true;
  }

  updateEndGame(next);
  if (next.phase !== "game-over" && playerIndex === next.currentPlayerIndex) {
    advanceTurn(next);
  }
  return next;
}
