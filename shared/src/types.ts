export const RANKS = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
] as const;

export const SUITS = ["clubs", "diamonds", "hearts", "spades"] as const;

export type Rank = (typeof RANKS)[number];
export type Suit = (typeof SUITS)[number];
export type CardColor = "red" | "black";

export interface StandardCard {
  readonly id: string;
  readonly kind: "standard";
  readonly rank: Rank;
  readonly suit: Suit;
  readonly color: CardColor;
  revealed: boolean;
}

export interface JokerCard {
  readonly id: string;
  readonly kind: "joker";
  revealed: boolean;
}

export type Card = StandardCard | JokerCard;

export interface PlayerState {
  readonly id: string;
  rack: Card[];
  eliminated: boolean;
}

export type TurnPhase =
  | "starter-place"
  | "draw"
  | "guess"
  | "place"
  | "penalty-place"
  | "self-penalty"
  | "game-over";

export interface GameState {
  readonly version: 1;
  players: PlayerState[];
  drawPile: Card[];
  currentPlayerIndex: number;
  phase: TurnPhase;
  pendingDraw: Card | null;
  drawnCardId: string | null;
  correctGuessesThisTurn: number;
  startingCardIds: Record<string, string>;
  pendingStartingJokerPlayerIds: string[];
  winnerId: string | null;
  turn: number;
}

export interface StandardGuess {
  readonly kind: "standard";
  readonly rank: Rank;
  readonly color: CardColor;
}

export interface JokerGuess {
  readonly kind: "joker";
}

export type CardGuess = StandardGuess | JokerGuess;

export interface GuessAction {
  readonly actorId: string;
  readonly targetPlayerId: string;
  readonly targetCardId: string;
  readonly guess: CardGuess;
}

export interface GuessResolution {
  readonly state: GameState;
  readonly correct: boolean;
  readonly revealedCardId: string | null;
  readonly nextPlayerId: string | null;
  readonly gameOver: boolean;
  readonly winnerId: string | null;
}

export type RandomSource = () => number;
export type CardIdFactory = (sequence: number) => string;

export interface StartingCardAssignment {
  readonly playerId: string;
  readonly card: Card;
}
