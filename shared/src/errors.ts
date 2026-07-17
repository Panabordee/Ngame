export type RuleViolationCode =
  | "DUPLICATE_PLAYER"
  | "GAME_OVER"
  | "INVALID_CARD_ID"
  | "INVALID_DECK"
  | "INVALID_INSERTION"
  | "INVALID_JOKER_COUNT"
  | "INVALID_PLAYER_COUNT"
  | "INVALID_RANDOM_VALUE"
  | "INVALID_SNAPSHOT"
  | "INVALID_TARGET"
  | "INVALID_TURN"
  | "WRONG_PHASE";

export class RuleViolation extends Error {
  readonly code: RuleViolationCode;

  constructor(code: RuleViolationCode, message: string) {
    super(message);
    this.name = "RuleViolation";
    this.code = code;
  }
}
