import type { StateEnvelope } from "@ngame/shared";

type GameView = NonNullable<StateEnvelope["game"]>;
export type ViewerCard = GameView["players"][number]["rack"][number];

interface CardViewProps {
  readonly card: ViewerCard;
  readonly selected?: boolean;
  readonly revealed?: boolean;
  readonly interactive?: boolean;
  readonly label?: string;
  readonly onSelect?: () => void;
}

const SUIT_SYMBOLS = {
  clubs: "♣",
  diamonds: "♦",
  hearts: "♥",
  spades: "♠",
} as const;

export function CardView({
  card,
  selected = false,
  revealed = card.revealed,
  interactive = false,
  label,
  onSelect,
}: CardViewProps) {
  const classNames = [
    "playing-card",
    `card-${card.kind}`,
    selected ? "is-selected" : "",
    revealed ? "is-revealed" : "",
    interactive ? "is-interactive" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={classNames}
      disabled={!interactive}
      onClick={onSelect}
      aria-label={label ?? `${card.kind} card`}
      title={`${label ?? "Card"} · ${card.id}`}
    >
      {card.kind === "hidden" && (
        <span className="card-back-art" aria-hidden="true" />
      )}

      {card.kind === "standard" && (
        <>
          <span className={`card-corner card-color-${card.color}`}>
            <strong>{card.rank}</strong>
            <span>{SUIT_SYMBOLS[card.suit]}</span>
          </span>
          <span className={`card-center card-color-${card.color}`}>
            <strong>{card.rank}</strong>
            <span>{SUIT_SYMBOLS[card.suit]}</span>
          </span>
          <span className={`card-corner card-corner-bottom card-color-${card.color}`}>
            <strong>{card.rank}</strong>
            <span>{SUIT_SYMBOLS[card.suit]}</span>
          </span>
        </>
      )}

      {card.kind === "joker" && (
        <span className="joker-face">
          <span className="joker-glyph">✦</span>
          <strong>JOKER</strong>
          <small>CIPHER</small>
        </span>
      )}

      {revealed && <span className="reveal-mark">REVEALED</span>}
    </button>
  );
}
