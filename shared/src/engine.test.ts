import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RuleViolation,
  chooseJokerCount,
  computeInitialHandSizes,
  createDeck,
  createInitialGame,
  deserializeGameState,
  drawCard,
  forfeitPlayer,
  insertCard,
  insertDrawnCard,
  isValidRackOrder,
  projectStateForPlayer,
  resolveGuess,
  serializeGameState,
  type Card,
  type CardColor,
  type GameState,
  type Rank,
  type StandardCard,
  type Suit,
} from "./index.ts";

function opaqueId(sequence: number): string {
  return `opaque-${sequence}`;
}

function standard(
  id: string,
  rank: Rank,
  color: CardColor,
  suit: Suit,
  revealed = false,
): StandardCard {
  return { id, kind: "standard", rank, color, suit, revealed };
}

function fixtureState(overrides: Partial<GameState> = {}): GameState {
  return {
    version: 1,
    players: [
      {
        id: "p1",
        rack: [standard("p1-a", "A", "red", "hearts")],
        eliminated: false,
      },
      {
        id: "p2",
        rack: [standard("p2-7", "7", "black", "clubs")],
        eliminated: false,
      },
      {
        id: "p3",
        rack: [standard("p3-k", "K", "red", "diamonds", true)],
        eliminated: true,
      },
    ],
    drawPile: [],
    currentPlayerIndex: 0,
    phase: "guess",
    pendingDraw: null,
    drawnCardId: null,
    winnerId: null,
    turn: 4,
    ...overrides,
  };
}

describe("deck setup and dealing", () => {
  it("builds 52 standard cards plus two to four Jokers", () => {
    for (const jokerCount of [2, 3, 4]) {
      const deck = createDeck(jokerCount, opaqueId);
      assert.equal(deck.length, 52 + jokerCount);
      assert.equal(deck.filter((card) => card.kind === "joker").length, jokerCount);
      assert.equal(new Set(deck.map((card) => card.id)).size, deck.length);
    }
  });

  it("maps the full random range to two, three, or four Jokers", () => {
    assert.equal(chooseJokerCount(() => 0), 2);
    assert.equal(chooseJokerCount(() => 0.34), 3);
    assert.equal(chooseJokerCount(() => 0.999_999), 4);
  });

  it("deals every supported player count and preserves four draw rounds", () => {
    for (let deckSize = 54; deckSize <= 56; deckSize += 1) {
      for (let playerCount = 3; playerCount <= 6; playerCount += 1) {
        const hands = computeInitialHandSizes(deckSize, playerCount);
        assert.equal(hands[0], (hands[1] ?? 0) + 1);
        assert.equal(hands.at(-1), (hands[1] ?? 0) - 1);
        assert.ok(deckSize - hands.reduce((sum, size) => sum + size, 0) >= playerCount * 4);

        const playerIds = Array.from({ length: playerCount }, (_, index) => `p${index + 1}`);
        const game = createInitialGame(playerIds, createDeck(deckSize - 52, opaqueId));
        assert.deepEqual(
          game.players.map((player) => player.rack.length),
          hands,
        );
        assert.ok(game.players.every((player) => isValidRackOrder(player.rack)));
        assert.ok(game.drawPile.length >= playerCount * 4);
      }
    }
  });
});

describe("rack ordering", () => {
  it("orders by rank, then red before black, while treating suits as equivalent", () => {
    const rack: Card[] = [
      standard("a-red-hearts", "A", "red", "hearts"),
      standard("a-red-diamonds", "A", "red", "diamonds"),
      standard("a-black", "A", "black", "clubs"),
      standard("two-red", "2", "red", "diamonds"),
    ];
    assert.equal(isValidRackOrder(rack), true);
    assert.equal(isValidRackOrder([rack[2]!, rack[0]!]), false);
  });

  it("allows Jokers at any position without weakening standard-card ordering", () => {
    const joker: Card = { id: "joker", kind: "joker", revealed: false };
    const valid = [
      joker,
      standard("a", "A", "black", "spades"),
      joker,
      standard("k", "K", "red", "hearts"),
    ];
    assert.equal(isValidRackOrder(valid), true);
    assert.equal(
      isValidRackOrder([standard("k", "K", "red", "hearts"), joker, standard("a", "A", "red", "hearts")]),
      false,
    );
  });

  it("rejects an insertion that breaks the rack order", () => {
    assert.throws(
      () =>
        insertCard(
          [standard("five", "5", "red", "hearts")],
          standard("four", "4", "black", "clubs"),
          1,
        ),
      (error: unknown) => error instanceof RuleViolation && error.code === "INVALID_INSERTION",
    );
  });
});

