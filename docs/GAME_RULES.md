# CipherDeck game rules

`GAME_DESIGN.md` is the canonical design source. This document is the concise player and implementer reference for the rules currently enforced by the engine.

## Players and deck

- One match has 3–6 authenticated players. Everyone readies, then the host starts manually.
- Classic securely shuffles all 52 standard cards plus 2–4 randomized Jokers. A private Custom room selects 24–56 total cards, 2–4 Jokers, and 1–8 draw rounds; the server samples standard cards and includes every configured Joker.
- Standard card order is rank first: `A, 2, 3, 4, 5, 6, 7, 8, 9, 10, J, Q, K`.
- For equal ranks, red comes before black. Suit does not affect ordering or guessing, so two cards with the same rank and color compare equally.
- A Joker may be placed anywhere in a rack. Ignore Jokers when checking whether the standard cards remain sorted.

## Starting player and initial deal

The server presents six hidden cards. Each eligible player selects a different card, then chosen cards reveal together. Highest rank starts; Joker is above `K`. Tied highest players alone repeat with six fresh cards until one player wins. Every final selected card becomes a revealed part of its owner's initial hand. Standard cards enter legal order automatically. Before turn one, each owner positions every Joker in their opening hand, including hidden Jokers from the normal deal; opponents never receive those hidden Joker IDs.

The server calculates:

```text
base = min(8, floor((deck size - draw rounds × player count) / player count))
```

The selected starter receives `base + 1`, the player immediately before the starter in turn order receives `base - 1`, and everyone else receives `base`. Classic reserves four rounds; Custom uses the configured reserve.

## Information visible to a player

- You see every card in your own rack.
- You see only IDs and positions for unrevealed opponent cards; their rank, color, suit, and Joker identity stay hidden.
- A revealed card is permanently visible to everyone.
- The server sends each player a separate viewer-safe projection. The client never receives the full authoritative deck or hidden opponent values.

## Turn sequence

1. If the draw pile contains cards, draw exactly one card. Keep it outside the rack while guessing.
2. Guess one unrevealed opponent card before the drawn card can be placed.

A standard guess names rank and color. A Joker guess declares only `JOKER`.

- Correct while holding a drawn card: reveal the targeted card, then either guess again or stop. Stopping opens the placement step; choose a legal slot, place the drawn card face-down, and end the turn.
- Wrong while holding a drawn card: leave the target hidden, reveal the drawn card, choose a legal placement slot, and end the turn.
- The client offers only legal slots, and the server independently validates the chosen slot. A standard card must preserve rank and red-before-black order; a Joker may use any slot. Equivalent cards may have multiple legal slots.
- Empty draw pile: each turn contains exactly one forced guess. A correct guess reveals the target and ends the turn safely. A wrong guess opens the self-penalty step; select and reveal one of your own unrevealed cards, then end the turn.

When the draw pile is empty, a new turn begins directly in the forced single-guess phase.

## Turn timer

The host may choose Off, 30, 60, 90, 120, 180, or 300 seconds. The timer applies to each required action and resets after every successful action. Clients count down from the server deadline and show an orange warning during the last 10 seconds. Missing the deadline immediately eliminates the responsible player: the server reveals the whole rack and preserves/reveals any pending drawn card before advancing play. During opening-Joker placement, every owner who has not finished placing their Jokers at the deadline is eliminated. A disconnect pause also pauses the timer.

## Elimination and winner

A player is eliminated as soon as every card in their rack is revealed. The match ends when only one active player remains; that player is the winner.

## Lobby, disconnect, and forfeit

- A lobby has a 3–6 player maximum. Its creator is host; every connected player must ready, and the host starts with at least three players. Settings changes clear ready state, and host transfers by join order if the owner leaves.
- The room locks when starting-card selection begins.
- Quick Match searches public rooms only. A code room is excluded from Quick Match and gets a unique server-generated six-digit code for direct joining.
- A dropped connection pauses actions for the whole room for 30 seconds.
- A successful reconnect resumes the same authenticated player and sends a fresh viewer-safe snapshot.
- If the reconnection timeout expires, all of that player's cards are revealed and the player is eliminated. A pending drawn card is first inserted and revealed so it cannot disappear.
- If the disconnected player owned the turn, play advances to the next active player. The winner check runs after the forfeit.
