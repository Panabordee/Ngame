import { RuleViolation } from "./errors.ts";
import { RANKS, type Card, type StandardCard } from "./types.ts";

const RANK_INDEX = new Map(RANKS.map((rank, index) => [rank, index]));

export function compareStandardCards(left: StandardCard, right: StandardCard): number {
  const rankDifference =
    (RANK_INDEX.get(left.rank) ?? Number.POSITIVE_INFINITY) -
    (RANK_INDEX.get(right.rank) ?? Number.POSITIVE_INFINITY);
  if (rankDifference !== 0) {
    return rankDifference;
  }

  if (left.color === right.color) {
    return 0;
  }
  return left.color === "red" ? -1 : 1;
}

export function isValidRackOrder(rack: readonly Card[]): boolean {
  const standardCards = rack.filter(
    (card): card is StandardCard => card.kind === "standard",
  );

  return standardCards.every((card, index) => {
    const next = standardCards[index + 1];
    return next === undefined || compareStandardCards(card, next) <= 0;
  });
}

export function sortRackKeepingJokers(rack: readonly Card[]): Card[] {
  const sortedStandardCards = rack
    .filter((card): card is StandardCard => card.kind === "standard")
    .toSorted(compareStandardCards);
  let standardIndex = 0;

  return rack.map((card) => {
    if (card.kind === "joker") {
      return structuredClone(card) as Card;
    }
    const replacement = sortedStandardCards[standardIndex];
    if (replacement === undefined) {
      throw new RuleViolation("INVALID_DECK", "The rack contains an empty card slot.");
    }
    standardIndex += 1;
    return structuredClone(replacement) as Card;
  });
}

export function insertCard(rack: readonly Card[], card: Card, index: number): Card[] {
  if (!Number.isInteger(index) || index < 0 || index > rack.length) {
    throw new RuleViolation("INVALID_INSERTION", "The rack insertion index is out of range.");
  }

  const nextRack = structuredClone(rack) as Card[];
  nextRack.splice(index, 0, structuredClone(card) as Card);
  if (!isValidRackOrder(nextRack)) {
    throw new RuleViolation(
      "INVALID_INSERTION",
      "The insertion would break rank and red-before-black ordering.",
    );
  }
  return nextRack;
}

export function validInsertionIndexes(rack: readonly Card[], card: Card): number[] {
  return Array.from({ length: rack.length + 1 }, (_, index) => index).filter((index) => {
    const candidate = structuredClone(rack) as Card[];
    candidate.splice(index, 0, structuredClone(card) as Card);
    return isValidRackOrder(candidate);
  });
}
