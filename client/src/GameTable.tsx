import { Fragment } from "react";
import {
  RANKS,
  validInsertionIndexes,
  type Card,
  type CardColor,
  type ClientGameView,
  type Rank,
} from "@ngame/shared";

import { CardView } from "./CardView.tsx";

interface GameTableProps {
  readonly game: ClientGameView;
  readonly viewerId: string;
  readonly viewerName: string;
  readonly playerNames: Readonly<Record<string, string>>;
  readonly actionsEnabled: boolean;
  readonly turnRemainingSeconds: number | null;
  readonly selectedTargetCardId: string;
  readonly selectedPenaltyCardId: string;
  readonly guessRank: Rank | "JOKER" | null;
  readonly guessColor: CardColor | null;
  readonly onSelectTarget: (playerId: string, cardId: string) => void;
  readonly onSelectGuessRank: (rank: Rank | "JOKER") => void;
  readonly onSelectGuessColor: (color: CardColor) => void;
  readonly onConfirmGuess: () => void;
  readonly onCancelGuess: () => void;
  readonly onSelectPenalty: (cardId: string) => void;
  readonly onInsert: (rackIndex: number) => void;
}

export function GameTable({
  game,
  viewerId,
  viewerName,
  playerNames,
  actionsEnabled,
  turnRemainingSeconds,
  selectedTargetCardId,
  selectedPenaltyCardId,
  guessRank,
  guessColor,
  onSelectTarget,
  onSelectGuessRank,
  onSelectGuessColor,
  onConfirmGuess,
  onCancelGuess,
  onSelectPenalty,
  onInsert,
}: GameTableProps) {
  const viewer = game.players.find((player) => player.id === viewerId);
  const opponents = game.players.filter((player) => player.id !== viewerId);
  const isViewerTurn = game.currentPlayerId === viewerId;
  const canTarget = actionsEnabled && isViewerTurn && game.phase === "guess";
  const canSelectPenalty = actionsEnabled && isViewerTurn && game.phase === "self-penalty";
  const pendingStartingJokerCardIds = new Set(game.pendingStartingJokerCardIds);
  const isStartingJokerPlacement =
    actionsEnabled &&
    game.phase === "starter-place" &&
    game.pendingStartingJokerCardIds.length > 0;
  const isPlacing =
    isStartingJokerPlacement ||
    (isViewerTurn && (game.phase === "place" || game.phase === "penalty-place"));
  const startingJokerCardId = game.pendingStartingJokerCardIds[0];
  const startingJoker = isStartingJokerPlacement
    ? viewer?.rack.find(
      (card) => card.id === startingJokerCardId && card.kind === "joker",
    ) ?? null
    : null;
  const placementRack = isStartingJokerPlacement
    ? viewer?.rack.filter((card) => !pendingStartingJokerCardIds.has(card.id)) ?? []
    : viewer?.rack ?? [];
  const visibleRack = viewer?.rack.flatMap((card): Card[] =>
    card.kind === "hidden" ? [] : [structuredClone(card) as Card],
  ) ?? [];
  const pendingCard =
    game.pendingDraw === null || game.pendingDraw.kind === "hidden"
      ? null
      : (structuredClone(game.pendingDraw) as Card);
  const displayedPendingCard = startingJoker ?? pendingCard;
  const validSlots = new Set(
    isStartingJokerPlacement
      ? Array.from({ length: placementRack.length + 1 }, (_, index) => index)
      : isPlacing && pendingCard !== null && visibleRack.length === (viewer?.rack.length ?? 0)
        ? validInsertionIndexes(visibleRack, pendingCard)
        : [],
  );
  const isTimeoutWarning =
    turnRemainingSeconds !== null && turnRemainingSeconds >= 0 && turnRemainingSeconds <= 10;

  return (
    <section className="game-table" aria-label="CipherDeck table">
      <div className="table-glow" aria-hidden="true" />

      <div className="opponent-grid">
        {opponents.map((player, playerIndex) => (
          <article
            key={player.id}
            className={`player-seat opponent-seat ${
              game.currentPlayerId === player.id ? "is-current" : ""
            } ${player.eliminated ? "is-eliminated" : ""}`}
          >
            <header className="seat-header">
              <div>
                <span className="seat-kicker">Opponent {playerIndex + 1}</span>
                <strong>{playerNames[player.id] ?? `Player · ${player.id.slice(0, 4).toUpperCase()}`}</strong>
              </div>
              <span className="card-count">{player.rack.length} cards</span>
            </header>
            <div className="rack opponent-rack">
              {player.rack.map((card, cardIndex) => {
                const selected = selectedTargetCardId === card.id;
                return (
                  <div className="target-card-wrap" key={card.id}>
                    <CardView
                      card={card}
                      selected={selected}
                      interactive={canTarget && !player.eliminated && !card.revealed}
                      onSelect={() => onSelectTarget(player.id, card.id)}
                      label={`${playerNames[player.id] ?? `Opponent ${playerIndex + 1}`}, card ${cardIndex + 1}`}
                    />
                    {selected && canTarget && (
                      <div className="guess-popover" role="dialog" aria-label="Choose your guess">
                        <div className="guess-popover-header">
                          <strong>Choose rank</strong>
                          <button type="button" onClick={onCancelGuess} aria-label="Cancel guess">×</button>
                        </div>
                        <div className="rank-grid">
                          {RANKS.map((rank) => (
                            <button
                              type="button"
                              key={rank}
                              className={guessRank === rank ? "is-active" : ""}
                              onClick={() => onSelectGuessRank(rank)}
                            >
                              {rank}
                            </button>
                          ))}
                          <button
                            type="button"
                            className={`joker-rank ${guessRank === "JOKER" ? "is-active" : ""}`}
                            onClick={() => onSelectGuessRank("JOKER")}
                          >
                            JOKER
                          </button>
                        </div>
                        {guessRank !== null && guessRank !== "JOKER" && (
                          <div className="color-picker">
                            <span>Then choose color</span>
                            <button type="button" className={`color-red ${guessColor === "red" ? "is-active" : ""}`} onClick={() => onSelectGuessColor("red")}>Red</button>
                            <button type="button" className={`color-black ${guessColor === "black" ? "is-active" : ""}`} onClick={() => onSelectGuessColor("black")}>Black</button>
                          </div>
                        )}
                        <button
                          type="button"
                          className="guess-button confirm-guess"
                          disabled={guessRank === null || (guessRank !== "JOKER" && guessColor === null)}
                          onClick={onConfirmGuess}
                        >
                          {guessRank === null
                            ? "Choose a rank"
                            : guessRank === "JOKER"
                              ? "Guess JOKER"
                              : guessColor === null
                                ? "Choose a color"
                                : `Guess ${guessRank} ${guessColor}`}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {player.eliminated && <span className="eliminated-banner">ELIMINATED</span>}
          </article>
        ))}
      </div>

      <div className="table-center">
        <div className="deck-zone">
          <div className="deck-stack" aria-label={`${game.drawPileCount} cards in draw pile`}>
            {game.drawPileCount > 0 ? (
              <span className="deck-card card-back-art" />
            ) : (
              <span className="empty-deck">EMPTY</span>
            )}
          </div>
          <div>
            <span className="zone-label">DRAW PILE</span>
            <strong>{game.drawPileCount}</strong>
          </div>
        </div>

        <div className={`turn-orbit ${isTimeoutWarning ? "is-timeout-warning" : ""}`}>
          <span>TURN</span>
          <strong>{game.turn}</strong>
          <small>{game.phase.replace("-", " ")}</small>
          <em>{turnRemainingSeconds === null ? "UNTIMED" : `${Math.floor(turnRemainingSeconds / 60).toString().padStart(2, "0")}:${(turnRemainingSeconds % 60).toString().padStart(2, "0")}`}</em>
        </div>

        <div className="pending-zone">
          <span className="zone-label">DRAWN CARD</span>
          {displayedPendingCard !== null ? (
            <CardView card={displayedPendingCard} label={isStartingJokerPlacement ? "Starting Joker" : "Pending drawn card"} />
          ) : (
            <div className="card-placeholder">—</div>
          )}
        </div>
      </div>

      {isTimeoutWarning && (
        <div className="timeout-warning" role="alert">
          <strong>{turnRemainingSeconds}</strong>
          <span>ACT NOW</span>
          <small>No action means immediate elimination</small>
        </div>
      )}

      {viewer !== undefined && (
        <article
          className={`player-seat own-seat ${isViewerTurn ? "is-current" : ""} ${
            viewer.eliminated ? "is-eliminated" : ""
          }`}
        >
          <header className="seat-header">
            <div>
              <span className="seat-kicker">Your rack</span>
              <strong>{viewerName}</strong>
            </div>
            <span className="card-count">{viewer.rack.length} cards</span>
          </header>
          <div className={`rack own-rack ${isPlacing ? "is-inserting" : ""}`}>
            {isPlacing ? (
              Array.from({ length: placementRack.length + 1 }, (_, rackIndex) => (
                <Fragment key={`slot-${rackIndex}`}>
                  {validSlots.has(rackIndex) ? (
                    <button
                      type="button"
                      className="insert-slot"
                      disabled={!actionsEnabled}
                      onClick={() => onInsert(rackIndex)}
                      aria-label={`Insert at valid position ${rackIndex + 1}`}
                    >
                      <span>+</span>
                    </button>
                  ) : (
                    <span className="insert-slot-spacer" aria-hidden="true" />
                  )}
                  {placementRack[rackIndex] !== undefined && (
                    <CardView
                      card={placementRack[rackIndex]}
                      selected={selectedPenaltyCardId === placementRack[rackIndex]?.id}
                      interactive={canSelectPenalty && !placementRack[rackIndex]?.revealed}
                      onSelect={() => onSelectPenalty(placementRack[rackIndex]?.id ?? "")}
                      label={`Your card ${rackIndex + 1}`}
                    />
                  )}
                </Fragment>
              ))
            ) : (
              viewer.rack.map((card, cardIndex) => (
                <CardView
                  key={card.id}
                  card={card}
                  selected={selectedPenaltyCardId === card.id}
                  interactive={canSelectPenalty && !card.revealed}
                  onSelect={() => onSelectPenalty(card.id)}
                  label={`Your card ${cardIndex + 1}`}
                />
              ))
            )}
          </div>
          {canSelectPenalty && (
            <p className="seat-hint">Select one unrevealed card, then confirm “Reveal selected”.</p>
          )}
          {isPlacing && (
            <p className="seat-hint">
              {game.phase === "place"
                ? "Choose a + slot. Your drawn card will stay face-down."
                : game.phase === "starter-place"
                  ? `Place your opening-hand Joker in any + slot. ${game.pendingStartingJokerCardIds.length} remaining.`
                  : "Wrong guess: choose a + slot for the revealed drawn card."}
            </p>
          )}
        </article>
      )}
    </section>
  );
}
