import { RuleViolation } from "./errors.ts";
import { shuffleDeck } from "./deck.ts";
import { RANKS, type Card, type RandomSource } from "./types.ts";

export interface StartingChoice {
  readonly playerId: string;
  readonly card: Card;
}

export function highestStartingPlayerIds(
  choices: readonly StartingChoice[],
): string[] {
  if (choices.length === 0) {
    throw new RuleViolation("INVALID_STARTING_CARDS", "At least one starting choice is required.");
  }
  const value = (card: Card): number =>
    card.kind === "joker" ? RANKS.length : RANKS.indexOf(card.rank);
  const highest = Math.max(...choices.map((choice) => value(choice.card)));
  return choices
    .filter((choice) => value(choice.card) === highest)
    .map((choice) => choice.playerId);
}

export function drawFreshStartingCards(
  cards: readonly Card[],
  precedingCardIds: ReadonlySet<string>,
  random: RandomSource,
  count = 6,
): { readonly selected: Card[]; readonly remaining: Card[] } {
  if (!Number.isInteger(count) || count < 1 || cards.length < count) {
    throw new RuleViolation("INVALID_DECK", "There are not enough cards for a fresh choice set.");
  }
  const fresh = cards.filter((card) => !precedingCardIds.has(card.id));
  const candidates = fresh.length >= count ? fresh : [...cards];
  const selected = shuffleDeck(candidates, random).slice(0, count);
  const selectedIds = new Set(selected.map((card) => card.id));
  return {
    selected,
    remaining: cards.filter((card) => !selectedIds.has(card.id)),
  };
}
