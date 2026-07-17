---
name: cipher-deck-game-engine
description: Use this skill when creating or editing the game logic of the Cipher Deck card deduction game (guessing an opponent's rank/color or colorless JOKER) — including server-side deck setup, dealing, rack ordering, turn engine, freely positioned Cipher Jokers, and win-condition logic.
---

# Cipher Deck — Game Engine Skill

## When to Use This Skill
Trigger this skill for tasks involving:
- Dealing cards / building player racks / enforcing card sort order
- Turn logic (correct guess, wrong guess, card reveal, extra guesses)
- Win/loss conditions
- Colyseus room state / schema for this game

## Core Rules to Implement Exactly (see GAME_DESIGN.md)
1. Support 3–6 players with a standard 52-card deck plus a server-randomized 2–4 Cipher Jokers.
2. Preserve at least four full draw rounds. Compute `base = min(8, floor((deckSize - 4 * playerCount) / playerCount))`; deal `base + 1` to the first player, `base - 1` to the last, and `base` to everyone else.
3. Keep standard cards sorted by rank (`A, 2–10, J, Q, K`), then color (red before black). Ignore suits. Treat standard cards with the same rank and color as ordering-equivalent. Allow Jokers at any rack position and ignore them when validating the surrounding standard-card order. Validate every insertion on the server.
4. While the draw pile contains cards, draw exactly one card and keep it pending outside the rack. Require at least one guess before placement. A correct guess permanently reveals the target and lets the player either guess again or stop; stopping requires the player to choose a server-validated rack slot, places the pending card face-down, and ends the turn.
5. A wrong guess while holding a pending drawn card leaves the guessed target hidden, permanently reveals the pending card, then requires the player to choose a server-validated rack slot before the turn ends.
6. When the draw pile is empty, require exactly one guess. A correct guess reveals the target and ends the turn safely. A wrong guess requires the player to choose one of their own unrevealed cards to reveal, then ends the turn.
7. Guess a Joker by declaring `JOKER` without a color. A correct Joker guess reveals only the targeted Joker and grants another guess normally.
8. A player loses when every card in their rack is revealed; the last remaining player wins.
9. Start fixed-size 3–6 player rooms automatically when full. Pause on disconnect for 30 seconds; on timeout, reveal the dropped player's full rack, preserve/reveal any pending drawn card, eliminate them, advance their turn if necessary, and re-evaluate the winner.

## Checklist Before Submitting Work (use every time game logic is touched)
- [ ] The server is the sole arbiter — never the client (anti-cheat).
- [ ] Unit tests cover: 2–4 randomized Jokers, 3–6 player deals, four-round draw reserve, mandatory pre-placement guess, continue-or-stop after a correct guess, hidden placement after stopping, revealed placement after a wrong guess, the empty-pile forced single guess and self-penalty path, duplicate ranks, Joker placement at every slot, invalid sort order, and end-game conditions.
- [ ] State broadcast to each client only contains what that client is allowed to see (never send the hidden values of other players' unrevealed cards — this is the most common vulnerability in this genre of game).
- [ ] Reconnect handling: pause actions for 30 seconds, preserve the full state on reconnect, and test the timeout-forfeit path without losing a pending drawn card.

## Reference Scripts
scripts/deal.ts — example deal/shuffle function (have Codex generate this from the spec above; no pre-existing file needed).

## Security Notes (matches the user's cybersecurity background)
- Validate every client action server-side (never trust client payloads directly).
- Use Colyseus's authoritative room state; never put secrets (unrevealed card values) into client-visible state.
- Rate-limit actions per turn to prevent spam/DoS from a malicious client.
