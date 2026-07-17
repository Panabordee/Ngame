import type { CardGuess } from "./types.ts";
import type { ClientGameView } from "./view.ts";

export type RoomStatus = "waiting" | "playing" | "paused" | "finished";
export type LobbyMode = "public" | "code";

export interface RoomPlayer {
  readonly id: string;
  readonly displayName: string;
  readonly connected: boolean;
}

export interface StateEnvelope {
  readonly status: RoomStatus;
  readonly desiredPlayers: number;
  readonly lobbyMode: LobbyMode;
  readonly roomCode: string | null;
  readonly connectedPlayers: number;
  readonly players: readonly RoomPlayer[];
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
}

export interface SelfPenaltyMessage {
  readonly cardId: string;
}
