# CipherDeck game rules

`GAME_DESIGN.md` is the canonical design source. This document is the concise player and implementer reference for the rules currently enforced by the engine.

## Players and deck

- One match has exactly 3–6 authenticated players. The room starts automatically when its configured player count is reached.
- The server creates all 52 standard playing cards and randomly adds 2, 3, or 4 Jokers, then securely shuffles the 54–56 card deck.
- Standard card order is rank first: `A, 2, 3, 4, 5, 6, 7, 8, 9, 10, J, Q, K`.
- For equal ranks, red comes before black. Suit does not affect ordering or guessing, so two cards with the same rank and color compare equally.
- A Joker may be placed anywhere in a rack. Ignore Jokers when checking whether the standard cards remain sorted.

## Initial deal

The server calculates:

```text
base = min(8, floor((deck size - 4 × player count) / player count))
```

The first player receives `base + 1`, the last player receives `base - 1`, and every player between them receives `base`. This always leaves at least four complete draw rounds in the pile.

## Information visible to a player

- You see every card in your own rack.
- You see only IDs and positions for unrevealed opponent cards; their rank, color, suit, and Joker identity stay hidden.
- A revealed card is permanently visible to everyone.
- The server sends each player a separate viewer-safe projection. The client never receives the full authoritative deck or hidden opponent values.

## Turn sequence

1. If the draw pile contains cards, draw exactly one card.
2. Insert it into a legal rack position. A standard card must preserve rank and red-before-black order; a Joker may use any position.
3. Guess one unrevealed opponent card.

A standard guess names rank and color. A Joker guess declares only `JOKER`.

- Correct: reveal the targeted card and keep guessing in the same turn.
- Wrong after drawing: reveal the card drawn this turn in its inserted position, then end the turn.
- Wrong after the pile is empty: select and reveal one of your own unrevealed cards, then end the turn.

When the draw pile is empty, a new turn begins directly in the guess phase.

## Elimination and winner

A player is eliminated as soon as every card in their rack is revealed. The match ends when only one active player remains; that player is the winner.

## Lobby, disconnect, and forfeit

- A lobby has a fixed target of 3–6 players and is locked after the match starts.
- A dropped connection pauses actions for the whole room for 30 seconds.
- A successful reconnect resumes the same authenticated player and sends a fresh viewer-safe snapshot.
- If the timeout expires, all of that player's cards are revealed and the player is eliminated. A pending drawn card is first inserted and revealed so it cannot disappear.
- If the disconnected player owned the turn, play advances to the next active player. The winner check runs after the forfeit.
