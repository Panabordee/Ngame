import type { CardGuess } from "./types.ts";
import type { ClientGameView } from "./view.ts";

export type RoomStatus = "waiting" | "playing" | "paused" | "finished";

export interface StateEnvelope {
  readonly status: RoomStatus;
  readonly desiredPlayers: number;
  readonly connectedPlayers: number;
  readonly droppedPlayerIds: readonly string[];
  readonly game: ClientGameView | null;
}

export interface RoomErrorMessage {
  readonly code: string;
  readonly message: string;
}

export interface InsertMessage {
  readonly rackIndex: number;
}

export interface GuessMessage {
  readonly targetPlayerId: string;
  readonly targetCardId: string;
  readonly guess: CardGuess;
  readonly selfRevealCardId: string | null;
}
