import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RuleViolation,
  chooseJokerCount,
  computeInitialHandSizes,
  createCustomDeck,
  createDeck,
  createInitialGame,
  createInitialGameWithStartingCards,
  deserializeGameState,
  drawCard,
  drawFreshStartingCards,
  forfeitPlayer,
  highestStartingPlayerIds,
  insertCard,
  insertDrawnCard,
  isValidRackOrder,
  placeStartingJoker,
  projectStateForPlayer,
  revealSelfPenalty,
  resolveGuess,
  resolveTurnTimeout,
  serializeGameState,
  stopGuessingAndPlace,
  validInsertionIndexes,
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
    correctGuessesThisTurn: 0,
    startingCardIds: {},
    pendingStartingJokerCardIdsByPlayer: {},
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

  it("builds a custom 40-card deck and preserves a two-round reserve for five players", () => {
    let randomValue = 0;
    const random = () => {
      randomValue = (randomValue + 0.371) % 1;
      return randomValue;
    };
    const deck = createCustomDeck(40, 3, random, opaqueId);
    assert.equal(deck.length, 40);
    assert.equal(deck.filter((card) => card.kind === "joker").length, 3);
    assert.equal(new Set(deck.map((card) => card.id)).size, 40);
    assert.deepEqual(computeInitialHandSizes(40, 5, 2), [7, 6, 6, 6, 5]);
  });

  it("counts revealed starting cards in each hand and lets the winner start", () => {
    const deck = createDeck(2, opaqueId);
    const assignments = [
      { playerId: "p1", card: deck[0]! },
      { playerId: "p2", card: deck[13]! },
      { playerId: "p3", card: deck[26]! },
    ];
    const assignedIds = new Set(assignments.map((assignment) => assignment.card.id));
    const game = createInitialGameWithStartingCards(
      ["p1", "p2", "p3"],
      deck.filter((card) => !assignedIds.has(card.id)),
      assignments,
      "p2",
      4,
    );
    assert.deepEqual(game.players.map((player) => player.rack.length), [7, 9, 8]);
    assert.equal(game.players[game.currentPlayerIndex]?.id, "p2");
    assert.equal(game.phase, "draw");
    for (const assignment of assignments) {
      const card = game.players
        .find((player) => player.id === assignment.playerId)
        ?.rack.find((candidate) => candidate.id === assignment.card.id);
      assert.equal(card?.revealed, true);
    }
  });

  it("requires every opening-hand Joker owner to choose any rack slot", () => {
    const deck = createDeck(3, opaqueId);
    const selectedJoker = deck.find((card) => card.kind === "joker")!;
    const assignments = [
      { playerId: "p1", card: deck[0]! },
      { playerId: "p2", card: selectedJoker },
      { playerId: "p3", card: deck[26]! },
    ];
    const assignedIds = new Set(assignments.map((assignment) => assignment.card.id));
    const remainingDeck = deck.filter((card) => !assignedIds.has(card.id));
    const dealtJokers = remainingDeck.filter((card) => card.kind === "joker");
    const remainingStandards = remainingDeck.filter((card) => card.kind === "standard");
    const dealingDeck = [
      dealtJokers[0]!,
      remainingStandards[0]!,
      remainingStandards[1]!,
      dealtJokers[1]!,
      ...remainingStandards.slice(2),
    ];
    const initial = createInitialGameWithStartingCards(
      ["p1", "p2", "p3"],
      dealingDeck,
      assignments,
      "p2",
      4,
    );
    assert.equal(initial.phase, "starter-place");
    assert.deepEqual(initial.pendingStartingJokerCardIdsByPlayer, {
      p1: dealtJokers.map((card) => card.id),
      p2: [selectedJoker.id],
    });
    const opponentSetupView = projectStateForPlayer(initial, "p3");
    assert.deepEqual(opponentSetupView.pendingStartingJokerCardIds, []);
    assert.equal(
      dealtJokers.some((joker) => JSON.stringify(opponentSetupView).includes(joker.id)),
      false,
    );
    assert.deepEqual(
      projectStateForPlayer(initial, "p1").pendingStartingJokerCardIds,
      dealtJokers.map((card) => card.id),
    );

    const p2RackLengthWithoutPending = initial.players[1]!.rack.length - 1;
    for (let rackIndex = 0; rackIndex <= p2RackLengthWithoutPending; rackIndex += 1) {
      const placed = placeStartingJoker(initial, "p2", rackIndex);
      assert.equal(placed.players[1]?.rack[rackIndex]?.id, selectedJoker.id);
      assert.equal(placed.phase, "starter-place");
      assert.deepEqual(placed.pendingStartingJokerCardIdsByPlayer, {
        p1: dealtJokers.map((card) => card.id),
      });
    }

    const firstP1JokerPlaced = placeStartingJoker(initial, "p1", 0);
    assert.deepEqual(firstP1JokerPlaced.pendingStartingJokerCardIdsByPlayer.p1, [
      dealtJokers[1]!.id,
    ]);
    const allP1JokersPlaced = placeStartingJoker(firstP1JokerPlaced, "p1", 1);
    const allPlaced = placeStartingJoker(allP1JokersPlaced, "p2", 2);
    assert.equal(allPlaced.phase, "draw");
    assert.deepEqual(allPlaced.pendingStartingJokerCardIdsByPlayer, {});
  });

  it("redraws equal highest ranks and multiple Jokers from a fresh set", () => {
    assert.deepEqual(
      highestStartingPlayerIds([
        { playerId: "p1", card: standard("king-red", "K", "red", "hearts") },
        { playerId: "p2", card: standard("king-black", "K", "black", "clubs") },
        { playerId: "p3", card: standard("queen", "Q", "red", "diamonds") },
      ]),
      ["p1", "p2"],
    );
    assert.deepEqual(
      highestStartingPlayerIds([
        { playerId: "p1", card: { id: "joker-1", kind: "joker", revealed: false } },
        { playerId: "p2", card: { id: "joker-2", kind: "joker", revealed: false } },
      ]),
      ["p1", "p2"],
    );

    const cards = createDeck(2, opaqueId).slice(0, 12);
    const precedingIds = new Set(cards.slice(0, 6).map((card) => card.id));
    const fresh = drawFreshStartingCards(cards, precedingIds, () => 0);
    assert.equal(fresh.selected.length, 6);
    assert.equal(fresh.selected.every((card) => !precedingIds.has(card.id)), true);
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

  it("returns every legal duplicate slot and every slot for a Joker", () => {
    const rack = [
      standard("red-7-a", "7", "red", "diamonds"),
      standard("red-7-b", "7", "red", "hearts"),
      standard("black-7", "7", "black", "clubs"),
    ];
    assert.deepEqual(
      validInsertionIndexes(rack, standard("red-7-c", "7", "red", "hearts")),
      [0, 1, 2],
    );
    assert.deepEqual(
      validInsertionIndexes(rack, { id: "joker", kind: "joker", revealed: false }),
      [0, 1, 2, 3],
    );
  });
});

