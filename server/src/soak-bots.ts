import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import {
  RANKS,
  createDeck,
  createInitialGame,
  drawCard,
  insertDrawnCard,
  isValidRackOrder,
  placeStartingJoker,
  revealSelfPenalty,
  resolveGuess,
  shuffleDeck,
  stopGuessingAndPlace,
  validInsertionIndexes,
  type CardGuess,
  type GameState,
} from "@ngame/shared";

interface MatchReport {
  readonly match: number;
  readonly seed: number;
  readonly players: number;
  readonly jokers: number;
  readonly actions: number;
  readonly turns: number;
  readonly emptyPileActions: number;
  readonly winnerId: string;
  readonly durationMs: number;
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

function randomIndex(length: number, random: () => number): number {
  assert.ok(length > 0);
  return Math.min(length - 1, Math.floor(random() * length));
}

function randomGuess(random: () => number): CardGuess {
  if (random() < 1 / 27) return { kind: "joker" };
  return {
    kind: "standard",
    rank: RANKS[randomIndex(RANKS.length, random)]!,
    color: random() < 0.5 ? "red" : "black",
  };
}

function assertInvariants(state: GameState, initialCardIds: ReadonlySet<string>): void {
  for (const player of state.players) assert.equal(isValidRackOrder(player.rack), true);
  const cards = [
    ...state.players.flatMap((player) => player.rack),
    ...state.drawPile,
    ...(state.pendingDraw === null ? [] : [state.pendingDraw]),
  ];
  assert.equal(cards.length, initialCardIds.size, "A card disappeared or was duplicated.");
  assert.equal(new Set(cards.map((card) => card.id)).size, cards.length, "Duplicate card ID found.");
  assert.deepEqual(new Set(cards.map((card) => card.id)), initialCardIds);
  const activePlayers = state.players.filter((player) => !player.eliminated);
  if (state.phase === "game-over") {
    assert.equal(activePlayers.length, 1);
    assert.equal(state.winnerId, activePlayers[0]?.id);
  } else {
    assert.ok(activePlayers.length >= 2);
    assert.equal(state.players[state.currentPlayerIndex]?.eliminated, false);
  }
}

function placeAllOpeningJokers(state: GameState, random: () => number): GameState {
  let next = state;
  while (next.phase === "starter-place") {
    const entry = Object.entries(next.pendingStartingJokerCardIdsByPlayer)[0];
    assert.notEqual(entry, undefined);
    const [playerId, pendingIds] = entry!;
    const player = next.players.find((candidate) => candidate.id === playerId)!;
    const placedRackLength = player.rack.length - pendingIds.length;
    next = placeStartingJoker(next, playerId, randomIndex(placedRackLength + 1, random));
  }
  return next;
}

function runMatch(match: number, seed: number): MatchReport {
  const random = seededRandom(seed);
  const playerCount = 3 + (match - 1) % 4;
  const jokerCount = 2 + (match - 1) % 3;
  let sequence = 0;
  const deck = shuffleDeck(createDeck(jokerCount, () => `m${match}-c${sequence++}`), random);
  const initialCardIds = new Set(deck.map((card) => card.id));
  const playerIds = Array.from({ length: playerCount }, (_, index) => `bot-${index + 1}`);
  let state = placeAllOpeningJokers(createInitialGame(playerIds, deck), random);
  let actions = 0;
  let emptyPileActions = 0;
  const startedAt = performance.now();

  while (state.phase !== "game-over") {
    assert.ok(actions < 20_000, `Match ${match} stalled at phase ${state.phase}, turn ${state.turn}.`);
    assertInvariants(state, initialCardIds);
    const actor = state.players[state.currentPlayerIndex]!;
    if (state.drawPile.length === 0) emptyPileActions += 1;

    if (state.phase === "draw") {
      state = drawCard(state, actor.id);
    } else if (state.phase === "guess") {
      if (state.pendingDraw !== null && state.correctGuessesThisTurn > 0 && random() < 0.62) {
        state = stopGuessingAndPlace(state, actor.id);
      } else {
        const targets = state.players
          .filter((player) => player.id !== actor.id && !player.eliminated)
          .flatMap((player) => player.rack.filter((card) => !card.revealed).map((card) => ({ playerId: player.id, cardId: card.id })));
        assert.ok(targets.length > 0, "Guess phase has no legal opponent target.");
        const target = targets[randomIndex(targets.length, random)]!;
        state = resolveGuess(state, { actorId: actor.id, targetPlayerId: target.playerId, targetCardId: target.cardId, guess: randomGuess(random) }).state;
      }
    } else if (state.phase === "place" || state.phase === "penalty-place") {
      assert.notEqual(state.pendingDraw, null);
      const slots = validInsertionIndexes(actor.rack, state.pendingDraw!);
      assert.ok(slots.length > 0);
      state = insertDrawnCard(state, actor.id, slots[randomIndex(slots.length, random)]!);
    } else if (state.phase === "self-penalty") {
      const ownTargets = actor.rack.filter((card) => !card.revealed);
      assert.ok(ownTargets.length > 0);
      state = revealSelfPenalty(state, actor.id, ownTargets[randomIndex(ownTargets.length, random)]!.id);
    } else {
      assert.fail(`Unexpected phase: ${state.phase}`);
    }
    actions += 1;
  }

  assertInvariants(state, initialCardIds);
  return {
    match,
    seed,
    players: playerCount,
    jokers: jokerCount,
    actions,
    turns: state.turn,
    emptyPileActions,
    winnerId: state.winnerId!,
    durationMs: performance.now() - startedAt,
  };
}

const matchCount = Number(process.argv[2] ?? 10);
assert.ok(Number.isSafeInteger(matchCount) && matchCount > 0 && matchCount <= 1_000);
const reports = Array.from({ length: matchCount }, (_, index) => runMatch(index + 1, 0xc1f3_0000 + index * 7_919));
for (const report of reports) {
  console.log(`match=${report.match} seed=${report.seed} players=${report.players} jokers=${report.jokers} actions=${report.actions} turns=${report.turns} emptyPileActions=${report.emptyPileActions} winner=${report.winnerId} durationMs=${report.durationMs.toFixed(1)}`);
}
console.log(`summary matches=${reports.length} actions=${reports.reduce((sum, report) => sum + report.actions, 0)} turns=${reports.reduce((sum, report) => sum + report.turns, 0)} durationMs=${reports.reduce((sum, report) => sum + report.durationMs, 0).toFixed(1)}`);