describe("authoritative turn resolution", () => {
  it("reveals the targeted card on a correct rank-and-color guess and keeps the turn", () => {
    const state = fixtureState({
      players: [
        { id: "p1", rack: [standard("p1-a", "A", "red", "hearts")], eliminated: false },
        {
          id: "p2",
          rack: [
            standard("target", "7", "black", "clubs"),
            standard("other", "8", "red", "hearts"),
          ],
          eliminated: false,
        },
        { id: "p3", rack: [standard("p3-k", "K", "red", "diamonds")], eliminated: false },
      ],
    });
    const result = resolveGuess(state, {
      actorId: "p1",
      targetPlayerId: "p2",
      targetCardId: "target",
      guess: { kind: "standard", rank: "7", color: "black" },
      selfRevealCardId: null,
    });
    assert.equal(result.correct, true);
    assert.equal(result.nextPlayerId, "p1");
    assert.equal(result.state.players[1]?.rack[0]?.revealed, true);
    assert.equal(state.players[1]?.rack[0]?.revealed, false);
  });

  it("reveals only the selected duplicate rank-and-color card", () => {
    const state = fixtureState({
      players: [
        { id: "p1", rack: [standard("p1-a", "A", "red", "hearts")], eliminated: false },
        {
          id: "p2",
          rack: [
            standard("red-7-diamonds", "7", "red", "diamonds"),
            standard("red-7-hearts", "7", "red", "hearts"),
          ],
          eliminated: false,
        },
        { id: "p3", rack: [standard("p3-k", "K", "black", "clubs")], eliminated: false },
      ],
    });
    const result = resolveGuess(state, {
      actorId: "p1",
      targetPlayerId: "p2",
      targetCardId: "red-7-hearts",
      guess: { kind: "standard", rank: "7", color: "red" },
      selfRevealCardId: null,
    });
    assert.equal(result.state.players[1]?.rack[0]?.revealed, false);
    assert.equal(result.state.players[1]?.rack[1]?.revealed, true);
  });

  it("reveals the inserted draw and advances after a wrong guess", () => {
    const drawn = standard("drawn", "4", "red", "diamonds");
    let state = fixtureState({
      drawPile: [drawn],
      phase: "draw",
    });
    state = drawCard(state, "p1");
    state = insertDrawnCard(state, "p1", 1);
    const result = resolveGuess(state, {
      actorId: "p1",
      targetPlayerId: "p2",
      targetCardId: "p2-7",
      guess: { kind: "standard", rank: "8", color: "black" },
      selfRevealCardId: null,
    });
    assert.equal(result.correct, false);
    assert.equal(result.revealedCardId, "drawn");
    assert.equal(result.state.players[0]?.rack.find((card) => card.id === "drawn")?.revealed, true);
    assert.equal(result.nextPlayerId, "p2");
    assert.equal(result.state.phase, "guess");
  });

  it("uses a chosen own card as the wrong-guess penalty when the pile is empty", () => {
    const state = fixtureState();
    const thirdPlayer = state.players[2];
    assert.ok(thirdPlayer !== undefined);
    thirdPlayer.rack[0]!.revealed = false;
    thirdPlayer.eliminated = false;
    const result = resolveGuess(state, {
      actorId: "p1",
      targetPlayerId: "p2",
      targetCardId: "p2-7",
      guess: { kind: "standard", rank: "7", color: "red" },
      selfRevealCardId: "p1-a",
    });
    assert.equal(result.correct, false);
    assert.equal(result.revealedCardId, "p1-a");
    assert.equal(result.state.players[0]?.eliminated, true);
    assert.equal(result.nextPlayerId, "p2");
  });

  it("rejects out-of-turn actions and resolves a colorless Joker guess", () => {
    assert.throws(
      () => drawCard(fixtureState({ phase: "draw", drawPile: createDeck(2, opaqueId) }), "p2"),
      (error: unknown) => error instanceof RuleViolation && error.code === "INVALID_TURN",
    );
    const state = fixtureState({
      players: [
        { id: "p1", rack: [standard("p1-a", "A", "red", "hearts")], eliminated: false },
        { id: "p2", rack: [{ id: "cipher", kind: "joker", revealed: false }], eliminated: false },
        { id: "p3", rack: [standard("p3-k", "K", "black", "clubs")], eliminated: false },
      ],
    });
    const result = resolveGuess(state, {
      actorId: "p1",
      targetPlayerId: "p2",
      targetCardId: "cipher",
      guess: { kind: "joker" },
      selfRevealCardId: null,
    });
    assert.equal(result.correct, true);
    assert.equal(result.revealedCardId, "cipher");
    assert.equal(result.nextPlayerId, "p1");
  });

  it("ends the game when only one active player remains", () => {
    const result = resolveGuess(fixtureState(), {
      actorId: "p1",
      targetPlayerId: "p2",
      targetCardId: "p2-7",
      guess: { kind: "standard", rank: "7", color: "black" },
      selfRevealCardId: null,
    });
    assert.equal(result.gameOver, true);
    assert.equal(result.winnerId, "p1");
    assert.equal(result.state.players[1]?.eliminated, true);
  });
});