describe("authoritative turn resolution", () => {
  it("eliminates a player who lets an action timer expire", () => {
    const activePlayers = [
      { id: "p1", rack: [standard("p1-a", "A", "red", "hearts")], eliminated: false },
      { id: "p2", rack: [standard("p2-7", "7", "black", "clubs")], eliminated: false },
      { id: "p3", rack: [standard("p3-k", "K", "red", "diamonds")], eliminated: false },
    ];
    const skipped = resolveTurnTimeout(
      fixtureState({
        players: activePlayers,
        phase: "draw",
        drawPile: [standard("draw", "4", "red", "hearts")],
      }),
      () => 0,
    );
    assert.equal(skipped.currentPlayerIndex, 1);
    assert.equal(skipped.turn, 5);
    assert.equal(skipped.players[0]?.eliminated, true);
    assert.equal(skipped.players[0]?.rack.every((card) => card.revealed), true);

    const pending = resolveTurnTimeout(
      fixtureState({
        players: activePlayers,
        phase: "guess",
        pendingDraw: standard("pending-timeout", "4", "red", "hearts"),
      }),
      () => 0,
    );
    const timedOutCard = pending.players[0]?.rack.find(
      (card) => card.id === "pending-timeout",
    );
    assert.equal(timedOutCard?.revealed, true);
    assert.equal(pending.players[0]?.eliminated, true);
    assert.equal(pending.currentPlayerIndex, 1);

    const penalized = resolveTurnTimeout(fixtureState({ players: activePlayers }), () => 0);
    assert.equal(penalized.players[0]?.rack[0]?.revealed, true);
    assert.equal(penalized.players[0]?.eliminated, true);
    assert.equal(penalized.currentPlayerIndex, 1);
    assert.equal(penalized.phase, "guess");
  });

  it("eliminates every Joker owner who ignores opening placement", () => {
    const timedOut = resolveTurnTimeout(
      fixtureState({
        phase: "starter-place",
        players: [
          {
            id: "p1",
            rack: [{ id: "p1-joker", kind: "joker", revealed: false }],
            eliminated: false,
          },
          {
            id: "p2",
            rack: [{ id: "p2-joker", kind: "joker", revealed: true }],
            eliminated: false,
          },
          { id: "p3", rack: [standard("p3-k", "K", "red", "diamonds")], eliminated: false },
        ],
        pendingStartingJokerCardIdsByPlayer: {
          p1: ["p1-joker"],
          p2: ["p2-joker"],
        },
      }),
      () => 0,
    );
    assert.equal(timedOut.players[0]?.eliminated, true);
    assert.equal(timedOut.players[1]?.eliminated, true);
    assert.equal(timedOut.phase, "game-over");
    assert.equal(timedOut.winnerId, "p3");
  });

  it("requires a guess before placement, then allows stop and hidden placement after a correct guess", () => {
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
      pendingDraw: standard("drawn", "9", "red", "hearts"),
      drawnCardId: "drawn",
    });
    assert.throws(
      () => insertDrawnCard(state, "p1", 1),
      (error: unknown) => error instanceof RuleViolation && error.code === "WRONG_PHASE",
    );
    assert.throws(
      () => stopGuessingAndPlace(state, "p1"),
      (error: unknown) => error instanceof RuleViolation && error.code === "WRONG_PHASE",
    );
    const result = resolveGuess(state, {
      actorId: "p1",
      targetPlayerId: "p2",
      targetCardId: "target",
      guess: { kind: "standard", rank: "7", color: "black" },
    });
    assert.equal(result.correct, true);
    assert.equal(result.nextPlayerId, "p1");
    assert.equal(result.state.correctGuessesThisTurn, 1);
    assert.equal(result.state.players[1]?.rack[0]?.revealed, true);
    assert.equal(state.players[1]?.rack[0]?.revealed, false);

    const placement = stopGuessingAndPlace(result.state, "p1");
    assert.equal(placement.phase, "place");
    const placed = insertDrawnCard(placement, "p1", 1);
    assert.equal(placed.players[0]?.rack[1]?.id, "drawn");
    assert.equal(placed.players[0]?.rack[1]?.revealed, false);
    assert.equal(placed.players[placed.currentPlayerIndex]?.id, "p2");
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
    });
    assert.equal(result.state.players[1]?.rack[0]?.revealed, false);
    assert.equal(result.state.players[1]?.rack[1]?.revealed, true);
  });

  it("reveals a pending draw after a wrong guess and waits for a legal placement", () => {
    const drawn = standard("drawn", "4", "red", "diamonds");
    let state = fixtureState({
      drawPile: [drawn],
      phase: "draw",
    });
    state = drawCard(state, "p1");
    assert.equal(state.phase, "guess");
    const result = resolveGuess(state, {
      actorId: "p1",
      targetPlayerId: "p2",
      targetCardId: "p2-7",
      guess: { kind: "standard", rank: "8", color: "black" },
    });
    assert.equal(result.correct, false);
    assert.equal(result.revealedCardId, "drawn");
    assert.equal(result.state.pendingDraw?.revealed, true);
    assert.equal(result.state.phase, "penalty-place");
    assert.equal(result.nextPlayerId, "p1");

    const placed = insertDrawnCard(result.state, "p1", 1);
    assert.equal(placed.players[0]?.rack.find((card) => card.id === "drawn")?.revealed, true);
    assert.equal(placed.players[placed.currentPlayerIndex]?.id, "p2");
  });

  it("waits for the player to choose an own-card penalty after a wrong empty-pile guess", () => {
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
    });
    assert.equal(result.correct, false);
    assert.equal(result.revealedCardId, null);
    assert.equal(result.state.phase, "self-penalty");
    assert.equal(result.state.players[0]?.rack[0]?.revealed, false);

    const penalized = revealSelfPenalty(result.state, "p1", "p1-a");
    assert.equal(penalized.players[0]?.eliminated, true);
    assert.equal(penalized.players[penalized.currentPlayerIndex]?.id, "p2");
  });

  it("allows exactly one empty-pile guess and ends the turn safely when it is correct", () => {
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
    });
    assert.equal(result.correct, true);
    assert.equal(result.state.players[1]?.rack[0]?.revealed, true);
    assert.equal(result.state.turn, state.turn + 1);
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
        {
          id: "p2",
          rack: [
            { id: "cipher", kind: "joker", revealed: false },
            standard("p2-other", "K", "black", "clubs"),
          ],
          eliminated: false,
        },
        { id: "p3", rack: [standard("p3-k", "K", "black", "clubs")], eliminated: false },
      ],
    });
    const result = resolveGuess(state, {
      actorId: "p1",
      targetPlayerId: "p2",
      targetCardId: "cipher",
      guess: { kind: "joker" },
    });
    assert.equal(result.correct, true);
    assert.equal(result.revealedCardId, "cipher");
    assert.equal(result.nextPlayerId, "p2");
  });

  it("ends the game when only one active player remains", () => {
    const result = resolveGuess(fixtureState(), {
      actorId: "p1",
      targetPlayerId: "p2",
      targetCardId: "p2-7",
      guess: { kind: "standard", rank: "7", color: "black" },
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
      phase: "guess",
      pendingDraw: standard("pending", "10", "red", "hearts"),
      drawnCardId: "pending",
      drawPile: [standard("next", "J", "black", "spades")],
    });
    const restored = deserializeGameState(serializeGameState(original));
    assert.deepEqual(restored, original);
  });

  it("forfeits a timed-out current player without losing a pending draw", () => {
    const state = fixtureState({
      phase: "guess",
      pendingDraw: standard("pending", "10", "red", "hearts"),
      drawnCardId: "pending",
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

  it("does not strand a match when a starting-Joker owner forfeits", () => {
    const state = fixtureState({
      phase: "starter-place",
      startingCardIds: { p1: "starter-joker" },
      pendingStartingJokerCardIdsByPlayer: { p1: ["starter-joker"] },
      players: [
        {
          id: "p1",
          rack: [{ id: "starter-joker", kind: "joker", revealed: true }],
          eliminated: false,
        },
        { id: "p2", rack: [standard("p2", "7", "black", "clubs")], eliminated: false },
        { id: "p3", rack: [standard("p3", "K", "red", "diamonds")], eliminated: false },
      ],
    });
    const forfeited = forfeitPlayer(state, "p1");
    assert.equal(forfeited.phase, "draw");
    assert.deepEqual(forfeited.pendingStartingJokerCardIdsByPlayer, {});
    assert.equal(forfeited.players[forfeited.currentPlayerIndex]?.id, "p2");
  });
});
