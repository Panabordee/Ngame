import { RuleViolation } from "./errors.ts";
import type { Card, CardColor, GameState, Rank, Suit } from "./types.ts";

interface VisibleStandardCard {
  readonly id: string;
  readonly kind: "standard";
  readonly rank: Rank;
  readonly suit: Suit;
  readonly color: CardColor;
  readonly revealed: boolean;
}

interface VisibleJokerCard {
  readonly id: string;
  readonly kind: "joker";
  readonly revealed: boolean;
}

interface HiddenCard {
  readonly id: string;
  readonly kind: "hidden";
  readonly revealed: false;
}

type ClientCard = VisibleStandardCard | VisibleJokerCard | HiddenCard;

function visibleCard(card: Card): VisibleStandardCard | VisibleJokerCard {
  return structuredClone(card) as VisibleStandardCard | VisibleJokerCard;
}

function hiddenCard(card: Card): HiddenCard {
  return { id: card.id, kind: "hidden", revealed: false };
}

export interface ClientGameView {
  readonly version: 1;
  readonly players: readonly {
    readonly id: string;
    readonly rack: readonly ClientCard[];
    readonly eliminated: boolean;
  }[];
  readonly drawPileCount: number;
  readonly currentPlayerId: string;
  readonly phase: GameState["phase"];
  readonly pendingDraw: ClientCard | null;
  readonly drawnCardId: string | null;
  readonly correctGuessesThisTurn: number;
  readonly winnerId: string | null;
  readonly turn: number;
}

export function projectStateForPlayer(state: GameState, viewerId: string): ClientGameView {
  if (!state.players.some((player) => player.id === viewerId)) {
    throw new RuleViolation("INVALID_TARGET", "The viewer is not part of this match.");
  }
  const currentPlayer = state.players[state.currentPlayerIndex];
  if (currentPlayer === undefined) {
    throw new RuleViolation("INVALID_TURN", "The current player index is invalid.");
  }

  return {
    version: 1,
    players: state.players.map((player) => ({
      id: player.id,
      rack: player.rack.map((card) =>
        player.id === viewerId || card.revealed ? visibleCard(card) : hiddenCard(card),
      ),
      eliminated: player.eliminated,
    })),
    drawPileCount: state.drawPile.length,
    currentPlayerId: currentPlayer.id,
    phase: state.phase,
    pendingDraw:
      state.pendingDraw === null
        ? null
        : currentPlayer.id === viewerId || state.pendingDraw.revealed
          ? visibleCard(state.pendingDraw)
          : hiddenCard(state.pendingDraw),
    drawnCardId: state.drawnCardId,
    correctGuessesThisTurn: state.correctGuessesThisTurn,
    winnerId: state.winnerId,
    turn: state.turn,
  };
}
