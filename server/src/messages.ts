import {
  RANKS,
  type CardColor,
  type GuessAction,
  type GuessMessage,
  type InsertMessage,
  type Rank,
  type SelfPenaltyMessage,
} from "@ngame/shared";
import type { CardGuess } from "@ngame/shared";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseInsertMessage(value: unknown): InsertMessage | null {
  if (!isRecord(value) || !Number.isSafeInteger(value.rackIndex)) {
    return null;
  }
  return { rackIndex: value.rackIndex as number };
}

function isRank(value: unknown): value is Rank {
  return typeof value === "string" && (RANKS as readonly string[]).includes(value);
}

function isColor(value: unknown): value is CardColor {
  return value === "red" || value === "black";
}

function parseGuess(value: unknown): CardGuess | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.kind === "joker") {
    return { kind: "joker" };
  }
  if (value.kind === "standard" && isRank(value.rank) && isColor(value.color)) {
    return { kind: "standard", rank: value.rank, color: value.color };
  }
  return null;
}

export function parseGuessMessage(value: unknown): GuessMessage | null {
  if (
    !isRecord(value) ||
    typeof value.targetPlayerId !== "string" ||
    typeof value.targetCardId !== "string"
  ) {
    return null;
  }
  const guess = parseGuess(value.guess);
  if (guess === null) {
    return null;
  }
  return {
    targetPlayerId: value.targetPlayerId,
    targetCardId: value.targetCardId,
    guess,
  };
}

export function parseSelfPenaltyMessage(value: unknown): SelfPenaltyMessage | null {
  if (!isRecord(value) || typeof value.cardId !== "string" || value.cardId.length === 0) {
    return null;
  }
  return { cardId: value.cardId };
}

export function toGuessAction(actorId: string, message: GuessMessage): GuessAction {
  return { actorId, ...message };
}
