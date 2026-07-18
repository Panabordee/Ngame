import type { Card, CardGuess } from "./types.ts";
import type { ClientGameView } from "./view.ts";

export type RoomStatus = "waiting" | "starting" | "playing" | "paused" | "finished";
export type LobbyMode = "public" | "code";
export type RulePreset = "classic" | "custom";
export type AccountType = "registered" | "guest";
export type BotDifficulty = "easy" | "normal" | "hard";

export interface RoomSettings {
  readonly preset: RulePreset;
  readonly turnSeconds: 0 | 30 | 60 | 90 | 120 | 180 | 300;
  readonly totalCards: number;
  readonly drawRounds: number;
  readonly jokerCount: 0 | 2 | 3 | 4;
  readonly botDifficulty: BotDifficulty;
}

export interface StartingCardOptionView {
  readonly id: string;
  readonly selectedByPlayerId: string | null;
  readonly card: Card | null;
}

export interface StartingCardResultView {
  readonly playerId: string;
  readonly card: Card;
}

export interface StartingSelectionView {
  readonly phase: "choosing" | "revealed" | "joker-placement";
  readonly round: number;
  readonly eligiblePlayerIds: readonly string[];
  readonly options: readonly StartingCardOptionView[];
  readonly resolvedCards: readonly StartingCardResultView[];
  readonly starterPlayerId: string | null;
}

export interface RoomPlayer {
  readonly id: string;
  readonly displayName: string;
  readonly accountType: AccountType;
  readonly connected: boolean;
  readonly isHost: boolean;
  readonly ready: boolean;
  readonly isBot: boolean;
}

export interface StateEnvelope {
  readonly status: RoomStatus;
  readonly desiredPlayers: number;
  readonly lobbyMode: LobbyMode;
  readonly roomCode: string | null;
  readonly settings: RoomSettings;
  readonly startingSelection: StartingSelectionView | null;
  readonly hostPlayerId: string | null;
  readonly connectedPlayers: number;
  readonly players: readonly RoomPlayer[];
  readonly droppedPlayerIds: readonly string[];
  readonly reconnectDeadlineMs: number | null;
  readonly serverTimeMs: number;
  readonly turnDeadlineMs: number | null;
  readonly game: ClientGameView | null;
  readonly guessHistory: readonly GuessHistoryEntry[];
  readonly deductionMisses: readonly DeductionMissEntry[];
  readonly eventLog: readonly GameEventEntry[];
  readonly matchResult: MatchResultView | null;
  readonly isSpectator: boolean;
}

export type GameEventKind = "match-started" | "draw" | "guess" | "turn-ended" | "eliminated" | "winner";
export interface GameEventEntry { readonly id: number; readonly kind: GameEventKind; readonly actorPlayerId: string | null; readonly targetPlayerId: string | null; readonly detail: string | null; }
export interface PlayerMatchStats { readonly playerId: string; readonly guesses: number; readonly correctGuesses: number; readonly cardsRevealed: number; }
export interface MatchResultView { readonly winnerPlayerId: string | null; readonly stats: readonly PlayerMatchStats[]; }

export interface GuessHistoryEntry {
  readonly id: number;
  readonly actorPlayerId: string;
  readonly targetPlayerId: string;
  readonly targetCardId: string;
  readonly guess: CardGuess;
  readonly correct: boolean;
}

export interface DeductionMissEntry {
  readonly targetCardId: string;
  readonly guesses: readonly CardGuess[];
}

export interface RoomErrorMessage {
  readonly code: string;
  readonly message: string;
}

export type TableEmote = "thinking" | "nice" | "oops" | "good-game";
export interface TableEmoteMessage { readonly actorPlayerId: string; readonly emote: TableEmote; readonly sentAtMs: number; }

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

export interface UpdateRoomSettingsMessage {
  readonly preset: RulePreset;
  readonly turnSeconds: RoomSettings["turnSeconds"];
  readonly totalCards: number;
  readonly drawRounds: number;
  readonly jokerCount: RoomSettings["jokerCount"];
  readonly botDifficulty: BotDifficulty;
}

export interface RoomSettingsAppliedMessage {
  readonly settings: RoomSettings;
}

export interface UpdateGuestDisplayNameMessage {
  readonly displayName: string;
}

export interface GuestDisplayNameUpdatedMessage {
  readonly displayName: string;
}

export interface SelectStartingCardMessage {
  readonly cardId: string;
}
