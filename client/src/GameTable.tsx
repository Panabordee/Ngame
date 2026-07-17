import { Fragment } from "react";
import {
  validInsertionIndexes,
  type Card,
  type ClientGameView,
} from "@ngame/shared";

import { CardView } from "./CardView.tsx";

interface GameTableProps {
  readonly game: ClientGameView;
  readonly viewerId: string;
  readonly viewerName: string;
  readonly actionsEnabled: boolean;
  readonly selectedTargetCardId: string;
  readonly selectedPenaltyCardId: string;
  readonly onSelectTarget: (playerId: string, cardId: string) => void;
  readonly onSelectPenalty: (cardId: string) => void;
  readonly onInsert: (rackIndex: number) => void;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

export function GameTable({
  game,
  viewerId,
  viewerName,
  actionsEnabled,
  selectedTargetCardId,
  selectedPenaltyCardId,
  onSelectTarget,
  onSelectPenalty,
  onInsert,
}: GameTableProps) {
  const viewer = game.players.find((player) => player.id === viewerId);
  const opponents = game.players.filter((player) => player.id !== viewerId);
  const isViewerTurn = game.currentPlayerId === viewerId;
  const canTarget = actionsEnabled && isViewerTurn && game.phase === "guess";
  const canSelectPenalty = actionsEnabled && isViewerTurn && game.phase === "self-penalty";
  const isPlacing =
    isViewerTurn && (game.phase === "place" || game.phase === "penalty-place");
  const visibleRack = viewer?.rack.flatMap((card): Card[] =>
    card.kind === "hidden" ? [] : [structuredClone(card) as Card],
  ) ?? [];
  const pendingCard =
    game.pendingDraw === null || game.pendingDraw.kind === "hidden"
      ? null
      : (structuredClone(game.pendingDraw) as Card);
  const validSlots = new Set(
    isPlacing && pendingCard !== null && visibleRack.length === (viewer?.rack.length ?? 0)
      ? validInsertionIndexes(visibleRack, pendingCard)
      : [],
  );

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
                <strong>{shortId(player.id)}</strong>
              </div>
              <span className="card-count">{player.rack.length} cards</span>
            </header>
            <div className="rack opponent-rack">
              {player.rack.map((card, cardIndex) => (
                <CardView
                  key={card.id}
                  card={card}
                  selected={selectedTargetCardId === card.id}
                  interactive={canTarget && !player.eliminated && !card.revealed}
                  onSelect={() => onSelectTarget(player.id, card.id)}
                  label={`Opponent ${playerIndex + 1}, card ${cardIndex + 1}`}
                />
              ))}
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

        <div className="turn-orbit">
          <span>TURN</span>
          <strong>{game.turn}</strong>
          <small>{game.phase.replace("-", " ")}</small>
        </div>

        <div className="pending-zone">
          <span className="zone-label">DRAWN CARD</span>
          {game.pendingDraw !== null ? (
            <CardView card={game.pendingDraw} label="Pending drawn card" />
          ) : (
            <div className="card-placeholder">—</div>
          )}
        </div>
      </div>

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
              Array.from({ length: viewer.rack.length + 1 }, (_, rackIndex) => (
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
                  {viewer.rack[rackIndex] !== undefined && (
                    <CardView
                      card={viewer.rack[rackIndex]}
                      selected={selectedPenaltyCardId === viewer.rack[rackIndex]?.id}
                      interactive={canSelectPenalty && !viewer.rack[rackIndex]?.revealed}
                      onSelect={() => onSelectPenalty(viewer.rack[rackIndex]?.id ?? "")}
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
                : "Wrong guess: choose a + slot for the revealed drawn card."}
            </p>
          )}
        </article>
      )}
    </section>
  );
}