describe("privacy and reconnect state", () => {
  it("never projects hidden opponent values, colors, suits, or Joker identity", () => {
    const state = fixtureState({
      players: [
        { id: "p1", rack: [standard("mine", "A", "red", "hearts")], eliminated: false },
        {
          id: "p2",
          rack: [
            standard("opaque-opponent-1", "Q", "black", "spades"),
            { id: "opaque-opponent-2", kind: "joker", revealed: false },
            standard("shown", "K", "red", "diamonds", true),
          ],
          eliminated: false,
        },
        { id: "p3", rack: [standard("p3", "2", "black", "clubs")], eliminated: false },
      ],
    });
    const view = projectStateForPlayer(state, "p1");
    const opponentRack = view.players[1]?.rack;
    assert.deepEqual(opponentRack?.[0], {
      id: "opaque-opponent-1",
      kind: "hidden",
      revealed: false,
    });
    assert.deepEqual(opponentRack?.[1], {
      id: "opaque-opponent-2",
      kind: "hidden",
      revealed: false,
    });
    assert.equal(opponentRack?.[2]?.kind, "standard");
    assert.doesNotMatch(JSON.stringify(opponentRack?.slice(0, 2)), /Q|black|spades|joker/);
  });

  it("round-trips the authoritative turn state for reconnects", () => {
    const original = fixtureState({
      phase: "insert",
      pendingDraw: standard("pending", "10", "red", "hearts"),
      drawPile: [standard("next", "J", "black", "spades")],
    });
    const restored = deserializeGameState(serializeGameState(original));
    assert.deepEqual(restored, original);
  });

  it("forfeits a timed-out current player without losing a pending draw", () => {
    const state = fixtureState({
      phase: "insert",
      pendingDraw: standard("pending", "10", "red", "hearts"),
      drawPile: [standard("next", "J", "black", "spades")],
      players: [
        { id: "p1", rack: [standard("p1-a", "A", "red", "hearts")], eliminated: false },
        { id: "p2", rack: [standard("p2-7", "7", "black", "clubs")], eliminated: false },
        { id: "p3", rack: [standard("p3-k", "K", "red", "diamonds")], eliminated: false },
      ],
    });
    const forfeited = forfeitPlayer(state, "p1");
    assert.equal(forfeited.players[0]?.eliminated, true);
    assert.equal(forfeited.players[0]?.rack.length, 2);
    assert.ok(forfeited.players[0]?.rack.every((card) => card.revealed));
    assert.equal(forfeited.pendingDraw, null);
    assert.equal(forfeited.players[forfeited.currentPlayerIndex]?.id, "p2");
    assert.equal(forfeited.phase, "draw");
  });
});
