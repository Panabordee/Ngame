import { RuleViolation } from "./errors.ts";
import {
  RANKS,
  SUITS,
  type Card,
  type CardColor,
  type CardIdFactory,
  type RandomSource,
  type Suit,
} from "./types.ts";

export function colorForSuit(suit: Suit): CardColor {
  return suit === "diamonds" || suit === "hearts" ? "red" : "black";
}

export function chooseJokerCount(random: RandomSource): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RuleViolation(
      "INVALID_RANDOM_VALUE",
      "Random sources must return a finite value in the range [0, 1).",
    );
  }
  return 2 + Math.floor(value * 3);
}

export function createDeck(jokerCount: number, idFactory: CardIdFactory): Card[] {
  if (!Number.isInteger(jokerCount) || jokerCount < 2 || jokerCount > 4) {
    throw new RuleViolation(
      "INVALID_JOKER_COUNT",
      "A CipherDeck match requires between two and four Jokers.",
    );
  }

  const cards: Card[] = [];
  let sequence = 0;

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({
        id: idFactory(sequence),
        kind: "standard",
        rank,
        suit,
        color: colorForSuit(suit),
        revealed: false,
      });
      sequence += 1;
    }
  }

  for (let joker = 0; joker < jokerCount; joker += 1) {
    cards.push({
      id: idFactory(sequence),
      kind: "joker",
      revealed: false,
    });
    sequence += 1;
  }

  if (new Set(cards.map((card) => card.id)).size !== cards.length) {
    throw new RuleViolation("INVALID_CARD_ID", "Card IDs must be unique and opaque.");
  }

  return cards;
}

export function shuffleDeck(cards: readonly Card[], random: RandomSource): Card[] {
  const shuffled = structuredClone(cards) as Card[];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RuleViolation(
        "INVALID_RANDOM_VALUE",
        "Random sources must return a finite value in the range [0, 1).",
      );
    }
    const swapIndex = Math.floor(value * (index + 1));
    const current = shuffled[index];
    const replacement = shuffled[swapIndex];
    if (current === undefined || replacement === undefined) {
      throw new RuleViolation("INVALID_DECK", "The deck cannot contain empty slots.");
    }
    shuffled[index] = replacement;
    shuffled[swapIndex] = current;
  }

  return shuffled;
}

export function createShuffledDeck(
  random: RandomSource,
  idFactory: CardIdFactory,
): Card[] {
  return shuffleDeck(createDeck(chooseJokerCount(random), idFactory), random);
}
