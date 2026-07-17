import { RuleViolation } from "./errors.ts";
import type { GameState } from "./types.ts";

export function serializeGameState(state: GameState): string {
  return JSON.stringify(state);
}

export function deserializeGameState(serialized: string): GameState {
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch {
    throw new RuleViolation("INVALID_SNAPSHOT", "The game snapshot is not valid JSON.");
  }

  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1 ||
    !("players" in value) ||
    !Array.isArray(value.players) ||
    !("drawPile" in value) ||
    !Array.isArray(value.drawPile)
  ) {
    throw new RuleViolation("INVALID_SNAPSHOT", "The game snapshot has an invalid shape.");
  }

  return value as GameState;
}
